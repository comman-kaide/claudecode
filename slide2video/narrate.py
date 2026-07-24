#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
slide2video/narrate.py
台本JSON + PDF から、ナレーション+BGM付きスライドショーMP4を一括生成する汎用CLIツール。

パイプライン:
  1. 台本JSON読み込み: {"pages":[{"page":1,"text":"..."},...]} 形式(ページ1..Nの連番)
  2. Open JTalk でページごとにTTS(wav / 指定サンプルレート / モノラル)
     → 前後の無音(0.4〜0.7s程度入る)をトリム(--no-trimで無効化)
  3. 各wav(トリム後)の実長 narr_i をffprobeで取得し、表示時間を計算
       通常ページ: dur_i = max(narr_i + lead + tail + xfade, min_dur)
       最終ページ: dur_N = max(narr_N + lead + final_tail, final_min)
  4. ナレーショントラック組み立て(サンプル単位)
       セグメント長 L_i = dur_i - xfade (最終ページのみ L_N = dur_N)
       各セグメント = 無音lead + ナレーション + 残り無音
       → セグメント開始時刻が映像xfadeタイムラインのoffsetと一致する
  5. BGM合成(標準ライブラリで自前合成: Cmaj7-Am7-Fmaj7-G7のパッド、権利フリー)
       → ffmpegで lowpass + 軽いエコー + 末尾フェードアウト
  6. ミックス: ナレーション loudnorm(2パス) + BGM(音量控えめ) → amix → alimiter(-1dB)
  7. make_video.py を --durations-file + --audio 付きで呼び出して最終MP4を生成

依存: open-jtalk(+辞書+htsvoice), poppler-utils, ffmpeg
Pythonは標準ライブラリのみ使用。

使用例:
  python3 narrate.py script.json slides.pdf out.mp4 --workdir ./work
  python3 narrate.py script.json slides.pdf out.mp4 --no-bgm --rate 1.0
"""

import argparse
import json
import math
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import wave
from array import array
from pathlib import Path

DEFAULT_DIC = "/var/lib/mecab/dic/open-jtalk/naist-jdic"
DEFAULT_VOICE = "/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice"


def info(msg: str) -> None:
    print(f"[narrate] {msg}", flush=True)


def die(msg: str) -> None:
    print(f"[narrate] エラー: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


def run(cmd, capture=False, quiet=False):
    try:
        res = subprocess.run(
            [str(c) for c in cmd],
            check=True,
            text=True,
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.PIPE if (capture or quiet) else None,
        )
    except FileNotFoundError:
        die(f"コマンドが見つかりません: {cmd[0]}")
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        die(f"コマンド失敗 (exit {e.returncode}): {' '.join(map(str, cmd))}\n{stderr}")
    return res.stdout if capture else None


def require_tools():
    missing = [t for t in ("open_jtalk", "ffmpeg", "ffprobe") if shutil.which(t) is None]
    if missing:
        die("必要な外部コマンドが見つかりません: " + ", ".join(missing))


def load_script(path: Path):
    """台本JSONを読み、[(page, text), ...](1..N連番)を返す。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        die(f"台本JSONを読めません: {path} ({e})")
    pages = data.get("pages") if isinstance(data, dict) else data
    if not isinstance(pages, list) or not pages:
        die('台本JSONは {"pages":[{"page":1,"text":"..."},...]} 形式にしてください')
    try:
        items = sorted(((int(p["page"]), str(p["text"])) for p in pages), key=lambda x: x[0])
    except (KeyError, TypeError, ValueError):
        die("台本の各要素には page(数値) と text(文字列) が必要です")
    nums = [n for n, _ in items]
    if nums != list(range(1, len(nums) + 1)):
        die(f"台本のページ番号が1..Nの連番ではありません: {nums}")
    return items


def ffprobe_duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "csv=p=0", path], capture=True)
    return round(float(out.strip()), 3)


def trim_silence(src: Path, dst: Path, threshold=500, head_pad=0.05, tail_pad=0.10):
    """wavの前後無音をトリムする(立ち上がり前head_pad秒・終端後tail_pad秒は残す)。

    open_jtalkの出力は先頭・末尾に0.4〜0.7s程度の無音を含むため、
    これを除去しないとリード/テールの設計値どおりのタイミングにならない。
    """
    with wave.open(str(src), "rb") as w:
        sr = w.getframerate()
        data = array("h")
        data.frombytes(w.readframes(w.getnframes()))
    first = next((i for i, s in enumerate(data) if abs(s) > threshold), None)
    if first is None:  # 全無音ならそのまま
        shutil.copyfile(src, dst)
        return
    last = next(len(data) - 1 - i for i, s in enumerate(reversed(data)) if abs(s) > threshold)
    start = max(0, first - int(head_pad * sr))
    end = min(len(data), last + 1 + int(tail_pad * sr))
    with wave.open(str(dst), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data[start:end].tobytes())


def tts_all(items, tts_dir: Path, args):
    """全ページをTTS(+前後無音トリム)してwavパスのリストを返す。"""
    wavs = []
    for pg, text in items:
        txt = tts_dir / f"page-{pg:02d}.txt"
        raw = tts_dir / f"page-{pg:02d}_raw.wav"
        wav = tts_dir / f"page-{pg:02d}.wav"
        txt.write_text(text + "\n", encoding="utf-8")
        run(["open_jtalk", "-x", args.dic, "-m", args.voice,
             "-s", args.sample_rate, "-r", f"{args.rate:g}",
             "-ow", raw, txt], quiet=True)
        if not raw.is_file() or raw.stat().st_size <= 44:
            die(f"TTSに失敗しました: page {pg}")
        if args.no_trim:
            shutil.copyfile(raw, wav)
        else:
            trim_silence(raw, wav)
        wavs.append(wav)
    return wavs


def build_track(wavs, durations, args, out_wav: Path, layout_path: Path):
    """ナレーショントラックを組み立て、(トラック長秒, レイアウト情報)を返す。"""
    sr = args.sample_rate
    n = len(wavs)
    lead_n = int(round(args.lead * sr))
    track = array("h")
    layout = []
    pos = 0
    for i, wp in enumerate(wavs):
        with wave.open(str(wp), "rb") as w:
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (sr, 1, 2):
                die(f"想定外のwav形式です: {wp}")
            voice = array("h")
            voice.frombytes(w.readframes(w.getnframes()))
        L = durations[i] - args.xfade if i < n - 1 else durations[i]
        target = int(round(L * sr))
        rest = target - lead_n - len(voice)
        if rest < 0:
            die(f"ページ{i + 1}: セグメント長 {L:.3f}s にナレーションが収まりません")
        layout.append({
            "page": i + 1,
            "narr_sec": round(len(voice) / sr, 3),
            "duration_sec": durations[i],
            "segment_start_sec": round(pos / sr, 6),
            "voice_start_sec": round((pos + lead_n) / sr, 6),
        })
        track.frombytes(b"\x00\x00" * lead_n)
        track.extend(voice)
        track.frombytes(b"\x00\x00" * rest)
        pos += target
    with wave.open(str(out_wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(track.tobytes())
    layout_path.write_text(
        json.dumps(layout, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(track) / sr, layout


def synth_bgm(out_path: Path, seconds: float, sr: int):
    """落ち着いたコード進行のパッドBGMを標準ライブラリのみで合成(ステレオwav)。

    キーC、Cmaj7→Am7→Fmaj7→G7 を1コード8秒でループ。
    各音はサイン波+控えめな第2倍音、アタック1.5s/リリース2s、
    コードはリリース分(2s)重ねて滑らかに切り替える。ピークは-6.9dB程度に正規化。
    """
    chords = [
        [130.81, 329.63, 392.00, 493.88],  # Cmaj7: C3 E4 G4 B4
        [110.00, 261.63, 329.63, 392.00],  # Am7 : A2 C4 E4 G4
        [174.61, 220.00, 261.63, 329.63],  # Fmaj7: F3 A3 C4 E4
        [196.00, 246.94, 293.66, 349.23],  # G7  : G3 B3 D4 F4
    ]
    chord_len, attack, release = 8.0, 1.5, 2.0
    note_len = chord_len + release
    ln = int(note_len * sr)

    env = [0.0] * ln
    for s in range(ln):
        t = s / sr
        if t < attack:
            env[s] = t / attack
        elif t <= chord_len:
            env[s] = 1.0
        else:
            env[s] = max(0.0, 1.0 - (t - chord_len) / release)

    sin = math.sin
    waves = []
    for freqs in chords:
        buf = array("f", bytes(4 * ln))
        for k, f in enumerate(freqs):
            amp = 0.32 if k == 0 else 0.17  # ルートやや強め
            w1 = 2.0 * math.pi * f / sr
            for s in range(ln):
                buf[s] += (sin(w1 * s) + 0.30 * sin(2.0 * w1 * s)) * amp * env[s]
        waves.append(buf)

    n = int(seconds * sr)
    master = array("f", bytes(4 * n))
    ci, t0 = 0, 0.0
    while t0 < seconds:
        s0 = int(t0 * sr)
        cw = waves[ci % len(waves)]
        end = min(n, s0 + ln)
        for j in range(end - s0):
            master[s0 + j] += cw[j]
        ci += 1
        t0 += chord_len

    peak = max(max(master), -min(master))
    gain = (0.45 / peak) if peak > 0 else 1.0  # ピーク約-6.9dB
    delay = int(0.012 * sr)  # 右chを12ms遅らせてステレオの広がりを出す
    out = array("h", bytes(4 * n))
    for s in range(n):
        out[2 * s] = int(master[s] * gain * 32767.0)
    rg = gain * 0.92
    for s in range(n - delay):
        out[2 * (s + delay) + 1] = int(master[s] * rg * 32767.0)
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(out.tobytes())


def measure_levels(path: Path):
    """astatsで (ピークdB, RMS dB) を実測する。"""
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path),
         "-af", "astats=measure_perchannel=none", "-f", "null", "-"],
        text=True, capture_output=True)
    peak = rms = None
    for line in p.stderr.splitlines():
        if "Peak level dB:" in line:
            peak = float(line.rsplit(":", 1)[1])
        elif "RMS level dB:" in line:
            rms = float(line.rsplit(":", 1)[1])
    return peak, rms


def finish_bgm(raw: Path, out: Path, video_total: float, sr: int):
    """lowpass+軽いエコー+末尾フェードアウトでBGMを仕上げる。

    aecho等でレベルが下がるため、実測ピークを合成時と同等(-6.9dB)へ戻してから
    フェードアウトを付ける(alimiterでピーク-3dB以下を保証)。
    """
    fx = Path(raw).with_name("bgm_fx.wav")
    run(["ffmpeg", "-y", "-v", "error", "-i", raw,
         "-af", "lowpass=f=2000,aecho=0.7:0.28:64:0.22",
         "-ar", sr, "-c:a", "pcm_s16le", fx], quiet=True)
    peak, _ = measure_levels(fx)
    gain_db = (-6.9 - peak) if peak is not None else 0.0
    fade_st = max(video_total - 3.0, 0.0)  # 動画末尾までに無音へ到達させる
    af = (f"volume={gain_db:.2f}dB,"
          f"afade=t=out:st={fade_st:.3f}:d=3,"
          "alimiter=limit=0.66:level=false")  # ピーク-3dB以下の保険
    run(["ffmpeg", "-y", "-v", "error", "-i", fx, "-af", af,
         "-ar", sr, "-c:a", "pcm_s16le", out], quiet=True)


def measure_loudnorm(narr_wav: Path, i_lufs: float, tp: float, lra: float):
    """loudnorm 1パス目(測定)。JSONを返す(失敗時None)。"""
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(narr_wav),
         "-af", f"loudnorm=I={i_lufs}:TP={tp}:LRA={lra}:print_format=json",
         "-f", "null", "-"],
        text=True, capture_output=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", p.stderr, re.S)
    if p.returncode != 0 or not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def mix_audio(narr_wav: Path, bgm_wav, out_wav: Path, args):
    """ナレーション(loudnorm 2パス)とBGMをミックスしてwav出力。"""
    tp, lra = -1.5, 11.0
    ln = f"loudnorm=I={args.loudnorm_i}:TP={tp}:LRA={lra}"
    meas = measure_loudnorm(narr_wav, args.loudnorm_i, tp, lra)
    if meas:
        ln += (f":measured_I={meas['input_i']}:measured_TP={meas['input_tp']}"
               f":measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}"
               f":offset={meas['target_offset']}:linear=true")
        info(f"loudnorm 2パス: 測定 input_i={meas['input_i']} LUFS -> 目標 {args.loudnorm_i} LUFS")
    else:
        info("警告: loudnorm測定に失敗。1パス(dynamic)で正規化します")
    nar = (f"[0:a]{ln},aresample={args.sample_rate},"
           f"aformat=sample_fmts=s16:channel_layouts=stereo[nar]")
    limiter = "alimiter=limit=0.891:level=false"  # ピーク-1dB以内
    if bgm_wav:
        fc = (nar + ";"
              f"[1:a]aformat=channel_layouts=stereo,volume={args.bgm_volume}[bgm];"
              f"[nar][bgm]amix=inputs=2:duration=first:normalize=0,"
              f"{limiter},aformat=sample_fmts=s16:channel_layouts=stereo[aout]")
        inputs = ["-i", narr_wav, "-i", bgm_wav]
    else:
        fc = (f"[0:a]{ln},aresample={args.sample_rate},"
              f"{limiter},aformat=sample_fmts=s16:channel_layouts=stereo[aout]")
        inputs = ["-i", narr_wav]
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", fc,
         "-map", "[aout]", "-ar", args.sample_rate, "-c:a", "pcm_s16le", out_wav],
        quiet=True)


def main():
    p = argparse.ArgumentParser(
        description="台本JSON+PDFからナレーション+BGM付きスライドショーMP4を一括生成",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("script", help="台本JSON(pages配列にpage/text)")
    p.add_argument("pdf", help="入力PDF")
    p.add_argument("output", help="出力MP4")
    p.add_argument("--workdir", default=None,
                   help="中間ファイル置き場(未指定なら一時ディレクトリ)")
    p.add_argument("--rate", type=float, default=0.95, help="話速(open_jtalk -r)")
    p.add_argument("--no-trim", action="store_true",
                   help="TTS出力の前後無音をトリムしない")
    p.add_argument("--sample-rate", type=int, default=48000, help="音声サンプルレート")
    p.add_argument("--lead", type=float, default=0.7,
                   help="各スライド表示開始からナレーション開始までの間(秒)")
    p.add_argument("--tail", type=float, default=0.9, help="ナレーション後の間(秒)")
    p.add_argument("--min-dur", type=float, default=4.5, help="通常ページの最低表示秒")
    p.add_argument("--final-tail", type=float, default=2.3, help="最終ページのナレーション後の間(秒)")
    p.add_argument("--final-min", type=float, default=5.0, help="最終ページの最低表示秒")
    p.add_argument("--xfade", type=float, default=0.5, help="映像クロスフェード秒(make_video.pyと同値)")
    p.add_argument("--no-bgm", action="store_true", help="BGMを付けない")
    p.add_argument("--bgm-volume", type=float, default=0.12,
                   help="BGMの音量係数(0.10〜0.15目安)")
    p.add_argument("--loudnorm-i", type=float, default=-15.0,
                   help="ナレーションのラウドネス目標(LUFS)")
    p.add_argument("--dic", default=DEFAULT_DIC, help="Open JTalk辞書ディレクトリ")
    p.add_argument("--voice", default=DEFAULT_VOICE, help="htsvoiceファイル")
    p.add_argument("--audio-only", action="store_true",
                   help="音声(mix.wav)とdurationsファイルの生成までで止める(動画を作らない)")
    p.add_argument("--video-args", default="",
                   help="make_video.py へ渡す追加引数(例: \"--crf 18 --preset slow\")")
    args = p.parse_args()

    require_tools()
    script = Path(args.script).resolve()
    pdf = Path(args.pdf).resolve()
    output = Path(args.output).resolve()
    for f, name in ((script, "台本JSON"), (pdf, "PDF")):
        if not f.is_file():
            die(f"{name}が見つかりません: {f}")
    if not Path(args.dic).is_dir():
        die(f"Open JTalk辞書が見つかりません: {args.dic}")
    if not Path(args.voice).is_file():
        die(f"htsvoiceが見つかりません: {args.voice}")

    if args.workdir:
        workdir = Path(args.workdir).resolve()
    else:
        workdir = Path(tempfile.mkdtemp(prefix="narrate_"))
    tts_dir = workdir / "tts"
    tts_dir.mkdir(parents=True, exist_ok=True)

    # --- 1-2. 台本読み込み & TTS ---
    items = load_script(script)
    n = len(items)
    info(f"台本: {script} ({n}ページ)")
    info(f"TTS実行中 (open_jtalk, 話速{args.rate:g}, {args.sample_rate}Hz)...")
    wavs = tts_all(items, tts_dir, args)
    info(f"TTS完了: {n}本")

    # --- 3. 表示時間計算 ---
    narrs = [ffprobe_duration(w) for w in wavs]
    durations = []
    for i, narr in enumerate(narrs):
        if i < n - 1:
            d = max(narr + args.lead + args.tail + args.xfade, args.min_dur)
        else:
            d = max(narr + args.lead + args.final_tail, args.final_min)
        durations.append(round(d, 3))
    total = round(sum(durations) - args.xfade * (n - 1), 3)
    info("ナレーション実長と表示時間 (ページ: narr -> dur):")
    for pg, (narr, d) in enumerate(zip(narrs, durations), start=1):
        info(f"  page {pg:>3}: narr {narr:7.3f}s -> dur {d:7.3f}s")
    info(f"動画尺 = {sum(durations):.3f} - {args.xfade} x {n - 1} = {total:.3f}s")

    dur_file = workdir / "narration_durations.txt"
    with open(dur_file, "w", encoding="utf-8") as f:
        f.write("page\tduration_sec\tnarr_sec\n")
        for pg, (narr, d) in enumerate(zip(narrs, durations), start=1):
            f.write(f"{pg}\t{d:.3f}\t{narr:.3f}\n")
        f.write(f"# total_video_sec\t{total:.3f}\n")

    # --- 4. ナレーショントラック組み立て ---
    narr_track = workdir / "narration_track.wav"
    layout_json = workdir / "narration_layout.json"
    track_len, _ = build_track(wavs, durations, args, narr_track, layout_json)
    diff = track_len - total
    info(f"ナレーショントラック: {track_len:.3f}s (動画尺との差 {diff:+.4f}s)")
    if abs(diff) > 0.05:
        die("トラック総長が動画尺と±0.05sを超えて不一致です")

    # --- 5. BGM ---
    bgm_wav = None
    if not args.no_bgm:
        info("BGM合成中 (標準ライブラリ・パッド進行 Cmaj7-Am7-Fmaj7-G7)...")
        bgm_raw = workdir / "bgm_raw.wav"
        bgm_wav = workdir / "bgm.wav"
        synth_bgm(bgm_raw, total + 1.0, args.sample_rate)
        finish_bgm(bgm_raw, bgm_wav, total, args.sample_rate)
        info(f"BGM完了: {bgm_wav} ({ffprobe_duration(bgm_wav):.3f}s)")

    # --- 6. ミックス ---
    mix_wav = workdir / "mix.wav"
    info(f"ミックス中 (loudnorm I={args.loudnorm_i}, BGM volume={args.bgm_volume})...")
    mix_audio(narr_track, bgm_wav, mix_wav, args)
    mix_len = ffprobe_duration(mix_wav)
    info(f"ミックス完了: {mix_wav} ({mix_len:.3f}s)")

    if args.audio_only:
        info("--audio-only: ここで終了します。")
        info(f"  durationsファイル: {dur_file}")
        info(f"  ミックス済み音声 : {mix_wav}")
        return

    # --- 7. 動画生成 ---
    make_video = Path(__file__).resolve().with_name("make_video.py")
    if not make_video.is_file():
        die(f"make_video.py が見つかりません: {make_video}")
    cmd = [sys.executable, make_video, pdf, output,
           "--workdir", workdir / "video",
           "--durations-file", dur_file,
           "--audio", mix_wav,
           "--xfade", args.xfade]
    cmd += shlex.split(args.video_args)
    info("make_video.py を呼び出します...")
    run(cmd)
    info(f"完了: {output}")


if __name__ == "__main__":
    main()
