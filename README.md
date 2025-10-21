# 自動字幕生成アプリ | Auto Subtitle Generator

動画ファイルをアップロードするだけで、OpenAI Whisper APIを使用して自動的に字幕（SRTフォーマット）を生成するWebアプリケーションです。

## 機能

- 🎬 動画ファイルのアップロード（ドラッグ&ドロップ対応）
- 🎵 動画から音声を自動抽出
- 🤖 OpenAI Whisper APIを使用した高精度な音声認識
- 📝 SRT形式の字幕ファイル生成
- 👁️ ブラウザ上で字幕のプレビュー表示
- 💾 字幕ファイルのダウンロード
- 📊 リアルタイムの進捗表示

## 対応フォーマット

- MP4
- AVI
- MOV
- MKV
- WebM

最大ファイルサイズ: 100MB

## 必要要件

- Node.js 16以上
- FFmpeg
- OpenAI APIキー

## セットアップ

### 1. FFmpegのインストール

#### macOS
```bash
brew install ffmpeg
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install ffmpeg
```

#### Windows
[FFmpeg公式サイト](https://ffmpeg.org/download.html)からダウンロードして、PATH に追加してください。

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env.example`を`.env`にコピーして、OpenAI APIキーを設定します:

```bash
cp .env.example .env
```

`.env`ファイルを編集:
```
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
```

OpenAI APIキーは[OpenAI Platform](https://platform.openai.com/api-keys)から取得できます。

## 使い方

### サーバーの起動

```bash
npm start
```

開発モード（ファイル変更時に自動再起動）:
```bash
npm run dev
```

### アプリケーションへのアクセス

ブラウザで以下のURLを開きます:
```
http://localhost:3000
```

### 字幕の生成手順

1. Webページにアクセス
2. 動画ファイルをアップロード（クリックまたはドラッグ&ドロップ）
3. 処理が完了するまで待機（数分かかる場合があります）
4. 生成された字幕をプレビュー
5. 必要に応じてSRTファイルをダウンロード

## APIエンドポイント

### POST /api/upload
動画ファイルをアップロードして字幕を生成

**リクエスト:**
- Content-Type: multipart/form-data
- Body: video (ファイル)

**レスポンス:**
```json
{
  "success": true,
  "message": "Subtitles generated successfully",
  "subtitle": "SRT形式の字幕内容",
  "downloadUrl": "/api/download/subtitle-xxxxx.srt"
}
```

### GET /api/download/:filename
生成された字幕ファイルをダウンロード

### GET /api/health
サーバーのヘルスチェック

## プロジェクト構成

```
.
├── server.js              # Expressサーバー
├── package.json           # プロジェクト設定
├── .env                   # 環境変数（要作成）
├── .env.example           # 環境変数のテンプレート
├── .gitignore            # Git除外設定
├── public/
│   └── index.html        # フロントエンドUI
└── uploads/              # アップロード・生成ファイル保存
    ├── audio/            # 抽出された音声ファイル
    └── subtitles/        # 生成された字幕ファイル
```

## 技術スタック

### バックエンド
- **Node.js**: サーバー環境
- **Express**: Webフレームワーク
- **Multer**: ファイルアップロード処理
- **fluent-ffmpeg**: 動画から音声抽出
- **OpenAI API**: Whisper音声認識
- **fs-extra**: ファイルシステム操作

### フロントエンド
- **HTML5**: マークアップ
- **CSS3**: スタイリング（グラデーション、アニメーション）
- **Vanilla JavaScript**: UI制御、Ajax通信

## トラブルシューティング

### FFmpegが見つからない
```
Error: ffmpeg not found
```
→ FFmpegが正しくインストールされ、PATHに追加されているか確認してください。

### OpenAI APIエラー
```
Error: Invalid API key
```
→ `.env`ファイルのAPIキーが正しいか確認してください。

### ファイルサイズエラー
```
Error: File too large
```
→ 100MB以下の動画ファイルを使用してください。

## 料金について

このアプリケーションはOpenAI Whisper APIを使用します。
- 料金: $0.006 / 分（音声の長さに基づく）
- 詳細: [OpenAI Pricing](https://openai.com/pricing)

## ライセンス

MIT License

## 貢献

プルリクエストやイシューの報告を歓迎します！

## サポート

問題が発生した場合は、GitHubのIssuesで報告してください。
