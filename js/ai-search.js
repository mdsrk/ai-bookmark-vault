// ============================================================
// AI Search Module — Natural Language Search
// ============================================================

/**
 * Perform an AI-powered search.
 */
async function performAISearch() {
  const input = document.getElementById('aiSearchInput');
  const resultsContainer = document.getElementById('aiSearchResults');
  const explanationEl = document.getElementById('aiExplanation');
  const loadingEl = document.getElementById('aiSearchLoading');
  const bannerEl = document.getElementById('aiNotConfiguredBanner');

  const query = input.value.trim();
  if (!query) return;

  // Check if AI is configured (we'll know from the error)
  resultsContainer.innerHTML = '';
  explanationEl.style.display = 'none';
  loadingEl.style.display = 'block';

  try {
    const data = await apiCall('/api/ai-search', 'POST', { query });

    loadingEl.style.display = 'none';
    resultsContainer.innerHTML = '';

    // Show explanation
    if (data.explanation) {
      explanationEl.textContent = data.explanation;
      explanationEl.style.display = 'block';
    }

    if (data.results && data.results.length > 0) {
      data.results.forEach(bm => {
        resultsContainer.innerHTML += renderBookmarkCard(bm);
      });
    } else {
      resultsContainer.innerHTML = renderEmptyState(
        'fa-robot',
        'No relevant bookmarks found',
        'AI could not find bookmarks related to your query. Try different wording or save more bookmarks.'
      );
    }
  } catch (err) {
    loadingEl.style.display = 'none';

    if (err.code === 'AI_NOT_CONFIGURED') {
      bannerEl.style.display = 'block';
      resultsContainer.innerHTML = '';
      return;
    }

    resultsContainer.innerHTML = renderEmptyState(
      'fa-exclamation-triangle',
      'AI Search failed',
      err.message || 'AI search failed. Try again or check your API settings.'
    );
  }
}

/**
 * Setup AI search handlers.
 */
function setupAISearch() {
  const searchBtn = document.getElementById('aiSearchBtn');
  const input = document.getElementById('aiSearchInput');

  if (!searchBtn || !input) return;

  searchBtn.addEventListener('click', performAISearch);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performAISearch();
    }
  });
}
