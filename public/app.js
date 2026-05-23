// Frontend JavaScript Logic - Real-Time SSE Progress & Premium Interactions

document.addEventListener('DOMContentLoaded', () => {
  
  // DOM Elements
  const urlInput = document.getElementById('youtube-url-input');
  const analyzeBtn = document.getElementById('analyze-btn');
  const errorMessage = document.getElementById('error-message');
  
  const skeletonLoader = document.getElementById('skeleton-loader');
  const downloadWorkspace = document.getElementById('download-workspace');
  
  const videoThumbnail = document.getElementById('video-thumbnail');
  const videoDuration = document.getElementById('video-duration');
  const videoTitle = document.getElementById('video-title');
  const videoAuthor = document.getElementById('video-author');
  
  const videoResolutionsGrid = document.getElementById('video-resolutions-grid');
  const downloadAudioBtn = document.getElementById('download-audio-btn');
  const downloadThumbnailBtn = document.getElementById('download-thumbnail-btn');
  const thumbnailPreviewImg = document.getElementById('thumbnail-preview-img');
  
  // Progress Modal Elements
  const progressModal = document.getElementById('progress-modal');
  const progressTitle = document.getElementById('progress-title');
  const progressSubtitle = document.getElementById('progress-subtitle');
  const progressCircleBar = document.getElementById('progress-circle-bar');
  const progressLinearBar = document.getElementById('progress-linear-bar');
  const progressPercent = document.getElementById('progress-percent');
  const metricSpeed = document.getElementById('metric-speed');
  const metricEta = document.getElementById('metric-eta');
  const stageBadge = document.getElementById('stage-badge');
  const cancelDownloadBtn = document.getElementById('cancel-download-btn');
  
  // Active state variables
  let currentVideoUrl = '';
  let activeEventSource = null;
  
  // Circle progress calculations
  const CIRCLE_CIRCUMFERENCE = 439.8; // 2 * pi * r (r=70)

  // 1. YouTube URL Regex Validator
  function isValidYouTubeUrl(url) {
    const regExp = /^(?:https?:\/\/)?(?:m\.|www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))((\w|-){11})(?:\S+)?$/;
    return regExp.test(url.trim());
  }

  // 2. Tab Navigation Interaction
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(targetTab).classList.add('active');
    });
  });

  // 3. Audio Bitrate Radio Item Selection Design State
  const audioOptionItems = document.querySelectorAll('.audio-option-item');
  
  audioOptionItems.forEach(item => {
    item.addEventListener('click', () => {
      audioOptionItems.forEach(i => i.classList.remove('checked'));
      item.classList.add('checked');
      
      const radio = item.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  // 4. Format Duration (seconds to HH:MM:SS)
  function formatDuration(seconds) {
    if (!seconds) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // 5. Format File Size (bytes to MB)
  function formatBytes(bytes) {
    if (!bytes) return 'Variable';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  // 6. Map Resolution Heights to Human-Readable Label Card Details
  const resolutionDetailsMap = {
    2160: { name: '4K Ultra HD', badge: 'UHD', cls: 'res-card-4k' },
    1440: { name: '2K Quad HD', badge: '2K QHD', cls: 'res-card-2k' },
    1080: { name: '1080p Full HD', badge: 'FHD', cls: 'res-card-1080p' },
    720: { name: '720p HD', badge: 'HD', cls: 'res-card-720p' },
    480: { name: '480p SD', badge: 'SD', cls: 'res-card-480p' },
    360: { name: '360p SD', badge: 'SD', cls: 'res-card-360p' },
    240: { name: '240p Mobile', badge: 'MOB', cls: 'res-card-240p' },
    144: { name: '144p Mobile', badge: 'MOB', cls: 'res-card-144p' }
  };

  // 7. Click Trigger - Analyze URL
  analyzeBtn.addEventListener('click', analyzeUrl);
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') analyzeUrl();
  });

  async function analyzeUrl() {
    const url = urlInput.value.trim();
    errorMessage.classList.add('hidden');
    
    if (!url) {
      showError('Please paste a YouTube URL first.');
      return;
    }
    
    if (!isValidYouTubeUrl(url)) {
      showError('The URL provided is not a valid YouTube link. Please check it and try again.');
      return;
    }
    
    currentVideoUrl = url;
    
    // UI state transitions
    downloadWorkspace.classList.add('hidden');
    skeletonLoader.classList.remove('hidden');
    analyzeBtn.disabled = true;
    analyzeBtn.querySelector('.btn-text').textContent = 'Analyzing...';
    analyzeBtn.querySelector('.btn-icon').className = 'fa-solid fa-spinner fa-spin btn-icon';
    
    try {
      const response = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to analyze video.');
      }
      
      renderWorkspace(data);
      
    } catch (err) {
      console.error(err);
      showError(err.message || 'An error occurred while fetching video details. Please try again.');
      skeletonLoader.classList.add('hidden');
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.querySelector('.btn-text').textContent = 'Analyze';
      analyzeBtn.querySelector('.btn-icon').className = 'fa-solid fa-wand-magic-sparkles btn-icon';
    }
  }

  function showError(msg) {
    errorMessage.querySelector('span').textContent = msg;
    errorMessage.classList.remove('hidden');
  }

  // 8. Render Metadata & Options Grid in Workspace
  function renderWorkspace(data) {
    // Hide skeleton and show panel
    skeletonLoader.classList.add('hidden');
    downloadWorkspace.classList.remove('hidden');
    
    // Set Core Metadata details
    videoThumbnail.src = data.thumbnail;
    thumbnailPreviewImg.src = data.thumbnail;
    videoDuration.textContent = formatDuration(data.duration);
    videoTitle.textContent = data.title;
    videoAuthor.innerHTML = `<i class="fa-solid fa-circle-check channel-verify-icon"></i> ${data.author}`;
    
    // Reset Resolution Grid
    videoResolutionsGrid.innerHTML = '';
    
    // Generate grid cards for available resolutions
    data.resolutions.forEach(height => {
      const details = resolutionDetailsMap[height] || { name: `${height}p Video`, badge: 'VID', cls: 'res-card-other' };
      
      // Attempt to find approximate filesize for this resolution height
      const formatObj = data.formats.find(f => f.height === height);
      const sizeStr = formatObj ? formatBytes(formatObj.filesize) : 'Variable';
      
      const card = document.createElement('div');
      card.className = `resolution-card ${details.cls}`;
      card.innerHTML = `
        <div class="res-label">${height}p</div>
        <div class="res-badge">${details.badge}</div>
        <div class="res-size ${sizeStr !== 'Variable' ? 'estimated' : ''}">Est. Size: ${sizeStr}</div>
        <button class="download-icon-btn" data-quality="${height}">
          <i class="fa-solid fa-cloud-arrow-down"></i> Download
        </button>
      `;
      
      // Wire click handler
      card.querySelector('.download-icon-btn').addEventListener('click', () => {
        triggerDownload('video', height);
      });
      
      videoResolutionsGrid.appendChild(card);
    });
  }

  // 9. Trigger Post Download
  async function triggerDownload(type, quality = null) {
    let bodyData = {
      url: currentVideoUrl,
      type: type
    };
    
    if (type === 'video') {
      bodyData.quality = quality;
    } else if (type === 'audio') {
      const checkedRadio = document.querySelector('input[name="audio-bitrate"]:checked');
      bodyData.bitrate = checkedRadio ? checkedRadio.value : '320k';
    }
    
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });
      const data = await response.json();
      
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to start download.');
      }
      
      // Initialize SSE listener and open progress card modal
      startProgressTracking(data.jobId, type);
      
    } catch (err) {
      alert(err.message || 'Error initiating download.');
    }
  }

  // 10. Start Real-time SSE Progress Tracking
  function startProgressTracking(jobId, type) {
    // Show Modal
    progressModal.classList.remove('hidden');
    cancelDownloadBtn.textContent = 'Cancel';
    
    // Set UI Title based on type
    if (type === 'video') {
      progressTitle.textContent = 'Downloading Video File';
    } else if (type === 'audio') {
      progressTitle.textContent = 'Extracting High Quality MP3';
    } else {
      progressTitle.textContent = 'Downloading Image Banner';
    }
    
    progressSubtitle.textContent = 'Contacting server and allocating bandwidth...';
    updateProgressRing(0);
    metricSpeed.textContent = '0 KB/s';
    metricEta.textContent = '--:--';
    stageBadge.textContent = 'CONNECTING';
    stageBadge.style.color = '#8b5cf6';
    stageBadge.style.background = 'rgba(139, 92, 246, 0.12)';
    stageBadge.style.borderColor = 'rgba(139, 92, 246, 0.25)';
    
    // Close existing connection if any exists
    if (activeEventSource) {
      activeEventSource.close();
    }
    
    // Connect to SSE stream
    activeEventSource = new EventSource(`/api/progress/${jobId}`);
    
    activeEventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('SSE update:', data);
      
      if (data.status === 'downloading') {
        const percent = data.percent || 0;
        updateProgressRing(percent);
        progressSubtitle.textContent = 'Downloading media assets from YouTube streams...';
        metricSpeed.textContent = data.speed || '0 KB/s';
        metricEta.textContent = data.eta || '--:--';
        
        stageBadge.textContent = 'DOWNLOADING';
        stageBadge.style.color = '#ec4899';
        stageBadge.style.background = 'rgba(236, 72, 153, 0.12)';
        stageBadge.style.borderColor = 'rgba(236, 72, 153, 0.25)';
      } 
      
      else if (data.status === 'merging') {
        updateProgressRing(99);
        progressSubtitle.textContent = 'Merging video and audio streams via FFmpeg... This may take a moment.';
        metricSpeed.textContent = 'Processing...';
        metricEta.textContent = 'Merging';
        
        stageBadge.textContent = 'MERGING';
        stageBadge.style.color = '#10b981';
        stageBadge.style.background = 'rgba(16, 185, 129, 0.12)';
        stageBadge.style.borderColor = 'rgba(16, 185, 129, 0.25)';
      } 
      
      else if (data.status === 'completed') {
        updateProgressRing(100);
        progressSubtitle.textContent = 'Finished! Handing off to browser download...';
        metricSpeed.textContent = 'Completed';
        metricEta.textContent = '00:00';
        
        stageBadge.textContent = 'COMPLETED';
        stageBadge.style.color = '#10b981';
        stageBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        stageBadge.style.borderColor = '#10b981';
        cancelDownloadBtn.textContent = 'Close';
        
        activeEventSource.close();
        activeEventSource = null;
        
        // Browser triggers direct file download
        setTimeout(() => {
          window.location.href = `/api/retrieve/${jobId}`;
        }, 600);
      } 
      
      else if (data.status === 'failed') {
        progressSubtitle.textContent = 'Failed: ' + (data.error || 'Server processing error.');
        stageBadge.textContent = 'FAILED';
        stageBadge.style.color = '#ef4444';
        stageBadge.style.background = 'rgba(239, 68, 68, 0.12)';
        stageBadge.style.borderColor = '#ef4444';
        
        cancelDownloadBtn.textContent = 'Close';
        activeEventSource.close();
        activeEventSource = null;
      }
    };
    
    activeEventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      progressSubtitle.textContent = 'Connection interrupted. The server is still downloading. Please wait.';
    };
  }

  // Helper to update Circular Ring path dashoffset
  function updateProgressRing(percent) {
    progressPercent.textContent = `${Math.floor(percent)}%`;
    const offset = CIRCLE_CIRCUMFERENCE - (percent / 100) * CIRCLE_CIRCUMFERENCE;
    progressCircleBar.style.strokeDashoffset = offset;
    progressLinearBar.style.width = `${percent}%`;
  }

  // Cancel / Close Click
  cancelDownloadBtn.addEventListener('click', () => {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    progressModal.classList.add('hidden');
  });

  // Wire Audio Button Click
  downloadAudioBtn.addEventListener('click', () => {
    triggerDownload('audio');
  });

  // Wire Thumbnail Button Click
  downloadThumbnailBtn.addEventListener('click', () => {
    triggerDownload('thumbnail');
  });

});
