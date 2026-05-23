const urlInput = document.getElementById('urlInput');
const analyzeBtn = document.getElementById('analyzeBtn');

const skeletonLoader = document.getElementById('skeletonLoader');
const downloadWorkspace = document.getElementById('downloadWorkspace');
const errorMessage = document.getElementById('errorMessage');

let currentVideoUrl = '';

// CLICK EVENT
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

  errorMessage.textContent = message;

  errorMessage.classList.remove('hidden');

  analyzeBtn.disabled = false;

  analyzeBtn.querySelector('.btn-text').textContent =
    'Analyze';

  analyzeBtn.querySelector('.btn-icon').className =
    'fa-solid fa-wand-magic-sparkles btn-icon';
}

// MAIN ANALYZE FUNCTION
async function analyzeUrl() {

  let url = urlInput.value.trim();

  // UNIVERSAL SHORT URL FIX
  try {

    if (url.includes("youtu.be/")) {

      const parsedUrl = new URL(url);

      let videoId = parsedUrl.pathname;

      // Remove leading slash
      videoId = videoId.replace("/", "").trim();

      // Remove params
      videoId = videoId.split("?")[0];
      videoId = videoId.split("&")[0];

      // Convert to full URL
      url = `https://www.youtube.com/watch?v=${videoId}`;

      console.log("Converted URL:", url);
    }

  } catch (err) {

    console.error("URL conversion failed:", err);
  }

  // Hide previous errors
  errorMessage.classList.add('hidden');

  // Empty URL check
  if (!url) {

    showError('Please paste a YouTube URL first.');
    return;
  }

  // URL validation
  if (!isValidYouTubeUrl(url)) {

    showError('Invalid YouTube URL.');
    return;
  }

  currentVideoUrl = url;

  // UI states
  if (downloadWorkspace) {
    downloadWorkspace.classList.add('hidden');
  }

  if (skeletonLoader) {
    skeletonLoader.classList.remove('hidden');
  }

  analyzeBtn.disabled = true;

  const btnText =
    analyzeBtn.querySelector('.btn-text');

  const btnIcon =
    analyzeBtn.querySelector('.btn-icon');

  if (btnText) {
    btnText.textContent = 'Analyzing...';
  }

  if (btnIcon) {
    btnIcon.className =
      'fa-solid fa-spinner fa-spin btn-icon';
  }

  try {

    const response = await fetch(
      `/api/info?url=${encodeURIComponent(url)}`
    );

    const data = await response.json();

    if (!response.ok || data.error) {

      throw new Error(
        data.error || 'Failed to analyze video.'
      );
    }

    console.log(data);

    // HIDE LOADER
    if (skeletonLoader) {
      skeletonLoader.classList.add('hidden');
    }

    // SHOW WORKSPACE
    if (downloadWorkspace) {
      downloadWorkspace.classList.remove('hidden');
    }

    // OPTIONAL:
    // renderWorkspace(data);

  } catch (err) {

    console.error(err);

    showError(
      err.message ||
      'An error occurred while fetching video details.'
    );

    if (skeletonLoader) {
      skeletonLoader.classList.add('hidden');
    }

  } finally {

    analyzeBtn.disabled = false;

    if (btnText) {
      btnText.textContent = 'Analyze';
    }

    if (btnIcon) {
      btnIcon.className =
        'fa-solid fa-wand-magic-sparkles btn-icon';
    }
  }
}
