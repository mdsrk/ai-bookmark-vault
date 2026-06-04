// ============================================================
// Bookmarks Module — CRUD, Rendering, Favorites
// ============================================================

let currentPage = 1;
let hasMorePages = false;
let isLoading = false;
let bookmarkCache = null;
let currentViewMode = 'card';
let currentListView = 'dashboard-view';
let currentFavoriteFilter = false;

/**
 * Load bookmarks from the API and render them.
 */
async function loadBookmarks(page = 1, append = false, view = 'dashboard-view', favorite = false) {
  if (isLoading) return;
  isLoading = true;

  currentListView = view;
  currentFavoriteFilter = favorite;

  const container = view === 'favorites-view'
    ? document.getElementById('favoritesGrid')
    : document.getElementById('bookmarkContainer');

  if (!append) {
    // Show skeletons based on view mode
    const skeletonCount = currentViewMode === 'list' ? 5 : 6;
    container.innerHTML = Array(skeletonCount).fill(null).map(() => renderSkeletonCard()).join('');
  }

  try {
    const sortBy = document.getElementById('sortSelect')?.value || 'newest';
    const folderFilter = document.getElementById('folderFilterSelect')?.value || '';
    
    const params = new URLSearchParams({ page, limit: 20, sort: sortBy });
    if (favorite) params.set('favorite', 'true');
    if (folderFilter) params.set('folder_id', folderFilter);

    const data = await apiCall(`/api/bookmarks?${params}`);

    if (!append) {
      container.innerHTML = '';
    }

    if (data.bookmarks.length === 0 && !append) {
      const title = favorite ? 'No favorites yet' : 'No bookmarks yet';
      const msg = favorite ? 'Star bookmarks to add them to favorites.' : 'Add your first bookmark to get started.';
      container.innerHTML = renderEmptyState(
        favorite ? 'fa-star' : 'fa-bookmark',
        title,
        msg,
        favorite ? '' : 'Add Bookmark',
        "document.getElementById('addBookmarkBtn').click()"
      );
    } else {
      // Apply view mode class
      container.className = currentViewMode === 'list' ? 'bookmark-list' : 'bookmark-grid';
      
      data.bookmarks.forEach(bm => {
        container.innerHTML += renderBookmarkCard(bm);
      });
    }

    // Update pagination
    hasMorePages = data.pagination.page < data.pagination.totalPages;
    currentPage = data.pagination.page;

    const loadMore = document.getElementById('loadMoreContainer');
    if (loadMore) {
      loadMore.style.display = hasMorePages && !favorite ? 'block' : 'none';
    }

    // Update stats
    updateStats(data.bookmarks, data.pagination);

    // Cache
    bookmarkCache = data.bookmarks;
  } catch (err) {
    if (!append) {
      container.innerHTML = renderEmptyState(
        'fa-exclamation-triangle',
        'Failed to load bookmarks',
        err.message || 'An error occurred. Please try again.'
      );
    }
    showToast(err.message || 'Failed to load bookmarks', 'error');
  } finally {
    isLoading = false;
  }
}

/**
 * Set view mode (card or list).
 */
function setViewMode(mode) {
  currentViewMode = mode;
  const container = document.getElementById('bookmarkContainer');
  if (container) {
    container.className = mode === 'list' ? 'bookmark-list' : 'bookmark-grid';
  }
  
  // Update toggle buttons
  document.getElementById('cardViewBtn')?.classList.toggle('active', mode === 'card');
  document.getElementById('listViewBtn')?.classList.toggle('active', mode === 'list');
  
  // Clear bulk selection
  bulkSelectedIds.clear();
  updateBulkUI();
  
  // Reload bookmarks
  const activeView = document.querySelector('.view.active');
  if (activeView && activeView.id === 'dashboard-view') {
    loadBookmarks(1, false, 'dashboard-view', false);
  }
}

/**
 * Update stats bar.
 */
async function updateStats(bookmarks, pagination) {
  try {
    // Get full stats from API
    const data = await apiCall('/api/bookmarks?limit=1&page=1');

    // Get counts via separate queries... for simplicity, compute from total
    const total = data.pagination.total;

    document.getElementById('statTotal').textContent = total;

    // Get favorites count
    const favData = await apiCall('/api/bookmarks?favorite=true&limit=1');
    document.getElementById('statFavorites').textContent = favData.pagination.total;

    // For AI stats, count from bookmarks we have or get them
    let processed = 0;
    let pending = 0;
    const allData = await apiCall('/api/bookmarks?limit=100');
    allData.bookmarks.forEach(b => {
      if (b.ai_status === 'completed' || b.ai_status === 'failed') processed++;
      if (b.ai_status === 'pending' || b.ai_status === 'processing') pending++;
    });

    document.getElementById('statProcessed').textContent = processed;
    document.getElementById('statPending').textContent = pending;
  } catch {
    // Silently fail — stats aren't critical
  }
}

/**
 * Create a new bookmark.
 */
async function createBookmark(url, notes, folder_id) {
  const data = await apiCall('/api/bookmarks', 'POST', { 
    url, 
    notes: notes || null,
    folder_id: folder_id || null
  });

  // Refresh dashboard view
  loadBookmarks(1, false, 'dashboard-view');

  return data;
}

/**
 * Update a bookmark.
 */
async function updateBookmark(id, fields) {
  const data = await apiCall(`/api/bookmarks/${id}`, 'PUT', fields);
  showToast('Bookmark updated', 'success');

  // Refresh current view
  const activeView = document.querySelector('.view.active');
  if (activeView) {
    refreshView(activeView.id);
  }

  return data;
}

/**
 * Delete a bookmark with confirmation.
 */
async function deleteBookmark(id) {
  const confirmed = await showConfirmModal('Delete Bookmark', 'Are you sure you want to delete this bookmark? This action cannot be undone.');
  if (!confirmed) return;

  try {
    await apiCall(`/api/bookmarks/${id}`, 'DELETE');
    showToast('Bookmark deleted', 'success');

    // Remove card from DOM
    const card = document.querySelector(`.bookmark-card[data-id="${id}"]`);
    if (card) card.remove();

    // Refresh
    const activeView = document.querySelector('.view.active');
    if (activeView) {
      refreshView(activeView.id);
    }
  } catch (err) {
    showToast(err.message || 'Failed to delete', 'error');
  }
}

/**
 * Toggle favorite status.
 */
async function toggleFavorite(id, starEl) {
  try {
    const data = await apiCall(`/api/bookmarks/${id}/favorite`, 'POST');
    const isFav = data.favorite;

    // Update star
    if (starEl) {
      starEl.style.color = isFav ? '#f59e0b' : 'var(--text-muted)';
      starEl.title = isFav ? 'Unfavorite' : 'Favorite';
    }

    showToast(isFav ? 'Added to favorites' : 'Removed from favorites', isFav ? 'success' : 'info');
  } catch (err) {
    showToast(err.message || 'Failed to toggle favorite', 'error');
  }
}

/**
 * Retry AI processing for a failed bookmark.
 */
async function retryAI(id) {
  try {
    await apiCall(`/api/bookmarks/${id}/retry-ai`, 'POST');
    showToast('AI processing retriggered', 'info');

    // Update card status
    const card = document.querySelector(`.bookmark-card[data-id="${id}"]`);
    if (card) {
      const statusEl = card.querySelector('.badge-failed');
      if (statusEl) {
        statusEl.outerHTML = '<span class="badge-pending"><i class="fas fa-clock mr-1"></i>Pending</span>';
      }
    }
  } catch (err) {
    showToast(err.message || 'Failed to retry AI', 'error');
  }
}

/**
 * Open edit modal and populate with bookmark data.
 */
async function openEditModal(id) {
  try {
    const bookmark = await apiCall(`/api/bookmarks/${id}`, 'GET');

    document.getElementById('editBookmarkId').value = bookmark.id;
    document.getElementById('editBookmarkUrl').value = bookmark.url || '';
    document.getElementById('editBookmarkTitle').value = bookmark.title || '';
    document.getElementById('editBookmarkSummary').value = bookmark.summary || '';
    document.getElementById('editBookmarkTags').value = bookmark.tags || '';
    document.getElementById('editBookmarkNotes').value = bookmark.notes || '';

    // Load folders and select current
    await loadFolders('editBookmarkFolder', bookmark.folder_id);

    document.getElementById('editBookmarkModal').classList.add('open');
  } catch (err) {
    showToast(err.message || 'Failed to load bookmark', 'error');
  }
}

/**
 * Refresh a view by its ID.
 */
function refreshView(viewId) {
  switch (viewId) {
    case 'dashboard-view':
      loadBookmarks(1);
      break;
    case 'favorites-view':
      loadBookmarks(1, false, 'favorites-view', true);
      break;
    case 'search-view':
      const q = document.getElementById('globalSearch').value;
      if (q) performSearch(q);
      break;
  }
}

// ─── Event Listeners (setup in dashboard-init.js) ──────

// ─── Bulk Delete Logic ────────────────────────────────────
let bulkSelectedIds = new Set();

function updateBulkUI() {
  const bar = document.getElementById('bulkActionBar');
  const countEl = document.getElementById('bulkSelectedCount');
  if (!bar || !countEl) return;
  
  // Only show when more than 1 bookmark is selected
  if (bulkSelectedIds.size > 1) {
    bar.classList.add('visible');
    countEl.textContent = bulkSelectedIds.size;
  } else {
    bar.classList.remove('visible');
  }
}

function setupBulkDelete() {
  // Delegate checkbox changes
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('bulk-select')) {
      const id = parseInt(e.target.dataset.id);
      if (e.target.checked) {
        bulkSelectedIds.add(id);
      } else {
        bulkSelectedIds.delete(id);
      }
      updateBulkUI();
    }
  });

  // Select All
  const selectAllBtn = document.getElementById('selectAllBtn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('.bulk-select');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      
      checkboxes.forEach(cb => {
        cb.checked = !allChecked;
        const id = parseInt(cb.dataset.id);
        if (!allChecked) {
          bulkSelectedIds.add(id);
        } else {
          bulkSelectedIds.delete(id);
        }
      });
      
      updateBulkUI();
    });
  }

  // Bulk Delete
  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', async () => {
      if (bulkSelectedIds.size === 0) return;
      
      const confirmed = await showConfirmModal(
        'Delete Selected', 
        `Are you sure you want to delete ${bulkSelectedIds.size} bookmark${bulkSelectedIds.size !== 1 ? 's' : ''}?`
      );
      if (!confirmed) return;
      
      try {
        const data = await apiCall('/api/bookmarks/bulk-delete', 'POST', {
          ids: Array.from(bulkSelectedIds)
        });
        
        showToast(`Deleted ${data.deleted} bookmark${data.deleted !== 1 ? 's' : ''}`, 'success');
        bulkSelectedIds.clear();
        updateBulkUI();
        
        // Refresh current view
        const activeView = document.querySelector('.view.active');
        if (activeView) refreshView(activeView.id);
      } catch (err) {
        showToast(err.message || 'Failed to delete', 'error');
      }
    });
  }
}
