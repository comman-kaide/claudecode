const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI client
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

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|avi|mov|mkv|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'));
    }
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
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoPath = req.file.path;
    const audioPath = path.join(AUDIO_DIR, `audio-${Date.now()}.mp3`);
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
    await fs.remove(audioPath);

    res.json({
      success: true,
      message: 'Subtitles generated successfully',
      subtitle: srtContent,
      downloadUrl: `/api/download/${path.basename(subtitlePath)}`
    });

  } catch (error) {
    console.error('Error processing video:', error);
    res.status(500).json({
      error: 'Failed to process video',
      details: error.message
    });
  }
});

// GET endpoint to download subtitle file
app.get('/api/download/:filename', (req, res) => {
  const filePath = path.join(SUBTITLE_DIR, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Subtitle file not found' });
  }

  res.download(filePath, 'subtitles.srt');
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Auto Subtitle Generator API is running' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Upload videos to generate subtitles automatically!`);
});
