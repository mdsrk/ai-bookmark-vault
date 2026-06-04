// ============================================================
// UI Module — Toast, Helpers, and Common Utilities
// ============================================================

/**
 * Show a toast notification.
 * @param {string} message - Message to display
 * @param {'success'|'error'|'info'|'warning'} type - Toast type
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type} toast-enter`;

  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    info: 'fa-info-circle',
    warning: 'fa-exclamation-triangle',
  };

  toast.innerHTML = `
    <i class="fas ${icons[type] || icons.info}"></i>
    <span>${escapeHtml(message)}</span>
    <button class="toast-close" onclick="this.parentElement.classList.add('toast-exit');setTimeout(()=>this.parentElement.remove(),200)">
      <i class="fas fa-times"></i>
    </button>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.isConnected) {
      toast.classList.remove('toast-enter');
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 200);
    }
  }, 4000);
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format a date string for display.
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Get domain from URL.
 */
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Get favicon URL for a domain.
 */
function getFaviconUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
}

/**
 * Get the first letter for favicon fallback.
 */
function getFaviconLetter(bookmark) {
  const source = bookmark.title || getDomain(bookmark.url) || '?';
  return source[0].toUpperCase();
}

/**
 * Truncate text to max characters.
 */
function truncate(text, max = 100) {
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max) + '...';
}

/**
 * Highlight matching text with <mark> tags.
 */
function highlightText(text, query) {
  if (!text || !query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const terms = query.split(/\s+/).filter(t => t.length > 0);
  let result = escaped;
  for (const term of terms) {
    const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
    result = result.replace(regex, '<span class="search-highlight">$1</span>');
  }
  return result;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Render a bookmark card HTML string.
 */
function renderBookmarkCard(bookmark, query = '') {
  const domain = getDomain(bookmark.url);
  const favicon = getFaviconUrl(bookmark.url);
  const title = query ? highlightText(bookmark.title, query) : escapeHtml(bookmark.title || 'Untitled');
  const summary = query ? highlightText(bookmark.summary, query) : escapeHtml(truncate(bookmark.summary, 120));
  const notesPreview = bookmark.notes ? escapeHtml(truncate(bookmark.notes, 80)) : '';
  const tags = (bookmark.tags || '').split(',').map(t => t.trim()).filter(Boolean);

  // AI Status Badge
  let aiBadge = '';
  if (bookmark.ai_status === 'pending') {
    aiBadge = '<span class="ai-badge ai-badge-pending"><span class="badge-dot pending"></span> Pending</span>';
  } else if (bookmark.ai_status === 'processing') {
    aiBadge = '<span class="ai-badge ai-badge-processing"><span class="badge-dot processing"></span> Processing</span>';
  } else if (bookmark.ai_status === 'failed') {
    aiBadge = '<span class="ai-badge ai-badge-failed"><span class="badge-dot failed"></span> Failed <span class="retry-btn" onclick="event.stopPropagation(); retryAI(' + bookmark.id + ')"><i class="fas fa-redo"></i></span></span>';
  }

  // Folder badge
  const folderBadge = bookmark.folder_name
    ? `<span class="folder-badge"><i class="fas fa-folder"></i> ${escapeHtml(bookmark.folder_name)}</span>`
    : '';

  // Safe favicon fallback using JS-friendly approach
  const fallbackLetter = (bookmark.title || domain)[0] || '?';

  return `
    <div class="bookmark-card" data-id="${bookmark.id}" onclick="window.open('${escapeHtml(bookmark.url)}', '_blank')">
      <!-- Checkbox for bulk select (top-left) -->
      <div class="card-checkbox" onclick="event.stopPropagation()">
        <input type="checkbox" class="bulk-select" data-id="${bookmark.id}" />
      </div>

      <!-- Delete button: always top-right -->
      <button class="card-delete-btn" onclick="event.stopPropagation(); deleteBookmark(${bookmark.id})" title="Delete bookmark">
        <i class="fas fa-trash-alt"></i>
      </button>

      <div class="bookmark-card-top">
        <div class="favicon-wrapper">
          <img class="bookmark-favicon" src="${favicon}" alt=""
            onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"
          />
          <span class="favicon-fallback" style="display:none;">${fallbackLetter}</span>
        </div>
        <div class="bookmark-title-row">
          <span class="bookmark-title">${title}</span>
          ${folderBadge}
        </div>
      </div>
      <div class="bookmark-url">${escapeHtml(domain)}</div>

      ${bookmark.summary || notesPreview ? '<hr class="card-divider" />' : ''}

      <div class="card-body-fixed">
        ${bookmark.summary ? `<div class="bookmark-summary">${summary}</div>` : ''}
        ${notesPreview ? `<div class="bookmark-notes-preview"><i class="fas fa-pencil-alt mr-1"></i>${notesPreview}</div>` : ''}
      </div>

      ${tags.length > 0 || aiBadge ? '<hr class="card-divider" />' : ''}

      ${tags.length > 0 ? '<div class="tags-section-label">Tags</div>' : ''}
      <div class="tags-row">
        ${tags.slice(0, 5).map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}
        ${tags.length > 5 ? `<span class="tag-more">+${tags.length - 5}</span>` : ''}
        <span class="ml-auto">${aiBadge}</span>
      </div>

      <hr class="card-divider" />

      <div class="card-footer">
        <span class="card-timestamp">${formatDate(bookmark.created_at)}</span>
        <div class="card-actions">
          <span class="favorite-star"
                style="color: ${bookmark.favorite ? '#f59e0b' : 'var(--text-muted)'}"
                onclick="event.stopPropagation(); toggleFavorite(${bookmark.id}, this)"
                title="${bookmark.favorite ? 'Unfavorite' : 'Favorite'}">
            <i class="fas fa-star"></i>
          </span>
          <button class="card-action-btn" onclick="event.stopPropagation(); openEditModal(${bookmark.id})" title="Edit">
            <i class="fas fa-edit"></i> Edit
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render a skeleton card for loading state.
 */
function renderSkeletonCard() {
  return `
    <div class="bookmark-card skeleton-card">
      <div class="bookmark-card-top mb-1">
        <div class="skeleton" style="width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0;"></div>
        <div style="flex:1; min-width:0;">
          <div class="skeleton" style="height: 15px; width: 75%; margin-bottom: 6px;"></div>
          <div class="skeleton" style="height: 11px; width: 45%;"></div>
        </div>
      </div>
      <hr class="card-divider" />
      <div class="skeleton" style="height: 13px; width: 100%; margin-bottom: 6px;"></div>
      <div class="skeleton" style="height: 13px; width: 60%; margin-bottom: 6px;"></div>
      <hr class="card-divider" />
      <div class="flex gap-2">
        <div class="skeleton" style="height: 20px; width: 50px; border-radius: 99px;"></div>
        <div class="skeleton" style="height: 20px; width: 60px; border-radius: 99px;"></div>
      </div>
      <hr class="card-divider" />
      <div class="flex justify-between">
        <div class="skeleton" style="height: 11px; width: 80px;"></div>
        <div class="skeleton" style="height: 11px; width: 60px;"></div>
      </div>
    </div>
  `;
}

/**
 * Render an empty state.
 */
function renderEmptyState(icon, title, message, ctaText = '', ctaAction = null) {
  return `
    <div class="empty-state">
      <i class="fas ${icon} empty-state-icon"></i>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${ctaText ? `<button class="btn-primary" onclick="${ctaAction}">${escapeHtml(ctaText)}</button>` : ''}
    </div>
  `;
}

/**
 * Show a custom confirm modal (replaces native confirm).
 * @returns {Promise<boolean>}
 */
function showConfirmModal(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal-content confirm-modal">
        <div class="modal-header">
          <h2 class="modal-title">${escapeHtml(title)}</h2>
        </div>
        <p style="font-size:14px;color:var(--text-secondary);line-height:1.5;font-family:var(--font-body);">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn-secondary" id="confirmCancelBtn">Cancel</button>
          <button class="btn-danger" id="confirmOkBtn"><i class="fas fa-trash"></i> Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.classList.remove('open');
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 150);
      resolve(result);
    };

    overlay.querySelector('#confirmCancelBtn').onclick = () => cleanup(false);
    overlay.querySelector('#confirmOkBtn').onclick = () => cleanup(true);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
  });
}

/**
 * Load folders for dropdowns.
 */
async function loadFolders(selectId, selectedId = null) {
  try {
    const data = await apiCall('/api/folders');
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // Keep the first "No Folder" option if present
    const firstOption = select.options[0];
    select.innerHTML = '';
    if (firstOption && firstOption.value === '') {
      select.appendChild(firstOption);
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No Folder';
      select.appendChild(opt);
    }
    
    data.folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name + ' (' + (f.bookmark_count || 0) + ')';
      if (selectedId && parseInt(selectedId) === f.id) opt.selected = true;
      select.appendChild(opt);
    });
    
    return data.folders;
  } catch (err) {
    console.error('Failed to load folders:', err);
    return [];
  }
}

/**
 * Load folders for the filter dropdown.
 */
async function loadFolderFilter() {
  try {
    const data = await apiCall('/api/folders');
    const select = document.getElementById('folderFilterSelect');
    const wrapper = document.getElementById('folderFilterWrapper');
    if (!select) return;
    
    select.innerHTML = '<option value="">All Folders</option>';
    
    if (data.folders.length > 0) {
      wrapper.style.display = 'flex';
      data.folders.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        select.appendChild(opt);
      });
    } else {
      wrapper.style.display = 'none';
    }
  } catch {
    // Silently fail
  }
}
