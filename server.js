const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');
const OpenAI = require('openai');
require('dotenv').config();

const { handleMessage } = require('./services/agent');
const { startSlackBot } = require('./services/slack');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI client (for subtitle generation)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure upload directories exist
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const AUDIO_DIR = path.join(__dirname, 'uploads/audio');
const SUBTITLE_DIR = path.join(__dirname, 'uploads/subtitles');

fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(AUDIO_DIR);
fs.ensureDirSync(SUBTITLE_DIR);

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'video-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.avi', '.mov', '.mkv', '.webm']);
const ALLOWED_MIMETYPES = new Set([
  'video/mp4',
  'video/avi',
  'video/x-msvideo',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
]);

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext) && ALLOWED_MIMETYPES.has(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Only video files are allowed!'));
  }
});

// Function to extract audio from video
async function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .audioCodec('libmp3lame')
      .audioFrequency(16000)
      .audioChannels(1)
      .on('end', () => resolve(audioPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

// Function to transcribe audio using Whisper API
async function transcribeAudio(audioPath) {
  const audioFile = fs.createReadStream(audioPath);

  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment']
  });

  return transcription;
}

// Function to convert transcription to SRT format
function generateSRT(transcription) {
  let srtContent = '';

  transcription.segments.forEach((segment, index) => {
    const startTime = formatTime(segment.start);
    const endTime = formatTime(segment.end);
    const text = segment.text.trim();

    srtContent += `${index + 1}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${text}\n\n`;
  });

  return srtContent;
}

// Function to format time for SRT (HH:MM:SS,mmm)
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

// POST endpoint to upload video and generate subtitles
app.post('/api/upload', upload.single('video'), async (req, res) => {
  let videoPath = null;
  let audioPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    videoPath = req.file.path;
    audioPath = path.join(AUDIO_DIR, `audio-${Date.now()}.mp3`);
    const subtitlePath = path.join(SUBTITLE_DIR, `subtitle-${Date.now()}.srt`);

    console.log('Processing video:', req.file.originalname);

    // Step 1: Extract audio from video
    console.log('Extracting audio...');
    await extractAudio(videoPath, audioPath);

    // Step 2: Transcribe audio using Whisper
    console.log('Transcribing audio...');
    const transcription = await transcribeAudio(audioPath);

    // Step 3: Generate SRT file
    console.log('Generating subtitles...');
    const srtContent = generateSRT(transcription);
    await fs.writeFile(subtitlePath, srtContent, 'utf-8');

    // Clean up temporary files
    await fs.remove(videoPath);
    videoPath = null;
    await fs.remove(audioPath);
    audioPath = null;

    res.json({
      success: true,
      message: 'Subtitles generated successfully',
      subtitle: srtContent,
      downloadUrl: `/api/download/${path.basename(subtitlePath)}`
    });

  } catch (error) {
    console.error('Error processing video:', error);
    // Clean up any temp files that were created before the error
    if (videoPath) await fs.remove(videoPath).catch(() => {});
    if (audioPath) await fs.remove(audioPath).catch(() => {});
    res.status(500).json({
      error: 'Failed to process video',
      details: error.message
    });
  }
});

// GET endpoint to download subtitle file
app.get('/api/download/:filename', (req, res) => {
  // Prevent path traversal: filename must be a plain basename with no directory components
  const filename = path.basename(req.params.filename);
  const filePath = path.join(SUBTITLE_DIR, filename);

  // Ensure the resolved path is strictly inside SUBTITLE_DIR
  if (!filePath.startsWith(SUBTITLE_DIR + path.sep)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Subtitle file not found' });
  }

  res.download(filePath, 'subtitles.srt');
});

// ========== AI Secretary Agent API ==========

// POST endpoint to send a message to the AI secretary
app.post('/api/agent/message', async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ error: 'userId and message are required' });
    }
    const reply = await handleMessage(userId, message);
    res.json({ success: true, reply });
  } catch (error) {
    console.error('Agent error:', error);
    res.status(500).json({ error: 'Failed to process message', details: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'AI Secretary Agent is running',
    features: ['subtitle-generator', 'ai-secretary', 'slack-bot'],
  });
});

app.listen(PORT, async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Upload videos to generate subtitles automatically!`);

  // Start Slack bot if configured
  try {
    await startSlackBot();
  } catch (error) {
    console.error('Failed to start Slack bot:', error.message);
  }
});
