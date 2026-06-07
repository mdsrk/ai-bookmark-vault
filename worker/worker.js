// ============================================================
// AI Bookmark Vault — Cloudflare Worker
// Single-file backend: auth, bookmarks, search, AI, settings
// ============================================================

// ─── Security & CORS Headers ───────────────────────────────
const SECURITY_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
  });
}

function error(msg, code, status = 400) {
  return json({ error: msg, code }, status);
}

// ─── JWT Helpers (HMAC-SHA256) ─────────────────────────────
async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64 = (obj) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const headerB64 = b64(header);
  const payloadB64 = b64({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7 * 86400 });

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${headerB64}.${payloadB64}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBin = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

    const valid = await crypto.subtle.verify('HMAC', key, sigBin, enc.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// ─── Password Hashing (PBKDF2) ─────────────────────────────
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return `${saltB64}:${hashB64}`;
}

async function verifyPassword(password, stored) {
  const [saltB64, hashB64] = stored.split(':');
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  const derivedB64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return derivedB64 === hashB64;
}

// ─── Auth Middleware ────────────────────────────────────────
async function getUserFromRequest(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  return payload;
}

// ─── URL Normalization ─────────────────────────────────────
function normalizeUrl(raw) {
  let url = raw.trim();
  // If no protocol, add https://
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url;
}

// ─── Database Init & Migration ────────────────────────────
async function initDB(env) {
  // Create tables if not exist (original schema)
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bookmarks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      url         TEXT NOT NULL,
      title       TEXT,
      summary     TEXT,
      tags        TEXT,
      notes       TEXT,
      favorite    INTEGER DEFAULT 0,
      ai_status   TEXT DEFAULT 'pending',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS settings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT,
      UNIQUE(user_id, key)
    )`),
  ]);

  // ── Migrations ──────────────────────────────────────────
  // Migration 1: Add folder_id column
  try {
    await env.DB.prepare(`ALTER TABLE bookmarks ADD COLUMN folder_id INTEGER`).run();
  } catch (e) { /* column already exists */ }

  // Migration 2: Add ai_retry_at column
  try {
    await env.DB.prepare(`ALTER TABLE bookmarks ADD COLUMN ai_retry_at DATETIME`).run();
  } catch (e) { /* column already exists */ }

  // Migration 3: Create folders table
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS folders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      name        TEXT NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name)
    )`).run();
  } catch (e) { /* table already exists */ }

  // Seed admin user if not exists
  const adminExists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind('admin').first();
  if (!adminExists) {
    const password_hash = await hashPassword('admin');
    await env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').bind('admin', password_hash).run();
    console.log('Admin user seeded: admin / admin');
  }
}

// ─── LLM Helper ────────────────────────────────────────────
async function callLLM(env, userId, messages) {
  // Read user's LLM settings
  const { results } = await env.DB.prepare(
    'SELECT key, value FROM settings WHERE user_id = ? AND (key = ? OR key = ? OR key = ? OR key = ?)'
  ).bind(userId, 'ai_provider', 'api_key', 'base_url', 'model').all();

  const settings = {};
  for (const row of results) settings[row.key] = row.value;

  const provider = settings.ai_provider || 'openrouter';
  let base_url, api_key, model;

  if (provider === 'custom') {
    base_url = settings.base_url || '';
    api_key = settings.api_key || '';
    model = settings.model || 'gpt-4o-mini';
  } else {
    base_url = 'https://openrouter.ai/api/v1';
    api_key = settings.api_key || env.OPENROUTER_KEY || '';
    model = settings.model || 'openai/gpt-4o-mini';
  }

  if (!api_key) {
    throw new Error('AI provider not configured');
  }

  const res = await fetch(`${base_url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${api_key}`,
      ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://bookmark-vault.pages.dev' } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM call failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── AI Processing Logic ───────────────────────────────────
async function processBookmarkAI(env, bookmarkId, userId) {
  try {
    // Set status to processing
    await env.DB.prepare('UPDATE bookmarks SET ai_status = ? WHERE id = ? AND user_id = ?')
      .bind('processing', bookmarkId, userId).run();

    // Get bookmark
    const bookmark = await env.DB.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?')
      .bind(bookmarkId, userId).first();
    if (!bookmark) throw new Error('Bookmark not found');

    // Check feature toggles
    const { results: toggles } = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE user_id = ? AND key LIKE 'auto_%'"
    ).bind(userId).all();
    const toggleMap = {};
    for (const t of toggles) toggleMap[t.key] = t.value;

    const autoTitle = toggleMap['auto_title'] !== 'false';
    const autoSummary = toggleMap['auto_summary'] !== 'false';
    const autoTags = toggleMap['auto_tags'] !== 'false';

    // Fetch URL content
    let pageTitle = bookmark.title || '';
    let pageContent = '';
    try {
      const res = await fetch(bookmark.url, { signal: AbortSignal.timeout(8000) });
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      if (titleMatch) pageTitle = titleMatch[1].trim();
      const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
      if (descMatch) pageContent = descMatch[1].trim();
    } catch {
      // Gracefully fail on fetch errors
    }

    // Build LLM prompt
    const fields = [];
    if (autoTitle) fields.push('title');
    if (autoSummary) fields.push('summary (2-3 sentences)');
    if (autoTags) fields.push('tags (5 max, comma-separated)');

    if (fields.length === 0) {
      await env.DB.prepare('UPDATE bookmarks SET ai_status = ? WHERE id = ?')
        .bind('completed', bookmarkId).run();
      return;
    }

    const prompt = `Analyze this bookmark and provide the following fields in JSON format: ${fields.join(', ')}.

URL: ${bookmark.url}
Page Title: ${pageTitle}
Page Description: ${pageContent}
User Notes: ${bookmark.notes || 'none'}

Respond with valid JSON only, no markdown. Example format:
${autoTitle ? '{"title": "..."}' : ''}${autoSummary ? '{"summary": "..."}' : ''}${autoTags ? '{"tags": "tag1, tag2, tag3"}' : ''}`;

    const response = await callLLM(env, userId, [
      { role: 'system', content: 'You analyze web bookmarks and return JSON. Always respond with valid JSON only.' },
      { role: 'user', content: prompt },
    ]);

    // Parse JSON from response
    let parsed;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error('Failed to parse LLM response as JSON');
    }

    // Update bookmark with AI-generated fields
    const updates = {};
    if (autoTitle && parsed.title) updates.title = parsed.title;
    if (autoSummary && parsed.summary) updates.summary = parsed.summary;
    if (autoTags && parsed.tags) updates.tags = parsed.tags;

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = Object.values(updates);
      await env.DB.prepare(`UPDATE bookmarks SET ${setClauses}, ai_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...values, 'completed', bookmarkId).run();
    } else {
      await env.DB.prepare('UPDATE bookmarks SET ai_status = ? WHERE id = ?')
        .bind('completed', bookmarkId).run();
    }
  } catch (err) {
    console.error('AI processing error:', err.message);
    // Set retry time 5 minutes from now
    const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE bookmarks SET ai_status = ?, ai_retry_at = ? WHERE id = ?')
      .bind('failed', retryAt, bookmarkId).run();
  }
}

// ─── Background AI Retry Job ───────────────────────────────
async function retryFailedBookmarks(env) {
  try {
    const now = new Date().toISOString();
    const { results } = await env.DB.prepare(
      `SELECT id, user_id FROM bookmarks WHERE ai_status = 'failed' AND ai_retry_at IS NOT NULL AND ai_retry_at <= ? LIMIT 10`
    ).bind(now).all();
    
    for (const bm of results) {
      console.log(`Retrying AI for bookmark ${bm.id}`);
      env.waitUntil(processBookmarkAI(env, bm.id, bm.user_id));
    }
  } catch (err) {
    console.error('AI retry job error:', err.message);
  }
}

// ─── Route Handler ─────────────────────────────────────────
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: { ...CORS_HEADERS, ...SECURITY_HEADERS } });
  }

  // Serve robots.txt
  if (path === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: {
        'Content-Type': 'text/plain',
        ...SECURITY_HEADERS,
      },
    });
  }

  // Initialize DB on first request
  await initDB(env);

  // ─── Auth Routes ───────────────────────────────────────
  // POST /api/auth/register
  if (path === '/api/auth/register' && method === 'POST') {
    try {
      const { email, password } = await request.json();
      if (!email || !password) return error('Email and password required', 'MISSING_FIELDS');
      if (password.length < 6) return error('Password must be at least 6 characters', 'WEAK_PASSWORD');

      const password_hash = await hashPassword(password);
      const result = await env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
        .bind(email, password_hash).run();

      const token = await createJWT({ userId: result.meta.last_row_id, email }, env.JWT_SECRET);
      return json({ token, user: { id: result.meta.last_row_id, email } });
    } catch (err) {
      if (err.message?.includes('UNIQUE constraint')) {
        return error('Email already registered', 'EMAIL_EXISTS');
      }
      return error(err.message, 'REGISTER_FAILED');
    }
  }

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    try {
      const { email, password } = await request.json();
      if (!email || !password) return error('Email and password required', 'MISSING_FIELDS');

      const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
      if (!user) return error('Invalid credentials', 'INVALID_CREDENTIALS', 401);

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) return error('Invalid credentials', 'INVALID_CREDENTIALS', 401);

      const token = await createJWT({ userId: user.id, email: user.email }, env.JWT_SECRET);
      return json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
      return error(err.message, 'LOGIN_FAILED');
    }
  }

  // POST /api/auth/logout
  if (path === '/api/auth/logout' && method === 'POST') {
    // Stateless JWT — just return success
    return json({ message: 'Logged out' });
  }

  // POST /api/auth/change-password
  if (path === '/api/auth/change-password' && method === 'PUT') {
    const user = await getUserFromRequest(request, env);
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);

    try {
      const { currentPassword, newPassword } = await request.json();
      if (!currentPassword || !newPassword) return error('Current and new password required', 'MISSING_FIELDS');
      if (newPassword.length < 6) return error('New password must be at least 6 characters', 'WEAK_PASSWORD');

      const dbUser = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.userId).first();
      if (!dbUser) return error('User not found', 'NOT_FOUND', 404);

      const valid = await verifyPassword(currentPassword, dbUser.password_hash);
      if (!valid) return error('Current password is incorrect', 'INVALID_PASSWORD', 401);

      const password_hash = await hashPassword(newPassword);
      await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(password_hash, user.userId).run();

      return json({ message: 'Password changed successfully' });
    } catch (err) {
      return error(err.message, 'CHANGE_PASSWORD_FAILED');
    }
  }

  // ─── Authenticated Routes ──────────────────────────────
  const user = await getUserFromRequest(request, env);

  // ─── Bookmarks Routes ──────────────────────────────────
  // GET /api/bookmarks
  if (path === '/api/bookmarks' && method === 'GET') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);

    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;
    const favoriteFilter = url.searchParams.get('favorite');
    const sortBy = url.searchParams.get('sort') || 'newest';
    const folderFilter = url.searchParams.get('folder_id');

    let query = 'SELECT b.*, f.name as folder_name FROM bookmarks b LEFT JOIN folders f ON b.folder_id = f.id WHERE b.user_id = ?';
    const params = [user.userId];

    if (favoriteFilter === 'true' || favoriteFilter === '1') {
      query += ' AND b.favorite = 1';
    }

    if (folderFilter) {
      query += ' AND b.folder_id = ?';
      params.push(parseInt(folderFilter));
    }

    // Sort options
    switch (sortBy) {
      case 'oldest':
        query += ' ORDER BY b.created_at ASC';
        break;
      case 'title':
        query += ' ORDER BY b.title ASC, b.created_at DESC';
        break;
      case 'recently_updated':
        query += ' ORDER BY b.updated_at DESC';
        break;
      default: // newest
        query += ' ORDER BY b.created_at DESC';
    }

    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...params).all();

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM bookmarks WHERE user_id = ?';
    const countParams = [user.userId];
    if (favoriteFilter === 'true' || favoriteFilter === '1') {
      countQuery += ' AND favorite = 1';
    }
    if (folderFilter) {
      countQuery += ' AND folder_id = ?';
      countParams.push(parseInt(folderFilter));
    }
    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();

    return json({
      bookmarks: results,
      pagination: {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit),
      },
    });
  }

  // POST /api/bookmarks
  if (path === '/api/bookmarks' && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);

    try {
      let { url: bookmarkUrl, notes, folder_id } = await request.json();
      if (!bookmarkUrl) return error('URL is required', 'MISSING_FIELDS');

      // Normalize URL - accept without https:// and www.
      bookmarkUrl = normalizeUrl(bookmarkUrl);

      // Basic URL validation
      try {
        new URL(bookmarkUrl);
      } catch {
        return error('Invalid URL', 'INVALID_URL');
      }

      const result = await env.DB.prepare(
        'INSERT INTO bookmarks (user_id, url, notes, folder_id, ai_status) VALUES (?, ?, ?, ?, ?)'
      ).bind(user.userId, bookmarkUrl, notes || null, folder_id || null, 'pending').run();

      const bookmarkId = result.meta.last_row_id;

      // Trigger AI processing in background
      env.waitUntil(processBookmarkAI(env, bookmarkId, user.userId));

      const bookmark = await env.DB.prepare('SELECT * FROM bookmarks WHERE id = ?').bind(bookmarkId).first();
      return json(bookmark, 201);
    } catch (err) {
      return error(err.message, 'CREATE_FAILED');
    }
  }

  // GET /api/bookmarks/:id
  const bookmarkMatch = path.match(/^\/api\/bookmarks\/(\d+)$/);
  if (bookmarkMatch && method === 'GET') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    const bookmark = await env.DB.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?')
      .bind(parseInt(bookmarkMatch[1]), user.userId).first();
    if (!bookmark) return error('Not found', 'NOT_FOUND', 404);
    return json(bookmark);
  }

  // PUT /api/bookmarks/:id
  if (bookmarkMatch && method === 'PUT') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    try {
      const updates = await request.json();
      const allowedFields = ['url', 'title', 'summary', 'tags', 'notes', 'favorite', 'folder_id'];
      const setClauses = [];
      const values = [];

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          setClauses.push(`${field} = ?`);
          values.push(updates[field]);
        }
      }

      if (setClauses.length === 0) return error('No fields to update', 'NO_UPDATES');

      // If user manually saved edits, don't re-trigger AI for completed cards
      setClauses.push('updated_at = CURRENT_TIMESTAMP');
      values.push(parseInt(bookmarkMatch[1]), user.userId);

      await env.DB.prepare(
        `UPDATE bookmarks SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`
      ).bind(...values).run();

      const bookmark = await env.DB.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?')
        .bind(parseInt(bookmarkMatch[1]), user.userId).first();
      return json(bookmark);
    } catch (err) {
      return error(err.message, 'UPDATE_FAILED');
    }
  }

  // DELETE /api/bookmarks/:id
  if (bookmarkMatch && method === 'DELETE') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    const result = await env.DB.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?')
      .bind(parseInt(bookmarkMatch[1]), user.userId).run();
    if (result.meta.changes === 0) return error('Not found', 'NOT_FOUND', 404);
    return json({ message: 'Deleted' });
  }

  // POST /api/bookmarks/:id/favorite
  const favMatch = path.match(/^\/api\/bookmarks\/(\d+)\/favorite$/);
  if (favMatch && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    const bookmark = await env.DB.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?')
      .bind(parseInt(favMatch[1]), user.userId).first();
    if (!bookmark) return error('Not found', 'NOT_FOUND', 404);

    const newFav = bookmark.favorite ? 0 : 1;
    await env.DB.prepare('UPDATE bookmarks SET favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .bind(newFav, parseInt(favMatch[1]), user.userId).run();

    return json({ favorite: newFav });
  }

  // POST /api/bookmarks/:id/retry-ai
  const retryMatch = path.match(/^\/api\/bookmarks\/(\d+)\/retry-ai$/);
  if (retryMatch && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    const bookmark = await env.DB.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?')
      .bind(parseInt(retryMatch[1]), user.userId).first();
    if (!bookmark) return error('Not found', 'NOT_FOUND', 404);
    if (bookmark.ai_status !== 'failed') return error('Bookmark AI status is not failed', 'INVALID_STATUS');

    // Trigger AI retry in background
    env.waitUntil(processBookmarkAI(env, bookmark.id, user.userId));

    return json({ message: 'AI processing retriggered', ai_status: 'pending' });
  }

  // POST /api/process-bookmark/:id (internal trigger)
  const procMatch = path.match(/^\/api\/process-bookmark\/(\d+)$/);
  if (procMatch && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    const bookmarkId = parseInt(procMatch[1]);
    env.waitUntil(processBookmarkAI(env, bookmarkId, user.userId));
    return json({ message: 'Processing started' });
  }

  // ─── Search Routes ─────────────────────────────────────
  // GET /api/search?q=query
  if (path === '/api/search' && method === 'GET') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);

    const q = url.searchParams.get('q');
    if (!q || q.trim() === '') return json({ results: [] });

    const searchTerm = `%${q}%`;
    const { results } = await env.DB.prepare(
      `SELECT * FROM bookmarks 
       WHERE user_id = ? 
       AND (title LIKE ? OR url LIKE ? OR tags LIKE ? OR notes LIKE ? OR summary LIKE ?)
       ORDER BY 
         CASE 
           WHEN title LIKE ? THEN 1
           WHEN url LIKE ? THEN 4
           ELSE 5
         END,
         created_at DESC
       LIMIT 50`
    ).bind(
      user.userId,
      searchTerm, searchTerm, searchTerm, searchTerm, searchTerm,
      `%${q}%`, `%${q}%`
    ).all();

    return json({ results });
  }

  // POST /api/ai-search
  if (path === '/api/ai-search' && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);

    try {
      const { query } = await request.json();
      if (!query) return error('Query is required', 'MISSING_FIELDS');

      // Check if AI features are enabled
      const aiSearchEnabled = await env.DB.prepare(
        "SELECT value FROM settings WHERE user_id = ? AND key = ?"
      ).bind(user.userId, 'ai_search').first();
      if (aiSearchEnabled && aiSearchEnabled.value === 'false') {
        return error('AI Search is disabled in settings', 'AI_DISABLED');
      }

      // SQL keyword search for candidates
      const terms = query.split(/\s+/).filter(t => t.length > 2);
      let sqlQuery = 'SELECT * FROM bookmarks WHERE user_id = ?';
      const params = [user.userId];

      if (terms.length > 0) {
        const likeClauses = terms.map(() => '(title LIKE ? OR url LIKE ? OR tags LIKE ? OR notes LIKE ? OR summary LIKE ?)');
        sqlQuery += ' AND (' + likeClauses.join(' OR ') + ')';
        for (const term of terms) {
          const t = `%${term}%`;
          params.push(t, t, t, t, t);
        }
      }

      sqlQuery += ' ORDER BY favorite DESC, created_at DESC LIMIT 20';

      const { results } = await env.DB.prepare(sqlQuery).bind(...params).all();

      if (results.length === 0) {
        return json({ results: [], explanation: 'No bookmarks found matching your query.' });
      }

      // Send candidates to LLM for ranking
      const bookmarksContext = results.map((b, i) =>
        `[${i + 1}] Title: ${b.title || 'Untitled'}\nURL: ${b.url}\nSummary: ${b.summary || 'No summary'}\nTags: ${b.tags || 'None'}\nNotes: ${b.notes || 'None'}`
      ).join('\n\n');

      const llmResponse = await callLLM(env, user.userId, [
        {
          role: 'system',
          content: 'You are a bookmark search assistant. Given a user query and a list of bookmarks, rank them by relevance and provide a brief explanation. Return JSON: { "explanation": "string", "ranked_ids": [1,2,3...] } where ranked_ids are the numbers from the bookmark list, ordered by relevance (most relevant first). Respond with valid JSON only.',
        },
        {
          role: 'user',
          content: `User query: "${query}"\n\nBookmarks:\n${bookmarksContext}`,
        },
      ]);

      // Parse response
      let ranked;
      try {
        const jsonMatch = llmResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : llmResponse.trim();
        ranked = JSON.parse(jsonStr);
      } catch {
        // Fallback: return as-is
        return json({
          results,
          explanation: 'Here are the bookmarks matching your query.',
        });
      }

      // Reorder results based on LLM ranking
      const rankedResults = (ranked.ranked_ids || [])
        .map(id => results[id - 1])
        .filter(Boolean);

      const finalResults = rankedResults.length > 0 ? rankedResults : results;

      return json({
        results: finalResults,
        explanation: ranked.explanation || 'Here are the most relevant bookmarks.',
      });
    } catch (err) {
      if (err.message === 'AI provider not configured') {
        return error('AI features require an API key. Configure in Settings.', 'AI_NOT_CONFIGURED');
      }
      return error(err.message, 'AI_SEARCH_FAILED');
    }
  }

  // POST /api/ask
  if (path === '/api/ask' && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);

    try {
      const { question, history } = await request.json();
      if (!question) return error('Question is required', 'MISSING_FIELDS');

      // Check if Ask Bookmarks is enabled
      const askEnabled = await env.DB.prepare(
        "SELECT value FROM settings WHERE user_id = ? AND key = ?"
      ).bind(user.userId, 'ask_bookmarks').first();
      if (askEnabled && askEnabled.value === 'false') {
        return error('Ask My Bookmarks is disabled in settings', 'AI_DISABLED');
      }

      // Extract keywords from question for SQL search
      const terms = question.split(/\s+/).filter(t => t.length > 2);
      let sqlQuery = 'SELECT * FROM bookmarks WHERE user_id = ?';
      const params = [user.userId];
      const allTerms = [];

      if (terms.length > 0) {
        const likeClauses = terms.map(() => '(title LIKE ? OR url LIKE ? OR tags LIKE ? OR notes LIKE ? OR summary LIKE ?)');
        sqlQuery += ' AND (' + likeClauses.join(' OR ') + ')';
        for (const term of terms) {
          const t = `%${term}%`;
          params.push(t, t, t, t, t);
          allTerms.push(term);
        }
      }

      sqlQuery += ' ORDER BY favorite DESC, created_at DESC LIMIT 20';

      const { results } = await env.DB.prepare(sqlQuery).bind(...params).all();

      if (results.length === 0) {
        return json({
          answer: "I couldn't find any bookmarks related to that. Try saving some resources first.",
          citations: [],
        });
      }

      // Build context for LLM
      const bookmarksContext = results.map((b, i) =>
        `[${i + 1}] Title: ${b.title || 'Untitled'}\nURL: ${b.url}\nSummary: ${b.summary || 'No summary'}\nTags: ${b.tags || 'None'}\nNotes: ${b.notes || 'None'}`
      ).join('\n\n');

      // Build conversation history (last 5 exchanges)
      const historyMessages = (history || []).slice(-5).flatMap(h => [
        { role: 'user', content: h.question },
        { role: 'assistant', content: h.answer },
      ]);

      const llmResponse = await callLLM(env, user.userId, [
        {
          role: 'system',
          content: 'You are a helpful assistant that answers questions based on a user\'s personal bookmark collection. Answer the question directly using only the provided bookmarks. Cite bookmarks by their title (format: [Title]). If you use information from a bookmark, always cite it. Return JSON: { "answer": "your detailed answer with citations", "citations": ["Title1", "Title2"] }. Respond with valid JSON only.',
        },
        ...historyMessages,
        {
          role: 'user',
          content: `Question: "${question}"\n\nMy saved bookmarks:\n${bookmarksContext}`,
        },
      ]);

      // Parse response
      let result;
      try {
        const jsonMatch = llmResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : llmResponse.trim();
        result = JSON.parse(jsonStr);
      } catch {
        return json({
          answer: llmResponse,
          citations: results.map(b => b.title || b.url),
        });
      }

      return json({
        answer: result.answer || llmResponse,
        citations: result.citations || [],
      });
    } catch (err) {
      if (err.message === 'AI provider not configured') {
        return error('AI features require an API key. Configure in Settings.', 'AI_NOT_CONFIGURED');
      }
      return error(err.message, 'ASK_FAILED');
    }
  }

  // ─── Settings Routes ───────────────────────────────────
  // GET /api/settings
  if (path === '/api/settings' && method === 'GET') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    const { results } = await env.DB.prepare('SELECT key, value FROM settings WHERE user_id = ?')
      .bind(user.userId).all();

    const settings = {};
    for (const row of results) settings[row.key] = row.value;

    // Set defaults
    if (!settings.ai_provider) settings.ai_provider = 'openrouter';
    if (!settings.model) settings.model = 'openai/gpt-4o-mini';
    if (settings.auto_title === undefined) settings.auto_title = 'true';
    if (settings.auto_summary === undefined) settings.auto_summary = 'true';
    if (settings.auto_tags === undefined) settings.auto_tags = 'true';
    if (settings.ai_search === undefined) settings.ai_search = 'true';
    if (settings.ask_bookmarks === undefined) settings.ask_bookmarks = 'true';

    return json({ settings });
  }

  // POST /api/settings
  if (path === '/api/settings' && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    try {
      const { key, value } = await request.json();
      if (!key) return error('Key is required', 'MISSING_FIELDS');

      await env.DB.prepare(
        'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = ?'
      ).bind(user.userId, key, value, value).run();

      return json({ message: 'Saved' });
    } catch (err) {
      return error(err.message, 'SAVE_SETTING_FAILED');
    }
  }

  // ─── Import Bookmarks ──────────────────────────────────
  // POST /api/bookmarks/import
  if (path === '/api/bookmarks/import' && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    try {
      const { bookmarks, folder_id } = await request.json();
      if (!bookmarks || !Array.isArray(bookmarks) || bookmarks.length === 0) {
        return error('No bookmarks provided', 'MISSING_FIELDS');
      }

      // Pre-create folders from the import (if bookmarks have folder info)
      const folderCache = {}; // folderName -> folderId
      
      // First pass: collect unique folder paths and create them
      const folderPaths = new Set();
      for (const bm of bookmarks) {
        if (bm.folder) {
          const parts = bm.folder.split('/');
          let acc = '';
          for (const p of parts) {
            acc = acc ? acc + '/' + p : p;
            folderPaths.add(acc);
          }
        }
      }
      
      // Create folders from root to leaf
      for (const path of folderPaths) {
        const parts = path.split('/');
        const folderName = parts[parts.length - 1];
        try {
          const result = await env.DB.prepare(
            'INSERT INTO folders (user_id, name) VALUES (?, ?)'
          ).bind(user.userId, folderName).run();
          folderCache[path] = result.meta.last_row_id;
        } catch (e) {
          // Folder already exists - get its ID
          const existing = await env.DB.prepare(
            'SELECT id FROM folders WHERE user_id = ? AND name = ?'
          ).bind(user.userId, folderName).first();
          if (existing) folderCache[path] = existing.id;
        }
      }

      let imported = 0;
      for (const bm of bookmarks) {
        if (!bm.url) continue;
        try {
          const url = normalizeUrl(bm.url);
          new URL(url);
          
          // Determine folder: imported folder path > explicit folder_id > none
          let targetFolderId = null;
          if (bm.folder && folderCache[bm.folder]) {
            targetFolderId = folderCache[bm.folder];
          } else if (folder_id) {
            targetFolderId = parseInt(folder_id);
          }
          
          await env.DB.prepare(
            'INSERT INTO bookmarks (user_id, url, title, notes, folder_id, ai_status) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(user.userId, url, bm.title || null, bm.notes || null, targetFolderId, 'pending').run();
          imported++;
        } catch {
          // Skip invalid URLs
          continue;
        }
      }

      return json({ 
        imported, 
        total: bookmarks.length,
        folders_created: Object.keys(folderCache).length 
      });
    } catch (err) {
      return error(err.message, 'IMPORT_FAILED');
    }
  }

  // ─── Bulk Delete Bookmarks ──────────────────────────────
  // POST /api/bookmarks/bulk-delete
  if (path === '/api/bookmarks/bulk-delete' && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    try {
      const { ids } = await request.json();
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return error('No bookmark IDs provided', 'MISSING_FIELDS');
      }

      // Delete all matching bookmarks that belong to this user
      const placeholders = ids.map(() => '?').join(',');
      const result = await env.DB.prepare(
        `DELETE FROM bookmarks WHERE id IN (${placeholders}) AND user_id = ?`
      ).bind(...ids, user.userId).run();

      return json({ deleted: result.meta.changes });
    } catch (err) {
      return error(err.message, 'BULK_DELETE_FAILED');
    }
  }

  // ─── Folder Routes ─────────────────────────────────────
  // GET /api/folders
  if (path === '/api/folders' && method === 'GET') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    const { results } = await env.DB.prepare(
      'SELECT f.*, (SELECT COUNT(*) FROM bookmarks b WHERE b.folder_id = f.id) as bookmark_count FROM folders f WHERE f.user_id = ? ORDER BY f.name ASC'
    ).bind(user.userId).all();
    return json({ folders: results });
  }

  // POST /api/folders
  if (path === '/api/folders' && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    try {
      const { name } = await request.json();
      if (!name || !name.trim()) return error('Folder name is required', 'MISSING_FIELDS');

      const result = await env.DB.prepare(
        'INSERT INTO folders (user_id, name) VALUES (?, ?)'
      ).bind(user.userId, name.trim()).run();

      const folder = await env.DB.prepare('SELECT * FROM folders WHERE id = ?').bind(result.meta.last_row_id).first();
      return json(folder, 201);
    } catch (err) {
      if (err.message?.includes('UNIQUE constraint')) {
        return error('Folder already exists', 'FOLDER_EXISTS');
      }
      return error(err.message, 'CREATE_FOLDER_FAILED');
    }
  }

  // DELETE /api/folders/:id
  const folderMatch = path.match(/^\/api\/folders\/(\d+)$/);
  if (folderMatch && method === 'DELETE') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    const folderId = parseInt(folderMatch[1]);
    // Unset folder_id for bookmarks in this folder
    await env.DB.prepare('UPDATE bookmarks SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').bind(folderId, user.userId).run();
    await env.DB.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').bind(folderId, user.userId).run();
    return json({ message: 'Folder deleted' });
  }

  // ─── AI Sync ────────────────────────────────────────────
  // POST /api/ai-sync — process all pending bookmarks with progress
  if (path === '/api/ai-sync' && method === 'POST') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);

    try {
      const body = await request.json();
      const chunkSize = body.chunkSize || 5; // Process N bookmarks per chunk

      // Get all bookmarks that need AI processing (pending or failed)
      const { results: allBookmarks } = await env.DB.prepare(
        `SELECT id FROM bookmarks WHERE user_id = ? AND (ai_status = 'pending' OR ai_status = 'failed') ORDER BY created_at DESC`
      ).bind(user.userId).all();

      const total = allBookmarks.length;
      if (total === 0) {
        return json({ message: 'No bookmarks pending AI processing', total: 0, processed: 0 });
      }

      // Process in chunks
      let processed = 0;
      const bookmarkIds = allBookmarks.map(b => b.id);

      for (let i = 0; i < bookmarkIds.length; i += chunkSize) {
        const chunk = bookmarkIds.slice(i, i + chunkSize);
        // Process all bookmarks in this chunk concurrently
        const promises = chunk.map(id =>
          processBookmarkAI(env, id, user.userId).catch(err => {
            console.error(`AI sync error for bookmark ${id}:`, err.message);
          })
        );
        await Promise.all(promises);
        processed += chunk.length;
      }

      return json({
        message: `AI sync complete. Processed ${processed} of ${total} bookmarks.`,
        total,
        processed,
      });
    } catch (err) {
      return error(err.message, 'AI_SYNC_FAILED', 500);
    }
  }

  // ─── Export Routes ─────────────────────────────────────
  // GET /api/export/json
  if (path === '/api/export/json' && method === 'GET') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    const { results } = await env.DB.prepare(
      'SELECT id, url, title, summary, tags, notes, favorite, ai_status, created_at, updated_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.userId).all();

    return new Response(JSON.stringify({ bookmarks: results }, null, 2), {
      headers: {
        ...CORS_HEADERS,
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="bookmarks-export.json"',
      },
    });
  }

  // GET /api/export/csv
  if (path === '/api/export/csv' && method === 'GET') {
    if (!user) return error('Unauthorized', 'UNAUTHORIZED', 401);
    const { results } = await env.DB.prepare(
      'SELECT id, url, title, summary, tags, notes, favorite, ai_status, created_at, updated_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.userId).all();

    const headers = ['id', 'url', 'title', 'summary', 'tags', 'notes', 'favorite', 'ai_status', 'created_at', 'updated_at'];
    const escapeCsv = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    const csvLines = [headers.join(',')];
    for (const row of results) {
      csvLines.push(headers.map(h => escapeCsv(row[h])).join(','));
    }

    return new Response(csvLines.join('\n'), {
      headers: {
        ...CORS_HEADERS,
        ...SECURITY_HEADERS,
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="bookmarks-export.csv"',
      },
    });
  }

  // ─── 404 ────────────────────────────────────────────────
  return error('Not found', 'NOT_FOUND', 404);
}

// ─── Worker Entry ──────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    // Provide waitUntil via ctx
    env.waitUntil = ctx.waitUntil.bind(ctx);
    
    // Run AI retry check in background on every request
    ctx.waitUntil(retryFailedBookmarks(env));
    
    const response = await handleRequest(request, env).catch(err => {
      console.error('Unhandled error:', err);
      return error('Internal server error', 'INTERNAL_ERROR', 500);
    });

    // Attach security headers to all responses
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (!newHeaders.has(key)) {
        newHeaders.set(key, value);
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
