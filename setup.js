const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BIN_DIR = path.join(__dirname, 'bin');
const isWindows = process.platform === 'win32';

const YTDLP_PATH = path.join(BIN_DIR, isWindows ? 'yt-dlp.exe' : 'yt-dlp');
const FFMPEG_PATH = path.join(BIN_DIR, isWindows ? 'ffmpeg.exe' : 'ffmpeg');
const FFPROBE_PATH = path.join(BIN_DIR, isWindows ? 'ffprobe.exe' : 'ffprobe');

const YTDLP_URL = isWindows
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

const FFMPEG_URL = isWindows
  ? 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
  : 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz';

// Helper to download a file with redirect-following and progress logging
function downloadFile(url, destPath, label) {
  return new Promise((resolve, reject) => {
    console.log(`Starting download for ${label}...`);
    const file = fs.createWriteStream(destPath);
    
    function get(downloadUrl) {
      https.get(downloadUrl, (response) => {
        // Follow redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          get(response.headers.location);
          return;
        }
        
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          reject(new Error(`Failed to download ${label}. Status Code: ${response.statusCode}`));
          return;
        }
        
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        let lastReportedPercent = 0;
        
        response.on('data', (chunk) => {
          file.write(chunk);
          downloadedSize += chunk.length;
          if (totalSize) {
            const percent = Math.floor((downloadedSize / totalSize) * 100);
            if (percent - lastReportedPercent >= 10 || percent === 100) {
              console.log(`${label}: ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(1)}MB of ${(totalSize / 1024 / 1024).toFixed(1)}MB)`);
              lastReportedPercent = percent;
            }
          } else {
            if (downloadedSize % (1024 * 1024) === 0) {
              console.log(`${label}: ${(downloadedSize / 1024 / 1024).toFixed(1)}MB downloaded`);
            }
          }
        });
        
        response.on('end', () => {
          file.end();
        });
      }).on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
      
      file.on('finish', () => {
        resolve();
      });
      
      file.on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }
    
    get(url);
  });
}

// Main setup function
async function runSetup() {
  console.log(`=== YouTube Downloader Binary Setup (${isWindows ? 'Windows' : 'Linux'}) ===`);
  
  if (!fs.existsSync(BIN_DIR)) {
    console.log(`Creating bin directory at: ${BIN_DIR}`);
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  // 1. Download yt-dlp
  if (fs.existsSync(YTDLP_PATH)) {
    console.log(`✔ yt-dlp is already installed.`);
  } else {
    try {
      await downloadFile(YTDLP_URL, YTDLP_PATH, 'yt-dlp');
      if (!isWindows) {
        console.log('Setting executable permission for yt-dlp on Linux...');
        fs.chmodSync(YTDLP_PATH, 0o755);
      }
    } catch (err) {
      console.error('❌ Failed to download yt-dlp:', err.message);
      process.exit(1);
    }
  }

  // 2. Download and Extract FFmpeg
  if (fs.existsSync(FFMPEG_PATH) && fs.existsSync(FFPROBE_PATH)) {
    console.log('✔ ffmpeg and ffprobe are already installed.');
  } else {
    const archivePath = path.join(BIN_DIR, isWindows ? 'ffmpeg.zip' : 'ffmpeg.tar.xz');
    const extractTempDir = path.join(BIN_DIR, 'ffmpeg-temp');
    
    try {
      // Download the ZIP / Tarball
      await downloadFile(FFMPEG_URL, archivePath, 'FFmpeg Static Build Package');
      
      console.log('Extracting FFmpeg binaries (this may take a few seconds)...');
      if (fs.existsSync(extractTempDir)) {
        fs.rmSync(extractTempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(extractTempDir, { recursive: true });
      
      if (isWindows) {
        // Use Windows PowerShell to unzip natively
        const extractCmd = `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractTempDir}' -Force"`;
        execSync(extractCmd, { stdio: 'inherit' });
      } else {
        // Use Linux native tar command
        const extractCmd = `tar -xf "${archivePath}" -C "${extractTempDir}"`;
        execSync(extractCmd, { stdio: 'inherit' });
      }
      
      // Locate the binaries in the extracted structure
      const contents = fs.readdirSync(extractTempDir);
      const rootFolder = contents.find(f => f.startsWith('ffmpeg-master'));
      
      if (!rootFolder) {
        throw new Error('Could not find ffmpeg root directory inside extracted archive');
      }
      
      const srcBinDir = path.join(extractTempDir, rootFolder, 'bin');
      const srcFfmpeg = path.join(srcBinDir, isWindows ? 'ffmpeg.exe' : 'ffmpeg');
      const srcFfprobe = path.join(srcBinDir, isWindows ? 'ffprobe.exe' : 'ffprobe');
      
      if (!fs.existsSync(srcFfmpeg) || !fs.existsSync(srcFfprobe)) {
        throw new Error('ffmpeg or ffprobe was not found in the extracted folder');
      }
      
      // Move binaries to bin/
      console.log('Moving binaries to the destination bin folder...');
      fs.renameSync(srcFfmpeg, FFMPEG_PATH);
      fs.renameSync(srcFfprobe, FFPROBE_PATH);
      
      if (!isWindows) {
        console.log('Setting executable permissions for Linux...');
        fs.chmodSync(FFMPEG_PATH, 0o755);
        fs.chmodSync(FFPROBE_PATH, 0o755);
      }
      
      console.log('✔ FFmpeg setup successfully!');
      
    } catch (err) {
      console.error('❌ Failed to setup FFmpeg:', err.message);
      process.exit(1);
    } finally {
      // Clean up temporary files
      console.log('Cleaning up temporary setup files...');
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }
      if (fs.existsSync(extractTempDir)) {
        fs.rmSync(extractTempDir, { recursive: true, force: true });
      }
    }
  }
  
  console.log('=== Setup Successfully Finished! Ready to Download. ===\n');
}

// If run directly, execute setup
if (require.main === module) {
  runSetup().catch(err => {
    console.error('Setup failed unexpectedly:', err);
    process.exit(1);
  });
}

module.exports = runSetup;
