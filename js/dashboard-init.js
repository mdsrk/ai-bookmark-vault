// ============================================================
// Dashboard Initialization — View switching, event handlers
// ============================================================

/**
 * Switch to a view by its element ID.
 */
function switchView(viewId) {
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // Show target view
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-view="${viewId}"]`);
  if (navItem) navItem.classList.add('active');

  // Update page title
  const titles = {
    'dashboard-view': 'Dashboard',
    'favorites-view': 'Favorites',
    'search-view': 'Search',
    'ai-search-view': 'AI Search',
    'ask-view': 'Ask My Bookmarks',
    'settings-view': 'Settings',
  };

  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = titles[viewId] || 'Dashboard';

  // Refresh specific views
  if (viewId === 'dashboard-view') {
    loadFolderFilter();
    loadBookmarks(1, false, 'dashboard-view');
  } else if (viewId === 'favorites-view') {
    loadBookmarks(1, false, 'favorites-view', true);
  } else if (viewId === 'search-view') {
    const q = document.getElementById('globalSearch').value || document.getElementById('mobileSearchInput')?.value || '';
    if (q) performSearch(q);
  } else if (viewId === 'settings-view') {
    loadSettings();
    renderFolderList();
  }

  // Close sidebar on mobile
  closeSidebar();
}

/**
 * Open the sidebar on mobile.
 */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('mobileOverlay').classList.add('open');
}

/**
 * Close the sidebar on mobile.
 */
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobileOverlay').classList.remove('open');
}

// ── Theme Toggle ──────────────────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem('vault_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('vault_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('themeIcon');
  if (icon) {
    icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
  }
}

// ── Chat send button enable/disable ──────────────────────
function setupChatInput() {
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSendBtn');
  if (input && sendBtn) {
    input.addEventListener('input', () => {
      sendBtn.disabled = !input.value.trim();
    });
  }
}

// ── Sort & Folder Filter Handlers ─────────────────────────
function setupToolbar() {
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      loadBookmarks(1, false, currentListView, currentFavoriteFilter);
    });
  }

  const folderFilter = document.getElementById('folderFilterSelect');
  if (folderFilter) {
    folderFilter.addEventListener('change', () => {
      loadBookmarks(1, false, currentListView, currentFavoriteFilter);
    });
  }

  // View toggle buttons
  const cardBtn = document.getElementById('cardViewBtn');
  const listBtn = document.getElementById('listViewBtn');
  if (cardBtn) {
    cardBtn.addEventListener('click', () => setViewMode('card'));
  }
  if (listBtn) {
    listBtn.addEventListener('click', () => setViewMode('list'));
  }
}

// ── Folder Management ─────────────────────────────────────
async function setupFoldersManagement() {
  const createBtn = document.getElementById('createFolderBtn');
  const input = document.getElementById('newFolderInput');
  
  if (createBtn && input) {
    createBtn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) {
        showToast('Please enter a folder name', 'warning');
        return;
      }
      try {
        await apiCall('/api/folders', 'POST', { name });
        input.value = '';
        showToast('Folder created', 'success');
        renderFolderList();
        loadFolderFilter();
      } catch (err) {
        showToast(err.message || 'Failed to create folder', 'error');
      }
    });
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createBtn.click();
    });
  }
  
  renderFolderList();
}

async function renderFolderList() {
  const container = document.getElementById('folderListSettings');
  if (!container) return;
  
  try {
    const data = await apiCall('/api/folders');
    if (data.folders.length === 0) {
      container.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">No folders yet. Create one above.</p>';
      return;
    }
    
    container.innerHTML = data.folders.map(f => `
      <div class="folder-settings-item">
        <div>
          <span class="folder-name"><i class="fas fa-folder" style="color:var(--accent);margin-right:6px;"></i>${escapeHtml(f.name)}</span>
          <span class="folder-count">${f.bookmark_count || 0} bookmarks</span>
        </div>
        <button class="folder-delete-btn" data-folder-id="${f.id}" title="Delete folder">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `).join('');
    
    // Delete handlers
    container.querySelectorAll('.folder-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.folderId);
        const confirmed = await showConfirmModal('Delete Folder', 'Delete this folder? Bookmarks in it will be unassigned.');
        if (!confirmed) return;
        try {
          await apiCall(`/api/folders/${id}`, 'DELETE');
          showToast('Folder deleted', 'success');
          renderFolderList();
          loadFolderFilter();
          loadBookmarks(1);
        } catch (err) {
          showToast(err.message || 'Failed to delete folder', 'error');
        }
      });
    });
  } catch {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">Failed to load folders.</p>';
  }
}

// ─── Initialize on DOM ready ─────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Require auth
  requireAuth();

  // Init theme
  initTheme();

  // Set user email
  const user = getCurrentUser();
  if (user) {
    document.getElementById('sidebarUser').textContent = user.email;
    document.getElementById('settingsEmail').textContent = user.email;
  }

  // ── Sidebar Navigation ──
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const viewId = item.getAttribute('data-view');
      switchView(viewId);
    });
  });

  // ── Theme Toggle ──
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
  }

  // ── Hamburger Menu ──
  const hamburger = document.getElementById('hamburgerBtn');
  if (hamburger) {
    hamburger.addEventListener('click', openSidebar);
  }

  // ── Mobile Overlay ──
  const overlay = document.getElementById('mobileOverlay');
  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  // ── Logout ──
  document.getElementById('logoutBtn').addEventListener('click', logout);

  // ── Toolbar ──
  setupToolbar();

  // ── Add Bookmark Modal ──
  const addBtn = document.getElementById('addBookmarkBtn');
  const modal = document.getElementById('addBookmarkModal');
  const closeBtn = document.getElementById('closeModalBtn');
  const addForm = document.getElementById('addBookmarkForm');

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      loadFolders('bookmarkFolder');
      modal.classList.add('open');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  }

  // Close modal on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modal.classList.remove('open');
      document.getElementById('editBookmarkModal').classList.remove('open');
    }
    // Ctrl/Cmd + B → open Add Bookmark
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      loadFolders('bookmarkFolder');
      modal.classList.add('open');
    }
  });

  // ── Save Bookmark ──
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('bookmarkUrl').value.trim();
    const notes = document.getElementById('bookmarkNotes').value.trim();
    const folderId = document.getElementById('bookmarkFolder').value;
    const saveBtn = document.getElementById('saveBookmarkBtn');

    if (!url) {
      showToast('URL is required', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      await createBookmark(url, notes, folderId || null);
      addForm.reset();
      modal.classList.remove('open');
      showToast('Bookmark saved. AI is processing...', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save bookmark', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Bookmark';
    }
  });

  // ── Edit Bookmark Modal ──
  const editModal = document.getElementById('editBookmarkModal');
  const closeEditBtn = document.getElementById('closeEditModalBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const editForm = document.getElementById('editBookmarkForm');

  if (closeEditBtn) {
    closeEditBtn.addEventListener('click', () => editModal.classList.remove('open'));
  }
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => editModal.classList.remove('open'));
  }

  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) editModal.classList.remove('open');
  });

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = parseInt(document.getElementById('editBookmarkId').value);
    const fields = {
      url: document.getElementById('editBookmarkUrl').value,
      title: document.getElementById('editBookmarkTitle').value,
      summary: document.getElementById('editBookmarkSummary').value,
      tags: document.getElementById('editBookmarkTags').value,
      notes: document.getElementById('editBookmarkNotes').value,
      folder_id: parseInt(document.getElementById('editBookmarkFolder').value) || null,
    };

    try {
      await updateBookmark(id, fields);
      editModal.classList.remove('open');
      showToast('Bookmark updated', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update bookmark', 'error');
    }
  });

  // ── Load More ──
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      if (hasMorePages) {
        loadBookmarks(currentPage + 1, true);
      }
    });
  }

  // ── Chat input enable/disable ──
  setupChatInput();

  // ── Initialize All Features ──
  setupSearch();
  setupAISearch();
  setupAskBookmarks();
  setupSettings();
  setupFoldersManagement();
  setupImportExport();
  setupBulkDelete();

  // ── Load initial data ──
  loadBookmarks(1);
  loadFolderFilter();
});
