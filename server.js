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
const YTDLP_PATH = path.join(BIN_DIR, isWindows ? 'yt-dlp' : 'yt-dlp');
const FFMPEG_PATH = path.join(BIN_DIR, isWindows ? 'ffmpeg' : 'ffmpeg');

// Enable JSON middleware
app.use(express.json());

// Ensure directories exist
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// In-memory job state
const activeJobs = new Map();

// Helper to broadcast progress updates to all SSE clients connected to a job
function broadcast(jobId, data) {
  const job = activeJobs.get(jobId);
  if (!job || !job.clients) return;
  
  // Update internal job state
  Object.assign(job, data);
  
  const payload = `data: ${JSON.stringify({
    status: job.status,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    error: job.error
  })}\n\n`;
  
  job.clients.forEach(res => {
    res.write(payload);
  });
}

// 1. Check & Auto-download dependencies on server startup
async function initServer() {
  console.log('Validating dependencies...');
  try {
    if (!fs.existsSync(YTDLP_PATH) || !fs.existsSync(FFMPEG_PATH)) {
      console.log('Missing yt-dlp or ffmpeg! Starting automatic downloader...');
      await runSetup();
    } else {
      console.log('✔ All binaries found.');
    }
  } catch (err) {
    console.error('❌ Dependency initialization failed:', err.message);
  }
}

// 2. Fetch video information & available resolutions
app.get('/api/info', (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required.' });
  }

  console.log(`Fetching metadata for: ${url}`);
  
  // Execute yt-dlp to get JSON representation of video metadata
  const cmd = `"${YTDLP_PATH}" --dump-json "${url}"`;
  
  exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      console.error('yt-dlp execution error:', err.message);
      return res.status(500).json({ error: 'Failed to retrieve video metadata. Make sure the URL is correct.' });
    }
    
    try {
      const metadata = JSON.parse(stdout);
      
      // Parse formats and filter unique heights (resolutions)
      const resolutions = new Set();
      const formats = [];
      
      if (metadata.formats) {
        metadata.formats.forEach(f => {
          if (f.vcodec !== 'none' && f.height) {
            resolutions.add(f.height);
            
            // Push relevant details for each resolution format
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
      
      // Filter out and sort resolutions in descending order
      const sortedResolutions = Array.from(resolutions)
        .sort((a, b) => b - a)
        .filter(r => [144, 240, 360, 480, 720, 1080, 1440, 2160].includes(r));

      // Get high res thumbnails
      const thumbs = metadata.thumbnails || [];
      const highResThumb = thumbs.reduce((prev, current) => {
        return (prev.width || 0) > (current.width || 0) ? prev : current;
      }, { url: metadata.thumbnail });

      res.json({
        title: metadata.title,
        author: metadata.uploader || metadata.channel || 'Unknown Channel',
        duration: metadata.duration, // in seconds
        thumbnail: highResThumb.url,
        resolutions: sortedResolutions,
        formats: formats
      });
      
    } catch (parseErr) {
      console.error('Metadata parsing error:', parseErr);
      res.status(500).json({ error: 'Error parsing video metadata.' });
    }
  });
});

// 3. Trigger download process
app.post('/api/download', (req, res) => {
  const { url, type, quality, bitrate } = req.body;
  
  if (!url || !type) {
    return res.status(400).json({ error: 'URL and Type parameters are required.' });
  }
  
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    type: type,
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
  
  // Return the jobId instantly so client can open an SSE connection
  res.json({ success: true, jobId: jobId });
  
  // Start the background process
  let args = [];
  let fileExtension = 'mp4';
  
  if (type === 'video') {
    const height = quality || '1080';
    fileExtension = 'mp4';
    // Format selector: select best video under or equal to chosen height, combine with best audio
    args = [
      url,
      '-f', `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}]/best`,
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', FFMPEG_PATH,
      '-o', path.join(DOWNLOADS_DIR, `${jobId}.temp.%(ext)s`)
    ];
  } else if (type === 'audio') {
    fileExtension = 'mp3';
    const rate = bitrate || '320k';
    args = [
      url,
      '-f', 'bestaudio',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', rate,
      '--ffmpeg-location', FFMPEG_PATH,
      '-o', path.join(DOWNLOADS_DIR, `${jobId}.temp.%(ext)s`)
    ];
  } else if (type === 'thumbnail') {
    // Download highest resolution thumbnail directly via backend and save it
    // We can run a simplified yt-dlp command to extract thumbnail
    fileExtension = 'jpg';
    args = [
      url,
      '--skip-download',
      '--write-thumbnail',
      '-o', path.join(DOWNLOADS_DIR, `${jobId}.temp`)
    ];
  }
  
  console.log(`Spawning yt-dlp with args:`, args.join(' '));
  const child = spawn(YTDLP_PATH, args);
  
  child.stdout.on('data', (data) => {
    const line = data.toString();
    console.log(`[yt-dlp stdout]: ${line.trim()}`);
    
    // Parse progress lines from yt-dlp
    // e.g. [download]  12.4% of  54.21MiB at  4.12MiB/s ETA 00:10
    const progressMatch = line.match(/\[download\]\s+(\d+\.\d+)%\s+of\s+\S+\s+at\s+(\S+)\s+ETA\s+(\S+)/);
    if (progressMatch) {
      broadcast(jobId, {
        status: 'downloading',
        percent: parseFloat(progressMatch[1]),
        speed: progressMatch[2],
        eta: progressMatch[3]
      });
      return;
    }
    
    // Parse merger status
    // e.g. [Merger] Merging formats into "..."
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
    console.log(`yt-dlp process exited with code ${code}`);
    if (code !== 0) {
      broadcast(jobId, {
        status: 'failed',
        error: 'Download process exited with an error. Please verify the URL or try another option.'
      });
      return;
    }
    
    // Locate the downloaded file
    // yt-dlp might have written it as jobId.temp.mp4, jobId.temp.mp3, jobId.temp.jpg, etc.
    try {
      const files = fs.readdirSync(DOWNLOADS_DIR);
      const downloadedFile = files.find(f => f.startsWith(jobId));
      
      if (!downloadedFile) {
        throw new Error('Downloaded file could not be found on disk.');
      }
      
      const sourcePath = path.join(DOWNLOADS_DIR, downloadedFile);
      const actualExtension = path.extname(downloadedFile); // e.g. .mp4 or .mp3
      const destFileName = `download_${jobId}${actualExtension}`;
      const finalPath = path.join(DOWNLOADS_DIR, destFileName);
      
      // Rename to a static clean name
      fs.renameSync(sourcePath, finalPath);
      
      // Get title/metadata for browser download filename
      exec(`"${YTDLP_PATH}" --get-title "${url}"`, (err, stdout) => {
        let cleanTitle = 'youtube_download';
        if (!err && stdout) {
          // Replace special characters to make a safe filename
          cleanTitle = stdout.trim().replace(/[/\\?%*:|"<>]/g, '_');
        }
        
        const finalDownloadName = `${cleanTitle}${actualExtension}`;
        
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
      console.error('Post-download process failed:', err);
      broadcast(jobId, {
        status: 'failed',
        error: err.message
      });
    }
  });
});

// 4. Server-Sent Events (SSE) route to track progress in real-time
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  
  // Set headers for Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Add client response object to the job client pool
  job.clients.push(res);
  
  // Send initial state immediately
  res.write(`data: ${JSON.stringify({
    status: job.status,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    error: job.error
  })}\n\n`);
  
  // Handle client connection drop
  req.on('close', () => {
    job.clients = job.clients.filter(c => c !== res);
  });
});

// 5. Download retrieval route
app.get('/api/retrieve/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);
  
  if (!job || job.status !== 'completed' || !job.filePath) {
    return res.status(404).send('File not found or download has not finished.');
  }
  
  console.log(`Client retrieving download: ${job.fileName}`);
  
  res.download(job.filePath, job.fileName, (err) => {
    if (err) {
      console.error('Error during file transfer:', err.message);
    } else {
      console.log(`Download completed and file served: ${job.fileName}`);
      // Clean up the file from disk immediately to save space!
      fs.unlink(job.filePath, (unlinkErr) => {
        if (unlinkErr) console.error('Failed to delete temp download:', unlinkErr.message);
        else console.log(`Self-cleaned downloaded file: ${job.fileName}`);
      });
      // Delete job from map
      activeJobs.delete(jobId);
    }
  });
});

// Serve frontend static files
app.use(express.static(PUBLIC_DIR));

// Start backend server
function startListening(port) {
  const server = app.listen(port, () => {
    console.log(`===================================================`);
    console.log(`🚀 Premium YouTube Downloader Server Running!`);
    console.log(`🔗 Local Access: http://localhost:${port}`);
    console.log(`===================================================`);
    
    // Trigger binary check/download asynchronously in the background after server starts!
    initServer();
  });
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying next port ${port + 1}...`);
      startListening(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startListening(PORT);
