// ============================================================
// Auth Module — AI Bookmark Vault
// ============================================================

/**
 * Log in with email and password.
 * Saves token and user to localStorage.
 */
async function login(email, password) {
  const data = await apiCall('/api/auth/login', 'POST', { email, password });
  localStorage.setItem('vault_token', data.token);
  localStorage.setItem('vault_user', JSON.stringify(data.user));
  return data;
}

/**
 * Register a new user.
 */
async function register(email, password) {
  const data = await apiCall('/api/auth/register', 'POST', { email, password });
  localStorage.setItem('vault_token', data.token);
  localStorage.setItem('vault_user', JSON.stringify(data.user));
  return data;
}

/**
 * Log out — clear local storage and redirect to login.
 */
function logout() {
  localStorage.removeItem('vault_token');
  localStorage.removeItem('vault_user');
  window.location.href = '/index.html';
}

/**
 * Get the currently logged-in user object.
 */
function getCurrentUser() {
  const raw = localStorage.getItem('vault_user');
  return raw ? JSON.parse(raw) : null;
}

/**
 * Check if user is authenticated.
 */
function isAuthenticated() {
  return !!localStorage.getItem('vault_token');
}

/**
 * Require auth — redirect to login if not authenticated.
 */
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = '/index.html';
  }
}
