const urlInput = document.getElementById('youtube-url-input');

const analyzeBtn = document.getElementById('analyze-btn');

const skeletonLoader =
  document.getElementById('skeleton-loader');

const downloadWorkspace =
  document.getElementById('download-workspace');

const errorMessage =
  document.getElementById('error-message');

// VIDEO ELEMENTS
const videoThumbnail =
  document.getElementById('video-thumbnail');

const thumbnailPreview =
  document.getElementById('thumbnail-preview-img');

const videoTitle =
  document.getElementById('video-title');

const videoAuthor =
  document.getElementById('video-author');

const videoDuration =
  document.getElementById('video-duration');

const resolutionsGrid =
  document.getElementById('video-resolutions-grid');

// GLOBAL URL
let currentVideoUrl = '';

// BUTTON EVENT
analyzeBtn.addEventListener('click', analyzeUrl);

// VALIDATE URL
function isValidYouTubeUrl(url) {

  return (
    url.includes('youtube.com/watch?v=') ||
    url.includes('youtu.be/')
  );
}

// SHOW ERROR
function showError(message) {

  errorMessage.innerHTML =
    `<i class="fa-solid fa-circle-exclamation"></i> ${message}`;

  errorMessage.classList.remove('hidden');
}

// FORMAT DURATION
function formatDuration(seconds) {

  if (!seconds) return '00:00';

  const hrs = Math.floor(seconds / 3600);

  const mins = Math.floor((seconds % 3600) / 60);

  const secs = seconds % 60;

  if (hrs > 0) {

    return `${hrs}:${mins
      .toString()
      .padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }

  return `${mins}:${secs
    .toString()
    .padStart(2, '0')}`;
}

// MAIN ANALYZE FUNCTION
async function analyzeUrl() {

  let url = urlInput.value.trim();

  // SHORT URL FIX
  try {

    if (url.includes('youtu.be/')) {

      const parsedUrl = new URL(url);

      let videoId =
        parsedUrl.pathname.replace('/', '');

      videoId = videoId.split('?')[0];
      videoId = videoId.split('&')[0];

      url =
        `https://www.youtube.com/watch?v=${videoId}`;

      console.log('Converted URL:', url);
    }

  } catch (err) {

    console.error('URL conversion failed:', err);
  }

  // HIDE ERRORS
  errorMessage.classList.add('hidden');

  // EMPTY CHECK
  if (!url) {

    showError('Please paste a YouTube URL.');

    return;
  }

  // VALIDATION
  if (!isValidYouTubeUrl(url)) {

    showError('Invalid YouTube URL.');

    return;
  }

  currentVideoUrl = url;

  // UI STATE
  downloadWorkspace.classList.add('hidden');

  skeletonLoader.classList.remove('hidden');

  analyzeBtn.disabled = true;

  analyzeBtn.querySelector('.btn-text')
    .textContent = 'Analyzing...';

  try {

    const response = await fetch(
      `/api/info?url=${encodeURIComponent(url)}`
    );

    // SAFE RESPONSE HANDLING
    const text = await response.text();

    let data;

    try {

      data = JSON.parse(text);

    } catch (e) {

      console.error("RAW RESPONSE:", text);

      throw new Error(
        "Server returned invalid response."
      );
    }

    if (!response.ok || data.error) {

      throw new Error(
        data.error ||
        'Failed to analyze video.'
      );
    }

    console.log(data);

    // HIDE LOADER
    skeletonLoader.classList.add('hidden');

    // SHOW WORKSPACE
    downloadWorkspace.classList.remove('hidden');

    // THUMBNAIL
    videoThumbnail.src = data.thumbnail;

    thumbnailPreview.src = data.thumbnail;

    // TITLE
    videoTitle.textContent = data.title;

    // AUTHOR
    videoAuthor.innerHTML =
      `<i class="fa-solid fa-circle-check channel-verify-icon"></i> ${data.author}`;

    // DURATION
    videoDuration.textContent =
      formatDuration(data.duration);

    // VIDEO QUALITY OPTIONS
    resolutionsGrid.innerHTML = '';

    if (
      data.resolutions &&
      data.resolutions.length > 0
    ) {

      data.resolutions.forEach((res) => {

        const btn =
          document.createElement('button');

        btn.className = 'resolution-btn';

        btn.innerHTML =
          `<i class="fa-solid fa-download"></i> ${res}p`;

        btn.onclick = () => {

          alert(
            `Download ${res}p feature connected successfully`
          );
        };

        resolutionsGrid.appendChild(btn);
      });

    } else {

      resolutionsGrid.innerHTML =
        '<p>No formats available.</p>';
    }

  } catch (err) {

    console.error(err);

    showError(
      err.message ||
      'Failed to fetch video metadata.'
    );

    skeletonLoader.classList.add('hidden');

  } finally {

    analyzeBtn.disabled = false;

    analyzeBtn.querySelector('.btn-text')
      .textContent = 'Analyze';
  }
}
