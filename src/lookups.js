import { jsonResponse, getAuthSession, parseCookies, PUBLIC_API_CACHE_CONTROL } from './utils.js';

let lookupsReady = false;

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

export const ensureLookupsReady = async (env) => {
  if (lookupsReady) return;
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
  lookupsReady = true;
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

export async function handleLookupsRequest(request, env, pathname) {
  // GET /api/lookups - Public grouped lookups
  if (pathname === '/api/lookups' && request.method === 'GET') {
    try {
      await ensureLookupsReady(env);
      const { results } = await env.DB.prepare(
        `SELECT * FROM lookups ORDER BY sort_order ASC, id ASC`
      ).all();
      const all = (results || []).map(serializeLookupRow);
      const hasAdminCookie = Boolean(parseCookies(request).platenko_session);
      const cacheHeaders = hasAdminCookie
        ? {}
        : { 'Cache-Control': PUBLIC_API_CACHE_CONTROL, 'Vary': 'Cookie' };
      return jsonResponse({
        techniques: all.filter((x) => x.category === 'technique'),
        statuses: all.filter((x) => x.category === 'status'),
        mediums: all.filter((x) => x.category === 'medium'),
        dimensionPresets: all.filter((x) => x.category === 'dimension_preset'),
        all,
      }, 200, cacheHeaders);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // POST /api/lookups/reorder (Authenticated)
  if (pathname === '/api/lookups/reorder' && request.method === 'POST') {
    try {
      const session = await getAuthSession(env, request);
      if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
      await ensureLookupsReady(env);
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
      const session = await getAuthSession(env, request);
      if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
      await ensureLookupsReady(env);
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
      const session = await getAuthSession(env, request);
      if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
      await ensureLookupsReady(env);
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
      const session = await getAuthSession(env, request);
      if (!session.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
      await ensureLookupsReady(env);
      const id = Number(decodeURIComponent(pathname.substring('/api/lookups/'.length)));
      await env.DB.prepare(`DELETE FROM lookups WHERE id = ?`).bind(id).run();
      return jsonResponse({ success: true });
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  return null;
}
