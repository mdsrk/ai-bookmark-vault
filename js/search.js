// ============================================================
// Search Module — Global SQL Search
// ============================================================

let searchTimeout = null;

/**
 * Perform a standard SQL text search.
 */
async function performSearch(query) {
  const resultsContainer = document.getElementById('searchResults');
  const countEl = document.getElementById('searchResultCount');

  if (!query || query.trim() === '') {
    resultsContainer.innerHTML = '';
    countEl.textContent = '';
    return;
  }

  // Show skeleton
  resultsContainer.innerHTML = Array(3).fill(null).map(() => renderSkeletonCard()).join('');
  countEl.textContent = 'Searching...';

  try {
    const data = await apiCall(`/api/search?q=${encodeURIComponent(query)}`);

    resultsContainer.innerHTML = '';

    if (data.results.length === 0) {
      resultsContainer.innerHTML = renderEmptyState(
        'fa-search-minus',
        'No results found',
        `No bookmarks match "${query}". Try different keywords.`
      );
      countEl.textContent = 'No results found';
    } else {
      data.results.forEach(bm => {
        resultsContainer.innerHTML += renderBookmarkCard(bm, query);
      });
      countEl.textContent = `${data.results.length} result${data.results.length !== 1 ? 's' : ''} for "${query}"`;
    }
  } catch (err) {
    resultsContainer.innerHTML = renderEmptyState(
      'fa-exclamation-triangle',
      'Search failed',
      err.message || 'An error occurred. Please try again.'
    );
    countEl.textContent = 'Search failed';
  }
}

/**
 * Setup search handlers.
 */
function setupSearch() {
  const searchInput = document.getElementById('globalSearch');
  const mobileSearchInput = document.getElementById('mobileSearchInput');

  /**
   * Handle search input from either desktop or mobile search bar.
   */
  function handleSearchInput(inputEl) {
    clearTimeout(searchTimeout);
    const query = inputEl.value.trim();

    if (query.length === 0) {
      document.getElementById('searchResults').innerHTML = '';
      document.getElementById('searchResultCount').textContent = '';
      return;
    }

    // Sync the other search input
    if (inputEl === searchInput && mobileSearchInput) {
      mobileSearchInput.value = inputEl.value;
    } else if (inputEl === mobileSearchInput && searchInput) {
      searchInput.value = inputEl.value;
    }

    // Auto-switch to search view after 300ms debounce
    searchTimeout = setTimeout(() => {
      switchView('search-view');
      performSearch(query);
    }, 300);
  }

  // Desktop search bar
  if (searchInput) {
    searchInput.addEventListener('input', () => handleSearchInput(searchInput));
  }

  // Mobile search bar (inside search-view)
  if (mobileSearchInput) {
    mobileSearchInput.addEventListener('input', () => handleSearchInput(mobileSearchInput));
  }

  // Keyboard shortcut: Ctrl/Cmd + K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      (searchInput || mobileSearchInput)?.focus();
    }
  });
}
