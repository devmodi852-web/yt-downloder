async function analyzeUrl() {

  let url = urlInput.value.trim();

  // UNIVERSAL SHORT URL FIX
  try {

    if (url.includes("youtu.be/")) {

      const parsedUrl = new URL(url);

      let videoId = parsedUrl.pathname;

      // Remove leading slash
      videoId = videoId.replace("/", "").trim();

      // Remove accidental params
      videoId = videoId.split("?")[0];
      videoId = videoId.split("&")[0];

      // Build final clean URL
      url = `https://www.youtube.com/watch?v=${videoId}`;

      console.log("Converted URL:", url);
    }

  } catch (err) {

    console.error("Short URL conversion failed:", err);
  }

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

  analyzeBtn.querySelector('.btn-icon').className =
    'fa-solid fa-spinner fa-spin btn-icon';

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

    renderWorkspace(data);

  } catch (err) {

    console.error(err);

    showError(
      err.message ||
      'An error occurred while fetching video details. Please try again.'
    );

    skeletonLoader.classList.add('hidden');

  } finally {

    analyzeBtn.disabled = false;

    analyzeBtn.querySelector('.btn-text').textContent =
      'Analyze';

    analyzeBtn.querySelector('.btn-icon').className =
      'fa-solid fa-wand-magic-sparkles btn-icon';
  }
}
