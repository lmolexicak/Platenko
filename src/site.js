import { jsonResponse, getAuthSession, toAbsoluteUrl, escapeHtml, parseCookies, PUBLIC_API_CACHE_CONTROL } from './utils.js';

let siteSchemaReady = false;

export const DEFAULT_SITE_SETTINGS = {
  brandTitle: 'Plátenko',
  brandSubtitle: 'Originálne maľby na plátne',
  heroTitle: 'Originálne maľby na plátne',
  heroSubtitle: 'Tekutý akryl, holandský pour, jemné prechody airbrushom a detailné textúry od Plátenko.',
  aboutHeading: 'O tvorbe',
  aboutText: 'Každé plátno je spojením organickej tekutosti a vedomého zásahu. Akrylové liatie necháva pigmenty prirodzene reagovať a vytvárať jedinečné bunky a štruktúry, zatiaľ čo airbrush a štetec dopĺňajú hĺbku, svetlo a kontrast.',
  aboutCustomOrder: 'Máte predstavu o farebnej palete, rozmere alebo technike do svojho interiéru? Zákazková tvorba je možná po dohode.',
  aboutShipping: 'Každé dielo na napnutom plátne je ošetrené UV ochranným lakom a bezpečne zabalené pre doručenie.',
  instagramHandle: '@platenko.akryl',
  instagramUrl: 'https://www.instagram.com/platenko.akryl',
  contactEmail: '',
  defaultHashtags: '#platenko #akrylnaplatne #abstraktneumenie #slovenskeumenie #originalmalba #fluidart #dutchpour #interierovydizajn',
  footerText: '© 2026 Plátenko. Všetky práva vyhradené. Originálne diela @platenko.akryl',
};

const ALLOWED_SETTING_KEYS = Object.keys(DEFAULT_SITE_SETTINGS);

export const ensureSiteSchema = async (env) => {
  if (siteSchemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT ''
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS inquiries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artwork_id TEXT DEFAULT '',
        artwork_title TEXT DEFAULT '',
        sender_name TEXT NOT NULL,
        sender_contact TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        created_at TEXT NOT NULL,
        sender_ip TEXT DEFAULT ''
      )
    `),
  ]);
  try {
    await env.DB.prepare(`ALTER TABLE inquiries ADD COLUMN sender_ip TEXT DEFAULT ''`).run();
  } catch (err) {
    if (!/duplicate column/i.test(String(err && err.message))) throw err;
  }
  siteSchemaReady = true;
};

export const getSiteSettings = async (env) => {
  await ensureSiteSchema(env);
  const { results } = await env.DB.prepare(`SELECT key, value FROM site_settings`).all();
  const merged = { ...DEFAULT_SITE_SETTINGS };
  for (const row of results || []) {
    if (row && ALLOWED_SETTING_KEYS.includes(row.key) && typeof row.value === 'string') {
      merged[row.key] = row.value;
    }
  }
  return merged;
};

export async function serveIndexWithDynamicOG(request, env, url) {
  const assetResp = await env.ASSETS.fetch(request);
  const ct = assetResp.headers.get('Content-Type') || '';
  if (!assetResp.ok || !ct.includes('text/html')) {
    return assetResp;
  }

  try {
    const settings = await getSiteSettings(env);
    const dieloId = (url.searchParams.get('dielo') || '').trim();
    let art = null;

    if (dieloId) {
      art = await env.DB.prepare(
        `SELECT id, title, dimensions, medium, description, cover_image, social_image_url, cover_aspect_ratio FROM artworks WHERE id = ?`
      )
        .bind(dieloId)
        .first();
    }

    const brand = settings.brandTitle || 'Plátenko';
    const defaultTitle = `${brand} | ${settings.brandSubtitle || 'Abstraktné akrylové maľby na plátne'}`;
    const defaultDesc = settings.heroSubtitle || DEFAULT_SITE_SETTINGS.heroSubtitle;

    const buildOgImageUrl = (rawImg) => {
      const abs = toAbsoluteUrl(url.origin, rawImg);
      if (!abs) return '';
      try {
        const parsed = new URL(abs);
        if (
          parsed.origin === url.origin &&
          (parsed.pathname.startsWith('/images/paintings/') || parsed.pathname.startsWith('/paintings/'))
        ) {
          parsed.searchParams.set('size', 'thumb');
        }
        return parsed.toString();
      } catch {
        return abs;
      }
    };

    let pageTitle = defaultTitle;
    let pageDesc = defaultDesc;
    let ogTitle = defaultTitle;
    let ogDesc = defaultDesc;
    let ogImage = `${url.origin}/images/logo_only_IG_transparent.png`;
    let ogImgWidth = 512;
    let ogImgHeight = 512;
    let ogImgAlt = `${brand} — ${settings.brandSubtitle || 'Originálne maľby na plátne'}`;
    let ogUrl = `${url.origin}/`;

    if (art) {
      const dims = art.dimensions || 'originál na plátne';
      const medium = art.medium || 'Akryl na plátne';
      pageTitle = `${art.title} | ${brand}`;
      const rawDesc = (art.description || '').trim();
      pageDesc = rawDesc
        ? `${dims} · ${medium} — ${rawDesc.slice(0, 170)}`
        : `Originálna maľba „${art.title}“ (${dims}, ${medium}) od ${brand}.`;
      ogTitle = `${art.title} (${dims}) · ${brand}`;
      ogDesc = pageDesc;
      const preferredImg = (art.social_image_url || art.cover_image || '').trim();
      if (preferredImg) {
        const resolvedImg = buildOgImageUrl(preferredImg);
        if (resolvedImg) ogImage = resolvedImg;
      }
      const ratio = Number(art.cover_aspect_ratio);
      if (Number.isFinite(ratio) && ratio > 0) {
        if (ratio >= 1) {
          ogImgWidth = 800;
          ogImgHeight = Math.max(1, Math.round(800 / ratio));
        } else {
          ogImgWidth = Math.max(1, Math.round(800 * ratio));
          ogImgHeight = 800;
        }
      } else {
        ogImgWidth = 800;
        ogImgHeight = 800;
      }
      ogImgAlt = `${art.title} — ${dims} (${brand})`;
      ogUrl = `${url.origin}/?dielo=${encodeURIComponent(art.id)}`;
    }

    const ogTagsHtml = `
  <link rel="canonical" href="${escapeHtml(ogUrl)}">
  <meta property="og:type" content="${art ? 'article' : 'website'}">
  <meta property="og:site_name" content="${escapeHtml(brand)}">
  <meta property="og:title" content="${escapeHtml(ogTitle)}">
  <meta property="og:description" content="${escapeHtml(ogDesc)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:image:width" content="${ogImgWidth}">
  <meta property="og:image:height" content="${ogImgHeight}">
  <meta property="og:image:alt" content="${escapeHtml(ogImgAlt)}">
  <meta property="og:url" content="${escapeHtml(ogUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}">
  <meta name="twitter:description" content="${escapeHtml(ogDesc)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
  <meta name="twitter:image:alt" content="${escapeHtml(ogImgAlt)}">`;

    const rewritten = new HTMLRewriter()
      .on('title', {
        element(el) {
          el.setInnerContent(pageTitle);
        },
      })
      .on('meta[name="description"]', {
        element(el) {
          el.setAttribute('content', pageDesc);
        },
      })
      .on('head', {
        element(el) {
          el.append(ogTagsHtml, { html: true });
        },
      })
      .transform(assetResp);

    const headers = new Headers(rewritten.headers);
    if (!ct.toLowerCase().includes('charset=')) {
      headers.set('Content-Type', 'text/html; charset=utf-8');
    }
    headers.set('Cache-Control', 'public, max-age=60');
    return new Response(rewritten.body, {
      status: rewritten.status,
      headers,
    });
  } catch {
    return assetResp;
  }
}

export async function handleSiteRequest(request, env, url, pathname, ctx) {
  // GET /api/site-settings (Public)
  if (pathname === '/api/site-settings' && request.method === 'GET') {
    try {
      const settings = await getSiteSettings(env);
      const hasAdminCookie = Boolean(parseCookies(request).platenko_session);
      const cacheHeaders = hasAdminCookie
        ? {}
        : { 'Cache-Control': PUBLIC_API_CACHE_CONTROL, 'Vary': 'Cookie' };
      return jsonResponse(settings, 200, cacheHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // PUT /api/site-settings (Authenticated)
  if (pathname === '/api/site-settings' && request.method === 'PUT') {
    try {
      const session = await getAuthSession(env, request);
      if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
      await ensureSiteSchema(env);

      const body = await request.json().catch(() => ({}));
      const nowIso = new Date().toISOString();
      const stmts = [];

      for (const key of ALLOWED_SETTING_KEYS) {
        if (body[key] !== undefined && typeof body[key] === 'string') {
          stmts.push(
            env.DB.prepare(`
              INSERT INTO site_settings (key, value, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            `).bind(key, body[key].trim(), nowIso)
          );
        }
      }

      if (stmts.length > 0) {
        await env.DB.batch(stmts);
      }

      const fresh = await getSiteSettings(env);
      return jsonResponse({ success: true, settings: fresh });
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // POST /api/inquiry (Public)
  if (pathname === '/api/inquiry' && request.method === 'POST') {
    try {
      await ensureSiteSchema(env);
      const body = await request.json().catch(() => ({}));

      // Honeypot anti-spam check
      if (typeof body.website === 'string' && body.website.trim().length > 0) {
        return jsonResponse({ success: true, id: null }, 201);
      }

      const senderName = typeof body.senderName === 'string' ? body.senderName.trim() : '';
      const senderContact = typeof body.senderContact === 'string' ? body.senderContact.trim() : '';
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      const artworkId = (typeof body.artworkId === 'string' ? body.artworkId.trim() : '').slice(0, 120);
      const artworkTitle = (typeof body.artworkTitle === 'string' ? body.artworkTitle.trim() : '').slice(0, 200);

      if (!senderName) {
        return jsonResponse({ error: 'Zadaj prosím svoje meno.' }, 400);
      }
      if (senderName.length > 120) {
        return jsonResponse({ error: 'Meno je príliš dlhé (max 120 znakov).' }, 400);
      }
      if (!senderContact) {
        return jsonResponse({ error: 'Zadaj prosím svoj e-mail alebo telefón.' }, 400);
      }
      if (senderContact.length > 160) {
        return jsonResponse({ error: 'Kontakt je príliš dlhý (max 160 znakov).' }, 400);
      }
      const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderContact);
      const digitCount = (senderContact.match(/\d/g) || []).length;
      if (!isValidEmail && digitCount < 6) {
        return jsonResponse({ error: 'Zadaj prosím platný e-mail alebo telefónne číslo.' }, 400);
      }
      if (message.length < 5) {
        return jsonResponse({ error: 'Správa musí mať aspoň 5 znakov.' }, 400);
      }
      if (message.length > 4000) {
        return jsonResponse({ error: 'Správa je príliš dlhá (max 4000 znakov).' }, 400);
      }

      const senderIp = (
        request.headers.get('CF-Connecting-IP') ||
        (request.headers.get('X-Forwarded-For') || '').split(',')[0] ||
        ''
      ).trim().slice(0, 64);

      if (senderIp) {
        const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const rateRow = await env.DB.prepare(
          `SELECT COUNT(*) AS cnt FROM inquiries WHERE sender_ip = ? AND created_at > ?`
        )
          .bind(senderIp, windowStart)
          .first();
        if (rateRow && Number(rateRow.cnt) >= 5) {
          return jsonResponse({ error: 'Príliš veľa dopytov za krátky čas. Skúste to prosím neskôr.' }, 429);
        }
      }

      const createdAt = new Date().toISOString();
      const res = await env.DB.prepare(`
        INSERT INTO inquiries (artwork_id, artwork_title, sender_name, sender_contact, message, status, created_at, sender_ip)
        VALUES (?, ?, ?, ?, ?, 'new', ?, ?)
      `)
        .bind(artworkId, artworkTitle, senderName, senderContact, message, createdAt, senderIp)
        .run();

      const insertedId = res && res.meta ? res.meta.last_row_id : null;

      // Optional non-blocking webhook notification (e.g. Telegram/Discord/Make)
      if (env.INQUIRY_WEBHOOK_URL && String(env.INQUIRY_WEBHOOK_URL).trim()) {
        const webhookReq = fetch(String(env.INQUIRY_WEBHOOK_URL).trim(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
          body: JSON.stringify({
            id: insertedId,
            artworkId,
            artworkTitle,
            senderName,
            senderContact,
            message,
            createdAt,
            url: artworkId ? `${url.origin}/?dielo=${encodeURIComponent(artworkId)}` : url.origin,
          }),
        }).catch(() => {});
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(webhookReq);
        }
      }

      return jsonResponse({ success: true, id: insertedId }, 201);
    } catch (err) {
      console.error('POST /api/inquiry failed:', err);
      return jsonResponse({ error: 'Dopyt sa nepodarilo odoslať.' }, 500);
    }
  }

  // GET /api/inquiries (Authenticated)
  if (pathname === '/api/inquiries' && request.method === 'GET') {
    try {
      const session = await getAuthSession(env, request);
      if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
      await ensureSiteSchema(env);

      const { results } = await env.DB.prepare(
        `SELECT * FROM inquiries ORDER BY id DESC LIMIT 200`
      ).all();

      const inquiries = (results || []).map((r) => ({
        id: r.id,
        artworkId: r.artwork_id || '',
        artworkTitle: r.artwork_title || '',
        senderName: r.sender_name,
        senderContact: r.sender_contact,
        message: r.message,
        status: r.status || 'new',
        createdAt: r.created_at || '',
      }));
      const unreadCount = inquiries.filter((x) => x.status === 'new').length;
      return jsonResponse({ inquiries, unreadCount });
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // PATCH /api/inquiries/:id (Authenticated)
  if (pathname.startsWith('/api/inquiries/') && request.method === 'PATCH') {
    try {
      const session = await getAuthSession(env, request);
      if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
      await ensureSiteSchema(env);

      const id = Number(decodeURIComponent(pathname.substring('/api/inquiries/'.length)));
      if (!Number.isFinite(id) || id <= 0) {
        return jsonResponse({ error: 'Neplatné ID dopytu.' }, 400);
      }

      const body = await request.json().catch(() => ({}));
      const allowed = ['new', 'replied', 'archived'];
      const status = allowed.includes(body.status) ? body.status : null;
      if (!status) {
        return jsonResponse({ error: 'Neplatný stav dopytu.' }, 400);
      }

      await env.DB.prepare(`UPDATE inquiries SET status = ? WHERE id = ?`).bind(status, id).run();
      return jsonResponse({ success: true, id, status });
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // DELETE /api/inquiries/:id (Authenticated)
  if (pathname.startsWith('/api/inquiries/') && request.method === 'DELETE') {
    try {
      const session = await getAuthSession(env, request);
      if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
      await ensureSiteSchema(env);

      const id = Number(decodeURIComponent(pathname.substring('/api/inquiries/'.length)));
      if (!Number.isFinite(id) || id <= 0) {
        return jsonResponse({ error: 'Neplatné ID dopytu.' }, 400);
      }

      await env.DB.prepare(`DELETE FROM inquiries WHERE id = ?`).bind(id).run();
      return jsonResponse({ success: true, id });
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  return null;
}
