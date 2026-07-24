#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
slide2video/make_video.py
PDFスライドからスライドショー形式のMP4動画を生成する汎用CLIツール。

パイプライン:
  1. pdftoppm でPDF全ページをPNG化(デフォルト200dpi)し、枚数がページ数と一致するか検証
  2. ffmpeg で各PNGを指定解像度(デフォルト1920x1080)に統一(PNGヘッダで実寸を検証)
  3. pdftotext で各ページの文字数(空白・改行除去後)を取得し、表示時間を自動計算
       duration = base + chars / chars_per_sec  (min/maxでクランプ、--fixedで個別固定可)
  4. xfadeフィルタチェーン(クロスフェード)でPythonがfilter_complexを生成し、
     H.264(libx264/yuv420p/+faststart/無音)でエンコード
     xfadeのoffsetは「累積表示時間 - xfade秒 x 結合回数」で計算

依存: poppler-utils (pdftoppm/pdftotext/pdfinfo), ffmpeg
Pythonは標準ライブラリのみ使用。

使用例:
  python3 make_video.py slides.pdf out.mp4
  python3 make_video.py slides.pdf out.mp4 --fixed 1=6.0 --fixed 38=6.0 --workdir ./work
"""

import argparse
import math
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

# xfade入力の末尾に足す保険時間(秒)。フレーム量子化で最終フレームが欠けて
# クロスフェードが frame 不足にならないようにする(最終入力を除く)。
# 表示タイミング自体は xfade の offset で決まるため、動画尺には影響しない。
PAD_TAIL = 0.25


def info(msg: str) -> None:
    print(f"[slide2video] {msg}", flush=True)


def die(msg: str) -> None:
    print(f"[slide2video] エラー: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


def run(cmd, capture=False, quiet=False):
    """外部コマンドを実行。失敗したら終了。capture=Trueでstdoutを返す。"""
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
    missing = [t for t in ("pdftoppm", "pdftotext", "pdfinfo", "ffmpeg") if shutil.which(t) is None]
    if missing:
        die("必要な外部コマンドが見つかりません: " + ", ".join(missing)
            + " (poppler-utils と ffmpeg をインストールしてください)")


def pdf_page_count(pdf: Path) -> int:
    out = run(["pdfinfo", pdf], capture=True)
    m = re.search(r"^Pages:\s+(\d+)", out, re.M)
    if not m:
        die(f"pdfinfoからページ数を取得できません: {pdf}")
    return int(m.group(1))


def png_size(path: Path):
    """PNGヘッダ(IHDR)から (width, height) を読む。標準ライブラリのみ。"""
    with open(path, "rb") as f:
        head = f.read(33)
    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        die(f"PNGとして読めません: {path}")
    return struct.unpack(">II", head[16:24])


def page_char_count(pdf: Path, page: int) -> int:
    """該当ページのテキストを抽出し、空白・改行を除去した文字数を返す。"""
    out = run(["pdftotext", "-f", page, "-l", page, "-enc", "UTF-8", pdf, "-"],
              capture=True)
    # str.split() はスペース/タブ/改行/改ページ/全角スペース等の
    # Unicode空白すべてで分割するので、joinすれば空白除去になる
    return len("".join(out.split()))


def parse_fixed(values):
    fixed = {}
    for v in values or []:
        m = re.fullmatch(r"(\d+)=([0-9.]+)", v.strip())
        if not m:
            die(f"--fixed の形式が不正です: '{v}' (例: --fixed 1=6.0)")
        fixed[int(m.group(1))] = float(m.group(2))
    return fixed


def build_filter_script(durations, args, total):
    """filter_complex の中身を生成して文字列で返す。"""
    n = len(durations)
    lines = []
    for i in range(n):
        lines.append(f"[{i}:v]settb=AVTB,fps={args.fps},setsar=1,format=yuv420p[v{i}];")

    cur = "[v0]"
    if n > 1:
        cum = 0.0
        for k in range(1, n):  # k = 結合回数(1始まり)
            cum += durations[k - 1]          # それまでの累積表示時間
            offset = cum - args.xfade * k    # 累積表示時間 - xfade秒 x 結合回数
            out = f"[x{k}]"
            lines.append(
                f"{cur}[v{k}]xfade=transition={args.transition}"
                f":duration={args.xfade:.3f}:offset={offset:.3f}{out};"
            )
            cur = out

    tail = []
    if args.fadein > 0:
        tail.append(f"fade=t=in:st=0:d={args.fadein:.3f}")
    if args.fadeout > 0:
        st = max(total - args.fadeout, 0.0)
        tail.append(f"fade=t=out:st={st:.3f}:d={args.fadeout:.3f}")
    tail.append("format=yuv420p")
    lines.append(f"{cur}{','.join(tail)}[vout]")
    return "\n".join(lines) + "\n"


def main():
    p = argparse.ArgumentParser(
        description="PDFスライドからスライドショーMP4を生成する(クロスフェード付き・無音)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("pdf", help="入力PDFのパス")
    p.add_argument("output", help="出力MP4のパス")
    p.add_argument("--workdir", default=None,
                   help="中間ファイル置き場(未指定なら一時ディレクトリを作成し、終了時に削除)")
    p.add_argument("--keep-workdir", action="store_true",
                   help="一時ディレクトリを削除せず残す(--workdir指定時は常に残る)")
    p.add_argument("--width", type=int, default=1920, help="出力の横解像度(偶数)")
    p.add_argument("--height", type=int, default=1080, help="出力の縦解像度(偶数)")
    p.add_argument("--dpi", type=int, default=200, help="pdftoppmのレンダリング解像度(dpi)")
    p.add_argument("--fps", type=int, default=30, help="出力フレームレート")
    p.add_argument("--base", type=float, default=3.5, help="表示時間の基礎秒数")
    p.add_argument("--chars-per-sec", type=float, default=45.0,
                   help="1秒あたりの読み文字数(表示時間 = base + 文字数/この値)")
    p.add_argument("--min-dur", type=float, default=4.0, help="表示時間の下限(秒)")
    p.add_argument("--max-dur", type=float, default=12.0, help="表示時間の上限(秒)")
    p.add_argument("--fixed", action="append", metavar="PAGE=SEC",
                   help="特定ページの表示時間を固定(例: --fixed 1=6.0)。複数指定可")
    p.add_argument("--xfade", type=float, default=0.5, help="スライド間クロスフェード秒数")
    p.add_argument("--transition", default="fade", help="xfadeのtransition名")
    p.add_argument("--fadein", type=float, default=0.8, help="冒頭フェードイン秒数(0で無効)")
    p.add_argument("--fadeout", type=float, default=1.0, help="末尾フェードアウト秒数(0で無効)")
    p.add_argument("--fit", choices=("stretch", "pad"), default="stretch",
                   help="アスペクト比が合わない場合の合わせ方: stretch=引き伸ばし(scale=WxH), "
                        "pad=レターボックス(黒帯)")
    p.add_argument("--crf", type=int, default=20, help="libx264のCRF値")
    p.add_argument("--preset", default="medium", help="libx264のpreset")
    p.add_argument("--dry-run", action="store_true",
                   help="表示時間の計算とffmpegコマンド生成のみ行い、エンコードしない")
    args = p.parse_args()

    require_tools()

    pdf = Path(args.pdf).resolve()
    output = Path(args.output).resolve()
    if not pdf.is_file():
        die(f"PDFが見つかりません: {pdf}")
    if args.width % 2 or args.height % 2:
        die("--width / --height は偶数を指定してください(yuv420pの制約)")
    if args.xfade < 0:
        die("--xfade は0以上を指定してください")
    output.parent.mkdir(parents=True, exist_ok=True)

    # 作業ディレクトリ
    if args.workdir:
        workdir = Path(args.workdir).resolve()
        workdir.mkdir(parents=True, exist_ok=True)
        cleanup = False
    else:
        workdir = Path(tempfile.mkdtemp(prefix="slide2video_"))
        cleanup = not args.keep_workdir
    raw_dir = workdir / "raw"
    frames_dir = workdir / "frames"
    raw_dir.mkdir(parents=True, exist_ok=True)
    frames_dir.mkdir(parents=True, exist_ok=True)

    # --- 1. ページ数取得 & PNG化 ---
    n_pages = pdf_page_count(pdf)
    info(f"入力PDF: {pdf}")
    info(f"ページ数: {n_pages}")
    info(f"pdftoppm -png -r {args.dpi} でPNG化中...")
    run(["pdftoppm", "-png", "-r", args.dpi, pdf, raw_dir / "page"], quiet=True)
    raw_pages = sorted(raw_dir.glob("page-*.png"))
    if len(raw_pages) != n_pages:
        die(f"PNG化の枚数不一致: PDF {n_pages}ページに対しPNG {len(raw_pages)}枚")
    info(f"PNG化完了: {len(raw_pages)}枚 (ページ数と一致することを確認)")

    # --- 2. 解像度統一 ---
    if args.fit == "stretch":
        vf = f"scale={args.width}:{args.height},setsar=1"
    else:
        vf = (f"scale={args.width}:{args.height}:force_original_aspect_ratio=decrease,"
              f"pad={args.width}:{args.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1")
    info(f"{args.width}x{args.height} へ統一中 (fit={args.fit})...")
    scaled_pages = []
    for src in raw_pages:
        dst = frames_dir / src.name
        run(["ffmpeg", "-y", "-v", "error", "-i", src, "-vf", vf, dst], quiet=True)
        w, h = png_size(dst)
        if (w, h) != (args.width, args.height):
            die(f"解像度統一に失敗: {dst} は {w}x{h}")
        scaled_pages.append(dst)
    if len(scaled_pages) != n_pages:
        die(f"統一後の枚数不一致: {len(scaled_pages)}枚 (期待 {n_pages}枚)")
    info(f"解像度統一完了: {len(scaled_pages)}枚すべて {args.width}x{args.height}")

    # --- 3. 表示時間計算 ---
    fixed = parse_fixed(args.fixed)
    unknown = [pg for pg in fixed if not (1 <= pg <= n_pages)]
    if unknown:
        die(f"--fixed のページ番号が範囲外です: {unknown} (1〜{n_pages})")
    info("pdftotext で文字数を取得し表示時間を計算中...")
    durations, char_counts = [], []
    for pg in range(1, n_pages + 1):
        chars = page_char_count(pdf, pg)
        char_counts.append(chars)
        if pg in fixed:
            d = float(fixed[pg])
        else:
            d = args.base + chars / args.chars_per_sec
            d = min(max(d, args.min_dur), args.max_dur)
        durations.append(round(d, 3))
    bad = [i + 1 for i, d in enumerate(durations) if n_pages > 1 and d <= args.xfade]
    if bad:
        die(f"表示時間がクロスフェード({args.xfade}s)以下のページがあります: {bad}")

    total = round(sum(durations) - args.xfade * (n_pages - 1), 3)
    info("表示時間一覧 (ページ: 文字数 -> 秒):")
    for pg, (c, d) in enumerate(zip(char_counts, durations), start=1):
        mark = " [固定]" if pg in fixed else ""
        info(f"  page {pg:>3}: {c:>4}文字 -> {d:6.3f}s{mark}")
    info(f"合計表示時間 {sum(durations):.3f}s - クロスフェード {args.xfade}s x {n_pages - 1}回 "
         f"= 動画尺 {total:.3f}s")
    dur_file = workdir / "durations.txt"
    with open(dur_file, "w", encoding="utf-8") as f:
        f.write("page\tchars\tduration_sec\n")
        for pg, (c, d) in enumerate(zip(char_counts, durations), start=1):
            f.write(f"{pg}\t{c}\t{d:.3f}\n")
        f.write(f"# total_video_sec\t{total:.3f}\n")

    # --- 4. filter_complex 生成 & エンコード ---
    filter_script = workdir / "filter_complex.txt"
    filter_script.write_text(build_filter_script(durations, args, total), encoding="utf-8")
    info(f"filter_complex を生成: {filter_script}")

    cmd = ["ffmpeg", "-y", "-hide_banner"]
    for i, (img, d) in enumerate(zip(scaled_pages, durations)):
        t = d + (PAD_TAIL if i < n_pages - 1 else 0.0)  # 最終入力以外は保険を足す
        cmd += ["-loop", "1", "-t", f"{t:.3f}", "-framerate", args.fps, "-i", img]
    cmd += [
        "-filter_complex_script", filter_script,
        "-map", "[vout]",
        "-c:v", "libx264", "-preset", args.preset, "-crf", args.crf,
        "-pix_fmt", "yuv420p", "-r", args.fps,
        "-movflags", "+faststart",
        "-an",
        output,
    ]
    (workdir / "ffmpeg_cmd.txt").write_text(
        " ".join(str(c) for c in cmd) + "\n", encoding="utf-8")

    if args.dry_run:
        info("dry-run: エンコードをスキップしました。生成コマンド:")
        print(" ".join(str(c) for c in cmd))
        return

    info(f"ffmpegでエンコード中 (想定尺 {total:.1f}s)... しばらくかかります")
    run(cmd, quiet=True)
    if not output.is_file():
        die("出力ファイルが生成されませんでした")
    size_mb = output.stat().st_size / (1024 * 1024)
    info(f"完了: {output} ({size_mb:.1f} MB, 想定尺 {total:.3f}s)")

    if shutil.which("ffprobe"):
        probe = run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                     "-show_entries",
                     "stream=codec_name,width,height,avg_frame_rate:format=duration",
                     "-of", "default=noprint_wrappers=1", output], capture=True)
        info("ffprobe結果:\n" + probe.strip())

    if cleanup:
        shutil.rmtree(workdir, ignore_errors=True)
    else:
        info(f"中間ファイル: {workdir}")


if __name__ == "__main__":
    main()
