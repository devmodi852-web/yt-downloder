const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 3000;

// DIRECTORIES
const DOWNLOADS_DIR =
  path.join(__dirname, 'downloads');

const PUBLIC_DIR =
  path.join(__dirname, 'public');

const isWindows =
  process.platform === 'win32';

// yt-dlp + ffmpeg
const YTDLP_PATH =
  isWindows ? 'yt-dlp.exe' : 'yt-dlp';

const FFMPEG_PATH =
  isWindows ? 'ffmpeg.exe' : 'ffmpeg';

// MIDDLEWARE
app.use(express.json());

app.use(express.static(PUBLIC_DIR));

// CREATE DOWNLOAD DIR
if (!fs.existsSync(DOWNLOADS_DIR)) {

  fs.mkdirSync(DOWNLOADS_DIR, {
    recursive: true
  });
}

// ACTIVE JOBS
const activeJobs = new Map();

// SSE BROADCAST
function broadcast(jobId, data) {

  const job = activeJobs.get(jobId);

  if (!job || !job.clients) return;

  Object.assign(job, data);

  const payload =
    `data: ${JSON.stringify({
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

// VIDEO INFO API
app.get('/api/info', (req, res) => {

  const { url } = req.query;

  if (!url) {

    return res.status(400).json({
      error: 'URL parameter is required.'
    });
  }

  console.log('Fetching metadata:', url);

  const cmd =
    `"${YTDLP_PATH}" ` +
    `--no-playlist ` +
    `--no-warnings ` +
    `--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" ` +
    `--dump-json "${url}"`;

  exec(
    cmd,
    {
      maxBuffer: 20 * 1024 * 1024
    },
    (err, stdout, stderr) => {

      if (stderr) {

        console.log(
          'YT-DLP STDERR:',
          stderr
        );
      }

      if (err) {

        console.error(err);

        return res.status(500).json({
          error:
            stderr ||
            'Failed to retrieve video metadata.'
        });
      }

      try {

        const metadata =
          JSON.parse(stdout);

        const resolutions =
          new Set();

        const formats = [];

        if (metadata.formats) {

          metadata.formats.forEach((f) => {

            if (
              f.vcodec !== 'none' &&
              f.height
            ) {

              resolutions.add(f.height);

              formats.push({
                formatId: f.format_id,
                height: f.height,
                ext: f.ext,
                filesize:
                  f.filesize ||
                  f.filesize_approx ||
                  null
              });
            }
          });
        }

        const sortedResolutions =
          Array.from(resolutions)
            .sort((a, b) => b - a);

        res.json({
          title: metadata.title,
          author:
            metadata.uploader ||
            metadata.channel ||
            'Unknown Channel',
          duration: metadata.duration,
          thumbnail:
            metadata.thumbnail,
          resolutions:
            sortedResolutions,
          formats
        });

      } catch (parseErr) {

        console.error(parseErr);

        res.status(500).json({
          error:
            'Metadata parsing failed.'
        });
      }
    }
  );
});

// DOWNLOAD API
app.post('/api/download', (req, res) => {

  const {
    url,
    type,
    quality,
    bitrate
  } = req.body;

  if (!url || !type) {

    return res.status(400).json({
      error:
        'URL and type are required.'
    });
  }

  const jobId =
    crypto.randomUUID();

  activeJobs.set(jobId, {
    id: jobId,
    status: 'downloading',
    percent: 0,
    speed: '0 KB/s',
    eta: '--:--',
    clients: []
  });

  res.json({
    success: true,
    jobId
  });

  let args = [];

  // VIDEO
  if (type === 'video') {

    const height =
      quality || '1080';

    args = [
      '--no-playlist',
      '--no-warnings',
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',

      url,

      '-f',
      `bestvideo[height<=${height}]+bestaudio/best`,

      '--merge-output-format',
      'mp4',

      '--ffmpeg-location',
      FFMPEG_PATH,

      '-o',
      path.join(
        DOWNLOADS_DIR,
        `${jobId}.%(ext)s`
      )
    ];
  }

  // AUDIO
  else if (type === 'audio') {

    const rate =
      bitrate || '320k';

    args = [
      '--no-playlist',
      '--no-warnings',
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',

      url,

      '-x',

      '--audio-format',
      'mp3',

      '--audio-quality',
      rate,

      '--ffmpeg-location',
      FFMPEG_PATH,

      '-o',
      path.join(
        DOWNLOADS_DIR,
        `${jobId}.%(ext)s`
      )
    ];
  }

  // THUMBNAIL
  else if (type === 'thumbnail') {

    args = [
      '--no-playlist',
      '--no-warnings',
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',

      url,

      '--skip-download',

      '--write-thumbnail',

      '-o',
      path.join(
        DOWNLOADS_DIR,
        `${jobId}`
      )
    ];
  }

  console.log('RUNNING:', args);

  const child =
    spawn(YTDLP_PATH, args);

  child.stdout.on(
    'data',
    (data) => {

      const line =
        data.toString();

      console.log(line);

      const progressMatch =
        line.match(
          /\[download\]\s+(\d+\.\d+)%/
        );

      if (progressMatch) {

        broadcast(jobId, {
          status: 'downloading',
          percent: parseFloat(
            progressMatch[1]
          )
        });
      }
    }
  );

  child.stderr.on(
    'data',
    (data) => {

      console.error(
        data.toString()
      );
    }
  );

  child.on(
    'close',
    (code) => {

      if (code !== 0) {

        broadcast(jobId, {
          status: 'failed',
          error:
            'Download failed.'
        });

        return;
      }

      const files =
        fs.readdirSync(
          DOWNLOADS_DIR
        );

      const downloadedFile =
        files.find((f) =>
          f.startsWith(jobId)
        );

      if (!downloadedFile) {

        broadcast(jobId, {
          status: 'failed',
          error:
            'Downloaded file missing.'
        });

        return;
      }

      const finalPath =
        path.join(
          DOWNLOADS_DIR,
          downloadedFile
        );

      broadcast(jobId, {
        status: 'completed',
        percent: 100,
        filePath: finalPath,
        fileName:
          downloadedFile
      });
    }
  );
});

// SSE PROGRESS
app.get(
  '/api/progress/:jobId',
  (req, res) => {

    const { jobId } =
      req.params;

    const job =
      activeJobs.get(jobId);

    if (!job) {

      return res.status(404)
        .json({
          error:
            'Job not found.'
        });
    }

    res.writeHead(200, {
      'Content-Type':
        'text/event-stream',
      'Cache-Control':
        'no-cache',
      Connection:
        'keep-alive'
    });

    job.clients.push(res);

    req.on('close', () => {

      job.clients =
        job.clients.filter(
          (c) => c !== res
        );
    });
  }
);

// RETRIEVE FILE
app.get(
  '/api/retrieve/:jobId',
  (req, res) => {

    const { jobId } =
      req.params;

    const job =
      activeJobs.get(jobId);

    if (
      !job ||
      job.status !==
        'completed'
    ) {

      return res
        .status(404)
        .send('File not found.');
    }

    res.download(
      job.filePath,
      job.fileName,
      (err) => {

        if (!err) {

          fs.unlink(
            job.filePath,
            () => {}
          );

          activeJobs.delete(
            jobId
          );
        }
      }
    );
  }
);

// START SERVER
app.listen(PORT, () => {

  console.log(
    `Server running on port ${PORT}`
  );
});
