// Cloudflare Worker backend for Platenko Gallery

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const isHttps = url.protocol === 'https:';

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
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

    // ---- R2 Image & Cleanup Helpers ----
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

    // ---- 3. Artwork API Endpoints ----

    // GET /api/artworks - Public catalog from D1
    if (pathname === '/api/artworks' && request.method === 'GET') {
      try {
        const { results: artworks } = await env.DB.prepare(
          `SELECT * FROM artworks ORDER BY date_created DESC, id DESC`
        ).all();

        const { results: images } = await env.DB.prepare(
          `SELECT artwork_id, image_url, is_cover, sort_order FROM artwork_images ORDER BY sort_order ASC`
        ).all();

        const imgMap = {};
        for (const img of images) {
          if (!imgMap[img.artwork_id]) imgMap[img.artwork_id] = [];
          imgMap[img.artwork_id].push(img.image_url);
        }

        const data = artworks.map((art) => {
          const detailImgs = imgMap[art.id] || (art.cover_image ? [art.cover_image] : []);
          return {
            id: art.id,
            folder: art.folder_name,
            title: art.title,
            date: art.date_created,
            year: art.year,
            technique: art.technique,
            medium: art.medium,
            dimensions: art.dimensions,
            status: art.status,
            photoCount: art.photo_count || detailImgs.length,
            coverImage: art.cover_image || (detailImgs.length > 0 ? detailImgs[0] : ''),
            detailImages: detailImgs,
            description: art.description || '',
          };
        });

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

        const body = await request.json();
        const {
          id,
          folder,
          title,
          date,
          year,
          technique = 'Mixed',
          medium = 'Akryl na plátne',
          dimensions = '50 × 70 cm',
          status = 'Available',
          description = '',
          coverImage = '',
          detailImages = [],
        } = body;

        if (!id) {
          return jsonResponse({ error: 'Missing artwork id' }, 400);
        }

        const imgs = Array.isArray(detailImages) && detailImages.length > 0
          ? detailImages
          : (coverImage ? [coverImage] : []);
        const resolvedCover = coverImage || imgs[0] || '';

        await env.DB.prepare(`
          INSERT OR REPLACE INTO artworks
            (id, folder_name, title, date_created, year, technique, medium, dimensions, status, description, cover_image, photo_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            id,
            folder ?? id.replace(/^art-/, ''),
            title ?? '',
            date ?? null,
            year ?? null,
            technique ?? 'Mixed',
            medium ?? 'Akryl na plátne',
            dimensions ?? '50 × 70 cm',
            status ?? 'Available',
            description ?? '',
            resolvedCover,
            imgs.length
          )
          .run();

        const stmts = [
          env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(id),
        ];
        imgs.forEach((imgUrl, idx) => {
          stmts.push(
            env.DB.prepare(
              `INSERT INTO artwork_images (artwork_id, image_url, is_cover, sort_order) VALUES (?, ?, ?, ?)`
            ).bind(id, imgUrl, idx === 0 ? 1 : 0, idx)
          );
        });
        await env.DB.batch(stmts);

        return jsonResponse({ success: true, id });
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

        const id = decodeURIComponent(pathname.substring('/api/artworks/'.length));
        const body = await request.json();
        const {
          title,
          dimensions,
          status,
          technique,
          medium,
          description,
          detailImages,
          thumbMap = {},
        } = body;

        await env.DB.prepare(`
          UPDATE artworks
          SET title = COALESCE(?, title),
              dimensions = COALESCE(?, dimensions),
              status = COALESCE(?, status),
              technique = COALESCE(?, technique),
              medium = COALESCE(?, medium),
              description = COALESCE(?, description)
          WHERE id = ?
        `)
          .bind(
            title ?? null,
            dimensions ?? null,
            status ?? null,
            technique ?? null,
            medium ?? null,
            description ?? null,
            id
          )
          .run();

        let resolvedImages;
        let deletedKeys = [];

        if (Array.isArray(detailImages) && detailImages.length > 0) {
          const { results: oldImgRows } = await env.DB.prepare(
            `SELECT image_url FROM artwork_images WHERE artwork_id = ?`
          )
            .bind(id)
            .all();
          const oldUrls = (oldImgRows || []).map((r) => r.image_url);

          const artRow = await env.DB.prepare(
            `SELECT folder_name FROM artworks WHERE id = ?`
          )
            .bind(id)
            .first();
          const folder = (artRow && artRow.folder_name) || id.replace(/^art-/, '');

          resolvedImages = [];
          for (let idx = 0; idx < detailImages.length; idx++) {
            const entry = detailImages[idx];
            if (typeof entry === 'string' && entry.startsWith('data:image/')) {
              const decoded = decodeDataImage(entry);
              if (decoded) {
                const r2Key = `paintings/${folder}/cover_${Date.now()}_${idx}.${decoded.ext}`;
                await env.IMAGES.put(r2Key, decoded.bytes, {
                  httpMetadata: { contentType: decoded.contentType },
                });

                const thumbCandidate = thumbMap && typeof thumbMap === 'object' ? thumbMap[entry] : null;
                const decodedThumb = decodeDataImage(thumbCandidate);
                if (decodedThumb) {
                  await env.IMAGES.put(`thumbs/${r2Key}`, decodedThumb.bytes, {
                    httpMetadata: { contentType: decodedThumb.contentType },
                  });
                }

                resolvedImages.push(`images/${r2Key}`);
                continue;
              }
            }
            if (typeof entry === 'string' && entry.length > 0) {
              resolvedImages.push(entry);
            }
          }

          if (resolvedImages.length > 0) {
            const stmts = [
              env.DB.prepare(
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
            deletedKeys = await deleteUnusedR2Images(removedUrls);
          }
        }

        const respPayload = { success: true, id, deletedFiles: deletedKeys.length };
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

        const id = decodeURIComponent(pathname.substring('/api/artworks/'.length));

        const { results: imgRows } = await env.DB.prepare(
          `SELECT image_url FROM artwork_images WHERE artwork_id = ?`
        )
          .bind(id)
          .all();
        const artRow = await env.DB.prepare(
          `SELECT cover_image FROM artworks WHERE id = ?`
        )
          .bind(id)
          .first();

        const candidateUrls = (imgRows || []).map((r) => r.image_url);
        if (artRow && artRow.cover_image) {
          candidateUrls.push(artRow.cover_image);
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
