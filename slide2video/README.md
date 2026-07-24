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
