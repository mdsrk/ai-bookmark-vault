// ============================================================
// Import/Export Module — Chrome/Firefox HTML Import
// ============================================================

let parsedImportBookmarks = [];

/**
 * Parse Chrome/Firefox bookmarks HTML file.
 */
/**
 * Parse Chrome/Firefox bookmarks HTML file and preserve folder structure.
 * Chrome/Firefox bookmark HTML uses nested <dl><dt><h3> for folders / <a> for bookmarks.
 */
function parseBookmarksHTML(html) {
  const bookmarks = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Recursively extract bookmarks with folder context
  function extractBookmarks(parent, folderPath) {
    const items = parent.children;
    for (let i = 0; i < items.length; i++) {
      const dt = items[i];
      if (dt.tagName !== 'DT') continue;
      
      const h3 = dt.querySelector(':scope > h3');
      const a = dt.querySelector(':scope > a');
      const dl = dt.querySelector(':scope > dl');
      
      if (h3) {
        // It's a folder - recurse into it
        const folderName = h3.textContent.trim();
        if (dl) {
          extractBookmarks(dl, folderPath ? folderPath + '/' + folderName : folderName);
        }
      } else if (a) {
        // It's a bookmark
        const url = a.getAttribute('href');
        if (!url || url === '' || url.startsWith('place:')) continue;
        
        const title = a.textContent.trim();
        const addDate = a.getAttribute('add_date');
        let tags = a.getAttribute('tags') || '';
        
        bookmarks.push({
          url,
          title: title || 'Untitled',
          notes: tags ? `Tags: ${tags}` : '',
          folder: folderPath || '',
          addDate: addDate ? parseInt(addDate) * 1000 : null,
        });
      }
    }
  }
  
  // Start from the first <dl> in the document
  const rootDl = doc.querySelector('dl');
  if (rootDl) {
    extractBookmarks(rootDl, '');
  } else {
    // Fallback: find all <a> tags
    const links = doc.querySelectorAll('a');
    links.forEach(a => {
      const url = a.getAttribute('href');
      if (!url || url === '' || url.startsWith('place:')) return;
      const title = a.textContent.trim();
      bookmarks.push({
        url,
        title: title || 'Untitled',
      });
    });
  }

  return bookmarks;
}

/**
 * Extract unique folder paths from parsed bookmarks.
 */
function extractFolderPaths(bookmarks) {
  const paths = new Set();
  bookmarks.forEach(bm => {
    if (bm.folder) {
      // Add parent folders too (e.g. "Tech/Web" adds "Tech" and "Tech/Web")
      const parts = bm.folder.split('/');
      let acc = '';
      parts.forEach(p => {
        acc = acc ? acc + '/' + p : p;
        paths.add(acc);
      });
    }
  });
  return Array.from(paths);
}

/**
 * Get the last folder name from a path (e.g. "Tech/Web" -> "Web").
 */
function getLastFolderName(path) {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * Setup import modal and handlers.
 */
function setupImportExport() {
  const importBtn = document.getElementById('importBookmarksBtn');
  const importModal = document.getElementById('importBookmarksModal');
  const closeImportBtn = document.getElementById('closeImportModalBtn');
  const cancelImportBtn = document.getElementById('cancelImportBtn');
  const fileInput = document.getElementById('importFileInput');
  const dropZone = document.getElementById('importDropZone');
  const startImportBtn = document.getElementById('startImportBtn');
  const importFolderSelect = document.getElementById('importFolderSelect');

  if (!importBtn) return;

  // Open modal
  importBtn.addEventListener('click', () => {
    parsedImportBookmarks = [];
    document.getElementById('importPreview').style.display = 'none';
    startImportBtn.disabled = true;
    fileInput.value = '';
    loadFolders('importFolderSelect');
    importModal.classList.add('open');
  });

  // Close modal
  const closeImport = () => importModal.classList.remove('open');
  if (closeImportBtn) closeImportBtn.addEventListener('click', closeImport);
  if (cancelImportBtn) cancelImportBtn.addEventListener('click', closeImport);
  importModal.addEventListener('click', (e) => {
    if (e.target === importModal) closeImport();
  });

  // Click drop zone to open file picker
  dropZone.addEventListener('click', () => fileInput.click());

  // File selected via picker
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processImportFile(file);
  });

  // File dropped
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border-medium)';
    dropZone.style.background = 'transparent';
    const file = e.dataTransfer.files[0];
    if (file) processImportFile(file);
  });

  // Start import
  startImportBtn.addEventListener('click', async () => {
    if (parsedImportBookmarks.length === 0) return;
    
    startImportBtn.disabled = true;
    startImportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
    
    try {
      const folderId = importFolderSelect.value;
      const data = await apiCall('/api/bookmarks/import', 'POST', {
        bookmarks: parsedImportBookmarks,
        folder_id: folderId || null,
      });
      
      showToast(`Imported ${data.imported} of ${data.total} bookmarks`, 'success');
      importModal.classList.remove('open');
      
      // Refresh
      const activeView = document.querySelector('.view.active');
      if (activeView) refreshView(activeView.id);
    } catch (err) {
      showToast(err.message || 'Import failed', 'error');
    } finally {
      startImportBtn.disabled = false;
      startImportBtn.innerHTML = '<i class="fas fa-file-import"></i> Import';
    }
  });
}

/**
 * Process an uploaded bookmarks HTML file.
 */
function processImportFile(file) {
  if (!file.name.endsWith('.html') && !file.name.endsWith('.htm')) {
    showToast('Please upload a bookmarks HTML file', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const html = e.target.result;
    parsedImportBookmarks = parseBookmarksHTML(html);
    
    document.getElementById('importFileName').textContent = file.name;
    document.getElementById('importCount').textContent = parsedImportBookmarks.length;
    document.getElementById('importPreview').style.display = 'block';
    startImportBtn.disabled = parsedImportBookmarks.length === 0;
    
    if (parsedImportBookmarks.length === 0) {
      showToast('No valid bookmarks found in the file', 'warning');
    }
  };
  reader.readAsText(file);
}
