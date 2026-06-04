// ============================================================
// Settings Module — AI Provider, Toggles, Account, Export
// ============================================================

let settingsDebounceTimer = null;

/**
 * Load all settings from the API.
 */
async function loadSettings() {
  try {
    const data = await apiCall('/api/settings', 'GET');
    const s = data.settings;

    // Provider
    if (s.ai_provider === 'custom') {
      document.querySelector('input[name="ai_provider"][value="custom"]').checked = true;
      toggleProviderFields('custom');
    } else {
      document.querySelector('input[name="ai_provider"][value="openrouter"]').checked = true;
      toggleProviderFields('openrouter');
    }

    // OpenRouter fields
    document.getElementById('settingsOpenRouterKey').value = s.api_key || '';
    document.getElementById('settingsOpenRouterModel').value = s.model || 'openai/gpt-4o-mini';

    // Custom fields
    document.getElementById('settingsCustomUrl').value = s.base_url || '';
    document.getElementById('settingsCustomKey').value = s.api_key || '';
    document.getElementById('settingsCustomModel').value = s.model || '';

    // Toggles
    document.getElementById('toggleAutoTitle').checked = s.auto_title !== 'false';
    document.getElementById('toggleAutoSummary').checked = s.auto_summary !== 'false';
    document.getElementById('toggleAutoTags').checked = s.auto_tags !== 'false';
    document.getElementById('toggleAiSearch').checked = s.ai_search !== 'false';
    document.getElementById('toggleAskBookmarks').checked = s.ask_bookmarks !== 'false';

    // User email
    const user = getCurrentUser();
    if (user) {
      document.getElementById('settingsEmail').textContent = user.email;
    }
  } catch (err) {
    showToast('Failed to load settings', 'error');
  }
}

/**
 * Toggle provider-specific fields visibility.
 */
function toggleProviderFields(provider) {
  document.getElementById('openrouterFields').style.display = provider === 'openrouter' ? 'block' : 'none';
  document.getElementById('customFields').style.display = provider === 'custom' ? 'block' : 'none';
}

/**
 * Save a single setting.
 */
async function saveSetting(key, value) {
  try {
    await apiCall('/api/settings', 'POST', { key, value });
    // Toast is shown by the debounced save function
  } catch (err) {
    showToast(`Failed to save ${key}`, 'error');
  }
}

/**
 * Debounced setting save.
 */
function debouncedSave(key, value) {
  clearTimeout(settingsDebounceTimer);
  settingsDebounceTimer = setTimeout(async () => {
    try {
      await apiCall('/api/settings', 'POST', { key, value });
      showToast('Saved', 'success');
    } catch (err) {
      showToast(`Failed to save ${key}`, 'error');
    }
  }, 500);
}

/**
 * Test AI connection.
 */
async function testConnection() {
  const btn = document.getElementById('testConnectionBtn');
  const resultEl = document.getElementById('connectionResult');

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
  resultEl.style.display = 'none';

  try {
    // First save current settings
    const provider = document.querySelector('input[name="ai_provider"]:checked').value;

    if (provider === 'openrouter') {
      const apiKey = document.getElementById('settingsOpenRouterKey').value;
      const model = document.getElementById('settingsOpenRouterModel').value;

      await apiCall('/api/settings', 'POST', { key: 'ai_provider', value: 'openrouter' });
      await apiCall('/api/settings', 'POST', { key: 'api_key', value: apiKey });
      await apiCall('/api/settings', 'POST', { key: 'model', value: model });
    } else {
      const apiKey = document.getElementById('settingsCustomKey').value;
      const baseUrl = document.getElementById('settingsCustomUrl').value;
      const model = document.getElementById('settingsCustomModel').value;

      await apiCall('/api/settings', 'POST', { key: 'ai_provider', value: 'custom' });
      await apiCall('/api/settings', 'POST', { key: 'api_key', value: apiKey });
      await apiCall('/api/settings', 'POST', { key: 'base_url', value: baseUrl });
      await apiCall('/api/settings', 'POST', { key: 'model', value: model });
    }

    // Test by making a minimal AI search call
    const testResult = await apiCall('/api/ai-search', 'POST', { query: 'test' });
    resultEl.innerHTML = '<i class="fas fa-check-circle" style="color: var(--success);"></i> Connection successful';
    resultEl.style.color = 'var(--success)';
    resultEl.style.display = 'block';
    showToast('Connection successful', 'success');
  } catch (err) {
    resultEl.innerHTML = `<i class="fas fa-times-circle" style="color: var(--danger);"></i> Connection failed: ${escapeHtml(err.message)}`;
    resultEl.style.color = 'var(--danger)';
    resultEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
  }
}

/**
 * Export bookmarks as JSON.
 */
async function exportJSON() {
  try {
    const response = await apiCallRaw('/api/export/json');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bookmarks-export.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported as JSON', 'success');
  } catch (err) {
    showToast('Export failed', 'error');
  }
}

/**
 * Export bookmarks as CSV.
 */
async function exportCSV() {
  try {
    const response = await apiCallRaw('/api/export/csv');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bookmarks-export.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported as CSV', 'success');
  } catch (err) {
    showToast('Export failed', 'error');
  }
}

/**
 * Setup settings handlers.
 */
function setupSettings() {
  // Provider radio toggle
  document.querySelectorAll('input[name="ai_provider"]').forEach(radio => {
    radio.addEventListener('change', () => {
      toggleProviderFields(radio.value);
      debouncedSave('ai_provider', radio.value);
    });
  });

  // OpenRouter fields
  const orKey = document.getElementById('settingsOpenRouterKey');
  const orModel = document.getElementById('settingsOpenRouterModel');

  if (orKey) {
    orKey.addEventListener('input', () => debouncedSave('api_key', orKey.value));
  }
  if (orModel) {
    orModel.addEventListener('input', () => debouncedSave('model', orModel.value));
  }

  // Custom fields
  const cUrl = document.getElementById('settingsCustomUrl');
  const cKey = document.getElementById('settingsCustomKey');
  const cModel = document.getElementById('settingsCustomModel');

  if (cUrl) cUrl.addEventListener('input', () => debouncedSave('base_url', cUrl.value));
  if (cKey) cKey.addEventListener('input', () => debouncedSave('api_key', cKey.value));
  if (cModel) cModel.addEventListener('input', () => debouncedSave('model', cModel.value));

  // Feature toggles
  const toggleIds = [
    { id: 'toggleAutoTitle', key: 'auto_title' },
    { id: 'toggleAutoSummary', key: 'auto_summary' },
    { id: 'toggleAutoTags', key: 'auto_tags' },
    { id: 'toggleAiSearch', key: 'ai_search' },
    { id: 'toggleAskBookmarks', key: 'ask_bookmarks' },
  ];

  toggleIds.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        debouncedSave(key, el.checked ? 'true' : 'false');
      });
    }
  });

  // Test connection
  const testBtn = document.getElementById('testConnectionBtn');
  if (testBtn) testBtn.addEventListener('click', testConnection);

  // Change password
  const changePwBtn = document.getElementById('changePwBtn');
  if (changePwBtn) {
    changePwBtn.addEventListener('click', async () => {
      const current = document.getElementById('settingsCurrentPw').value;
      const newPw = document.getElementById('settingsNewPw').value;
      const confirm = document.getElementById('settingsConfirmPw').value;

      if (!current || !newPw) {
        showToast('Please fill in all password fields', 'warning');
        return;
      }

      if (newPw !== confirm) {
        showToast('New passwords do not match', 'error');
        return;
      }

      if (newPw.length < 6) {
        showToast('Password must be at least 6 characters', 'warning');
        return;
      }

      try {
        await apiCall('/api/auth/change-password', 'PUT', { currentPassword: current, newPassword: newPw });
        showToast('Password changed successfully', 'success');
        document.getElementById('settingsCurrentPw').value = '';
        document.getElementById('settingsNewPw').value = '';
        document.getElementById('settingsConfirmPw').value = '';
      } catch (err) {
        showToast(err.message || 'Failed to change password', 'error');
      }
    });
  }

  // AI Sync Now
  const aiSyncBtn = document.getElementById('aiSyncNowBtn');
  if (aiSyncBtn) {
    aiSyncBtn.addEventListener('click', aiSyncNow);
  }

  // Export buttons
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');

  if (exportJsonBtn) exportJsonBtn.addEventListener('click', exportJSON);
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCSV);
}

/**
 * AI Sync Now — process all pending/failed bookmarks with progress bar.
 * Uses the server-side batch endpoint which processes bookmarks in chunks
 * while the frontend polls for progress by checking bookmark AI status counts.
 */
async function aiSyncNow() {
  const btn = document.getElementById('aiSyncNowBtn');
  const progressContainer = document.getElementById('aiSyncProgressContainer');
  const progressFill = document.getElementById('aiSyncProgressFill');
  const progressLabel = document.getElementById('aiSyncProgressLabel');
  const progressStatus = document.getElementById('aiSyncStatus');

  // Reset and show progress
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
  progressContainer.style.display = 'block';
  progressFill.style.width = '0%';
  progressFill.style.background = 'linear-gradient(90deg, var(--accent), #818cf8)';
  progressLabel.textContent = '0 / ?';
  progressStatus.textContent = 'Scanning bookmarks...';

  try {
    // Phase 1: Fetch all bookmarks to find pending/failed ones
    let allBookmarks = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await apiCall(`/api/bookmarks?limit=100&page=${page}`);
      allBookmarks.push(...data.bookmarks);
      hasMore = data.pagination.page < data.pagination.totalPages;
      page++;
    }

    const pendingItems = allBookmarks.filter(
      b => b.ai_status === 'pending' || b.ai_status === 'failed'
    );

    if (pendingItems.length === 0) {
      progressStatus.textContent = '✓ No bookmarks pending AI processing.';
      progressFill.style.width = '100%';
      progressFill.style.background = 'var(--success)';
      showToast('No bookmarks need AI processing', 'info');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sync"></i> AI Sync Now';
      return;
    }

    const total = pendingItems.length;
    progressLabel.textContent = `0 / ${total}`;
    progressStatus.textContent = `Processing 0 of ${total}...`;

    // Phase 2: Kick off the server-side batch sync
    // This processes all pending bookmarks in chunks on the server
    const syncPromise = apiCall('/api/ai-sync', 'POST', { chunkSize: 5 });

    // Phase 3: Poll for progress while the server works
    const pollUntil = Date.now() + 300000; // 5 min max
    let processed = 0;
    let pollInterval = 2000; // Start polling every 2s

    while (Date.now() < pollUntil && processed < total) {
      await sleep(pollInterval);

      // Check how many are still pending or processing
      const progressData = await apiCall('/api/bookmarks?limit=100');
      const stillPending = progressData.bookmarks.filter(
        b => b.ai_status === 'pending' || b.ai_status === 'processing'
      ).length;

      // Estimate processed: total minus those still pending/processing
      processed = Math.max(0, Math.min(total - stillPending, total));

      const percent = Math.round((processed / total) * 100);
      progressFill.style.width = `${percent}%`;
      progressLabel.textContent = `${processed} / ${total}`;

      if (processed < total) {
        progressStatus.textContent = `Processing ${processed} of ${total}...`;
      }

      // Gradually increase poll interval to avoid hammering the API
      pollInterval = Math.min(pollInterval + 500, 5000);

      if (processed >= total) break;
    }

    // Wait for server confirmation
    try {
      await syncPromise;
    } catch (e) {
      // Ignore — progress was already tracked via polling
    }

    // Phase 4: Final accurate count
    const finalData = await apiCall('/api/bookmarks?limit=100');
    const finalPending = finalData.bookmarks.filter(
      b => b.ai_status === 'pending' || b.ai_status === 'failed' || b.ai_status === 'processing'
    ).length;
    const finalProcessed = total - finalPending;

    progressFill.style.width = '100%';
    progressFill.style.background = 'var(--success)';
    progressLabel.textContent = `${finalProcessed} / ${total}`;
    progressStatus.textContent = `✓ AI sync complete! Processed ${finalProcessed} of ${total} bookmark${total !== 1 ? 's' : ''}.`;
    showToast(`AI sync complete — ${finalProcessed} bookmark${total !== 1 ? 's' : ''} processed`, 'success');
  } catch (err) {
    progressFill.style.background = 'var(--danger)';
    progressStatus.textContent = `✗ Sync failed: ${escapeHtml(err.message)}`;
    showToast(`AI sync failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sync"></i> AI Sync Now';
  }
}

/** Small sleep helper. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
