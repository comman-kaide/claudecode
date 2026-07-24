# slide2video 引き継ぎ資料(HANDOFF)

想定読者: デスクトップ環境(ローカルPC)で作業を引き継ぐ Claude、および人間の作業者。
この資料だけで「これまでの経緯・成果物・設計・再現手順・VOICEVOXへの音声差し替え」を把握できるように書いてあります。

- リポジトリ: `comman-kaide/claudecode`
- ブランチ: `claude/seminar-slide-video-request-yiquu3`(PR #1)
- 引き継ぎ時点の最終コミット: `slide2video/` 一式(make_video.py / narrate.py / README.md / HANDOFF.md / examples/)

---

## 1. プロジェクト概要と経緯

セミナースライドPDF **「【20260728】阿波銀行:生成AI活用セミナー」(全39ページ、960×540pt、16:9)** を動画化する依頼。クラウド実行環境(Claude Code on the web)で以下を制作・納品済み。

| 段階 | 成果物 | 仕様 |
|---|---|---|
| 1 | 無音スライドショー版 | 1920×1080 / H.264 / 30fps / 306.2秒(5分06秒) / 約17MB / 無音 |
| 2 | ナレーション+BGM付き完全版 | 1920×1080 / H.264(crf20) + AAC 192k 48kHz / 30fps / **544.533秒(9分05秒)** / 約33MB |

完全版の音声は **Open JTalk(男声 nitech-m001、話速0.95)** で合成した。理由: クラウド環境はGitHub releasesへのダウンロードがプロキシで403となり、VOICEVOXを導入できなかったため。**今回の引き継ぎの目的は、ローカル環境でVOICEVOXなどのより自然な声に差し替えて再生成すること。**

動画ファイル自体は生成物のためリポジトリに含めていない(ユーザーへチャットで納品済み)。ローカルで下記手順により同一品質で再生成できる。

## 2. リポジトリ構成(slide2video/)

| ファイル | 役割 |
|---|---|
| `make_video.py` | PDF→スライドショーMP4変換CLI(映像担当)。Python標準ライブラリのみ。外部コマンド: poppler-utils(pdftoppm/pdftotext/pdfinfo)、ffmpeg |
| `narrate.py` | 台本JSON+PDF→ナレーション+BGM付きMP4の統合CLI(音声担当)。TTS→尺設計→トラック組立→BGM合成→ミックス→make_video.py呼び出し。現状のTTSはOpen JTalk実装 |
| `README.md` | 利用者向けドキュメント(オプション一覧・台本形式・ライセンス) |
| `examples/narration_script_seminar20260728.json` | **今回のセミナーの完成済み台本(39ページ分)**。このまま再利用可 |
| `HANDOFF.md` | 本資料 |

## 3. 引き継ぎに必要なもの

**リポジトリで揃うもの**: ツール一式、台本、この資料。

**ユーザー(貝出さん)に用意してもらうもの**:
1. **元のセミナースライドPDF**(「【20260728】阿波銀行:生成AI活用セミナー」全39ページ、約3.7MB)。機密性配慮のためリポジトリには入れていない。チャットに添付してもらうか、ローカルのパスを教えてもらうこと。
2. VOICEVOXを使う場合: **VOICEVOXアプリ**(https://voicevox.hiroshiba.jp/ からダウンロード)のインストールと起動。

## 4. 環境セットアップ(ローカル)

必要: Python 3.8+ / poppler-utils / ffmpeg(libx264対応・xfadeが必要なので4.3以降)。

```bash
# macOS
brew install poppler ffmpeg

# Windows(いずれか)
winget install ffmpeg   # popplerは https://github.com/oschwartz10612/poppler-windows 等で導入しPATHへ
# または WSL / scoop: scoop install poppler ffmpeg
```

Open JTalk版をそのまま再現する場合のみ(Linux/WSL): `apt install open-jtalk open-jtalk-mecab-naist-jdic hts-voice-nitech-jp-atr503-m001`。VOICEVOXに差し替えるならOpen JTalkは不要。

## 5. 再現手順(現行=Open JTalk版)

```bash
python3 slide2video/narrate.py \
  slide2video/examples/narration_script_seminar20260728.json \
  <スライドPDF> out_narrated.mp4 --workdir ./work
```

これで完全版(9分05秒・BGM付き)と同一設計の動画ができる。無音版は `python3 slide2video/make_video.py <PDF> out.mp4 --fixed 1=6.0 --fixed 38=6.0`。

## 6. VOICEVOXへの差し替え手順(本題)

### 6.1 VOICEVOX Engine の起動とAPI

- VOICEVOXアプリを起動すると、同梱のEngineが `http://127.0.0.1:50021` でREST APIを提供する(アプリを起動したままにする)。Engine単体(voicevox_engine)でも同じ。
- キャラクター(style_id)一覧: `GET /speakers`
- 合成は2段階:
  1. `POST /audio_query?text=<URLエンコード済みテキスト>&speaker=<style_id>` → 合成クエリJSON
  2. クエリJSONを必要に応じて書き換え、`POST /synthesis?speaker=<style_id>`(Content-Type: application/json、ボディ=クエリJSON)→ wavが返る
- クエリJSONの有用フィールド:
  - `outputSamplingRate`: **48000 に書き換えること**(既定24000。パイプラインは48kHz前提)
  - `outputStereo`: false(モノラルのまま)
  - `speedScale`: 話速(1.0基準。ナレーションなら0.95〜1.0推奨)
  - `prePhonemeLength` / `postPhonemeLength`: 前後無音(既定0.1s。narrate.pyの自動トリムがあるのでそのままでよい)

確認例:
```bash
curl -s "http://127.0.0.1:50021/speakers" | head
echo -n "こんにちは、テストです。" > /tmp/t.txt
curl -s -X POST "http://127.0.0.1:50021/audio_query?speaker=13" --get --data-urlencode text@/tmp/t.txt > /tmp/q.json
python3 -c "import json;q=json.load(open('/tmp/q.json'));q['outputSamplingRate']=48000;json.dump(q,open('/tmp/q.json','w'))"
curl -s -X POST "http://127.0.0.1:50021/synthesis?speaker=13" -H "Content-Type: application/json" -d @/tmp/q.json -o /tmp/t.wav
```

### 6.2 narrate.py の改修ポイント

**改修は1関数だけ。** `narrate.py` の `tts_all()`(該当箇所は「open_jtalk」で検索)がページごとのTTSを担っている。ここを差し替えれば、残りのパイプライン(無音トリム→尺設計→トラック組立→BGM→ミックス→動画生成)は無改修でそのまま動く。

推奨実装: `--engine openjtalk|voicevox`、`--speaker <style_id>`、`--voicevox-url http://127.0.0.1:50021` オプションを追加し、voicevox選択時は各ページのテキストを 6.1 の2段階APIでwav化する(urllib.request で可能。標準ライブラリ縛りを維持できる)。リトライ(数回)と、エラー時に「VOICEVOXアプリが起動しているか」を案内するメッセージがあると親切。

**守るべき契約**(build_track が検証している):
- 出力wavは **48kHz / モノラル / 16bit PCM** であること。`outputSamplingRate=48000, outputStereo=false` を指定すれば合致する。万一形式が合わない場合は `ffmpeg -i in.wav -ar 48000 -ac 1 -sample_fmt s16 out.wav` で整えてよい
- `--rate`(open_jtalk用の話速)はVOICEVOXでは `speedScale` に読み替える

### 6.3 台本について

`examples/narration_script_seminar20260728.json` は **Open JTalkの誤読対策でカナに開いた表記**(例:「エーアイ」「あわぎんこう」「かいでやすし」「まつしげちょう」)。**VOICEVOXでもこのまま使ってよい**(読みが確定しているぶん安全)。より自然な抑揚を狙って漢字表記に戻す場合は、固有名詞(貝出康=かいでやすし、阿波銀行=あわぎんこう、松茂町=まつしげちょう)の読みだけは必ず維持すること。台本形式は `{"pages":[{"page":1,"text":"..."},...]}`(1..Nの連番、欠番不可)。

### 6.4 キャラクター選定とクレジット表記(重要)

- 内容がビジネスセミナーなので、落ち着いたトーンのスタイルを推奨。`GET /speakers` で一覧を取得し、ユーザーに2〜3案(男声/女声)を聞いて決めるのがよい。
- **VOICEVOXの規約により、生成音声の利用時は「VOICEVOX:キャラクター名」のクレジット表記が必要**(キャラごとの利用規約も要確認)。動画の概要欄・配布資料・最終スライドのいずれかに記載すること。BGMは自前合成なので権利表記不要。Open JTalk版の音声(nitech-m001)はCC BY 3.0。

## 7. 設計パラメータ(完成版の値。変えるときの基準)

### 尺の設計(ナレーション駆動)

- スライドiの表示時間: `dur_i = max(narr_i + lead(0.7) + tail(0.9) + xfade(0.5), 4.5)`
- 最終ページのみ: `dur_N = max(narr_N + lead(0.7) + final_tail(2.3), 5.0)`
- 動画尺 = Σdur − xfade × (N−1)
- narr_i は **無音トリム後** のwav実長(ffprobe、小数3桁)

### 音声トラックの同期設計

- セグメント長 `L_i = dur_i − xfade`(最終ページのみ `L_N = dur_N`)→ セグメント開始時刻が映像xfadeタイムラインのoffsetと厳密に一致する
- 各セグメント = 無音0.7s + ナレーション + 残り無音(サンプル単位で組立)
- TTS出力の前後無音は自動トリム(立ち上がり前50ms/終端後100msは残す、しきい値500/32768)。Open JTalkは前後に0.4〜0.7sの無音が入るためこれが必須だった。VOICEVOXでも有効のままでよい

### BGM・ミックス

- BGM: 自前合成パッド(Cmaj7→Am7→Fmaj7→G7、1コード8s、サイン波+第2倍音、アタック1.5s/リリース2s)→ lowpass 2000Hz+軽いエコー→実測ピークを-6.9dBへ補正→動画末尾基準で3sフェードアウト
- ナレーション: loudnorm 2パス(linear)で **I=-15 LUFS**、TP=-1.5、LRA=11
- ミックス: BGM volume **0.12**(≈ナレーション比-20dB)、amix(normalize=0)→ alimiter 0.891(ピーク-1dB以内)
- いずれも `narrate.py` のオプションで変更可能(`--bgm-volume` `--loudnorm-i` `--no-bgm` など。`--help`参照)

## 8. 品質検証チェックリスト(前回の検収基準。再生成後も同じ基準で確認)

| # | 検証 | 基準 | 前回実測 |
|---|---|---|---|
| 1 | ナレーショントラック総長 vs 動画尺 | ±0.05s | 差0.0000s |
| 2 | 多重化後の音声尺 vs 映像尺 | ±0.1s(超えたら-shortestで揃う=要調査) | 0.000s |
| 3 | ナレーション開始タイミング(3ページ抽出) | 理論値±0.1s | +0.06s |
| 4 | 全体ピーク | -1dB以内 | -3.82dB |
| 5 | BGMのみ区間RMS − ナレーション区間RMS | -18〜-22dB | -18.4dB |
| 6 | スライド全数収録・解像度・faststart | 39枚 / 1920×1080 / moov先頭 | 合格 |
| 7 | 開始・中間・終了フレームの目視 | 崩れなし | 合格 |

- #3の測り方: `--workdir` 内の `narration_layout.json` に各ページの `voice_start_sec`(理論値)が出る。最終MP4の該当時刻付近を `ffmpeg -af astats`(区間切り出し)や silencedetect で見て、音声の立ち上がりと照合する。
- 動画尺の理論値は `--workdir` 内 `narration_durations.txt` 末尾の `# total_video_sec`。

## 9. 既知の注意点・ハマりどころ

1. **スライド印字番号とPDFページ番号はズレる**(表紙・章扉に番号が無いため、最終39ページ目の印字は「34」)。PDFの物理ページ1..39が正。
2. ページ36は図版のみ(研修案内チラシ)でpdftotextは0文字。ナレーション駆動なら問題にならない。
3. make_video.py はxfadeのフレーム量子化対策で各入力に0.25sの保険パッド(`PAD_TAIL`)を足している。offset計算と尺には影響しない。仕様として変更しないこと。
4. ffmpegの `aecho` は出力レベルが大きく下がる(約-12.7dB実測)。BGM系を触るときはピーク実測→補正の実装(`finish_bgm`)を残すこと。
5. 完成版32.9MBはチャット送信上限(30MiB)を超えたため、配信用は `-crf 23 -b:a 128k` で約25.8MBに再圧縮した(内容・尺は同一)。ローカルでは不要な手順。
6. クラウド環境固有の事情(GitHub releases 403、SendUserFile上限)はローカルでは該当しない。

## 10. デスクトップのClaudeへの依頼プロンプト例(コピペ用)

```
セミナースライド動画のナレーションを、より自然な声(VOICEVOX)で作り直したいです。

1. https://github.com/comman-kaide/claudecode のブランチ
   claude/seminar-slide-video-request-yiquu3 をクローンし、
   slide2video/HANDOFF.md を読んでください(完全な引き継ぎ資料です)。
2. スライドPDFはこのメッセージに添付します。
   台本は slide2video/examples/narration_script_seminar20260728.json を使ってください。
3. VOICEVOXアプリはインストール済み・起動済みです(未導入なら手順を案内してください)。
4. HANDOFF.md の6章に従って narrate.py をVOICEVOX対応に改修し、
   キャラクターの候補を2〜3案提示して私が選んだ声でナレーション+BGM付きMP4を
   再生成してください。検証は8章のチェックリストに従ってください。
```
