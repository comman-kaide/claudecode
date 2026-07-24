# slide2video — PDFスライドをスライドショーMP4に変換するCLIツール

PDFのスライド資料(セミナー資料・プレゼン資料など)から、クロスフェード付きの
スライドショー形式MP4動画(H.264 / 無音)を一括生成するコマンドラインツールです。

各スライドの表示時間は、ページ内の文字数に応じて自動調整されます
(文字が多いページほど長く表示)。

## パイプライン

1. `pdfinfo` でページ数を取得
2. `pdftoppm -png -r <dpi>` で全ページをPNG化(枚数がページ数と一致するか検証)
3. `ffmpeg` で各PNGを指定解像度(既定 1920x1080)に統一(PNGヘッダで実寸を検証)
4. `pdftotext` で各ページの文字数(空白・改行除去後)を取得し、表示時間を計算
   - `表示時間 = base + 文字数 / chars_per_sec` を `min-dur`〜`max-dur` にクランプ
   - `--fixed PAGE=SEC` で特定ページのみ固定時間にできる
5. Pythonが `filter_complex` スクリプトを生成し、`xfade`(クロスフェード)チェーンで結合
   - xfadeのoffsetは「それまでの累積表示時間 − クロスフェード秒 × 結合回数」で計算
   - 冒頭フェードイン(黒から)・末尾フェードアウト(黒へ)を付加
6. libx264 (CRF/preset指定可)、yuv420p、`+faststart`、音声トラックなしでMP4出力

動画の総尺 = 全ページの表示時間合計 − クロスフェード秒 × (ページ数 − 1)

## 必要要件

- Python 3.8以上(標準ライブラリのみ使用。pipでの追加インストール不要)
- poppler-utils (`pdftoppm` / `pdftotext` / `pdfinfo`)
- ffmpeg (libx264対応ビルド。4.3以降推奨 — xfadeフィルタが必要)

### インストール例

```bash
# Debian / Ubuntu
sudo apt install poppler-utils ffmpeg

# macOS (Homebrew)
brew install poppler ffmpeg
```

ツール自体はこのディレクトリの `make_video.py` を直接実行するだけです。

## 使い方

```bash
python3 make_video.py <入力PDF> <出力MP4> [オプション]
```

### 例1: 基本(既定値で変換)

```bash
python3 make_video.py slides.pdf slideshow.mp4
```

### 例2: タイトルページと締めページを6秒固定、中間ファイルを残す

```bash
python3 make_video.py seminar_slides.pdf seminar_video.mp4 \
  --workdir ./video_work \
  --fixed 1=6.0 --fixed 38=6.0
```

### 例3: 4K・テンポ速め・フェード長め

```bash
python3 make_video.py slides.pdf out.mp4 \
  --width 3840 --height 2160 --dpi 300 \
  --base 2.5 --chars-per-sec 60 --min-dur 3 --max-dur 10 \
  --xfade 0.8 --fadein 1.0 --fadeout 1.5
```

### 例4: エンコードせずに表示時間の計算結果だけ確認

```bash
python3 make_video.py slides.pdf out.mp4 --dry-run
```

## オプション一覧

| オプション | 既定値 | 説明 |
|---|---|---|
| `--workdir DIR` | (一時Dir) | 中間ファイル置き場。指定すると削除されず残る |
| `--keep-workdir` | off | 一時ディレクトリを削除せず残す |
| `--width` / `--height` | 1920 / 1080 | 出力解像度(偶数のみ) |
| `--dpi N` | 200 | pdftoppmのレンダリング解像度 |
| `--fps N` | 30 | 出力フレームレート |
| `--base SEC` | 3.5 | 表示時間の基礎秒数 |
| `--chars-per-sec N` | 45 | 1秒あたりの読み文字数(表示時間の傾き) |
| `--min-dur` / `--max-dur` | 4.0 / 12.0 | 表示時間の下限/上限(秒) |
| `--fixed PAGE=SEC` | なし | 特定ページの表示時間を固定。複数指定可 |
| `--durations-file FILE` | なし | 全ページの表示時間を直接指定(各行 `ページ番号<TAB>秒`)。指定時は文字数計算・`--fixed`を使わない |
| `--audio FILE` | なし | 指定音声を多重化(AAC 192kbps)。動画尺との差が0.1s超なら警告して`-shortest`で揃える |
| `--xfade SEC` | 0.5 | スライド間クロスフェード秒数 |
| `--transition NAME` | fade | xfadeのtransition名(wipeleft等も指定可) |
| `--fadein` / `--fadeout` | 0.8 / 1.0 | 冒頭/末尾フェード秒数(0で無効) |
| `--fit stretch\|pad` | stretch | アスペクト比が合わない時: 引き伸ばし or 黒帯 |
| `--crf N` | 20 | libx264の品質(小さいほど高品質・大容量) |
| `--preset NAME` | medium | libx264のエンコード速度プリセット |
| `--dry-run` | off | 計算とコマンド生成のみ(エンコードしない) |

## 中間ファイル(workdir内)

| ファイル | 内容 |
|---|---|
| `raw/page-NN.png` | pdftoppmが出力した元解像度PNG |
| `frames/page-NN.png` | 出力解像度に統一したPNG |
| `durations.txt` | ページ番号・文字数・表示秒数の一覧(タブ区切り) |
| `filter_complex.txt` | 生成されたffmpegフィルタグラフ |
| `ffmpeg_cmd.txt` | 実行したffmpegコマンド全文 |

## ナレーション+BGM付き動画 (narrate.py)

台本JSONとPDFから、Open JTalkによるナレーションと自前合成BGM付きの
スライドショーMP4を一括生成します。表示時間は「文字数」ではなく
「ナレーションの実長」から自動設計されます(ナレーション駆動)。

### 追加の必要要件(Open JTalk)

```bash
# Debian / Ubuntu
sudo apt install open-jtalk open-jtalk-mecab-naist-jdic hts-voice-nitech-jp-atr503-m001
```

既定パス(オプションで変更可):

- 辞書: `/var/lib/mecab/dic/open-jtalk/naist-jdic`
- 音声: `/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice`

### 台本JSONの形式

```json
{
  "pages": [
    {"page": 1, "text": "1ページ目の読み上げテキスト。"},
    {"page": 2, "text": "2ページ目の読み上げテキスト。"}
  ]
}
```

ページ番号は1..Nの連番で、PDFのページ数と一致させます。
読み間違いを避けるため、固有名詞や英字はカナで書くのがおすすめです
(例: 「生成AI」→「生成エーアイ」)。

### 使い方

```bash
# 基本(ナレーション+BGM)
python3 narrate.py script.json slides.pdf out.mp4 --workdir ./work

# BGMなし・話速1.0
python3 narrate.py script.json slides.pdf out.mp4 --no-bgm --rate 1.0

# 音声(mix.wav)とdurationsファイルの生成までで止める(動画は後で)
python3 narrate.py script.json slides.pdf out.mp4 --workdir ./work --audio-only
python3 make_video.py slides.pdf out.mp4 --workdir ./work/video \
  --durations-file ./work/narration_durations.txt --audio ./work/mix.wav
```

### 処理内容

1. Open JTalk でページごとにTTS(モノラル/指定サンプルレート)。
   出力の前後に入る無音(0.4〜0.7s程度)は自動トリム(`--no-trim`で無効化)
2. 各ナレーション実長 `narr` から表示時間を計算
   - 通常ページ: `dur = max(narr + lead + tail + xfade, min_dur)`
   - 最終ページ: `dur = max(narr + lead + final_tail, final_min)`
3. ナレーショントラックを組み立て(各スライドの表示開始 `lead` 秒後に
   ナレーションが始まるよう、映像のxfadeタイムラインとサンプル単位で同期)
4. BGMを標準ライブラリで自前合成(キーC、Cmaj7→Am7→Fmaj7→G7のパッド、
   1コード8秒、権利フリー)→ ffmpegで lowpass 2kHz+軽いエコー+末尾フェードアウト
5. ナレーションを loudnorm(2パス、既定 -15 LUFS)で正規化し、
   BGM(既定 volume 0.112 ≒ ナレーション比約-20dB)と amix →
   alimiter でピーク-1dB以内 → 48kHzステレオ
6. `make_video.py --durations-file --audio` を呼び出してMP4化

### narrate.py の主なオプション

| オプション | 既定値 | 説明 |
|---|---|---|
| `--rate` | 0.95 | 話速(open_jtalk -r) |
| `--lead` | 0.7 | スライド表示開始からナレーション開始までの間(秒) |
| `--tail` | 0.9 | ナレーション後の間(秒) |
| `--min-dur` | 4.5 | 通常ページの最低表示秒 |
| `--final-tail` / `--final-min` | 2.3 / 5.0 | 最終ページの余韻・最低表示秒 |
| `--xfade` | 0.5 | 映像クロスフェード秒(make_video.pyへも渡る) |
| `--no-bgm` | off | BGMを付けない |
| `--bgm-volume` | 0.12 | BGM音量係数(0.10〜0.15目安) |
| `--loudnorm-i` | -15.0 | ナレーションのラウドネス目標(LUFS) |
| `--no-trim` | off | TTS出力の前後無音をトリムしない |
| `--dic` / `--voice` | 上記既定パス | Open JTalkの辞書/声モデル |
| `--audio-only` | off | 音声とdurationsファイルの生成までで止める |
| `--video-args "..."` | なし | make_video.pyへの追加引数(例: `"--crf 18"`) |

### ライセンス注記

- Open JTalk・付属辞書は修正BSDライセンスです。
- nitech-jp-atr503-m001 音声モデルは CC BY 3.0(名古屋工業大学)です。
  生成音声を含む動画を公開する場合はクレジット表記を推奨します。
- BGMは本ツールがその場で数値合成するオリジナル波形のため、権利フリーです。

## 注意点

- 16:9のPDF(例: 960x540pt)を16:9解像度へ変換する場合は無劣化のアスペクト比で
  変換されます。アスペクト比が異なるPDFは既定では引き伸ばされるため、
  `--fit pad` (黒帯レターボックス)の使用を検討してください。
- 表示時間はクロスフェード秒数より長い必要があります(短いとエラーで停止)。
- 文字が抽出できないページ(画像のみのページ)は文字数0として扱われ、
  `--min-dur` の時間だけ表示されます。
- ページ数が多い・尺が長いほどエンコードに時間がかかります
  (目安: 39ページ・尺約5分・1080p30で数分程度)。
- 出力は無音です。BGMを付ける場合は後段で
  `ffmpeg -i video.mp4 -i bgm.mp3 -c:v copy -c:a aac -shortest out.mp4` などを利用してください。
