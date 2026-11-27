import {
  jsonResponse,
  isAuthorizedForAutomation,
  urlToR2Key,
  toAsciiSlug,
  toAsciiFilename,
  escapeHtml,
} from './utils.js';

const KNOWN_REF_COLS = new Set([
  'artworks.id',
  'artworks.folder_name',
  'artworks.cover_image',
  'artworks.raw_image',
  'artworks.social_image_url',
  'artworks.instagram_url',
  'artwork_images.artwork_id',
  'artwork_images.image_url',
  'inquiries.artwork_id',
]);

const IGNORED_REF_TABLES = new Set([
  'ascii_migration_log',
  'site_settings',
  'automation_channels',
  'automation_integrations',
]);

export const isCleanAsciiSlug = (val) => /^[a-z0-9-]+$/.test(String(val || ''));

export const toAsciiR2Key = (r2Key) => {
  const clean = String(r2Key || '').replace(/^\/+/, '');
  if (!clean.startsWith('paintings/')) return clean;
  const parts = clean.split('/').filter(Boolean);
  if (parts.length < 2) return clean;
  const file = parts[parts.length - 1];
  const midFolders = parts.slice(1, -1).map((seg) => toAsciiSlug(seg) || 'folder');
  const safeFile = toAsciiFilename(file, 'image');
  return ['paintings', ...midFolders, safeFile].join('/');
};

const mapUrlToAscii = (rawUrl) => {
  const oldUrl = typeof rawUrl === 'string' ? rawUrl : '';
  if (!oldUrl) {
    return { oldUrl: '', newUrl: '', oldKey: null, newKey: null, changed: false };
  }
  const oldKey = urlToR2Key(oldUrl);
  if (!oldKey) {
    return { oldUrl, newUrl: oldUrl, oldKey: null, newKey: null, changed: false };
  }
  const newKey = toAsciiR2Key(oldKey);
  const changed = oldKey !== newKey;
  return {
    oldUrl,
    newUrl: changed ? `images/${newKey}` : oldUrl,
    oldKey,
    newKey,
    changed,
  };
};

const computeTargetArtworkId = (art) => {
  const rawId = String(art.id || '');
  if (isCleanAsciiSlug(rawId)) return rawId;
  const rawBase = rawId.replace(/^art-/i, '');
  const fallback = toAsciiSlug(`${art.date_created || ''}-${art.title || 'malba'}`) || 'malba';
  const slug = toAsciiSlug(rawBase) || fallback;
  return `art-${slug}`;
};

const computeTargetFolder = (art, targetId) => {
  const rawFolder = String(art.folder_name || '');
  if (rawFolder && isCleanAsciiSlug(rawFolder)) return rawFolder;
  const fallback = targetId.replace(/^art-/, '');
  return toAsciiSlug(rawFolder || fallback) || fallback;
};

const inspectD1Schema = async (env) => {
  const { results: tableRows } = await env.DB.prepare(
    `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`
  ).all();

  const tables = [];
  const tableColumns = {};
  const detectedRefColumns = [];
  const unexpectedRefColumns = [];
  let hasInquiriesTable = false;

  for (const row of tableRows || []) {
    const name = String(row.name || '');
    if (!/^[a-zA-Z0-9_]+$/.test(name)) continue;
    if (name === 'inquiries') hasInquiriesTable = true;

    const { results: cols } = await env.DB.prepare(`PRAGMA table_info("${name}")`).all();
    const colNames = (cols || []).map((c) => String(c.name));
    tableColumns[name] = colNames;
    tables.push({
      name,
      columns: (cols || []).map((c) => ({
        name: c.name,
        type: c.type || '',
        pk: c.pk === 1,
        notnull: c.notnull === 1,
      })),
    });

    for (const col of colNames) {
      const refKey = `${name}.${col}`;
      const looksLikeRef = /(artwork_id|folder|image|url|thumb|path)/i.test(col) || refKey === 'artworks.id';
      if (!looksLikeRef) continue;
      detectedRefColumns.push(refKey);
      if (!IGNORED_REF_TABLES.has(name) && !KNOWN_REF_COLS.has(refKey)) {
        unexpectedRefColumns.push(refKey);
      }
    }
  }

  return {
    tables,
    tableColumns,
    detectedRefColumns,
    unexpectedRefColumns,
    hasInquiriesTable,
  };
};

const listAllR2Keys = async (env) => {
  const r2Map = new Map();
  let cursor;
  do {
    const listed = await env.IMAGES.list(cursor ? { cursor, limit: 1000 } : { limit: 1000 });
    for (const obj of listed.objects || []) {
      r2Map.set(obj.key, { size: obj.size, etag: obj.etag || '' });
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return r2Map;
};

const ensureMigrationLogTable = async (env) => {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ascii_migration_log (
      old_r2_key TEXT PRIMARY KEY,
      new_r2_key TEXT NOT NULL,
      has_thumb INTEGER DEFAULT 0,
      artwork_old_id TEXT DEFAULT '',
      artwork_new_id TEXT DEFAULT '',
      migrated_at TEXT NOT NULL,
      cleaned_at TEXT DEFAULT ''
    )
  `).run();
};

const buildMigrationPlan = async (env) => {
  const [schema, artRes, imgRes, r2Map] = await Promise.all([
    inspectD1Schema(env),
    env.DB.prepare(`SELECT * FROM artworks ORDER BY sort_order ASC, date_created DESC, id DESC`).all(),
    env.DB.prepare(`SELECT id, artwork_id, image_url, is_cover, sort_order FROM artwork_images ORDER BY artwork_id, sort_order ASC, id ASC`).all(),
    listAllR2Keys(env),
  ]);

  const artworks = artRes.results || [];
  const artworkImages = imgRes.results || [];

  const inquiryCountByArtId = new Map();
  if (schema.hasInquiriesTable) {
    const { results: inqRows } = await env.DB.prepare(`SELECT id, artwork_id FROM inquiries`).all();
    for (const r of inqRows || []) {
      if (r.artwork_id) {
        inquiryCountByArtId.set(r.artwork_id, (inquiryCountByArtId.get(r.artwork_id) || 0) + 1);
      }
    }
  }

  const logByOldKey = new Map();
  try {
    const { results: logRows } = await env.DB.prepare(
      `SELECT old_r2_key, new_r2_key, has_thumb, migrated_at, cleaned_at FROM ascii_migration_log`
    ).all();
    for (const r of logRows || []) {
      logByOldKey.set(r.old_r2_key, r);
    }
  } catch {
    // ascii_migration_log does not exist yet (normal during read-only dry-run)
  }

  const imagesByArtwork = new Map();
  for (const row of artworkImages) {
    if (!imagesByArtwork.has(row.artwork_id)) imagesByArtwork.set(row.artwork_id, []);
    imagesByArtwork.get(row.artwork_id).push(row);
  }

  const existingIdSet = new Set(artworks.map((a) => a.id));
  const existingFolderOwners = new Map();
  for (const a of artworks) {
    if (a.folder_name) existingFolderOwners.set(a.folder_name, a.id);
  }

  const items = [];
  const r2PairToSources = new Map(); // newKey -> Set(oldKey)
  const targetIdOwners = new Map(); // newId -> [oldId]
  const targetFolderOwners = new Map(); // newFolder -> [oldId]
  const referencedR2Keys = new Set();

  for (const art of artworks) {
    const oldId = String(art.id || '');
    const newId = computeTargetArtworkId(art);
    const idChanged = oldId !== newId;

    const oldFolder = String(art.folder_name || '');
    const newFolder = computeTargetFolder(art, newId);
    const folderChanged = oldFolder !== newFolder;

    if (!targetIdOwners.has(newId)) targetIdOwners.set(newId, []);
    targetIdOwners.get(newId).push(oldId);

    if (!targetFolderOwners.has(newFolder)) targetFolderOwners.set(newFolder, []);
    targetFolderOwners.get(newFolder).push(oldId);

    const coverMap = mapUrlToAscii(art.cover_image);
    const rawMap = mapUrlToAscii(art.raw_image);
    const socialMap = mapUrlToAscii(art.social_image_url);

    const imgRows = imagesByArtwork.get(oldId) || [];
    const mappedImgs = imgRows.map((r) => {
      const m = mapUrlToAscii(r.image_url);
      return {
        rowId: r.id,
        isCover: r.is_cover === 1,
        sortOrder: r.sort_order,
        ...m,
      };
    });

    const uniquePairMap = new Map();
    const registerUrlMap = (m) => {
      if (m.oldKey) referencedR2Keys.add(m.oldKey);
      if (!m.changed || !m.oldKey || !m.newKey) return;
      if (!r2PairToSources.has(m.newKey)) r2PairToSources.set(m.newKey, new Set());
      r2PairToSources.get(m.newKey).add(m.oldKey);

      if (!uniquePairMap.has(m.oldKey)) {
        const logged = logByOldKey.get(m.oldKey);
        uniquePairMap.set(m.oldKey, {
          oldKey: m.oldKey,
          newKey: m.newKey,
          sourceExists: r2Map.has(m.oldKey),
          hasThumb: r2Map.has(`thumbs/${m.oldKey}`),
          targetExists: r2Map.has(m.newKey),
          thumbTargetExists: r2Map.has(`thumbs/${m.newKey}`),
          alreadyLogged: Boolean(logged && logged.new_r2_key === m.newKey),
        });
      }
    };

    registerUrlMap(coverMap);
    registerUrlMap(rawMap);
    registerUrlMap(socialMap);
    mappedImgs.forEach(registerUrlMap);

    const uniqueR2Pairs = Array.from(uniquePairMap.values());
    const needsMigration = idChanged
      || folderChanged
      || coverMap.changed
      || rawMap.changed
      || socialMap.changed
      || mappedImgs.some((m) => m.changed);

    items.push({
      row: art,
      title: art.title || '',
      oldId,
      newId,
      idChanged,
      oldFolder,
      newFolder,
      folderChanged,
      inquiriesCount: inquiryCountByArtId.get(oldId) || 0,
      cover: coverMap,
      raw: rawMap,
      social: socialMap,
      artworkImages: mappedImgs,
      uniqueR2Pairs,
      needsMigration,
    });
  }

  // Collision checks
  const idCollisions = [];
  const folderCollisions = [];
  const r2Collisions = [];

  for (const item of items) {
    if (item.idChanged && existingIdSet.has(item.newId)) {
      idCollisions.push({
        type: 'existing_d1_id',
        oldId: item.oldId,
        newId: item.newId,
        message: `Cieľové ID „${item.newId}“ už v tabuľke artworks existuje.`,
      });
    }
    const ownersForId = targetIdOwners.get(item.newId) || [];
    if (ownersForId.length > 1) {
      idCollisions.push({
        type: 'duplicate_target_id',
        oldId: item.oldId,
        newId: item.newId,
        owners: ownersForId,
        message: `Viacero diel (${ownersForId.join(', ')}) sa mapuje na rovnaké ID „${item.newId}“.`,
      });
    }

    if (item.folderChanged) {
      const existingOwner = existingFolderOwners.get(item.newFolder);
      if (existingOwner && existingOwner !== item.oldId) {
        folderCollisions.push({
          type: 'existing_d1_folder',
          oldId: item.oldId,
          oldFolder: item.oldFolder,
          newFolder: item.newFolder,
          existingOwner,
          message: `Cieľový priečinok „${item.newFolder}“ už patrí dielu „${existingOwner}“.`,
        });
      }
    }
    const ownersForFolder = targetFolderOwners.get(item.newFolder) || [];
    if (ownersForFolder.length > 1) {
      folderCollisions.push({
        type: 'duplicate_target_folder',
        oldId: item.oldId,
        newFolder: item.newFolder,
        owners: ownersForFolder,
        message: `Viacero diel (${ownersForFolder.join(', ')}) sa mapuje na rovnaký priečinok „${item.newFolder}“.`,
      });
    }
  }

  const allR2Copies = [];
  const seenOldKeys = new Set();
  const missingSourceR2Keys = [];

  for (const item of items) {
    for (const pair of item.uniqueR2Pairs) {
      if (seenOldKeys.has(pair.oldKey)) continue;
      seenOldKeys.add(pair.oldKey);
      allR2Copies.push({
        artworkOldId: item.oldId,
        artworkNewId: item.newId,
        ...pair,
      });

      if (!pair.sourceExists && !pair.targetExists) {
        missingSourceR2Keys.push({
          artworkOldId: item.oldId,
          oldKey: pair.oldKey,
          newKey: pair.newKey,
        });
      }

      const sources = Array.from(r2PairToSources.get(pair.newKey) || []);
      if (sources.length > 1) {
        r2Collisions.push({
          type: 'duplicate_target_r2_key',
          newKey: pair.newKey,
          sources,
          message: `Viacero rôznych R2 objektov (${sources.join(', ')}) sa mapuje na „${pair.newKey}“.`,
        });
      } else if (pair.targetExists && !pair.alreadyLogged) {
        const oldMeta = r2Map.get(pair.oldKey);
        const newMeta = r2Map.get(pair.newKey);
        const sameSize = Boolean(pair.sourceExists && oldMeta && newMeta && oldMeta.size === newMeta.size);
        const targetReferencedInD1 = referencedR2Keys.has(pair.newKey);
        if (!sameSize || targetReferencedInD1) {
          r2Collisions.push({
            type: 'existing_r2_target',
            oldKey: pair.oldKey,
            newKey: pair.newKey,
            message: `Cieľový R2 objekt „${pair.newKey}“ už existuje bez záznamu v ascii_migration_log.`,
          });
        }
      }
    }
  }

  const orphanNonAsciiR2Keys = [];
  for (const r2Key of r2Map.keys()) {
    const baseKey = r2Key.startsWith('thumbs/') ? r2Key.slice('thumbs/'.length) : r2Key;
    if (!baseKey.startsWith('paintings/')) continue;
    if (referencedR2Keys.has(baseKey)) continue;
    const targetBase = toAsciiR2Key(baseKey);
    if (baseKey !== targetBase) {
      orphanNonAsciiR2Keys.push({
        r2Key,
        suggestedKey: r2Key.startsWith('thumbs/') ? `thumbs/${targetBase}` : targetBase,
        size: r2Map.get(r2Key).size,
      });
    }
  }

  const artworksToMigrate = items.filter((i) => i.needsMigration);
  const collisionsTotal = idCollisions.length + folderCollisions.length + r2Collisions.length;

  return {
    schema,
    r2Map,
    totalArtworks: artworks.length,
    totalArtworkImages: artworkImages.length,
    totalR2Objects: r2Map.size,
    artworksToMigrate,
    allR2Copies,
    missingSourceR2Keys,
    orphanNonAsciiR2Keys,
    collisions: {
      total: collisionsTotal,
      ids: idCollisions,
      folders: folderCollisions,
      r2Keys: r2Collisions,
    },
  };
};

const formatDryRunPayload = (plan) => ({
  mode: 'dry-run',
  readOnly: true,
  summary: {
    totalArtworks: plan.totalArtworks,
    artworksNeedingMigration: plan.artworksToMigrate.length,
    totalArtworkImages: plan.totalArtworkImages,
    totalR2Objects: plan.totalR2Objects,
    r2KeysToCopy: plan.allR2Copies.length,
    missingSourceR2Keys: plan.missingSourceR2Keys.length,
    orphanNonAsciiR2Keys: plan.orphanNonAsciiR2Keys.length,
    collisionsTotal: plan.collisions.total,
    unexpectedRefColumns: plan.schema.unexpectedRefColumns,
  },
  schema: {
    tables: plan.schema.tables,
    detectedRefColumns: plan.schema.detectedRefColumns,
    unexpectedRefColumns: plan.schema.unexpectedRefColumns,
  },
  collisions: plan.collisions,
  artworks: plan.artworksToMigrate.map((item) => ({
    title: item.title,
    oldId: item.oldId,
    newId: item.newId,
    idChanged: item.idChanged,
    oldFolder: item.oldFolder,
    newFolder: item.newFolder,
    folderChanged: item.folderChanged,
    inquiriesCount: item.inquiriesCount,
    coverChanged: item.cover.changed,
    rawChanged: item.raw.changed,
    socialChanged: item.social.changed,
    changedImagesCount: item.artworkImages.filter((m) => m.changed).length,
    r2CopyCount: item.uniqueR2Pairs.length,
  })),
  r2Copies: plan.allR2Copies,
  missingSourceR2Keys: plan.missingSourceR2Keys,
  orphanNonAsciiR2Keys: plan.orphanNonAsciiR2Keys,
});

const renderDryRunHtml = (report) => {
  const s = report.summary;
  const colBadge = s.collisionsTotal === 0
    ? '<span style="color:#16a34a;font-weight:700;">✅ 0 kolízií</span>'
    : `<span style="color:#dc2626;font-weight:700;">⚠️ ${s.collisionsTotal} kolízií</span>`;

  const artRowsHtml = report.artworks.map((a) => `
    <tr>
      <td>${escapeHtml(a.title)}</td>
      <td><code>${escapeHtml(a.oldId)}</code></td>
      <td><code>${escapeHtml(a.newId)}</code></td>
      <td><code>${escapeHtml(a.oldFolder)}</code> → <code>${escapeHtml(a.newFolder)}</code></td>
      <td>${a.changedImagesCount} fotiek · ${a.r2CopyCount} R2${a.inquiriesCount ? ` · ${a.inquiriesCount} dopytov` : ''}</td>
    </tr>
  `).join('');

  const r2RowsHtml = report.r2Copies.map((r) => `
    <tr>
      <td><code>${escapeHtml(r.oldKey)}</code></td>
      <td><code>${escapeHtml(r.newKey)}</code></td>
      <td>${r.sourceExists ? '✅' : '❌ chýba'}</td>
      <td>${r.hasThumb ? '✅' : '—'}</td>
      <td>${r.targetExists ? '✅ existuje' : '—'}</td>
    </tr>
  `).join('');

  const schemaRowsHtml = report.schema.tables.map((t) => `
    <tr>
      <td><strong>${escapeHtml(t.name)}</strong></td>
      <td><code>${escapeHtml(t.columns.map((c) => `${c.name} (${c.type || 'ANY'}${c.pk ? ', PK' : ''})`).join(', '))}</code></td>
    </tr>
  `).join('');

  const collisionListHtml = s.collisionsTotal > 0
    ? `<div style="background:#fef2f2;border:1px solid #ef4444;padding:12px 16px;border-radius:8px;margin:16px 0;color:#991b1b;">
        <strong>Nájdené kolízie (migrácia bude zablokovaná):</strong>
        <pre style="white-space:pre-wrap;font-size:12px;">${escapeHtml(JSON.stringify(report.collisions, null, 2))}</pre>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="sk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ASCII Migrácia — Dry-Run Report</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 24px auto; max-width: 1280px; padding: 0 16px; color: #18181b; background: #fafafa; }
    h1, h2 { margin-top: 24px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 16px 0; }
    .card { background: #fff; border: 1px solid #e4e4e7; border-radius: 10px; padding: 12px 14px; }
    .card .lbl { font-size: 12px; color: #71717a; display: block; }
    .card .val { font-size: 20px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e4e4e7; font-size: 13px; margin-top: 8px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #e4e4e7; text-align: left; vertical-align: top; }
    th { background: #f4f4f5; font-size: 12px; text-transform: uppercase; color: #52525b; }
    code { background: #f4f4f5; padding: 2px 5px; border-radius: 4px; font-size: 12px; word-break: break-all; }
    .topbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
    .btn { display: inline-block; padding: 8px 14px; background: #18181b; color: #fff; border-radius: 8px; text-decoration: none; font-size: 13px; }
  </style>
</head>
<body>
  <div class="topbar">
    <div>
      <h1 style="margin:0;">ASCII Migrácia (D1 + R2) — Dry-Run (len náhľad)</h1>
      <p style="margin:4px 0 0;color:#52525b;">Žiadne dáta neboli zmenené ani zmazané · ${colBadge}</p>
    </div>
    <div style="display:flex;gap:8px;">
      <a class="btn" href="?format=json">Stiahnuť / zobraziť JSON</a>
      <a class="btn" style="background:#52525b;" href="/admin">← Späť do Admin CMS</a>
    </div>
  </div>

  <div class="cards">
    <div class="card"><span class="lbl">Diel celkovo</span><span class="val">${s.totalArtworks}</span></div>
    <div class="card"><span class="lbl">Diel na migráciu</span><span class="val">${s.artworksNeedingMigration}</span></div>
    <div class="card"><span class="lbl">R2 kľúčov na kópiu</span><span class="val">${s.r2KeysToCopy}</span></div>
    <div class="card"><span class="lbl">Chýbajúce R2 zdroje</span><span class="val">${s.missingSourceR2Keys}</span></div>
    <div class="card"><span class="lbl">Nepriradené ne-ASCII R2</span><span class="val">${s.orphanNonAsciiR2Keys}</span></div>
    <div class="card"><span class="lbl">Neočakávané stĺpce D1</span><span class="val">${s.unexpectedRefColumns.length}</span></div>
  </div>

  ${collisionListHtml}

  <div id="migControlPanel" style="background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:16px;margin:16px 0;">
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;">
      <div>
        <strong style="display:block;font-size:15px;">Režim 2: Bezpečná migrácia (kopírovanie R2 + úprava D1, BEZ mazania starých R2)</strong>
        <span style="font-size:12px;color:#52525b;">Spúšťa sa po malých dávkach (batchSize=2). Staré R2 súbory zostávajú nedotknuté až do samostatného Cleanup kroku.</span>
      </div>
      <button type="button" id="runMigrateBtn" class="btn" style="border:none;background:#16a34a;font-weight:600;${(s.collisionsTotal > 0 || s.artworksNeedingMigration === 0) ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;'}" ${(s.collisionsTotal > 0 || s.artworksNeedingMigration === 0) ? 'disabled' : ''}>
        🚀 Spustiť migráciu (Režim 2: kopírovanie R2 + D1, bez mazania)
      </button>
    </div>
    <div id="migStatus" style="margin-top:10px;font-size:13px;color:#3f3f46;font-weight:500;">${s.artworksNeedingMigration === 0 ? 'Všetky diela už sú zmigrované.' : 'Pripravené na spustenie.'}</div>
    <pre id="migFinalSummary" style="display:none;margin-top:10px;padding:12px;background:#f4f4f5;border-radius:8px;font-size:12px;overflow:auto;max-height:300px;"></pre>

    <details id="cleanupDetails" style="margin-top:14px;padding-top:12px;border-top:1px solid #e4e4e7;">
      <summary style="cursor:pointer;font-size:13px;font-weight:600;color:#71717a;">🧹 Režim 3: Samostatný Cleanup starých R2 objektov (až po vizuálnej kontrole)</summary>
      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <input type="text" id="cleanupConfirmInput" placeholder="Napíš CLEANUP_OLD_R2" style="padding:7px 10px;border:1px solid #d4d4d8;border-radius:6px;font-size:13px;min-width:210px;">
        <button type="button" id="runCleanupBtn" class="btn" style="border:none;background:#dc2626;cursor:pointer;opacity:0.5;" disabled>🗑️ Zmazať staré R2 duplikáty</button>
      </div>
      <div id="cleanupStatus" style="margin-top:8px;font-size:12px;color:#52525b;"></div>
    </details>
  </div>

  <h2>1. Zistená schéma D1 databázy</h2>
  <table>
    <thead><tr><th>Tabuľka</th><th>Stĺpce</th></tr></thead>
    <tbody>${schemaRowsHtml}</tbody>
  </table>

  <h2>2. Diela na úpravu (${report.artworks.length})</h2>
  <table>
    <thead><tr><th>Názov</th><th>Staré ID</th><th>Nové ASCII ID</th><th>Priečinok</th><th>Rozsah</th></tr></thead>
    <tbody>${artRowsHtml || '<tr><td colspan="5">Všetky diela už majú čisté ASCII ID a cesty.</td></tr>'}</tbody>
  </table>

  <h2>3. R2 objekty na skopírovanie (${report.r2Copies.length})</h2>
  <table>
    <thead><tr><th>Starý R2 kľúč</th><th>Nový ASCII R2 kľúč</th><th>Zdroj v R2</th><th>Thumb</th><th>Cieľ v R2</th></tr></thead>
    <tbody>${r2RowsHtml || '<tr><td colspan="5">Žiadne R2 objekty nevyžadujú migráciu.</td></tr>'}</tbody>
  </table>

  <script>
  (function () {
    const runBtn = document.getElementById('runMigrateBtn');
    const statusEl = document.getElementById('migStatus');
    const summaryEl = document.getElementById('migFinalSummary');
    const cleanupInp = document.getElementById('cleanupConfirmInput');
    const cleanupBtn = document.getElementById('runCleanupBtn');
    const cleanupStatusEl = document.getElementById('cleanupStatus');

    if (runBtn) {
      runBtn.addEventListener('click', async () => {
        runBtn.disabled = true;
        summaryEl.style.display = 'none';
        summaryEl.textContent = '';
        let totalBatches = 0;
        let totalSucceeded = 0;
        let totalFailed = 0;
        let totalOldR2Deleted = 0;
        let lastRemaining = null;
        let done = false;
        const errors = [];

        try {
          for (let step = 1; step <= 100; step++) {
            statusEl.textContent = 'Prebieha dávka #' + step + ' (kopírujem R2 a aktualizujem D1)...';
            const res = await fetch('/api/admin/migrate-ascii', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: 'migrate', batchSize: 2 }),
            });
            const data = await res.json().catch(() => ({}));
            totalBatches++;
            if (!res.ok) {
              errors.push({ step, status: res.status, error: data.error || ('HTTP ' + res.status), details: data });
              totalFailed++;
              break;
            }
            totalSucceeded += Number(data.succeeded) || 0;
            totalFailed += Number(data.failed) || 0;
            totalOldR2Deleted += Number(data.oldR2ObjectsDeleted) || 0;
            lastRemaining = data.remaining;
            done = Boolean(data.done);
            if (Array.isArray(data.results)) {
              for (const r of data.results) {
                if (r.status === 'error') errors.push({ step, ...r });
              }
            }
            statusEl.textContent = 'Dávka #' + step + ' hotová: migrovaných ' + totalSucceeded + ', chýb ' + totalFailed + ', zostáva ' + lastRemaining + '.';
            if (totalFailed > 0 || done || Number(data.processed) === 0) break;
          }

          let postDryRunSummary = null;
          if (done && totalFailed === 0) {
            statusEl.textContent = 'Overujem stav cez dry-run...';
            const checkRes = await fetch('/api/admin/migrate-ascii?format=json');
            const checkJson = await checkRes.json().catch(() => ({}));
            postDryRunSummary = checkJson.summary || null;
          }

          const out = {
            totalBatches,
            totalSucceeded,
            totalFailed,
            totalOldR2Deleted,
            lastRemaining,
            done,
            errors,
            postDryRunSummary,
          };
          summaryEl.style.display = 'block';
          if (done && totalFailed === 0) {
            statusEl.textContent = '✅ Migrácia dokončená: ' + totalSucceeded + ' diel, 0 chýb, 0 zmazaných starých R2 objektov.';
            summaryEl.textContent = 'MIGRATE_COMPLETE\n' + JSON.stringify(out, null, 2);
          } else {
            statusEl.textContent = '⚠️ Migrácia zastavená s chybou alebo nedokončená.';
            summaryEl.textContent = 'MIGRATE_ERROR\n' + JSON.stringify(out, null, 2);
            runBtn.disabled = false;
          }
        } catch (err) {
          summaryEl.style.display = 'block';
          statusEl.textContent = '❌ Chyba behu migrácie: ' + err.message;
          summaryEl.textContent = 'MIGRATE_ERROR\n' + JSON.stringify({ message: err.message, totalBatches, totalSucceeded, totalFailed, errors }, null, 2);
          runBtn.disabled = false;
        }
      });
    }

    if (cleanupInp && cleanupBtn) {
      cleanupInp.addEventListener('input', () => {
        const ok = cleanupInp.value.trim() === 'CLEANUP_OLD_R2';
        cleanupBtn.disabled = !ok;
        cleanupBtn.style.opacity = ok ? '1' : '0.5';
      });
      cleanupBtn.addEventListener('click', async () => {
        if (cleanupInp.value.trim() !== 'CLEANUP_OLD_R2') return;
        cleanupBtn.disabled = true;
        let totalDeleted = 0;
        let totalSkipped = 0;
        try {
          for (let step = 1; step <= 30; step++) {
            cleanupStatusEl.textContent = 'Cleanup dávka #' + step + '...';
            const res = await fetch('/api/admin/migrate-ascii', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: 'cleanup', confirm: 'CLEANUP_OLD_R2', batchSize: 50 }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
            totalDeleted += Number(data.deleted) || 0;
            totalSkipped += Number(data.skipped) || 0;
            cleanupStatusEl.textContent = 'Cleanup: zmazaných ' + totalDeleted + ', preskočených ' + totalSkipped + ', zostáva ' + data.remaining + '.';
            if (data.done || Number(data.processed) === 0 || Number(data.deleted) === 0) break;
          }
        } catch (err) {
          cleanupStatusEl.textContent = '❌ Cleanup chyba: ' + err.message;
          cleanupBtn.disabled = false;
        }
      });
    }
  })();
  </script>
</body>
</html>`;
};

const runMigrateMode = async (env, batchSizeRaw) => {
  const batchSize = Math.max(1, Math.min(15, Number(batchSizeRaw) || 5));
  await ensureMigrationLogTable(env);
  const plan = await buildMigrationPlan(env);

  if (plan.collisions.total > 0) {
    return jsonResponse({
      error: 'Detegované kolízie — migrácia bola zablokovaná bez vykonania zmien.',
      mode: 'migrate',
      collisions: plan.collisions,
    }, 409);
  }

  const slice = plan.artworksToMigrate.slice(0, batchSize);
  const artColumns = plan.schema.tableColumns.artworks || [];
  const results = [];
  let succeeded = 0;
  let failed = 0;
  let processed = 0;
  let r2CopiesInRequest = 0;
  const nowIso = new Date().toISOString();

  for (const item of slice) {
    if (processed > 0 && (r2CopiesInRequest >= 16 || (r2CopiesInRequest > 0 && item.uniqueR2Pairs.length >= 12))) {
      break;
    }
    processed++;
    try {
      // 1. Copy every non-ASCII R2 object (and its thumbnail) to the new ASCII key and verify size
      for (const pair of item.uniqueR2Pairs) {
        let needCopyMain = !plan.r2Map.has(pair.newKey);
        if (!needCopyMain) {
          const existingTarget = await env.IMAGES.head(pair.newKey);
          if (!existingTarget) needCopyMain = true;
        }
        if (needCopyMain) {
          const srcObj = await env.IMAGES.get(pair.oldKey);
          if (!srcObj) {
            throw new Error(`Zdrojový objekt v R2 chýba: ${pair.oldKey}`);
          }
          const srcBuf = await srcObj.arrayBuffer();
          await env.IMAGES.put(pair.newKey, srcBuf, {
            httpMetadata: srcObj.httpMetadata,
            customMetadata: srcObj.customMetadata,
          });
          const verified = await env.IMAGES.head(pair.newKey);
          if (!verified || verified.size !== srcBuf.byteLength) {
            throw new Error(`Overenie skopírovaného R2 objektu zlyhalo: ${pair.newKey}`);
          }
          r2CopiesInRequest++;
        }

        const oldThumbKey = `thumbs/${pair.oldKey}`;
        const newThumbKey = `thumbs/${pair.newKey}`;
        if (plan.r2Map.has(oldThumbKey)) {
          let needCopyThumb = !plan.r2Map.has(newThumbKey);
          if (!needCopyThumb) {
            const existingThumb = await env.IMAGES.head(newThumbKey);
            if (!existingThumb) needCopyThumb = true;
          }
          if (needCopyThumb) {
            const srcThumb = await env.IMAGES.get(oldThumbKey);
            if (!srcThumb) {
              throw new Error(`Zdrojový thumbnail v R2 chýba: ${oldThumbKey}`);
            }
            const thumbBuf = await srcThumb.arrayBuffer();
            await env.IMAGES.put(newThumbKey, thumbBuf, {
              httpMetadata: srcThumb.httpMetadata,
              customMetadata: srcThumb.customMetadata,
            });
            const verifiedThumb = await env.IMAGES.head(newThumbKey);
            if (!verifiedThumb || verifiedThumb.size !== thumbBuf.byteLength) {
              throw new Error(`Overenie skopírovaného thumbnailu zlyhalo: ${newThumbKey}`);
            }
            r2CopiesInRequest++;
          }
        }
      }

      // 2. Atomically update D1 (artworks, artwork_images, inquiries, ascii_migration_log)
      const stmts = [];
      const nextCoverUrl = item.cover.changed ? item.cover.newUrl : item.row.cover_image;
      const nextRawUrl = item.raw.changed ? item.raw.newUrl : item.row.raw_image;
      const nextSocialUrl = item.social.changed ? item.social.newUrl : item.row.social_image_url;

      if (item.idChanged) {
        if (!item.folderChanged && item.oldFolder) {
          // Temporarily free UNIQUE folder_name before inserting row with newId
          stmts.push(
            env.DB.prepare(`UPDATE artworks SET folder_name = ? WHERE id = ?`)
              .bind(`__mig__${item.oldId}`, item.oldId)
          );
        }

        const overrides = {
          id: item.newId,
          folder_name: item.newFolder,
          cover_image: nextCoverUrl,
          raw_image: nextRawUrl,
          social_image_url: nextSocialUrl,
        };
        const colList = artColumns.join(', ');
        const placeholders = artColumns.map(() => '?').join(', ');
        const values = artColumns.map((col) =>
          Object.prototype.hasOwnProperty.call(overrides, col) ? overrides[col] : item.row[col]
        );

        stmts.push(
          env.DB.prepare(`INSERT INTO artworks (${colList}) VALUES (${placeholders})`).bind(...values)
        );
        stmts.push(
          env.DB.prepare(`UPDATE artwork_images SET artwork_id = ? WHERE artwork_id = ?`)
            .bind(item.newId, item.oldId)
        );
        for (const imgRow of item.artworkImages) {
          if (imgRow.changed) {
            stmts.push(
              env.DB.prepare(`UPDATE artwork_images SET image_url = ? WHERE id = ?`)
                .bind(imgRow.newUrl, imgRow.rowId)
            );
          }
        }
        if (plan.schema.hasInquiriesTable && item.inquiriesCount > 0) {
          stmts.push(
            env.DB.prepare(`UPDATE inquiries SET artwork_id = ? WHERE artwork_id = ?`)
              .bind(item.newId, item.oldId)
          );
        }
        stmts.push(
          env.DB.prepare(`DELETE FROM artworks WHERE id = ?`).bind(item.oldId)
        );
      } else {
        stmts.push(
          env.DB.prepare(
            `UPDATE artworks SET folder_name = ?, cover_image = ?, raw_image = ?, social_image_url = ? WHERE id = ?`
          ).bind(
            item.newFolder,
            nextCoverUrl,
            nextRawUrl,
            nextSocialUrl,
            item.oldId
          )
        );
        for (const imgRow of item.artworkImages) {
          if (imgRow.changed) {
            stmts.push(
              env.DB.prepare(`UPDATE artwork_images SET image_url = ? WHERE id = ?`)
                .bind(imgRow.newUrl, imgRow.rowId)
            );
          }
        }
      }

      for (const pair of item.uniqueR2Pairs) {
        stmts.push(
          env.DB.prepare(`
            INSERT OR IGNORE INTO ascii_migration_log
              (old_r2_key, new_r2_key, has_thumb, artwork_old_id, artwork_new_id, migrated_at, cleaned_at)
            VALUES (?, ?, ?, ?, ?, ?, '')
          `).bind(
            pair.oldKey,
            pair.newKey,
            pair.hasThumb ? 1 : 0,
            item.oldId,
            item.newId,
            nowIso
          )
        );
      }

      await env.DB.batch(stmts);
      succeeded++;
      results.push({
        oldId: item.oldId,
        newId: item.newId,
        status: 'migrated',
        copiedR2Keys: item.uniqueR2Pairs.length,
      });
    } catch (err) {
      failed++;
      results.push({
        oldId: item.oldId,
        newId: item.newId,
        status: 'error',
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  const remaining = Math.max(0, plan.artworksToMigrate.length - succeeded);
  return jsonResponse({
    mode: 'migrate',
    batchSize,
    processed,
    succeeded,
    failed,
    remaining,
    done: remaining === 0 && failed === 0,
    oldR2ObjectsDeleted: 0,
    results,
  });
};

const runCleanupMode = async (env, { confirm, batchSize: batchSizeRaw, dryRun }) => {
  const batchSize = Math.max(1, Math.min(100, Number(batchSizeRaw) || 50));

  let pendingRows = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT old_r2_key, new_r2_key, has_thumb, artwork_old_id, artwork_new_id, migrated_at FROM ascii_migration_log WHERE cleaned_at = '' ORDER BY migrated_at ASC`
    ).all();
    pendingRows = results || [];
  } catch {
    return jsonResponse({
      mode: 'cleanup',
      dryRun: true,
      pendingCount: 0,
      message: 'Tabuľka ascii_migration_log zatiaľ neexistuje (migrácia ešte neprebehla).',
      candidates: [],
    });
  }

  const [{ results: artRows }, { results: imgRows }] = await Promise.all([
    env.DB.prepare(`SELECT cover_image, raw_image, social_image_url FROM artworks`).all(),
    env.DB.prepare(`SELECT image_url FROM artwork_images`).all(),
  ]);

  const referencedR2Keys = new Set();
  const addRef = (u) => {
    const k = urlToR2Key(u);
    if (k) referencedR2Keys.add(k);
  };
  for (const r of artRows || []) {
    addRef(r.cover_image);
    addRef(r.raw_image);
    addRef(r.social_image_url);
  }
  for (const r of imgRows || []) {
    addRef(r.image_url);
  }

  const isConfirmed = confirm === 'CLEANUP_OLD_R2' && dryRun !== true;
  if (!isConfirmed) {
    return jsonResponse({
      mode: 'cleanup',
      dryRun: true,
      requiresConfirm: confirm !== 'CLEANUP_OLD_R2',
      hint: 'Pre skutočné zmazanie starých R2 objektov pošli POST s { "mode": "cleanup", "confirm": "CLEANUP_OLD_R2" }.',
      pendingCount: pendingRows.length,
      candidates: pendingRows.slice(0, batchSize).map((r) => ({
        oldKey: r.old_r2_key,
        newKey: r.new_r2_key,
        hasThumb: r.has_thumb === 1,
        stillReferencedInD1: referencedR2Keys.has(r.old_r2_key),
      })),
    });
  }

  const slice = pendingRows.slice(0, batchSize);
  let deleted = 0;
  let skipped = 0;
  const details = [];
  const nowIso = new Date().toISOString();

  for (const row of slice) {
    if (referencedR2Keys.has(row.old_r2_key)) {
      skipped++;
      details.push({ oldKey: row.old_r2_key, status: 'skipped', reason: 'still_referenced_in_d1' });
      continue;
    }
    const newHead = await env.IMAGES.head(row.new_r2_key);
    if (!newHead) {
      skipped++;
      details.push({ oldKey: row.old_r2_key, status: 'skipped', reason: 'new_r2_key_missing' });
      continue;
    }

    const keysToDelete = [row.old_r2_key];
    if (row.has_thumb === 1) {
      const newThumbHead = await env.IMAGES.head(`thumbs/${row.new_r2_key}`);
      if (newThumbHead) {
        keysToDelete.push(`thumbs/${row.old_r2_key}`);
      }
    }

    await env.IMAGES.delete(keysToDelete);
    await env.DB.prepare(`UPDATE ascii_migration_log SET cleaned_at = ? WHERE old_r2_key = ?`)
      .bind(nowIso, row.old_r2_key)
      .run();
    deleted++;
    details.push({ oldKey: row.old_r2_key, deletedKeys: keysToDelete, status: 'deleted' });
  }

  const remaining = Math.max(0, pendingRows.length - deleted);
  return jsonResponse({
    mode: 'cleanup',
    dryRun: false,
    processed: slice.length,
    deleted,
    skipped,
    remaining,
    done: remaining === 0 && skipped === 0,
    details,
  });
};

export async function handleMigrateRequest(request, env, url, pathname) {
  if (pathname !== '/api/admin/migrate-ascii') return null;

  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  const auth = await isAuthorizedForAutomation(env, request);
  if (!auth.authorized) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    if (request.method === 'GET') {
      const plan = await buildMigrationPlan(env);
      const report = formatDryRunPayload(plan);
      const fmt = (url.searchParams.get('format') || '').toLowerCase();
      const accept = request.headers.get('Accept') || '';
      const wantHtml = fmt === 'html' || (fmt !== 'json' && accept.includes('text/html'));
      if (wantHtml) {
        return new Response(renderDryRunHtml(report), {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      return jsonResponse(report);
    }

    const body = await request.json().catch(() => ({}));
    const mode = String((body && body.mode) || url.searchParams.get('mode') || 'dry-run').toLowerCase();

    if (mode === 'dry-run') {
      const plan = await buildMigrationPlan(env);
      return jsonResponse(formatDryRunPayload(plan));
    }

    if (mode === 'migrate') {
      return await runMigrateMode(env, body && body.batchSize);
    }

    if (mode === 'cleanup') {
      return await runCleanupMode(env, {
        confirm: body && body.confirm,
        batchSize: body && body.batchSize,
        dryRun: body && body.dryRun === true,
      });
    }

    return jsonResponse({ error: 'Neznámy režim. Použi dry-run, migrate alebo cleanup.' }, 400);
  } catch (err) {
    console.error('ASCII migration endpoint error:', err);
    return jsonResponse({ error: err && err.message ? err.message : 'Chyba migrácie.' }, 500);
  }
}
