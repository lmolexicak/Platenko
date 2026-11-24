// Cloudflare Worker backend for Platenko Gallery

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. CORS Headers helper
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    const jsonResponse = (payload, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
        },
      });

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Images served directly from Cloudflare R2 bucket
    // Matches /images/paintings/* or /paintings/* (GET and HEAD)
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

      const object =
        request.method === 'HEAD'
          ? await env.IMAGES.head(key)
          : await env.IMAGES.get(key);

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

      return new Response(request.method === 'HEAD' ? null : object.body, { headers });
    }

    // 3. API Endpoints

    // GET /api/artworks - Load all paintings with their images from D1
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

        const data = artworks.map(art => {
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
            description: art.description || ''
          };
        });

        return jsonResponse(data);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // POST /api/artworks - Create or restore an artwork record (e.g. Admin Undo)
    if (pathname === '/api/artworks' && request.method === 'POST') {
      try {
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
          detailImages = []
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
        `).bind(
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
        ).run();

        const stmts = [
          env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(id)
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

    // POST /api/artworks/merge - Merge multiple albums into primaryId
    if (pathname === '/api/artworks/merge' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { primaryId, mergeIds } = body;

        if (!primaryId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
          return jsonResponse({ error: 'primaryId and non-empty mergeIds are required' }, 400);
        }

        const cleanMergeIds = mergeIds.filter(mid => mid && mid !== primaryId);
        if (cleanMergeIds.length === 0) {
          return jsonResponse({ error: 'No secondary albums to merge' }, 400);
        }

        const getAlbumImages = async (artId) => {
          const { results: imgs } = await env.DB.prepare(
            `SELECT image_url FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC`
          ).bind(artId).all();
          if (imgs && imgs.length > 0) {
            return imgs.map(r => r.image_url);
          }
          const artRow = await env.DB.prepare(
            `SELECT cover_image FROM artworks WHERE id = ?`
          ).bind(artId).first();
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
          env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(primaryId)
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
            env.DB.prepare(
              `UPDATE artworks SET photo_count = 0 WHERE id = ?`
            ).bind(primaryId)
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
          photoCount: combined.length
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // PUT or POST /api/artworks/:id - Update artwork metadata and/or detailImages (including data URLs uploaded to R2)
    if (pathname.startsWith('/api/artworks/') && (request.method === 'PUT' || request.method === 'POST')) {
      const id = decodeURIComponent(pathname.substring('/api/artworks/'.length));
      try {
        const body = await request.json();
        const { title, dimensions, status, technique, medium, description, detailImages } = body;

        await env.DB.prepare(`
          UPDATE artworks
          SET title = COALESCE(?, title),
              dimensions = COALESCE(?, dimensions),
              status = COALESCE(?, status),
              technique = COALESCE(?, technique),
              medium = COALESCE(?, medium),
              description = COALESCE(?, description)
          WHERE id = ?
        `).bind(
          title ?? null,
          dimensions ?? null,
          status ?? null,
          technique ?? null,
          medium ?? null,
          description ?? null,
          id
        ).run();

        let resolvedImages;
        if (Array.isArray(detailImages) && detailImages.length > 0) {
          const artRow = await env.DB.prepare(
            `SELECT folder_name FROM artworks WHERE id = ?`
          ).bind(id).first();
          const folder = (artRow && artRow.folder_name) || id.replace(/^art-/, '');

          resolvedImages = [];
          for (let idx = 0; idx < detailImages.length; idx++) {
            const entry = detailImages[idx];
            if (typeof entry === 'string' && entry.startsWith('data:image/')) {
              const match = entry.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
              if (match) {
                const contentType = match[1];
                const base64Data = match[2];
                const binaryStr = atob(base64Data);
                const bytes = new Uint8Array(binaryStr.length);
                for (let b = 0; b < binaryStr.length; b++) {
                  bytes[b] = binaryStr.charCodeAt(b);
                }
                const ext = contentType === 'image/png'
                  ? 'png'
                  : (contentType === 'image/webp' ? 'webp' : 'jpg');
                const r2Key = `paintings/${folder}/cover_${Date.now()}_${idx}.${ext}`;
                await env.IMAGES.put(r2Key, bytes, {
                  httpMetadata: { contentType }
                });
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
              env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(id)
            ];
            resolvedImages.forEach((imgUrl, i) => {
              stmts.push(
                env.DB.prepare(
                  `INSERT INTO artwork_images (artwork_id, image_url, is_cover, sort_order) VALUES (?, ?, ?, ?)`
                ).bind(id, imgUrl, i === 0 ? 1 : 0, i)
              );
            });
            await env.DB.batch(stmts);
          }
        }

        const respPayload = { success: true, id };
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

    // DELETE /api/artworks/:id - Remove artwork and its image links from D1
    if (pathname.startsWith('/api/artworks/') && request.method === 'DELETE') {
      const id = decodeURIComponent(pathname.substring('/api/artworks/'.length));
      try {
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(id),
          env.DB.prepare(`DELETE FROM artworks WHERE id = ?`).bind(id)
        ]);
        return jsonResponse({ success: true, id });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // 4. Static Assets fallback (handled by Cloudflare Pages/Workers assets)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
};
