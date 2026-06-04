// ============================================================
// API Client — AI Bookmark Vault
// ============================================================

const API_BASE = window.API_BASE || ''; // Same origin by default

/**
 * Make an authenticated API call to the backend.
 * @param {string} endpoint - API path (e.g., '/api/bookmarks')
 * @param {string} method - HTTP method
 * @param {object|null} body - Request body (for POST/PUT)
 * @returns {Promise<object>} Parsed JSON response
 */
async function apiCall(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('vault_token');

  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { method, headers };

  if (body !== null && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);

  // Handle 401 — redirect to login
  if (response.status === 401) {
    localStorage.removeItem('vault_token');
    localStorage.removeItem('vault_user');
    window.location.href = '/index.html';
    throw new Error('Session expired');
  }

  const data = await response.json();

  if (!response.ok) {
    const err = new Error(data.error || 'API request failed');
    err.code = data.code || 'UNKNOWN';
    err.status = response.status;
    throw err;
  }

  return data;
}

/**
 * Make an API call and get the raw Response (for file downloads).
 */
async function apiCallRaw(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('vault_token');

  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { method, headers };

  if (body !== null && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);

  if (response.status === 401) {
    localStorage.removeItem('vault_token');
    localStorage.removeItem('vault_user');
    window.location.href = '/index.html';
    throw new Error('Session expired');
  }

  return response;
}
