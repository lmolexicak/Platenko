import {
  jsonResponse,
  parseJsonSafe,
  parseDimPair,
  getAuthSession,
  uploadDataImageWithThumb,
  deleteUnusedR2Images,
  serializeArtworkRow,
} from './utils.js';
import { ensureAutomationSchema } from './automation.js';

export async function handleArtworksRequest(request, env, pathname) {
  // GET /api/artworks - Public catalog from D1
  if (pathname === '/api/artworks' && request.method === 'GET') {
    try {
      await ensureAutomationSchema(env);
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

      const list = artworks.map((art) => serializeArtworkRow(art, imgMap));
      // Verejnosť nedostane interné dáta (stav publikovania, ceny portálov, originál, kanály)
      const session = await getAuthSession(env, request).catch(() => ({ authenticated: false }));
      if (!session.authenticated) {
        for (const item of list) {
          delete item.publishStatus;
          delete item.portalPrices;
          delete item.publishChannels;
          delete item.rawImage;
        }
      }
      return jsonResponse(list);
    } catch (err) {
      console.error('GET /api/artworks failed:', err);
      return jsonResponse({ error: 'Katalóg sa nepodarilo načítať.' }, 500);
    }
  }

  // POST /api/artworks - Create artwork (Authenticated)
  if (pathname === '/api/artworks' && request.method === 'POST') {
    try {
      const session = await getAuthSession(env, request);
      if (!session.authenticated) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      await ensureAutomationSchema(env);

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
        portalPrices = {},
        socialImageUrl = '',
        coverAspectRatio = null,
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
      const resolvedRatio = Number(coverAspectRatio) > 0 ? Number(coverAspectRatio) : null;
      const sanitizedPortalPrices = {};
      if (portalPrices && typeof portalPrices === 'object') {
        for (const [pk, pv] of Object.entries(portalPrices)) {
          if (pv !== null && pv !== undefined && pv !== '' && Number.isFinite(Number(pv)) && Number(pv) >= 0) {
            sanitizedPortalPrices[pk] = Number(pv);
          }
        }
      }
      const resolvedPortalPricesJson = JSON.stringify(sanitizedPortalPrices);
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
          const uploadedUrl = await uploadDataImageWithThumb(env, entry, thumbCandidate, resolvedFolder, idx === 0 ? 'cover' : 'detail');
          if (uploadedUrl) resolvedImgs.push(uploadedUrl);
        } else if (typeof entry === 'string' && entry.length > 0) {
          resolvedImgs.push(entry);
        }
      }

      let resolvedRawImage = rawImage || '';
      if (typeof rawImageDataUrl === 'string' && rawImageDataUrl.startsWith('data:image/')) {
        const rawThumbCandidate = thumbMap && typeof thumbMap === 'object' ? thumbMap[rawImageDataUrl] : null;
        const uploadedRaw = await uploadDataImageWithThumb(env, rawImageDataUrl, rawThumbCandidate, resolvedFolder, 'raw');
        if (uploadedRaw) {
          resolvedRawImage = uploadedRaw;
          if (body.includeRawInAlbum !== false && !resolvedImgs.includes(uploadedRaw)) {
            resolvedImgs.push(uploadedRaw);
          }
        }
      }

      const resolvedCover = resolvedImgs[0] || (coverImage && !coverImage.startsWith('data:image/') ? coverImage : '');
      const resolvedSocialImg = (typeof socialImageUrl === 'string' && !socialImageUrl.startsWith('data:')) ? socialImageUrl : '';

      await env.DB.prepare(`
        INSERT OR REPLACE INTO artworks
          (id, folder_name, title, date_created, year, technique, medium, dimensions, width_cm, height_cm, depth_cm, price_eur, portal_prices_json, instagram_url, raw_image, social_image_url, cover_aspect_ratio, publish_status_json, publish_channels_json, sort_order, status, description, cover_image, photo_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          resolvedPortalPricesJson,
          instagramUrl ?? '',
          resolvedRawImage,
          resolvedSocialImg,
          resolvedRatio,
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
        portalPrices: sanitizedPortalPrices,
        socialImageUrl: resolvedSocialImg,
        coverAspectRatio: resolvedRatio,
        coverImage: resolvedCover,
        detailImages: resolvedImgs,
        rawImage: resolvedRawImage,
        photoCount: resolvedImgs.length,
      });
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // POST /api/artworks/reorder (Authenticated)
  if (pathname === '/api/artworks/reorder' && request.method === 'POST') {
    try {
      const session = await getAuthSession(env, request);
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

  // POST /api/artworks/merge (Authenticated)
  if (pathname === '/api/artworks/merge' && request.method === 'POST') {
    try {
      const session = await getAuthSession(env, request);
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

  // POST /api/artworks/:id/images/reorder (Authenticated)
  if (pathname.startsWith('/api/artworks/') && pathname.endsWith('/images/reorder') && request.method === 'POST') {
    try {
      const session = await getAuthSession(env, request);
      if (!session.authenticated) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      await ensureAutomationSchema(env);

      const id = decodeURIComponent(
        pathname.slice('/api/artworks/'.length, -'/images/reorder'.length)
      ).trim();
      if (!id) {
        return jsonResponse({ error: 'Chýba ID diela.' }, 400);
      }

      const artRow = await env.DB.prepare(`SELECT id, cover_image FROM artworks WHERE id = ?`).bind(id).first();
      if (!artRow) {
        return jsonResponse({ error: 'Dielo neexistuje.' }, 404);
      }

      const body = await request.json().catch(() => ({}));
      const orderedUrls = Array.isArray(body.orderedUrls)
        ? body.orderedUrls.filter((u) => typeof u === 'string' && u.length > 0)
        : [];
      if (orderedUrls.length === 0) {
        return jsonResponse({ error: 'orderedUrls musí obsahovať aspoň jednu fotku.' }, 400);
      }

      const { results: existingRows } = await env.DB.prepare(
        `SELECT image_url FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC`
      ).bind(id).all();
      const existingUrls = (existingRows || []).map((r) => r.image_url).filter(Boolean);
      if (existingUrls.length === 0 && artRow.cover_image) {
        existingUrls.push(artRow.cover_image);
      }

      const existingSet = new Set(existingUrls);
      const finalUrls = [];
      const seen = new Set();
      for (const u of orderedUrls) {
        if (existingSet.has(u) && !seen.has(u)) {
          seen.add(u);
          finalUrls.push(u);
        }
      }
      for (const u of existingUrls) {
        if (!seen.has(u)) {
          seen.add(u);
          finalUrls.push(u);
        }
      }

      if (finalUrls.length === 0) {
        return jsonResponse({ error: 'Žiadne platné fotky na preusporiadanie.' }, 400);
      }

      const ratioNum = Number(body.coverAspectRatio);
      const nextRatio = Number.isFinite(ratioNum) && ratioNum > 0 ? ratioNum : null;

      const stmts = [
        env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(id),
      ];
      finalUrls.forEach((imgUrl, idx) => {
        stmts.push(
          env.DB.prepare(
            `INSERT INTO artwork_images (artwork_id, image_url, is_cover, sort_order) VALUES (?, ?, ?, ?)`
          ).bind(id, imgUrl, idx === 0 ? 1 : 0, idx)
        );
      });
      stmts.push(
        env.DB.prepare(`UPDATE artworks SET cover_image = ?, photo_count = ?, cover_aspect_ratio = COALESCE(?, cover_aspect_ratio) WHERE id = ?`)
          .bind(finalUrls[0], finalUrls.length, nextRatio, id)
      );
      await env.DB.batch(stmts);

      return jsonResponse({
        success: true,
        id,
        coverImage: finalUrls[0],
        coverAspectRatio: nextRatio,
        detailImages: finalUrls,
        photoCount: finalUrls.length,
      });
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // PUT or POST /api/artworks/:id (Authenticated)
  if (pathname.startsWith('/api/artworks/') && (request.method === 'PUT' || request.method === 'POST')) {
    try {
      const session = await getAuthSession(env, request);
      if (!session.authenticated) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      await ensureAutomationSchema(env);

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
        portalPrices,
        socialImageUrl,
        coverAspectRatio,
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
        `SELECT folder_name, raw_image, price_eur, portal_prices_json, social_image_url FROM artworks WHERE id = ?`
      )
        .bind(id)
        .first();
      const folder = (existingArtRow && existingArtRow.folder_name) || id.replace(/^art-/, '');

      let uploadedRawUrl = null;
      let oldRawToClean = null;
      if (typeof rawImageDataUrl === 'string' && rawImageDataUrl.startsWith('data:image/')) {
        const rawThumbCandidate = thumbMap && typeof thumbMap === 'object' ? thumbMap[rawImageDataUrl] : null;
        uploadedRawUrl = await uploadDataImageWithThumb(env, rawImageDataUrl, rawThumbCandidate, folder, 'raw');
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
      const syncedRatio = Number(coverAspectRatio) > 0 ? Number(coverAspectRatio) : null;

      let syncedPrice = existingArtRow ? existingArtRow.price_eur : null;
      if (priceEur === null || priceEur === '') {
        syncedPrice = null;
      } else if (priceEur !== undefined) {
        const parsedPrice = Number(priceEur);
        if (Number.isFinite(parsedPrice) && parsedPrice >= 0) {
          syncedPrice = parsedPrice;
        }
      }

      let syncedPortalPrices = null;
      if (portalPrices !== undefined && portalPrices !== null && typeof portalPrices === 'object') {
        const cleanPortalPrices = {};
        for (const [pk, pv] of Object.entries(portalPrices)) {
          if (pv !== null && pv !== undefined && pv !== '' && Number.isFinite(Number(pv)) && Number(pv) >= 0) {
            cleanPortalPrices[pk] = Number(pv);
          }
        }
        syncedPortalPrices = JSON.stringify(cleanPortalPrices);
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
            portal_prices_json = COALESCE(?, portal_prices_json),
            publish_channels_json = COALESCE(?, publish_channels_json),
            cover_aspect_ratio = COALESCE(?, cover_aspect_ratio),
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
          syncedPortalPrices,
          syncedPublishChannelsJson,
          syncedRatio,
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
      let resolvedSocialUrl = socialImageUrl !== undefined ? socialImageUrl : (existingArtRow ? existingArtRow.social_image_url : '');

      if (oldRawToClean) {
        const cleanedRaw = await deleteUnusedR2Images(env, [oldRawToClean]);
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
            const uploadedUrl = await uploadDataImageWithThumb(env, entry, thumbCandidate, folder, idx === 0 ? 'cover' : 'detail');
            if (uploadedUrl) {
              if (idx === 0) uploadedNewCover = true;
              if (socialImageUrl === entry) resolvedSocialUrl = uploadedUrl;
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
          const cleanedRemoved = await deleteUnusedR2Images(env, removedUrls);
          deletedKeys.push(...cleanedRemoved);
        }
      }

      if (socialImageUrl !== undefined) {
        const safeSocial = (typeof resolvedSocialUrl === 'string' && !resolvedSocialUrl.startsWith('data:')) ? resolvedSocialUrl : '';
        await env.DB.prepare(`UPDATE artworks SET social_image_url = ? WHERE id = ?`)
          .bind(safeSocial, id)
          .run();
        if (existingArtRow && existingArtRow.social_image_url && existingArtRow.social_image_url !== safeSocial) {
          const cleanedSoc = await deleteUnusedR2Images(env, [existingArtRow.social_image_url]);
          deletedKeys.push(...cleanedSoc);
        }
        resolvedSocialUrl = safeSocial;
      }

      const respPayload = {
        success: true,
        id,
        priceEur: syncedPrice,
        socialImageUrl: resolvedSocialUrl || '',
        deletedFiles: deletedKeys.length,
      };
      if (syncedPortalPrices) respPayload.portalPrices = parseJsonSafe(syncedPortalPrices, {});
      if (syncedWidth) respPayload.widthCm = syncedWidth;
      if (syncedHeight) respPayload.heightCm = syncedHeight;
      if (syncedDepth) respPayload.depthCm = syncedDepth;
      if (syncedDimensions) respPayload.dimensions = syncedDimensions;
      if (syncedRatio) respPayload.coverAspectRatio = syncedRatio;
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

  // DELETE /api/artworks/:id (Authenticated)
  if (pathname.startsWith('/api/artworks/') && request.method === 'DELETE') {
    try {
      const session = await getAuthSession(env, request);
      if (!session.authenticated) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      await ensureAutomationSchema(env);

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
      if (artRow && artRow.cover_image) candidateUrls.push(artRow.cover_image);
      if (artRow && artRow.raw_image) candidateUrls.push(artRow.raw_image);
      if (artRow && artRow.social_image_url) candidateUrls.push(artRow.social_image_url);

      await env.DB.batch([
        env.DB.prepare(`DELETE FROM artwork_images WHERE artwork_id = ?`).bind(id),
        env.DB.prepare(`DELETE FROM artworks WHERE id = ?`).bind(id),
      ]);

      const deletedKeys = await deleteUnusedR2Images(env, candidateUrls);

      return jsonResponse({
        success: true,
        id,
        deletedFiles: deletedKeys.length,
      });
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  return null;
}
