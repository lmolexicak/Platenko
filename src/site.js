import { jsonResponse, getAuthSession, toAbsoluteUrl, escapeHtml } from './utils.js';

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
        created_at TEXT NOT NULL
      )
    `),
  ]);
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
        `SELECT id, title, dimensions, medium, description, cover_image FROM artworks WHERE id = ?`
      )
        .bind(dieloId)
        .first();
    }

    const brand = settings.brandTitle || 'Plátenko';
    const defaultTitle = `${brand} | ${settings.brandSubtitle || 'Abstraktné akrylové maľby na plátne'}`;
    const defaultDesc = settings.heroSubtitle || DEFAULT_SITE_SETTINGS.heroSubtitle;

    let pageTitle = defaultTitle;
    let pageDesc = defaultDesc;
    let ogTitle = defaultTitle;
    let ogDesc = defaultDesc;
    let ogImage = `${url.origin}/images/logo_only_IG_transparent.png`;
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
      if (art.cover_image) {
        ogImage = toAbsoluteUrl(url.origin, art.cover_image);
      }
      ogUrl = `${url.origin}/?dielo=${encodeURIComponent(art.id)}`;
    }

    const ogTagsHtml = `
  <meta property="og:type" content="${art ? 'article' : 'website'}">
  <meta property="og:site_name" content="${escapeHtml(brand)}">
  <meta property="og:title" content="${escapeHtml(ogTitle)}">
  <meta property="og:description" content="${escapeHtml(ogDesc)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:url" content="${escapeHtml(ogUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}">
  <meta name="twitter:description" content="${escapeHtml(ogDesc)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">`;

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
    headers.set('Cache-Control', 'public, max-age=60');
    return new Response(rewritten.body, {
      status: rewritten.status,
      headers,
    });
  } catch {
    return assetResp;
  }
}

export async function handleSiteRequest(request, env, url, pathname) {
  // GET /api/site-settings (Public)
  if (pathname === '/api/site-settings' && request.method === 'GET') {
    try {
      const settings = await getSiteSettings(env);
      return jsonResponse(settings);
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
      const senderName = typeof body.senderName === 'string' ? body.senderName.trim() : '';
      const senderContact = typeof body.senderContact === 'string' ? body.senderContact.trim() : '';
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      const artworkId = typeof body.artworkId === 'string' ? body.artworkId.trim() : '';
      const artworkTitle = typeof body.artworkTitle === 'string' ? body.artworkTitle.trim() : '';

      if (!senderName) {
        return jsonResponse({ error: 'Zadaj prosím svoje meno.' }, 400);
      }
      if (!senderContact) {
        return jsonResponse({ error: 'Zadaj prosím svoj e-mail alebo telefón.' }, 400);
      }
      if (message.length < 5) {
        return jsonResponse({ error: 'Správa musí mať aspoň 5 znakov.' }, 400);
      }
      if (message.length > 4000) {
        return jsonResponse({ error: 'Správa je príliš dlhá (max 4000 znakov).' }, 400);
      }

      const createdAt = new Date().toISOString();
      const res = await env.DB.prepare(`
        INSERT INTO inquiries (artwork_id, artwork_title, sender_name, sender_contact, message, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'new', ?)
      `)
        .bind(artworkId, artworkTitle, senderName, senderContact, message, createdAt)
        .run();

      const insertedId = res && res.meta ? res.meta.last_row_id : null;

      // Optional non-blocking webhook notification (e.g. Telegram/Discord/Make)
      if (env.INQUIRY_WEBHOOK_URL && String(env.INQUIRY_WEBHOOK_URL).trim()) {
        fetch(String(env.INQUIRY_WEBHOOK_URL).trim(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      }

      return jsonResponse({ success: true, id: insertedId }, 201);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
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
