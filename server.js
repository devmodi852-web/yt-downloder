const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');
const runSetup = require('./setup');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const BIN_DIR = path.join(__dirname, 'bin');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const PUBLIC_DIR = path.join(__dirname, 'public');

const isWindows = process.platform === 'win32';

const YTDLP_PATH = isWindows
  ? path.join(BIN_DIR, 'yt-dlp.exe')
  : 'python3';

const FFMPEG_PATH = isWindows
  ? path.join(BIN_DIR, 'ffmpeg.exe')
  : 'ffmpeg';

// Enable JSON middleware
app.use(express.json());

// Ensure directories exist
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// In-memory job state
const activeJobs = new Map();

// Broadcast helper
function broadcast(jobId, data) {
  const job = activeJobs.get(jobId);

  if (!job || !job.clients) return;

  Object.assign(job, data);

  const payload = `data: ${JSON.stringify({
    status: job.status,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    error: job.error
  })}\n\n`;

  job.clients.forEach((res) => {
    res.write(payload);
  });
}

// Initialize server
async function initServer() {
  console.log('Validating dependencies...');

  try {
    if (isWindows) {
      if (!fs.existsSync(YTDLP_PATH) || !fs.existsSync(FFMPEG_PATH)) {
        console.log('Missing binaries. Running setup...');
        await runSetup();
      } else {
        console.log('All binaries found.');
      }
    } else {
      console.log('Linux environment detected.');
      console.log('Using system yt-dlp + ffmpeg.');
    }
  } catch (err) {
    console.error('Dependency initialization failed:', err.message);
  }
}

// Fetch video info
app.get('/api/info', (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      error: 'URL parameter is required.'
    });
  }

  console.log(`Fetching metadata for: ${url}`);

  const cmd = isWindows
    ? `"${YTDLP_PATH}" --dump-json "${url}"`
    : `python3 -m yt_dlp --dump-json "${url}"`;

  exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {

    if (err) {
      console.error('YT-DLP ERROR:');
      console.error(stderr);
      console.error(err);

      return res.status(500).json({
        error: 'Failed to retrieve video metadata. Make sure the URL is correct.'
      });
    }

    try {
      const metadata = JSON.parse(stdout);

      const resolutions = new Set();
      const formats = [];

      if (metadata.formats) {
        metadata.formats.forEach((f) => {
          if (f.vcodec !== 'none' && f.height) {

            resolutions.add(f.height);

            formats.push({
              formatId: f.format_id,
              height: f.height,
              ext: f.ext,
              fps: f.fps || 30,
              filesize: f.filesize || f.filesize_approx || null,
              acodec: f.acodec,
              vcodec: f.vcodec
            });
          }
        });
      }

      const sortedResolutions = Array.from(resolutions)
        .sort((a, b) => b - a)
        .filter((r) => [144, 240, 360, 480, 720, 1080, 1440, 2160].includes(r));

      const thumbs = metadata.thumbnails || [];

      const highResThumb = thumbs.reduce((prev, current) => {
        return (prev.width || 0) > (current.width || 0)
          ? prev
          : current;
      }, { url: metadata.thumbnail });

      res.json({
        title: metadata.title,
        author: metadata.uploader || metadata.channel || 'Unknown Channel',
        duration: metadata.duration,
        thumbnail: highResThumb.url,
        resolutions: sortedResolutions,
        formats: formats
      });

    } catch (parseErr) {

      console.error('Metadata parsing error:', parseErr);

      res.status(500).json({
        error: 'Error parsing video metadata.'
      });
    }
  });
});

// Download route
app.post('/api/download', (req, res) => {

  const { url, type, quality, bitrate } = req.body;

  if (!url || !type) {
    return res.status(400).json({
      error: 'URL and Type parameters are required.'
    });
  }

  const jobId = crypto.randomUUID();

  const job = {
    id: jobId,
    type,
    status: 'downloading',
    percent: 0,
    speed: '0 KiB/s',
    eta: '--:--',
    filePath: '',
    fileName: '',
    error: null,
    clients: []
  };

  activeJobs.set(jobId, job);

  res.json({
    success: true,
    jobId
  });

  let args = [];

  if (type === 'video') {

    const height = quality || '1080';

    args = [
      url,
      '-f',
      `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}]/best`,
      '--merge-output-format',
      'mp4',
      '--ffmpeg-location',
      FFMPEG_PATH,
      '-o',
      path.join(DOWNLOADS_DIR, `${jobId}.temp.%(ext)s`)
    ];

  } else if (type === 'audio') {

    const rate = bitrate || '320k';

    args = [
      url,
      '-f',
      'bestaudio',
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      rate,
      '--ffmpeg-location',
      FFMPEG_PATH,
      '-o',
      path.join(DOWNLOADS_DIR, `${jobId}.temp.%(ext)s`)
    ];

  } else if (type === 'thumbnail') {

    args = [
      url,
      '--skip-download',
      '--write-thumbnail',
      '-o',
      path.join(DOWNLOADS_DIR, `${jobId}.temp`)
    ];
  }

  const spawnArgs = isWindows
    ? args
    : ['-m', 'yt_dlp', ...args];

  console.log('Running yt-dlp...');
  console.log(spawnArgs.join(' '));

  const child = spawn(YTDLP_PATH, spawnArgs);

  child.stdout.on('data', (data) => {

    const line = data.toString();

    console.log(`[yt-dlp stdout]: ${line.trim()}`);

    const progressMatch = line.match(
      /\[download\]\s+(\d+\.\d+)%\s+of\s+\S+\s+at\s+(\S+)\s+ETA\s+(\S+)/
    );

    if (progressMatch) {

      broadcast(jobId, {
        status: 'downloading',
        percent: parseFloat(progressMatch[1]),
        speed: progressMatch[2],
        eta: progressMatch[3]
      });

      return;
    }

    if (line.includes('[Merger]')) {

      broadcast(jobId, {
        status: 'merging',
        percent: 99,
        speed: 'Merging streams...',
        eta: 'Processing'
      });
    }
  });

  child.stderr.on('data', (data) => {
    console.error(`[yt-dlp stderr]: ${data.toString().trim()}`);
  });

  child.on('close', (code) => {

    console.log(`yt-dlp exited with code ${code}`);

    if (code !== 0) {

      broadcast(jobId, {
        status: 'failed',
        error: 'Download failed.'
      });

      return;
    }

    try {

      const files = fs.readdirSync(DOWNLOADS_DIR);

      const downloadedFile = files.find((f) =>
        f.startsWith(jobId)
      );

      if (!downloadedFile) {
        throw new Error('Downloaded file not found.');
      }

      const sourcePath = path.join(DOWNLOADS_DIR, downloadedFile);

      const actualExtension = path.extname(downloadedFile);

      const destFileName = `download_${jobId}${actualExtension}`;

      const finalPath = path.join(DOWNLOADS_DIR, destFileName);

      fs.renameSync(sourcePath, finalPath);

      const titleCmd = isWindows
        ? `"${YTDLP_PATH}" --get-title "${url}"`
        : `python3 -m yt_dlp --get-title "${url}"`;

      exec(titleCmd, (err, stdout) => {

        let cleanTitle = 'youtube_download';

        if (!err && stdout) {
          cleanTitle = stdout
            .trim()
            .replace(/[/\\?%*:|"<>]/g, '_');
        }

        const finalDownloadName =
          `${cleanTitle}${actualExtension}`;

        broadcast(jobId, {
          status: 'completed',
          percent: 100,
          speed: 'Done!',
          eta: '00:00',
          filePath: finalPath,
          fileName: finalDownloadName
        });
      });

    } catch (err) {

      console.error('Post-download error:', err);

      broadcast(jobId, {
        status: 'failed',
        error: err.message
      });
    }
  });
});

// SSE progress
app.get('/api/progress/:jobId', (req, res) => {

  const { jobId } = req.params;

  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({
      error: 'Job not found.'
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  job.clients.push(res);

  res.write(`data: ${JSON.stringify({
    status: job.status,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    error: job.error
  })}\n\n`);

  req.on('close', () => {
    job.clients = job.clients.filter((c) => c !== res);
  });
});

// Retrieve download
app.get('/api/retrieve/:jobId', (req, res) => {

  const { jobId } = req.params;

  const job = activeJobs.get(jobId);

  if (!job || job.status !== 'completed') {
    return res.status(404).send('File not found.');
  }

  res.download(job.filePath, job.fileName, (err) => {

    if (err) {
      console.error(err);
    } else {

      fs.unlink(job.filePath, () => {});

      activeJobs.delete(jobId);
    }
  });
});

// Static frontend
app.use(express.static(PUBLIC_DIR));

// Start server
function startListening(port) {

  const server = app.listen(port, () => {

    console.log('========================================');
    console.log(`Server running on port ${port}`);
    console.log('========================================');

    initServer();
  });

  server.on('error', (err) => {

    if (err.code === 'EADDRINUSE') {

      console.log(`Port ${port} in use. Trying ${port + 1}`);

      startListening(port + 1);

    } else {
      console.error(err);
    }
  });
}

startListening(PORT);
