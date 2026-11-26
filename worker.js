// Cloudflare Worker backend for Platenko Gallery

let automationSchemaReady = false;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const isHttps = url.protocol === 'https:';

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    const jsonResponse = (payload, status = 200, extraHeaders = {}) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...extraHeaders,
        },
      });

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ---- Crypto & Auth Helpers ----
    const hexToBytes = (hex) => {
      const clean = (hex || '').trim();
      const bytes = new Uint8Array(clean.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
      }
      return bytes;
    };

    const bytesToHex = (bytes) =>
      Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

    const timingSafeEqualHex = (a, b) => {
      if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
        return false;
      }
      let diff = 0;
      for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
      }
      return diff === 0;
    };

    const pbkdf2HashHex = async (password, saltHex) => {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: hexToBytes(saltHex),
          iterations: 100000,
          hash: 'SHA-256',
        },
        key,
        256
      );
      return bytesToHex(new Uint8Array(bits));
    };

    const parseCookies = (req) => {
      const map = {};
      const header = req.headers.get('Cookie') || '';
      header.split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        const name = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (name) map[name] = val;
      });
      return map;
    };

    const buildSessionCookie = (token, httpsFlag, maxAgeSeconds) => {
      let cookie = `platenko_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
      if (httpsFlag) cookie += '; Secure';
      return cookie;
    };

    const getAuthSession = async (req) => {
      const cookies = parseCookies(req);
      const token = cookies.platenko_session;
      if (!token) return { authenticated: false };

      const sessionRow = await env.DB.prepare(
        `SELECT token, expires_at FROM admin_sessions WHERE token = ? AND expires_at > ?`
      )
        .bind(token, Date.now())
        .first();

      if (!sessionRow) return { authenticated: false };

      const authRow = await env.DB.prepare(
        `SELECT username FROM admin_auth WHERE id = 1`
      ).first();

      return {
        authenticated: true,
        username: authRow ? authRow.username : 'mario',
        token,
      };
    };

    const isAuthorizedForAutomation = async (req) => {
      const authHeader = req.headers.get('Authorization') || '';
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      const expectedKey = typeof env.AUTOMATION_API_KEY === 'string' ? env.AUTOMATION_API_KEY.trim() : '';
      if (match && expectedKey) {
        const provided = match[1].trim();
        if (timingSafeEqualHex(provided, expectedKey)) {
          return { authorized: true, via: 'api_key' };
        }
        return { authorized: false };
      }
      const session = await getAuthSession(req);
      if (session.authenticated) {
        return { authorized: true, via: 'session' };
      }
      return { authorized: false };
    };

    // ---- R2 Image & Cleanup Helpers ----
    const parseDimPair = (dimensionsStr) => {
      if (typeof dimensionsStr !== 'string') return { widthCm: 50, heightCm: 70 };
      const nums = dimensionsStr.match(/\d+(?:[.,]\d+)?/g);
      if (!nums || nums.length < 2) return { widthCm: 50, heightCm: 70 };
      const w = parseFloat(nums[0].replace(',', '.'));
      const h = parseFloat(nums[1].replace(',', '.'));
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        return { widthCm: 50, heightCm: 70 };
      }
      return { widthCm: w, heightCm: h };
    };

    const urlToR2Key = (imageUrl) => {
      if (typeof imageUrl !== 'string' || !imageUrl) return null;
      let clean = imageUrl.split('?')[0].split('#')[0];
      if (clean.startsWith('/')) clean = clean.substring(1);
      if (clean.startsWith('images/')) clean = clean.substring('images/'.length);
      try {
        clean = decodeURIComponent(clean);
      } catch {
        // keep as-is
      }
      return clean.startsWith('paintings/') ? clean : null;
    };

    const decodeDataImage = (dataUrl) => {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return null;
      }
      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) return null;
      const contentType = match[1];
      const binaryStr = atob(match[2]);
      const bytes = new Uint8Array(binaryStr.length);
      for (let b = 0; b < binaryStr.length; b++) {
        bytes[b] = binaryStr.charCodeAt(b);
      }
      const ext = contentType === 'image/png'
        ? 'png'
        : (contentType === 'image/webp' ? 'webp' : 'jpg');
      return { contentType, bytes, ext };
    };

    const uploadDataImageWithThumb = async (dataUrl, thumbDataUrl, folder, prefix = 'cover') => {
      const decoded = decodeDataImage(dataUrl);
      if (!decoded) return null;
      const rand = Math.random().toString(36).slice(2, 6);
      const r2Key = `paintings/${folder}/${prefix}_${Date.now()}_${rand}.${decoded.ext}`;
      await env.IMAGES.put(r2Key, decoded.bytes, {
        httpMetadata: { contentType: decoded.contentType },
      });

      const decodedThumb = decodeDataImage(thumbDataUrl);
      if (decodedThumb) {
        await env.IMAGES.put(`thumbs/${r2Key}`, decodedThumb.bytes, {
          httpMetadata: { contentType: decodedThumb.contentType },
        });
      }
      return `images/${r2Key}`;
    };

    const deleteUnusedR2Images = async (candidateUrls) => {
      const uniqueUrls = Array.from(new Set((candidateUrls || []).filter(Boolean)));
      const keysToDelete = [];

      for (const imgUrl of uniqueUrls) {
        const stillInImages = await env.DB.prepare(
          `SELECT 1 FROM artwork_images WHERE image_url = ? LIMIT 1`
        )
          .bind(imgUrl)
          .first();
        if (stillInImages) continue;

        const stillAsCover = await env.DB.prepare(
          `SELECT 1 FROM artworks WHERE cover_image = ? LIMIT 1`
        )
          .bind(imgUrl)
          .first();
        if (stillAsCover) continue;

        const stillAsRaw = await env.DB.prepare(
          `SELECT 1 FROM artworks WHERE raw_image = ? LIMIT 1`
        )
          .bind(imgUrl)
          .first();
        if (stillAsRaw) continue;

        const stillAsSocial = await env.DB.prepare(
          `SELECT 1 FROM artworks WHERE social_image_url = ? LIMIT 1`
        )
          .bind(imgUrl)
          .first();
        if (stillAsSocial) continue;

        const r2Key = urlToR2Key(imgUrl);
        if (r2Key) {
          keysToDelete.push(r2Key, `thumbs/${r2Key}`);
        }
      }

      if (keysToDelete.length > 0) {
        await env.IMAGES.delete(keysToDelete);
      }
      return keysToDelete;
    };

    // ---- 1. Images served directly from Cloudflare R2 bucket ----
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      (pathname.startsWith('/images/paintings/') || pathname.startsWith('/paintings/'))
    ) {
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
        return new Response('Image not found in R2', { status: 404, headers: corsHeaders });
      }

      const headers = new Headers(corsHeaders);
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

      return new Response(request.method === 'HEAD' ? null : object.body, { headers });
    }

    // ---- 2. Auth Endpoints ----
    if (pathname === '/api/auth/me' && request.method === 'GET') {
      try {
        const session = await getAuthSession(request);
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
        const session = await getAuthSession(request);
        if (!session.authenticated) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const body = await request.json();
        const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

        if (!currentPassword || newPassword.length < 6) {
          return jsonResponse(
            { error: 'Nové heslo musí mať aspoň 6 znakov.' },
            400
          );
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

    // ---- Lookups (Číselníky) D1 Bootstrap & CRUD ----
    const DEFAULT_LOOKUPS = [
      { category: 'technique', code: 'Pouring', label: 'Pouring', color: '', meta: '', show_in_filter: 1, sort_order: 1 },
      { category: 'technique', code: 'Airbrush', label: 'Airbrush', color: '', meta: '', show_in_filter: 1, sort_order: 2 },
      { category: 'technique', code: 'Mixed', label: 'Mixed', color: '', meta: '', show_in_filter: 1, sort_order: 3 },
      { category: 'technique', code: 'Brush', label: 'Brush', color: '', meta: '', show_in_filter: 1, sort_order: 4 },

      { category: 'status', code: 'Available', label: 'Dostupné', color: 'green', meta: '', show_in_filter: 1, sort_order: 1 },
      { category: 'status', code: 'Reserved', label: 'Rezervované', color: 'yellow', meta: '', show_in_filter: 1, sort_order: 2 },
      { category: 'status', code: 'Sold', label: 'Predané', color: 'gray', meta: '', show_in_filter: 1, sort_order: 3 },

      { category: 'medium', code: 'Akryl na plátne', label: 'Akryl na plátne', color: '', meta: '', show_in_filter: 1, sort_order: 1 },
      { category: 'medium', code: 'Akryl a zlatá fólia na plátne', label: 'Akryl a zlatá fólia na plátne', color: '', meta: '', show_in_filter: 1, sort_order: 2 },

      { category: 'dimension_preset', code: '30x40', label: '30×40', color: '', meta: '{"w":30,"h":40}', show_in_filter: 1, sort_order: 1 },
      { category: 'dimension_preset', code: '50x50', label: '50×50', color: '', meta: '{"w":50,"h":50}', show_in_filter: 1, sort_order: 2 },
      { category: 'dimension_preset', code: '50x70', label: '50×70', color: '', meta: '{"w":50,"h":70}', show_in_filter: 1, sort_order: 3 },
      { category: 'dimension_preset', code: '70x50', label: '70×50', color: '', meta: '{"w":70,"h":50}', show_in_filter: 1, sort_order: 4 },
      { category: 'dimension_preset', code: '60x80', label: '60×80', color: '', meta: '{"w":60,"h":80}', show_in_filter: 1, sort_order: 5 },
      { category: 'dimension_preset', code: '80x100', label: '80×100', color: '', meta: '{"w":80,"h":100}', show_in_filter: 1, sort_order: 6 },
      { category: 'dimension_preset', code: '100x120', label: '100×120', color: '', meta: '{"w":100,"h":120}', show_in_filter: 1, sort_order: 7 },
    ];

    const ensureLookupsReady = async () => {
      await env.DB.batch([
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS lookups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            code TEXT NOT NULL,
            label TEXT NOT NULL,
            color TEXT DEFAULT '',
            meta TEXT DEFAULT '',
            show_in_filter INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0
          )
        `),
        env.DB.prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_lookups_cat_code ON lookups(category, code)`
        ),
      ]);

      const cntRow = await env.DB.prepare(`SELECT COUNT(*) AS cnt FROM lookups`).first();
      if (!cntRow || Number(cntRow.cnt) === 0) {
        const stmts = DEFAULT_LOOKUPS.map((item) =>
          env.DB.prepare(
            `INSERT OR IGNORE INTO lookups (category, code, label, color, meta, show_in_filter, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(item.category, item.code, item.label, item.color, item.meta, item.show_in_filter, item.sort_order)
        );
        await env.DB.batch(stmts);
      }
    };

    const serializeLookupRow = (r) => {
      let parsedMeta = {};
      if (r.meta) {
        try { parsedMeta = JSON.parse(r.meta); } catch {}
      }
      return {
        id: r.id,
        category: r.category,
        code: r.code,
        label: r.label,
        color: r.color || '',
        meta: parsedMeta,
        showInFilter: r.show_in_filter !== 0,
        sortOrder: Number(r.sort_order) || 0,
      };
    };

    const slugLookupCode = (str) =>
      (str || 'item')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'item';

    // GET /api/lookups - Public grouped lookups
    if (pathname === '/api/lookups' && request.method === 'GET') {
      try {
        await ensureLookupsReady();
        const { results } = await env.DB.prepare(
          `SELECT * FROM lookups ORDER BY sort_order ASC, id ASC`
        ).all();
        const all = (results || []).map(serializeLookupRow);
        return jsonResponse({
          techniques: all.filter((x) => x.category === 'technique'),
          statuses: all.filter((x) => x.category === 'status'),
          mediums: all.filter((x) => x.category === 'medium'),
          dimensionPresets: all.filter((x) => x.category === 'dimension_preset'),
          all,
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // POST /api/lookups/reorder (Authenticated)
    if (pathname === '/api/lookups/reorder' && request.method === 'POST') {
      try {
        const session = await getAuthSession(request);
        if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureLookupsReady();
        const body = await request.json();
        const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds : [];
        if (orderedIds.length === 0) {
          return jsonResponse({ error: 'orderedIds array required' }, 400);
        }
        const stmts = orderedIds.map((lid, idx) =>
          env.DB.prepare(`UPDATE lookups SET sort_order = ? WHERE id = ?`).bind(idx + 1, Number(lid))
        );
        await env.DB.batch(stmts);
        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // POST /api/lookups - Add new lookup entry (Authenticated)
    if (pathname === '/api/lookups' && request.method === 'POST') {
      try {
        const session = await getAuthSession(request);
        if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureLookupsReady();
        const body = await request.json();
        const category = body.category;
        const allowed = ['technique', 'status', 'medium', 'dimension_preset'];
        if (!allowed.includes(category)) {
          return jsonResponse({ error: 'Neplatná kategória číselníka.' }, 400);
        }

        let code = '';
        let label = (body.label || '').trim();
        let color = (body.color || '').trim();
        let metaStr = '';
        const showInFilter = body.showInFilter === false ? 0 : 1;

        if (category === 'dimension_preset') {
          const w = Math.max(5, Number(body.w || (body.meta && body.meta.w)) || 0);
          const h = Math.max(5, Number(body.h || (body.meta && body.meta.h)) || 0);
          if (!(w > 0 && h > 0)) {
            return jsonResponse({ error: 'Zadaj platnú šírku a výšku (cm).' }, 400);
          }
          code = `${w}x${h}`;
          label = `${w}×${h}`;
          metaStr = JSON.stringify({ w, h });
        } else {
          if (!label) return jsonResponse({ error: 'Názov položky nemôže byť prázdny.' }, 400);
          code = category === 'status' ? (body.code || slugLookupCode(label)) : label;
          if (category === 'status' && !color) color = 'blue';
        }

        const maxRow = await env.DB.prepare(
          `SELECT COALESCE(MAX(sort_order), 0) AS maxOrd FROM lookups WHERE category = ?`
        )
          .bind(category)
          .first();
        const nextOrder = (maxRow ? Number(maxRow.maxOrd) : 0) + 1;

        const res = await env.DB.prepare(
          `INSERT INTO lookups (category, code, label, color, meta, show_in_filter, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(category, code, label, color, metaStr, showInFilter, nextOrder)
          .run();

        const insertedId = res && res.meta ? res.meta.last_row_id : null;
        return jsonResponse({
          success: true,
          item: {
            id: insertedId,
            category,
            code,
            label,
            color,
            meta: metaStr ? JSON.parse(metaStr) : {},
            showInFilter: showInFilter !== 0,
            sortOrder: nextOrder,
          },
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // PUT /api/lookups/:id (Authenticated)
    if (pathname.startsWith('/api/lookups/') && request.method === 'PUT') {
      try {
        const session = await getAuthSession(request);
        if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureLookupsReady();
        const id = Number(decodeURIComponent(pathname.substring('/api/lookups/'.length)));
        const existing = await env.DB.prepare(`SELECT * FROM lookups WHERE id = ?`).bind(id).first();
        if (!existing) return jsonResponse({ error: 'Položka neexistuje.' }, 404);

        const body = await request.json();
        let nextLabel = body.label !== undefined ? String(body.label).trim() : existing.label;
        let nextCode = existing.code;
        let nextColor = body.color !== undefined ? String(body.color).trim() : (existing.color || '');
        let nextMeta = existing.meta || '';
        const nextShow = body.showInFilter !== undefined ? (body.showInFilter ? 1 : 0) : existing.show_in_filter;

        if (existing.category === 'dimension_preset') {
          let prevMeta = {};
          try { prevMeta = existing.meta ? JSON.parse(existing.meta) : {}; } catch {}
          const w = Math.max(5, Number(body.w || (body.meta && body.meta.w) || prevMeta.w) || 50);
          const h = Math.max(5, Number(body.h || (body.meta && body.meta.h) || prevMeta.h) || 70);
          nextCode = `${w}x${h}`;
          nextLabel = `${w}×${h}`;
          nextMeta = JSON.stringify({ w, h });
        } else if (existing.category === 'technique' || existing.category === 'medium') {
          if (!nextLabel) return jsonResponse({ error: 'Názov položky nemôže byť prázdny.' }, 400);
          nextCode = nextLabel;
        } else if (!nextLabel) {
          return jsonResponse({ error: 'Názov položky nemôže byť prázdny.' }, 400);
        }

        const stmts = [
          env.DB.prepare(
            `UPDATE lookups SET code = ?, label = ?, color = ?, meta = ?, show_in_filter = ? WHERE id = ?`
          ).bind(nextCode, nextLabel, nextColor, nextMeta, nextShow, id),
        ];

        // Keep existing artworks consistent when renaming a technique or medium
        if (body.syncArtworks !== false && nextLabel !== existing.label) {
          if (existing.category === 'technique') {
            stmts.push(
              env.DB.prepare(`UPDATE artworks SET technique = ? WHERE technique = ?`).bind(nextLabel, existing.code)
            );
          } else if (existing.category === 'medium') {
            stmts.push(
              env.DB.prepare(`UPDATE artworks SET medium = ? WHERE medium = ?`).bind(nextLabel, existing.code)
            );
          }
        }

        await env.DB.batch(stmts);
        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // DELETE /api/lookups/:id (Authenticated)
    if (pathname.startsWith('/api/lookups/') && request.method === 'DELETE') {
      try {
        const session = await getAuthSession(request);
        if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureLookupsReady();
        const id = Number(decodeURIComponent(pathname.substring('/api/lookups/'.length)));
        await env.DB.prepare(`DELETE FROM lookups WHERE id = ?`).bind(id).run();
        return jsonResponse({ success: true });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // ---- 3. Automation Schema & Channel Controls ----
    const DEFAULT_AUTOMATION_CHANNELS = [
      { channel_key: 'instagram', label: 'Instagram', kind: 'social', image_variant: 'stylized', adapter: 'meta_ig', implemented: 1, enabled: 0, auto_publish: 1, config_json: '{}', sort_order: 1 },
      { channel_key: 'facebook', label: 'Facebook', kind: 'social', image_variant: 'stylized', adapter: 'meta_fb', implemented: 1, enabled: 0, auto_publish: 1, config_json: '{}', sort_order: 2 },
      { channel_key: 'aukro', label: 'Aukro', kind: 'marketplace', image_variant: 'clean', adapter: 'aukro', implemented: 1, enabled: 0, auto_publish: 0, config_json: '{}', sort_order: 3 },
      { channel_key: 'sashe', label: 'Sashe.sk', kind: 'marketplace', image_variant: 'clean', adapter: 'sashe', implemented: 1, enabled: 0, auto_publish: 0, config_json: '{}', sort_order: 4 },
      { channel_key: 'pinterest', label: 'Pinterest', kind: 'social', image_variant: 'stylized', adapter: 'pinterest', implemented: 0, enabled: 0, auto_publish: 1, config_json: '{}', sort_order: 5 },
      { channel_key: 'tiktok', label: 'TikTok', kind: 'social', image_variant: 'stylized', adapter: 'tiktok', implemented: 0, enabled: 0, auto_publish: 1, config_json: '{}', sort_order: 6 },
      { channel_key: 'threads', label: 'Threads', kind: 'social', image_variant: 'stylized', adapter: 'threads', implemented: 0, enabled: 0, auto_publish: 1, config_json: '{}', sort_order: 7 },
      { channel_key: 'x', label: 'X (Twitter)', kind: 'social', image_variant: 'stylized', adapter: 'x', implemented: 0, enabled: 0, auto_publish: 1, config_json: '{}', sort_order: 8 },
      { channel_key: 'etsy', label: 'Etsy', kind: 'marketplace', image_variant: 'clean', adapter: 'etsy', implemented: 0, enabled: 0, auto_publish: 0, config_json: '{}', sort_order: 9 },
    ];

    const parseJsonSafe = (str, fallback) => {
      if (!str || typeof str !== 'string') return fallback;
      try {
        const parsed = JSON.parse(str);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
      } catch {
        return fallback;
      }
    };

    const toAbsoluteUrl = (origin, relOrAbs) => {
      if (!relOrAbs || typeof relOrAbs !== 'string') return '';
      if (/^https?:\/\//i.test(relOrAbs)) return relOrAbs;
      return `${origin}/${relOrAbs.replace(/^\/+/, '')}`;
    };

    const ensureAutomationSchema = async () => {
      if (automationSchemaReady) return;
      const { results: cols } = await env.DB.prepare(`PRAGMA table_info(artworks)`).all();
      const existingCols = new Set((cols || []).map((c) => c.name));
      const alterQueries = [];
      if (!existingCols.has('price_eur')) alterQueries.push(`ALTER TABLE artworks ADD COLUMN price_eur REAL`);
      if (!existingCols.has('social_image_url')) alterQueries.push(`ALTER TABLE artworks ADD COLUMN social_image_url TEXT DEFAULT ''`);
      if (!existingCols.has('publish_status_json')) alterQueries.push(`ALTER TABLE artworks ADD COLUMN publish_status_json TEXT DEFAULT '{}'`);
      if (!existingCols.has('publish_channels_json')) alterQueries.push(`ALTER TABLE artworks ADD COLUMN publish_channels_json TEXT DEFAULT '{}'`);

      for (const q of alterQueries) {
        try {
          await env.DB.prepare(q).run();
        } catch (err) {
          if (!/duplicate column/i.test(String(err && err.message))) throw err;
        }
      }

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS automation_channels (
          channel_key TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          kind TEXT NOT NULL,
          image_variant TEXT NOT NULL DEFAULT 'stylized',
          adapter TEXT NOT NULL,
          implemented INTEGER DEFAULT 0,
          enabled INTEGER DEFAULT 0,
          auto_publish INTEGER DEFAULT 0,
          config_json TEXT DEFAULT '{}',
          sort_order INTEGER DEFAULT 0,
          updated_at TEXT DEFAULT ''
        )
      `).run();

      const seedStmts = DEFAULT_AUTOMATION_CHANNELS.map((ch) =>
        env.DB.prepare(`
          INSERT OR IGNORE INTO automation_channels
            (channel_key, label, kind, image_variant, adapter, implemented, enabled, auto_publish, config_json, sort_order, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          ch.channel_key,
          ch.label,
          ch.kind,
          ch.image_variant,
          ch.adapter,
          ch.implemented,
          ch.enabled,
          ch.auto_publish,
          ch.config_json,
          ch.sort_order,
          ''
        )
      );
      if (seedStmts.length > 0) {
        await env.DB.batch(seedStmts);
      }
      automationSchemaReady = true;
    };

    const serializeChannelRow = (r) => ({
      key: r.channel_key,
      label: r.label,
      kind: r.kind,
      imageVariant: r.image_variant || 'stylized',
      adapter: r.adapter,
      implemented: r.implemented === 1,
      enabled: r.enabled === 1,
      autoPublish: r.auto_publish === 1,
      config: parseJsonSafe(r.config_json, {}),
      sortOrder: Number(r.sort_order) || 0,
      updatedAt: r.updated_at || '',
    });

    const serializeArtworkRow = (art, imgMap) => {
      const detailImgs = imgMap[art.id] || (art.cover_image ? [art.cover_image] : []);
      const parsedDims = parseDimPair(art.dimensions);
      const widthCm = Number(art.width_cm) > 0 ? Number(art.width_cm) : parsedDims.widthCm;
      const heightCm = Number(art.height_cm) > 0 ? Number(art.height_cm) : parsedDims.heightCm;
      const depthCm = Number(art.depth_cm) > 0 ? Number(art.depth_cm) : 4;
      const rawPrice = art.price_eur !== null && art.price_eur !== undefined && art.price_eur !== ''
        ? Number(art.price_eur)
        : null;
      return {
        id: art.id,
        folder: art.folder_name,
        title: art.title,
        date: art.date_created,
        year: art.year,
        technique: art.technique,
        medium: art.medium,
        dimensions: art.dimensions || `${widthCm} × ${heightCm} cm`,
        widthCm,
        heightCm,
        depthCm,
        priceEur: Number.isFinite(rawPrice) ? rawPrice : null,
        instagramUrl: art.instagram_url || '',
        rawImage: art.raw_image || '',
        socialImageUrl: art.social_image_url || '',
        publishStatus: parseJsonSafe(art.publish_status_json, {}),
        publishChannels: parseJsonSafe(art.publish_channels_json, {}),
        sortOrder: Number(art.sort_order) || 0,
        status: art.status,
        photoCount: art.photo_count || detailImgs.length,
        coverImage: art.cover_image || (detailImgs.length > 0 ? detailImgs[0] : ''),
        detailImages: detailImgs,
        description: art.description || '',
      };
    };

    const getPendingChannelsForArtwork = (artObj, channels, targetChannelKey = '') => {
      const candidates = targetChannelKey
        ? channels.filter((c) => c.key === targetChannelKey)
        : channels.filter((c) => c.enabled);
      return candidates
        .filter((ch) => {
          if (artObj.publishChannels && artObj.publishChannels[ch.key] === false) return false;
          const st = artObj.publishStatus && artObj.publishStatus[ch.key] && artObj.publishStatus[ch.key].status;
          return st !== 'published' && st !== 'drafted';
        })
        .map((ch) => ch.key);
    };

    // GET /api/automation/channels (Authenticated: Bearer key or Admin session)
    if (pathname === '/api/automation/channels' && request.method === 'GET') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema();

        const [{ results: chRows }, { results: artRows }] = await Promise.all([
          env.DB.prepare(`SELECT * FROM automation_channels ORDER BY sort_order ASC, channel_key ASC`).all(),
          env.DB.prepare(`SELECT id, status, social_image_url, publish_status_json, publish_channels_json FROM artworks`).all(),
        ]);

        const channels = (chRows || []).map(serializeChannelRow);
        const enabledCount = channels.filter((c) => c.enabled).length;
        let pendingArtworksCount = 0;

        for (const row of artRows || []) {
          const fakeArt = {
            id: row.id,
            publishStatus: parseJsonSafe(row.publish_status_json, {}),
            publishChannels: parseJsonSafe(row.publish_channels_json, {}),
          };
          const pendingKeys = getPendingChannelsForArtwork(fakeArt, channels);
          if (pendingKeys.length > 0) pendingArtworksCount++;
        }

        return jsonResponse({
          channels,
          summary: {
            enabledCount,
            totalChannels: channels.length,
            pendingArtworksCount,
          },
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // PUT /api/automation/channels/:key (Authenticated: Bearer key or Admin session)
    if (pathname.startsWith('/api/automation/channels/') && request.method === 'PUT') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema();

        const key = decodeURIComponent(pathname.substring('/api/automation/channels/'.length)).trim();
        const existing = await env.DB.prepare(`SELECT * FROM automation_channels WHERE channel_key = ?`).bind(key).first();
        if (!existing) {
          return jsonResponse({ error: 'Neznámy kanál automatizácie.' }, 404);
        }

        const body = await request.json();
        const nextEnabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled;
        const nextAutoPublish = body.autoPublish !== undefined ? (body.autoPublish ? 1 : 0) : existing.auto_publish;
        const nextConfigJson = body.config !== undefined && typeof body.config === 'object' && body.config !== null
          ? JSON.stringify(body.config)
          : (existing.config_json || '{}');
        const nowIso = new Date().toISOString();

        await env.DB.prepare(`
          UPDATE automation_channels
          SET enabled = ?, auto_publish = ?, config_json = ?, updated_at = ?
          WHERE channel_key = ?
        `)
          .bind(nextEnabled, nextAutoPublish, nextConfigJson, nowIso, key)
          .run();

        const updated = await env.DB.prepare(`SELECT * FROM automation_channels WHERE channel_key = ?`).bind(key).first();
        return jsonResponse({ success: true, channel: serializeChannelRow(updated) });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // GET /api/automation/pending (Authenticated: Bearer key or Admin session)
    if (pathname === '/api/automation/pending' && request.method === 'GET') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema();

        const channelParam = (url.searchParams.get('channel') || '').trim();
        const artworkIdParam = (url.searchParams.get('artworkId') || '').trim();
        const includeAll = url.searchParams.get('includeAll') === '1';

        const [{ results: chRows }, { results: artRows }, { results: imgRows }] = await Promise.all([
          env.DB.prepare(`SELECT * FROM automation_channels ORDER BY sort_order ASC, channel_key ASC`).all(),
          env.DB.prepare(`SELECT * FROM artworks ORDER BY sort_order ASC, date_created DESC, id DESC`).all(),
          env.DB.prepare(`SELECT artwork_id, image_url FROM artwork_images ORDER BY sort_order ASC`).all(),
        ]);

        const channels = (chRows || []).map(serializeChannelRow);
        const imgMap = {};
        for (const img of imgRows || []) {
          if (!imgMap[img.artwork_id]) imgMap[img.artwork_id] = [];
          imgMap[img.artwork_id].push(img.image_url);
        }

        const enabledChannels = channels.filter((c) => c.enabled);
        const needsStylizedAny = enabledChannels.some((c) => c.imageVariant === 'stylized')
          || (channelParam && channels.some((c) => c.key === channelParam && c.imageVariant === 'stylized'));

        const artworksPayload = [];
        for (const row of artRows || []) {
          if (artworkIdParam && row.id !== artworkIdParam) continue;
          const art = serializeArtworkRow(row, imgMap);
          const pendingChannels = getPendingChannelsForArtwork(art, channels, channelParam);
          const missingSocialImage = !art.socialImageUrl;

          const shouldInclude = includeAll
            || (artworkIdParam && (pendingChannels.length > 0 || missingSocialImage))
            || pendingChannels.length > 0
            || (needsStylizedAny && missingSocialImage);

          if (!shouldInclude) continue;

          artworksPayload.push({
            ...art,
            cleanImageUrl: toAbsoluteUrl(url.origin, art.coverImage),
            socialImagePublicUrl: toAbsoluteUrl(url.origin, art.socialImageUrl),
            detailImageUrls: (art.detailImages || []).map((u) => toAbsoluteUrl(url.origin, u)),
            pendingChannels,
          });
        }

        return jsonResponse({
          baseUrl: url.origin,
          channels,
          enabledChannelKeys: enabledChannels.map((c) => c.key),
          artworks: artworksPayload,
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // POST /api/automation/upload-social-image (Authenticated: Bearer key or Admin session)
    if (pathname === '/api/automation/upload-social-image' && request.method === 'POST') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema();

        const body = await request.json();
        const artworkId = (body && body.artworkId ? String(body.artworkId) : '').trim();
        const imageDataUrl = body && body.imageDataUrl;
        const thumbDataUrl = body && body.thumbDataUrl;

        if (!artworkId || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
          return jsonResponse({ error: 'artworkId a platný imageDataUrl sú povinné.' }, 400);
        }

        const existing = await env.DB.prepare(
          `SELECT id, folder_name, social_image_url FROM artworks WHERE id = ?`
        ).bind(artworkId).first();
        if (!existing) {
          return jsonResponse({ error: 'Dielo neexistuje.' }, 404);
        }

        const folder = existing.folder_name || artworkId.replace(/^art-/, '');
        const uploadedUrl = await uploadDataImageWithThumb(imageDataUrl, thumbDataUrl, folder, 'social_4x5');
        if (!uploadedUrl) {
          return jsonResponse({ error: 'Nepodarilo sa spracovať obrázok.' }, 400);
        }

        const prevSocialUrl = existing.social_image_url || '';
        await env.DB.prepare(`UPDATE artworks SET social_image_url = ? WHERE id = ?`)
          .bind(uploadedUrl, artworkId)
          .run();

        if (prevSocialUrl && prevSocialUrl !== uploadedUrl) {
          await deleteUnusedR2Images([prevSocialUrl]);
        }

        return jsonResponse({
          success: true,
          artworkId,
          socialImageUrl: uploadedUrl,
          publicUrl: toAbsoluteUrl(url.origin, uploadedUrl),
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // PATCH /api/automation/status/:id (Authenticated: Bearer key or Admin session)
    if (pathname.startsWith('/api/automation/status/') && request.method === 'PATCH') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema();

        const id = decodeURIComponent(pathname.substring('/api/automation/status/'.length));
        const existing = await env.DB.prepare(
          `SELECT id, publish_status_json, instagram_url FROM artworks WHERE id = ?`
        ).bind(id).first();
        if (!existing) {
          return jsonResponse({ error: 'Dielo neexistuje.' }, 404);
        }

        const body = await request.json();
        const currentStatus = parseJsonSafe(existing.publish_status_json, {});
        const nowIso = new Date().toISOString();
        let nextInstagramUrl = null;

        const applyOne = (chKey, entry) => {
          if (!chKey || !entry || typeof entry !== 'object') return;
          const prev = currentStatus[chKey] && typeof currentStatus[chKey] === 'object' ? currentStatus[chKey] : {};
          const nextObj = {
            status: entry.status || prev.status || 'pending',
            updatedAt: nowIso,
          };
          if (entry.externalId !== undefined) nextObj.externalId = entry.externalId;
          else if (prev.externalId !== undefined && entry.status !== 'pending') nextObj.externalId = prev.externalId;
          if (entry.url !== undefined) nextObj.url = entry.url;
          else if (prev.url !== undefined && entry.status !== 'pending') nextObj.url = prev.url;
          if (entry.error !== undefined) nextObj.error = entry.error;
          if (entry.note !== undefined) nextObj.note = entry.note;
          currentStatus[chKey] = nextObj;

          if (chKey === 'instagram' && entry.url && !existing.instagram_url) {
            nextInstagramUrl = String(entry.url);
          }
        };

        if (body.updates && typeof body.updates === 'object') {
          Object.entries(body.updates).forEach(([k, v]) => applyOne(k, v));
        } else if (body.channel) {
          applyOne(String(body.channel), body);
        } else {
          return jsonResponse({ error: 'Chýba channel alebo updates.' }, 400);
        }

        if (nextInstagramUrl) {
          await env.DB.prepare(
            `UPDATE artworks SET publish_status_json = ?, instagram_url = ? WHERE id = ?`
          ).bind(JSON.stringify(currentStatus), nextInstagramUrl, id).run();
        } else {
          await env.DB.prepare(
            `UPDATE artworks SET publish_status_json = ? WHERE id = ?`
          ).bind(JSON.stringify(currentStatus), id).run();
        }

        return jsonResponse({ success: true, id, publishStatus: currentStatus });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // ---- 4. Artwork API Endpoints ----

    // GET /api/artworks - Public catalog from D1
    if (pathname === '/api/artworks' && request.method === 'GET') {
      try {
        await ensureAutomationSchema();
        const { results: artworks } = await env.DB.prepare(
          `SELECT * FROM artworks ORDER BY sort_order ASC, date_created DESC, id DESC`
        ).all();

        const { results: images } = await env.DB.prepare(
          `SELECT artwork_id, image_url, is_cover, sort_order FROM artwork_images ORDER BY sort_order ASC`
        ).all();

        const imgMap = {};
        for (const img of images) {
          if (!imgMap[img.artwork_id]) imgMap[img.artwork_id] = [];
          imgMap[img.artwork_id].push(img.image_url);
        }

        const data = artworks.map((art) => serializeArtworkRow(art, imgMap));

        return jsonResponse(data);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // POST /api/artworks - Create or restore an artwork record (Authenticated)
    if (pathname === '/api/artworks' && request.method === 'POST') {
      try {
        const session = await getAuthSession(request);
        if (!session.authenticated) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        await ensureAutomationSchema();

        const body = await request.json();
        const {
          id,
          folder,
          title,
          date,
          year,
          technique = 'Mixed',
          medium = 'Akryl na plátne',
          dimensions,
          widthCm,
          heightCm,
          depthCm = 4,
          priceEur = null,
          publishChannels = {},
          instagramUrl = '',
          rawImage = '',
          rawImageDataUrl = '',
          sortOrder = 0,
          status = 'Available',
          description = '',
          coverImage = '',
          detailImages = [],
          thumbMap = {},
        } = body;

        if (!id) {
          return jsonResponse({ error: 'Missing artwork id' }, 400);
        }

        const resolvedFolder = folder || id.replace(/^art-/, '');
        const hasExplicitDims = Number(widthCm) > 0 && Number(heightCm) > 0;
        const parsedFromStr = parseDimPair(dimensions || '50 × 70 cm');
        const resolvedWidth = hasExplicitDims ? Number(widthCm) : parsedFromStr.widthCm;
        const resolvedHeight = hasExplicitDims ? Number(heightCm) : parsedFromStr.heightCm;
        const resolvedDepth = Number(depthCm) > 0 ? Number(depthCm) : 4;
        const resolvedDimensions = dimensions || `${resolvedWidth} × ${resolvedHeight} cm`;
        const resolvedPrice = priceEur !== null && priceEur !== undefined && priceEur !== '' && Number.isFinite(Number(priceEur)) && Number(priceEur) >= 0
          ? Number(priceEur)
          : null;
        const resolvedPublishChannelsJson = publishChannels && typeof publishChannels === 'object'
          ? JSON.stringify(publishChannels)
          : '{}';

        const rawInputs = Array.isArray(detailImages) && detailImages.length > 0
          ? detailImages
          : (coverImage ? [coverImage] : []);

        const resolvedImgs = [];
        for (let idx = 0; idx < rawInputs.length; idx++) {
          const entry = rawInputs[idx];
          if (typeof entry === 'string' && entry.startsWith('data:image/')) {
            const thumbCandidate = thumbMap && typeof thumbMap === 'object' ? thumbMap[entry] : null;
            const uploadedUrl = await uploadDataImageWithThumb(entry, thumbCandidate, resolvedFolder, idx === 0 ? 'cover' : 'detail');
            if (uploadedUrl) resolvedImgs.push(uploadedUrl);
          } else if (typeof entry === 'string' && entry.length > 0) {
            resolvedImgs.push(entry);
          }
        }

        let resolvedRawImage = rawImage || '';
        if (typeof rawImageDataUrl === 'string' && rawImageDataUrl.startsWith('data:image/')) {
          const rawThumbCandidate = thumbMap && typeof thumbMap === 'object' ? thumbMap[rawImageDataUrl] : null;
          const uploadedRaw = await uploadDataImageWithThumb(rawImageDataUrl, rawThumbCandidate, resolvedFolder, 'raw');
          if (uploadedRaw) {
            resolvedRawImage = uploadedRaw;
            if (body.includeRawInAlbum !== false && !resolvedImgs.includes(uploadedRaw)) {
              resolvedImgs.push(uploadedRaw);
            }
          }
        }

        const resolvedCover = resolvedImgs[0] || (coverImage && !coverImage.startsWith('data:image/') ? coverImage : '');

        await env.DB.prepare(`
          INSERT OR REPLACE INTO artworks
            (id, folder_name, title, date_created, year, technique, medium, dimensions, width_cm, height_cm, depth_cm, price_eur, instagram_url, raw_image, social_image_url, publish_status_json, publish_channels_json, sort_order, status, description, cover_image, photo_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            id,
            resolvedFolder,
            title ?? '',
            date ?? null,
            year ?? null,
            technique ?? 'Mixed',
            medium ?? 'Akryl na plátne',
            resolvedDimensions,
            resolvedWidth,
            resolvedHeight,
            resolvedDepth,
            resolvedPrice,
            instagramUrl ?? '',
            resolvedRawImage,
            '',
            '{}',
            resolvedPublishChannelsJson,
            Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
            status ?? 'Available',
            description ?? '',
            resolvedCover,
            resolvedImgs.length
          )
          .run();

        const stmts = [
          env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(id),
        ];
        resolvedImgs.forEach((imgUrl, idx) => {
          stmts.push(
            env.DB.prepare(
              `INSERT INTO artwork_images (artwork_id, image_url, is_cover, sort_order) VALUES (?, ?, ?, ?)`
            ).bind(id, imgUrl, idx === 0 ? 1 : 0, idx)
          );
        });
        await env.DB.batch(stmts);

        return jsonResponse({
          success: true,
          id,
          priceEur: resolvedPrice,
          coverImage: resolvedCover,
          detailImages: resolvedImgs,
          rawImage: resolvedRawImage,
          photoCount: resolvedImgs.length,
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // POST /api/artworks/reorder - Persist custom inventory sort order (Authenticated)
    if (pathname === '/api/artworks/reorder' && request.method === 'POST') {
      try {
        const session = await getAuthSession(request);
        if (!session.authenticated) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const body = await request.json();
        const orderedIds = body && Array.isArray(body.orderedIds) ? body.orderedIds.filter(Boolean) : [];
        if (orderedIds.length === 0) {
          return jsonResponse({ error: 'orderedIds array is required' }, 400);
        }

        const stmts = orderedIds.map((artId, idx) =>
          env.DB.prepare(`UPDATE artworks SET sort_order = ? WHERE id = ?`).bind(idx + 1, artId)
        );
        await env.DB.batch(stmts);

        return jsonResponse({ success: true, count: orderedIds.length });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // POST /api/artworks/merge - Merge multiple albums into primaryId (Authenticated)
    if (pathname === '/api/artworks/merge' && request.method === 'POST') {
      try {
        const session = await getAuthSession(request);
        if (!session.authenticated) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const body = await request.json();
        const { primaryId, mergeIds } = body;

        if (!primaryId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
          return jsonResponse({ error: 'primaryId and non-empty mergeIds are required' }, 400);
        }

        const cleanMergeIds = mergeIds.filter((mid) => mid && mid !== primaryId);
        if (cleanMergeIds.length === 0) {
          return jsonResponse({ error: 'No secondary albums to merge' }, 400);
        }

        const getAlbumImages = async (artId) => {
          const { results: imgs } = await env.DB.prepare(
            `SELECT image_url FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC`
          )
            .bind(artId)
            .all();
          if (imgs && imgs.length > 0) {
            return imgs.map((r) => r.image_url);
          }
          const artRow = await env.DB.prepare(
            `SELECT cover_image FROM artworks WHERE id = ?`
          )
            .bind(artId)
            .first();
          return artRow && artRow.cover_image ? [artRow.cover_image] : [];
        };

        const combined = [];
        const seen = new Set();
        const pushUnique = (urls) => {
          for (const u of urls) {
            if (u && !seen.has(u)) {
              seen.add(u);
              combined.push(u);
            }
          }
        };

        pushUnique(await getAlbumImages(primaryId));
        for (const mid of cleanMergeIds) {
          pushUnique(await getAlbumImages(mid));
        }

        const stmts = [
          env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(primaryId),
        ];
        combined.forEach((imgUrl, idx) => {
          stmts.push(
            env.DB.prepare(
              `INSERT INTO artwork_images (artwork_id, image_url, is_cover, sort_order) VALUES (?, ?, ?, ?)`
            ).bind(primaryId, imgUrl, idx === 0 ? 1 : 0, idx)
          );
        });

        if (combined.length > 0) {
          stmts.push(
            env.DB.prepare(
              `UPDATE artworks SET cover_image = ?, photo_count = ? WHERE id = ?`
            ).bind(combined[0], combined.length, primaryId)
          );
        } else {
          stmts.push(
            env.DB.prepare(`UPDATE artworks SET photo_count = 0 WHERE id = ?`).bind(primaryId)
          );
        }

        for (const mid of cleanMergeIds) {
          stmts.push(env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(mid));
          stmts.push(env.DB.prepare(`DELETE FROM artworks WHERE id = ?`).bind(mid));
        }

        await env.DB.batch(stmts);

        return jsonResponse({
          success: true,
          primaryId,
          detailImages: combined,
          photoCount: combined.length,
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // PUT or POST /api/artworks/:id - Update metadata/images, upload new covers+thumbs, delete removed R2 files (Authenticated)
    if (pathname.startsWith('/api/artworks/') && (request.method === 'PUT' || request.method === 'POST')) {
      try {
        const session = await getAuthSession(request);
        if (!session.authenticated) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        await ensureAutomationSchema();

        const id = decodeURIComponent(pathname.substring('/api/artworks/'.length));
        const body = await request.json();
        const {
          title,
          date,
          year,
          dimensions,
          widthCm,
          heightCm,
          depthCm,
          priceEur,
          publishChannels,
          instagramUrl,
          rawImage,
          rawImageDataUrl,
          sortOrder,
          status,
          technique,
          medium,
          description,
          detailImages,
          thumbMap = {},
        } = body;

        const existingArtRow = await env.DB.prepare(
          `SELECT folder_name, raw_image, price_eur FROM artworks WHERE id = ?`
        )
          .bind(id)
          .first();
        const folder = (existingArtRow && existingArtRow.folder_name) || id.replace(/^art-/, '');

        let uploadedRawUrl = null;
        let oldRawToClean = null;
        if (typeof rawImageDataUrl === 'string' && rawImageDataUrl.startsWith('data:image/')) {
          const rawThumbCandidate = thumbMap && typeof thumbMap === 'object' ? thumbMap[rawImageDataUrl] : null;
          uploadedRawUrl = await uploadDataImageWithThumb(rawImageDataUrl, rawThumbCandidate, folder, 'raw');
          if (uploadedRawUrl && existingArtRow && existingArtRow.raw_image && existingArtRow.raw_image !== uploadedRawUrl) {
            oldRawToClean = existingArtRow.raw_image;
          }
        }

        const hasExplicitDims = Number(widthCm) > 0 && Number(heightCm) > 0;
        let syncedDimensions = dimensions ?? null;
        let syncedWidth = hasExplicitDims ? Number(widthCm) : null;
        let syncedHeight = hasExplicitDims ? Number(heightCm) : null;

        if (hasExplicitDims && !syncedDimensions) {
          syncedDimensions = `${syncedWidth} × ${syncedHeight} cm`;
        } else if (!hasExplicitDims && typeof dimensions === 'string' && dimensions.trim()) {
          const parsed = parseDimPair(dimensions);
          syncedWidth = parsed.widthCm;
          syncedHeight = parsed.heightCm;
        }
        const syncedDepth = Number(depthCm) > 0 ? Number(depthCm) : null;
        const syncedSortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : null;

        let syncedPrice = existingArtRow ? existingArtRow.price_eur : null;
        if (priceEur === null || priceEur === '') {
          syncedPrice = null;
        } else if (priceEur !== undefined) {
          const parsedPrice = Number(priceEur);
          if (Number.isFinite(parsedPrice) && parsedPrice >= 0) {
            syncedPrice = parsedPrice;
          }
        }
        const syncedPublishChannelsJson = publishChannels !== undefined && publishChannels !== null && typeof publishChannels === 'object'
          ? JSON.stringify(publishChannels)
          : null;

        await env.DB.prepare(`
          UPDATE artworks
          SET title = COALESCE(?, title),
              date_created = COALESCE(?, date_created),
              year = COALESCE(?, year),
              dimensions = COALESCE(?, dimensions),
              width_cm = COALESCE(?, width_cm),
              height_cm = COALESCE(?, height_cm),
              depth_cm = COALESCE(?, depth_cm),
              price_eur = ?,
              publish_channels_json = COALESCE(?, publish_channels_json),
              instagram_url = COALESCE(?, instagram_url),
              raw_image = COALESCE(?, raw_image),
              sort_order = COALESCE(?, sort_order),
              status = COALESCE(?, status),
              technique = COALESCE(?, technique),
              medium = COALESCE(?, medium),
              description = COALESCE(?, description)
          WHERE id = ?
        `)
          .bind(
            title ?? null,
            date ?? null,
            year ?? null,
            syncedDimensions,
            syncedWidth,
            syncedHeight,
            syncedDepth,
            syncedPrice,
            syncedPublishChannelsJson,
            instagramUrl ?? null,
            (existingArtRow && existingArtRow.raw_image && !uploadedRawUrl) ? null : (uploadedRawUrl ?? rawImage ?? null),
            syncedSortOrder,
            status ?? null,
            technique ?? null,
            medium ?? null,
            description ?? null,
            id
          )
          .run();

        let resolvedImages;
        let deletedKeys = [];
        let preservedRawImage = uploadedRawUrl || null;

        if (oldRawToClean) {
          const cleanedRaw = await deleteUnusedR2Images([oldRawToClean]);
          deletedKeys.push(...cleanedRaw);
        }

        if (Array.isArray(detailImages) && detailImages.length > 0) {
          const { results: oldImgRows } = await env.DB.prepare(
            `SELECT image_url FROM artwork_images WHERE artwork_id = ?`
          )
            .bind(id)
            .all();
          const oldUrls = (oldImgRows || []).map((r) => r.image_url);
          let uploadedNewCover = false;

          resolvedImages = [];
          for (let idx = 0; idx < detailImages.length; idx++) {
            const entry = detailImages[idx];
            if (typeof entry === 'string' && entry.startsWith('data:image/')) {
              const thumbCandidate = thumbMap && typeof thumbMap === 'object' ? thumbMap[entry] : null;
              const uploadedUrl = await uploadDataImageWithThumb(entry, thumbCandidate, folder, idx === 0 ? 'cover' : 'detail');
              if (uploadedUrl) {
                if (idx === 0) uploadedNewCover = true;
                resolvedImages.push(uploadedUrl);
                continue;
              }
            }
            if (typeof entry === 'string' && entry.length > 0) {
              resolvedImages.push(entry);
            }
          }

          if (resolvedImages.length > 0) {
            if (!preservedRawImage && uploadedNewCover && (!existingArtRow || !existingArtRow.raw_image) && oldUrls[0]) {
              preservedRawImage = oldUrls[0];
            }

            const stmts = [
              (!uploadedRawUrl && preservedRawImage)
                ? env.DB.prepare(
                    `UPDATE artworks SET cover_image = ?, photo_count = ?, raw_image = ? WHERE id = ?`
                  ).bind(resolvedImages[0], resolvedImages.length, preservedRawImage, id)
                : env.DB.prepare(
                    `UPDATE artworks SET cover_image = ?, photo_count = ? WHERE id = ?`
                  ).bind(resolvedImages[0], resolvedImages.length, id),
              env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(id),
            ];
            resolvedImages.forEach((imgUrl, i) => {
              stmts.push(
                env.DB.prepare(
                  `INSERT INTO artwork_images (artwork_id, image_url, is_cover, sort_order) VALUES (?, ?, ?, ?)`
                ).bind(id, imgUrl, i === 0 ? 1 : 0, i)
              );
            });
            await env.DB.batch(stmts);

            const removedUrls = oldUrls.filter((u) => !resolvedImages.includes(u));
            const cleanedRemoved = await deleteUnusedR2Images(removedUrls);
            deletedKeys.push(...cleanedRemoved);
          }
        }

        const respPayload = { success: true, id, priceEur: syncedPrice, deletedFiles: deletedKeys.length };
        if (syncedWidth) respPayload.widthCm = syncedWidth;
        if (syncedHeight) respPayload.heightCm = syncedHeight;
        if (syncedDepth) respPayload.depthCm = syncedDepth;
        if (syncedDimensions) respPayload.dimensions = syncedDimensions;
        if (instagramUrl !== undefined) respPayload.instagramUrl = instagramUrl;
        if (preservedRawImage) respPayload.rawImage = preservedRawImage;
        if (resolvedImages && resolvedImages.length > 0) {
          respPayload.coverImage = resolvedImages[0];
          respPayload.detailImages = resolvedImages;
          respPayload.photoCount = resolvedImages.length;
        }
        return jsonResponse(respPayload);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // DELETE /api/artworks/:id - Delete D1 record and unused originals + thumbnails in R2 (Authenticated)
    if (pathname.startsWith('/api/artworks/') && request.method === 'DELETE') {
      try {
        const session = await getAuthSession(request);
        if (!session.authenticated) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        await ensureAutomationSchema();

        const id = decodeURIComponent(pathname.substring('/api/artworks/'.length));

        const { results: imgRows } = await env.DB.prepare(
          `SELECT image_url FROM artwork_images WHERE artwork_id = ?`
        )
          .bind(id)
          .all();
        const artRow = await env.DB.prepare(
          `SELECT cover_image, raw_image, social_image_url FROM artworks WHERE id = ?`
        )
          .bind(id)
          .first();

        const candidateUrls = (imgRows || []).map((r) => r.image_url);
        if (artRow && artRow.cover_image) {
          candidateUrls.push(artRow.cover_image);
        }
        if (artRow && artRow.raw_image) {
          candidateUrls.push(artRow.raw_image);
        }
        if (artRow && artRow.social_image_url) {
          candidateUrls.push(artRow.social_image_url);
        }

        await env.DB.batch([
          env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(id),
          env.DB.prepare(`DELETE FROM artworks WHERE id = ?`).bind(id),
        ]);

        const deletedKeys = await deleteUnusedR2Images(candidateUrls);

        return jsonResponse({
          success: true,
          id,
          deletedFiles: deletedKeys.length,
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // ---- 4. Static Assets fallback ----
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};
