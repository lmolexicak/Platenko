// Cloudflare Worker Entry Router for Plátenko Gallery
import {
  PUBLIC_MEDIA_CORS_HEADERS,
  jsonResponse,
  bytesToHex,
  timingSafeEqualHex,
  pbkdf2HashHex,
  parseCookies,
  buildSessionCookie,
  getAuthSession,
} from './src/utils.js';
import { serveIndexWithDynamicOG, handleSiteRequest } from './src/site.js';
import { handleLookupsRequest } from './src/lookups.js';
import { handleAutomationRequest, refreshExpiringIntegrations } from './src/automation.js';
import { handleArtworksRequest } from './src/artworks.js';
import { handleMigrateRequest } from './src/migrate.js';

const etagMatches = (ifNoneMatch, etag) => {
  if (!ifNoneMatch || !etag) return false;
  const trimmed = ifNoneMatch.trim();
  if (trimmed === '*') return true;
  const normalize = (val) => val.trim().replace(/^W\//i, '').replace(/^"|"$/g, '');
  const target = normalize(etag);
  return trimmed.split(',').some((part) => normalize(part) === target);
};

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshExpiringIntegrations(env, { force: false }));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const isHttps = url.protocol === 'https:';

    if (request.method === 'OPTIONS') {
      if (pathname.startsWith('/images/paintings/') || pathname.startsWith('/paintings/')) {
        return new Response(null, { status: 204, headers: PUBLIC_MEDIA_CORS_HEADERS });
      }
      const reqOrigin = request.headers.get('Origin');
      if (reqOrigin && reqOrigin === url.origin) {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': url.origin,
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Vary': 'Origin',
          },
        });
      }
      return new Response(null, { status: 204 });
    }

    // 1. Dynamic Open Graph & Site Settings injection for landing HTML
    if ((request.method === 'GET' || request.method === 'HEAD') && (pathname === '/' || pathname === '/index.html') && env.ASSETS) {
      return serveIndexWithDynamicOG(request, env, url);
    }

    // 1b. Protected Admin Changelog (/whatsnew.md requires authenticated admin session)
    if (pathname.toLowerCase() === '/whatsnew.md') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
      }
      const session = await getAuthSession(env, request);
      if (!session.authenticated) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      if (env.ASSETS) {
        const assetResp = await env.ASSETS.fetch(request);
        const headers = new Headers(assetResp.headers);
        headers.set('Cache-Control', 'private, no-store');
        if (assetResp.ok) {
          headers.set('Content-Type', 'text/markdown; charset=utf-8');
        }
        return new Response(request.method === 'HEAD' ? null : assetResp.body, {
          status: assetResp.status,
          headers,
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    }

    // 2. Direct R2 media proxy with ?size=thumb + Cache API + ETag/304
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      (pathname.startsWith('/images/paintings/') || pathname.startsWith('/paintings/'))
    ) {
      const cache = typeof caches !== 'undefined' ? caches.default : null;
      const cacheKey = new Request(url.toString(), { method: 'GET' });
      const ifNoneMatch = request.headers.get('If-None-Match');

      const cachedResp = cache ? await cache.match(cacheKey) : null;
      if (cachedResp) {
        if (etagMatches(ifNoneMatch, cachedResp.headers.get('etag'))) {
          return new Response(null, { status: 304, headers: cachedResp.headers });
        }
        if (request.method === 'HEAD') {
          return new Response(null, { status: cachedResp.status, headers: cachedResp.headers });
        }
        return cachedResp;
      }

      const rawKey = pathname.startsWith('/images/')
        ? pathname.substring('/images/'.length)
        : pathname.substring(1);

      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        key = rawKey;
      }

      const wantThumb = url.searchParams.get('size') === 'thumb';
      const fetchR2 = (r2Key) =>
        request.method === 'HEAD' ? env.IMAGES.head(r2Key) : env.IMAGES.get(r2Key);

      let object = null;
      let imageSourceHeader = 'original';

      if (wantThumb) {
        object = await fetchR2(`thumbs/${key}`);
        if (object) {
          imageSourceHeader = 'thumb';
        } else {
          object = await fetchR2(key);
          if (object) imageSourceHeader = 'original-fallback';
        }
      } else {
        object = await fetchR2(key);
      }

      if (!object) {
        return new Response('Image not found in R2', { status: 404, headers: PUBLIC_MEDIA_CORS_HEADERS });
      }

      const headers = new Headers(PUBLIC_MEDIA_CORS_HEADERS);
      object.writeHttpMetadata(headers);
      if (!headers.has('Content-Type')) {
        const lower = key.toLowerCase();
        if (lower.endsWith('.png')) headers.set('Content-Type', 'image/png');
        else if (lower.endsWith('.webp')) headers.set('Content-Type', 'image/webp');
        else headers.set('Content-Type', 'image/jpeg');
      }
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('X-Platenko-Image', imageSourceHeader);

      if (etagMatches(ifNoneMatch, object.httpEtag)) {
        if (object.body && typeof object.body.cancel === 'function') {
          object.body.cancel();
        }
        return new Response(null, { status: 304, headers });
      }

      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }

      const resp = new Response(object.body, { status: 200, headers });
      if (cache && ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      }
      return resp;
    }

    // 3. Auth Endpoints (/api/auth/*)
    if (pathname === '/api/auth/me' && request.method === 'GET') {
      try {
        const session = await getAuthSession(env, request);
        return jsonResponse({
          authenticated: session.authenticated,
          username: session.username || null,
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    if (pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = await request.json();
        const username = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';

        if (!username || !password) {
          return jsonResponse({ error: 'Zadaj používateľské meno a heslo.' }, 400);
        }

        const authRow = await env.DB.prepare(
          `SELECT username, password_salt, password_hash FROM admin_auth WHERE id = 1`
        ).first();

        if (!authRow || username.toLowerCase() !== authRow.username.toLowerCase()) {
          return jsonResponse({ error: 'Nesprávne meno alebo heslo.' }, 401);
        }

        const computedHash = await pbkdf2HashHex(password, authRow.password_salt);
        if (!timingSafeEqualHex(computedHash, authRow.password_hash)) {
          return jsonResponse({ error: 'Nesprávne meno alebo heslo.' }, 401);
        }

        const randBytes = new Uint8Array(32);
        crypto.getRandomValues(randBytes);
        const token = bytesToHex(randBytes);
        const maxAgeSeconds = 7 * 86400;
        const expiresAt = Date.now() + maxAgeSeconds * 1000;

        await env.DB.batch([
          env.DB.prepare(`DELETE FROM admin_sessions WHERE expires_at <= ?`).bind(Date.now()),
          env.DB.prepare(`INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)`).bind(token, expiresAt),
        ]);

        return jsonResponse(
          { authenticated: true, username: authRow.username },
          200,
          { 'Set-Cookie': buildSessionCookie(token, isHttps, maxAgeSeconds) }
        );
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      try {
        const cookies = parseCookies(request);
        if (cookies.platenko_session) {
          await env.DB.prepare(`DELETE FROM admin_sessions WHERE token = ?`)
            .bind(cookies.platenko_session)
            .run();
        }
        return jsonResponse(
          { success: true },
          200,
          { 'Set-Cookie': buildSessionCookie('', isHttps, 0) }
        );
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    if (pathname === '/api/auth/change-password' && request.method === 'POST') {
      try {
        const session = await getAuthSession(env, request);
        if (!session.authenticated) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const body = await request.json();
        const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

        if (!currentPassword || newPassword.length < 6) {
          return jsonResponse({ error: 'Nové heslo musí mať aspoň 6 znakov.' }, 400);
        }

        const authRow = await env.DB.prepare(
          `SELECT password_salt, password_hash FROM admin_auth WHERE id = 1`
        ).first();

        if (!authRow) {
          return jsonResponse({ error: 'Auth configuration missing.' }, 500);
        }

        const currentComputed = await pbkdf2HashHex(currentPassword, authRow.password_salt);
        if (!timingSafeEqualHex(currentComputed, authRow.password_hash)) {
          return jsonResponse({ error: 'Aktuálne heslo nie je správne.' }, 401);
        }

        const newSaltBytes = new Uint8Array(16);
        crypto.getRandomValues(newSaltBytes);
        const newSaltHex = bytesToHex(newSaltBytes);
        const newHashHex = await pbkdf2HashHex(newPassword, newSaltHex);

        await env.DB.batch([
          env.DB.prepare(
            `UPDATE admin_auth SET password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
          ).bind(newSaltHex, newHashHex),
          env.DB.prepare(`DELETE FROM admin_sessions WHERE token != ?`).bind(session.token),
        ]);

        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    if (pathname === '/api/auth/verify-password' && request.method === 'POST') {
      try {
        const session = await getAuthSession(env, request);
        if (!session.authenticated) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const body = await request.json().catch(() => ({}));
        const password = typeof body.password === 'string' ? body.password : '';
        if (!password) {
          return jsonResponse({ error: 'Zadaj heslo správcu.' }, 400);
        }

        const authRow = await env.DB.prepare(
          `SELECT password_salt, password_hash FROM admin_auth WHERE id = 1`
        ).first();
        if (!authRow) {
          return jsonResponse({ error: 'Auth configuration missing.' }, 500);
        }

        const computedHash = await pbkdf2HashHex(password, authRow.password_salt);
        if (!timingSafeEqualHex(computedHash, authRow.password_hash)) {
          return jsonResponse({ error: 'Nesprávne heslo správcu.' }, 401);
        }

        return jsonResponse({ verified: true });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 4. Delegated Feature API Routers
    if (pathname.startsWith('/api/site-settings') || pathname.startsWith('/api/inquir')) {
      const siteRes = await handleSiteRequest(request, env, url, pathname);
      if (siteRes) return siteRes;
    }

    if (pathname.startsWith('/api/lookups')) {
      const lookupRes = await handleLookupsRequest(request, env, pathname);
      if (lookupRes) return lookupRes;
    }

    if (pathname.startsWith('/api/automation/')) {
      const autoRes = await handleAutomationRequest(request, env, url, pathname);
      if (autoRes) return autoRes;
    }

    if (pathname.startsWith('/api/artworks')) {
      const artRes = await handleArtworksRequest(request, env, pathname);
      if (artRes) return artRes;
    }

    if (pathname === '/api/admin/migrate-ascii') {
      const migRes = await handleMigrateRequest(request, env, url, pathname);
      if (migRes) return migRes;
    }

    // 5. Static Assets fallback
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
