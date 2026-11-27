// Cloudflare Worker backend for Platenko Gallery

let automationSchemaReady = false;

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

const deriveAesKey = async (secret) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(secret).trim())
  );
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

const encryptCredentials = async (obj, secret) => {
  if (!secret || !String(secret).trim()) {
    throw new Error('Chýba hlavný šifrovací kľúč AUTOMATION_ENCRYPTION_KEY v Cloudflare Secrets.');
  }
  const key = await deriveAesKey(secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plainBytes = new TextEncoder().encode(JSON.stringify(obj || {}));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
  return `v1:${bytesToHex(iv)}:${bytesToHex(new Uint8Array(cipherBuf))}`;
};

const decryptCredentials = async (payloadStr, secret) => {
  if (!payloadStr || typeof payloadStr !== 'string') return {};
  if (!secret || !String(secret).trim()) {
    throw new Error('Chýba hlavný šifrovací kľúč AUTOMATION_ENCRYPTION_KEY v Cloudflare Secrets.');
  }
  const parts = payloadStr.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Neplatný formát šifrovaných prihlasovacích údajov.');
  }
  const key = await deriveAesKey(secret);
  const iv = hexToBytes(parts[1]);
  const cipherBytes = hexToBytes(parts[2]);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
  return parseJsonSafe(new TextDecoder().decode(plainBuf), {});
};

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

const INTEGRATION_PROVIDERS = [
  {
    provider: 'meta',
    label: 'Meta (Instagram & Facebook)',
    implemented: true,
    supportsOAuthFuture: true,
    envMap: {
      accessToken: 'META_ACCESS_TOKEN',
      igUserId: 'IG_USER_ID',
      fbPageId: 'FB_PAGE_ID',
      appId: 'META_APP_ID',
      appSecret: 'META_APP_SECRET',
    },
    fields: [
      { key: 'accessToken', label: 'Meta Access Token', secret: true, placeholder: 'EAAG...' },
      { key: 'igUserId', label: 'Instagram Business User ID', secret: false, placeholder: '178414...' },
      { key: 'fbPageId', label: 'Facebook Page ID', secret: false, placeholder: '102938...' },
      { key: 'appId', label: 'Meta App ID (pre auto-obnovu tokenu)', secret: false, placeholder: 'voliteľné' },
      { key: 'appSecret', label: 'Meta App Secret (pre auto-obnovu tokenu)', secret: true, placeholder: 'voliteľné' },
    ],
  },
  {
    provider: 'aukro',
    label: 'Aukro REST API',
    implemented: true,
    supportsOAuthFuture: true,
    envMap: {
      accessToken: 'AUKRO_ACCESS_TOKEN',
      refreshToken: 'AUKRO_REFRESH_TOKEN',
      clientId: 'AUKRO_CLIENT_ID',
      clientSecret: 'AUKRO_CLIENT_SECRET',
      categoryId: 'AUKRO_DEFAULT_CATEGORY_ID',
      currency: 'AUKRO_DEFAULT_CURRENCY',
      apiBaseUrl: 'AUKRO_API_BASE_URL',
    },
    fields: [
      { key: 'accessToken', label: 'Aukro Access Token', secret: true, placeholder: 'Bearer token...' },
      { key: 'refreshToken', label: 'Aukro Refresh Token', secret: true, placeholder: 'pre auto-obnovu' },
      { key: 'clientId', label: 'Client ID', secret: false, placeholder: 'OAuth Client ID' },
      { key: 'clientSecret', label: 'Client Secret', secret: true, placeholder: 'OAuth Client Secret' },
      { key: 'categoryId', label: 'Predvolená kategória ID', secret: false, placeholder: 'napr. 100516' },
      { key: 'currency', label: 'Mena (predvolene EUR)', secret: false, placeholder: 'EUR' },
      { key: 'apiBaseUrl', label: 'API Base URL', secret: false, placeholder: 'https://api.aukro.cz/v1' },
    ],
  },
  {
    provider: 'pinterest',
    label: 'Pinterest (predpríprava)',
    implemented: false,
    supportsOAuthFuture: true,
    envMap: { accessToken: 'PINTEREST_ACCESS_TOKEN', boardId: 'PINTEREST_BOARD_ID' },
    fields: [
      { key: 'accessToken', label: 'Pinterest Access Token', secret: true, placeholder: 'pina_...' },
      { key: 'boardId', label: 'Board ID', secret: false, placeholder: 'ID nástenky' },
    ],
  },
  {
    provider: 'tiktok',
    label: 'TikTok (predpríprava)',
    implemented: false,
    supportsOAuthFuture: true,
    envMap: { accessToken: 'TIKTOK_ACCESS_TOKEN' },
    fields: [
      { key: 'accessToken', label: 'TikTok Access Token', secret: true, placeholder: 'act...' },
    ],
  },
  {
    provider: 'threads',
    label: 'Threads (predpríprava)',
    implemented: false,
    supportsOAuthFuture: true,
    envMap: { accessToken: 'THREADS_ACCESS_TOKEN', userId: 'THREADS_USER_ID' },
    fields: [
      { key: 'accessToken', label: 'Threads Access Token', secret: true, placeholder: 'THQW...' },
      { key: 'userId', label: 'Threads User ID', secret: false, placeholder: 'ID profilu' },
    ],
  },
  {
    provider: 'x',
    label: 'X / Twitter (predpríprava)',
    implemented: false,
    supportsOAuthFuture: true,
    envMap: { accessToken: 'X_ACCESS_TOKEN' },
    fields: [
      { key: 'accessToken', label: 'X Access Token', secret: true, placeholder: 'Bearer / OAuth2 token' },
    ],
  },
  {
    provider: 'etsy',
    label: 'Etsy (predpríprava)',
    implemented: false,
    supportsOAuthFuture: true,
    envMap: { apiKey: 'ETSY_API_KEY', accessToken: 'ETSY_ACCESS_TOKEN', shopId: 'ETSY_SHOP_ID' },
    fields: [
      { key: 'apiKey', label: 'Etsy API Key (keystring)', secret: true, placeholder: 'keystring' },
      { key: 'accessToken', label: 'Etsy OAuth Token', secret: true, placeholder: 'token' },
      { key: 'shopId', label: 'Etsy Shop ID', secret: false, placeholder: 'ID obchodu' },
    ],
  },
];

const ensureAutomationSchema = async (env) => {
  if (automationSchemaReady) return;
  const { results: cols } = await env.DB.prepare(`PRAGMA table_info(artworks)`).all();
  const existingCols = new Set((cols || []).map((c) => c.name));
  const alterQueries = [];
  if (!existingCols.has('price_eur')) alterQueries.push(`ALTER TABLE artworks ADD COLUMN price_eur REAL`);
  if (!existingCols.has('portal_prices_json')) alterQueries.push(`ALTER TABLE artworks ADD COLUMN portal_prices_json TEXT DEFAULT '{}'`);
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

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS automation_integrations (
      provider TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'manual',
      encrypted_credentials TEXT DEFAULT '',
      account_id TEXT DEFAULT '',
      account_name TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'disconnected',
      expires_at TEXT DEFAULT '',
      last_checked_at TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      updated_at TEXT DEFAULT ''
    )
  `).run();

  const seedChannels = DEFAULT_AUTOMATION_CHANNELS.map((ch) =>
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
  const seedIntegrations = INTEGRATION_PROVIDERS.map((p) =>
    env.DB.prepare(`
      INSERT OR IGNORE INTO automation_integrations (provider, label, auth_type, status)
      VALUES (?, ?, 'manual', 'disconnected')
    `).bind(p.provider, p.label)
  );
  await env.DB.batch([...seedChannels, ...seedIntegrations]);
  automationSchemaReady = true;
};

const getProviderMeta = (provider) => INTEGRATION_PROVIDERS.find((p) => p.provider === provider) || null;

const resolveProviderCredentials = async (env, provider) => {
  const meta = getProviderMeta(provider);
  if (!meta) return { meta: null, creds: {}, source: 'none', row: null };
  const row = await env.DB.prepare(`SELECT * FROM automation_integrations WHERE provider = ?`).bind(provider).first();

  const envCreds = {};
  Object.entries(meta.envMap || {}).forEach(([fieldKey, envKey]) => {
    const val = env[envKey];
    if (typeof val === 'string' && val.trim()) {
      envCreds[fieldKey] = val.trim();
    }
  });

  if (row && row.encrypted_credentials) {
    if (!env.AUTOMATION_ENCRYPTION_KEY) {
      return {
        meta,
        creds: envCreds,
        source: 'db_locked',
        row,
        error: 'Chýba AUTOMATION_ENCRYPTION_KEY v Cloudflare Secrets.',
      };
    }
    try {
      const dbCreds = await decryptCredentials(row.encrypted_credentials, env.AUTOMATION_ENCRYPTION_KEY);
      // Allow env defaults (like appId/appSecret or currency) if not overridden in DB
      return { meta, creds: { ...envCreds, ...dbCreds }, source: 'db', row };
    } catch (err) {
      return { meta, creds: envCreds, source: 'db_error', row, error: err.message };
    }
  }

  if (Object.keys(envCreds).length > 0) {
    return { meta, creds: envCreds, source: 'env_secret', row };
  }
  return { meta, creds: {}, source: 'none', row };
};

const sanitizeIntegrationSummary = (resolved) => {
  const { meta, creds, source, row, error } = resolved;
  const configuredFields = Object.keys(creds).filter((k) => String(creds[k] || '').trim().length > 0);
  const dbStatus = (row && row.status) || 'disconnected';
  const effectiveStatus = source === 'env_secret' && dbStatus === 'disconnected'
    ? 'configured'
    : (error ? 'error' : dbStatus);
  return {
    provider: meta.provider,
    label: meta.label,
    implemented: meta.implemented,
    authType: (row && row.auth_type) || 'manual',
    supportsOAuthFuture: meta.supportsOAuthFuture,
    connected: effectiveStatus === 'connected' || effectiveStatus === 'configured',
    source,
    status: effectiveStatus,
    accountId: (row && row.account_id) || '',
    accountName: (row && row.account_name) || '',
    expiresAt: (row && row.expires_at) || '',
    lastCheckedAt: (row && row.last_checked_at) || '',
    lastError: error || (row && row.last_error) || '',
    updatedAt: (row && row.updated_at) || '',
    configuredFields,
    fields: meta.fields.map((f) => ({
      key: f.key,
      label: f.label,
      secret: Boolean(f.secret),
      placeholder: f.placeholder || '',
      hasValue: configuredFields.includes(f.key),
    })),
  };
};

const updateIntegrationRecord = async (env, provider, fieldsObj) => {
  const entries = Object.entries(fieldsObj);
  if (entries.length === 0) return;
  const setSql = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([, v]) => v);
  await env.DB.prepare(`UPDATE automation_integrations SET ${setSql} WHERE provider = ?`)
    .bind(...vals, provider)
    .run();
};

const refreshAukroAccessToken = async (env, creds) => {
  const base = String(creds.apiBaseUrl || 'https://api.aukro.cz/v1').replace(/\/+$/, '');
  const authBasic = btoa(`${creds.clientId}:${creds.clientSecret}`);
  const resp = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authBasic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    throw new Error(data.error_description || data.message || `Aukro OAuth2 HTTP ${resp.status}`);
  }
  const expiresAt = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
    : '';
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || creds.refreshToken,
    expiresAt,
  };
};

const testProviderConnection = async (env, provider) => {
  const resolved = await resolveProviderCredentials(env, provider);
  if (!resolved.meta) throw new Error('Neznáma integrácia.');
  const { creds, source, error } = resolved;
  const nowIso = new Date().toISOString();

  if (error) {
    await updateIntegrationRecord(env, provider, { status: 'error', last_checked_at: nowIso, last_error: error });
    throw new Error(error);
  }

  try {
    if (provider === 'meta') {
      if (!creds.accessToken || !creds.igUserId || !creds.fbPageId) {
        throw new Error('Vyplň Meta Access Token, IG User ID a FB Page ID.');
      }
      const v = 'v21.0';
      const [fbResp, igResp] = await Promise.all([
        fetch(`https://graph.facebook.com/${v}/${encodeURIComponent(creds.fbPageId)}?fields=id,name&access_token=${encodeURIComponent(creds.accessToken)}`),
        fetch(`https://graph.facebook.com/${v}/${encodeURIComponent(creds.igUserId)}?fields=id,username&access_token=${encodeURIComponent(creds.accessToken)}`),
      ]);
      const fbData = await fbResp.json().catch(() => ({}));
      const igData = await igResp.json().catch(() => ({}));
      if (!fbResp.ok || fbData.error) {
        throw new Error((fbData.error && fbData.error.message) || `Facebook Page HTTP ${fbResp.status}`);
      }
      if (!igResp.ok || igData.error) {
        throw new Error((igData.error && igData.error.message) || `Instagram účet HTTP ${igResp.status}`);
      }

      let expiresAt = (resolved.row && resolved.row.expires_at) || '';
      if (creds.appId && creds.appSecret) {
        try {
          const dbgResp = await fetch(
            `https://graph.facebook.com/${v}/debug_token?input_token=${encodeURIComponent(creds.accessToken)}&access_token=${encodeURIComponent(`${creds.appId}|${creds.appSecret}`)}`
          );
          const dbgData = await dbgResp.json().catch(() => ({}));
          if (dbgResp.ok && dbgData.data && dbgData.data.expires_at) {
            expiresAt = new Date(Number(dbgData.data.expires_at) * 1000).toISOString();
          }
        } catch {}
      }

      const accountName = [igData.username ? `@${igData.username}` : '', fbData.name || ''].filter(Boolean).join(' · ');
      await updateIntegrationRecord(env, provider, {
        status: 'connected',
        account_id: String(igData.id || creds.igUserId),
        account_name: accountName || 'Meta prepojené',
        expires_at: expiresAt,
        last_checked_at: nowIso,
        last_error: '',
      });
      return { ok: true, accountName, expiresAt };
    }

    if (provider === 'aukro') {
      const base = String(creds.apiBaseUrl || 'https://api.aukro.cz/v1').replace(/\/+$/, '');
      let token = creds.accessToken;
      let expiresAt = (resolved.row && resolved.row.expires_at) || '';
      if (!token && creds.refreshToken && creds.clientId && creds.clientSecret) {
        const refreshed = await refreshAukroAccessToken(env, creds);
        token = refreshed.accessToken;
        expiresAt = refreshed.expiresAt;
        if (source === 'db' && env.AUTOMATION_ENCRYPTION_KEY) {
          const enc = await encryptCredentials({ ...creds, ...refreshed }, env.AUTOMATION_ENCRYPTION_KEY);
          await updateIntegrationRecord(env, provider, { encrypted_credentials: enc });
        }
      }
      if (!token) {
        throw new Error('Vyplň Aukro Access Token alebo OAuth2 údaje.');
      }
      let meResp = await fetch(`${base}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (meResp.status === 404) {
        meResp = await fetch(`${base}/offers?limit=1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      const meData = await meResp.json().catch(() => ({}));
      if (!meResp.ok) {
        throw new Error(meData.message || `Aukro API HTTP ${meResp.status}`);
      }
      const accountName = meData.username || meData.login || meData.email || 'Aukro účet';
      await updateIntegrationRecord(env, provider, {
        status: 'connected',
        account_id: String(meData.id || ''),
        account_name: accountName,
        expires_at: expiresAt,
        last_checked_at: nowIso,
        last_error: '',
      });
      return { ok: true, accountName, expiresAt };
    }

    // Future pre-prepared integrations: verify required fields are saved
    const missing = resolved.meta.fields
      .filter((f) => !String(creds[f.key] || '').trim())
      .map((f) => f.label);
    if (missing.length > 0) {
      throw new Error(`Chýbajú údaje: ${missing.join(', ')}`);
    }
    await updateIntegrationRecord(env, provider, {
      status: 'configured',
      account_name: 'Kľúče uložené (predpríprava)',
      last_checked_at: nowIso,
      last_error: '',
    });
    return { ok: true, accountName: 'Kľúče uložené (predpríprava)', expiresAt: '' };
  } catch (err) {
    await updateIntegrationRecord(env, provider, {
      status: 'error',
      last_checked_at: nowIso,
      last_error: err.message,
    });
    throw err;
  }
};

const refreshExpiringIntegrations = async (env, { force = false } = {}) => {
  await ensureAutomationSchema(env);
  const results = {};
  if (!env.AUTOMATION_ENCRYPTION_KEY) {
    return { skipped: true, reason: 'AUTOMATION_ENCRYPTION_KEY nie je nastavený.' };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const thresholdMs = 14 * 86400 * 1000;

  for (const provider of ['meta', 'aukro']) {
    const resolved = await resolveProviderCredentials(env, provider);
    if (resolved.source !== 'db') continue;
    const { creds, row } = resolved;
    const expMs = row && row.expires_at ? Date.parse(row.expires_at) : NaN;
    const needsRefresh = force || (Number.isFinite(expMs) && expMs - nowMs <= thresholdMs);
    if (!needsRefresh) {
      results[provider] = { status: 'ok_not_expiring', expiresAt: row.expires_at || '' };
      continue;
    }

    try {
      if (provider === 'meta') {
        if (!creds.appId || !creds.appSecret || !creds.accessToken) {
          results[provider] = { status: 'skipped_no_app_secret' };
          continue;
        }
        const exUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(creds.appId)}&client_secret=${encodeURIComponent(creds.appSecret)}&fb_exchange_token=${encodeURIComponent(creds.accessToken)}`;
        const exResp = await fetch(exUrl);
        const exData = await exResp.json().catch(() => ({}));
        if (!exResp.ok || !exData.access_token) {
          throw new Error((exData.error && exData.error.message) || `Meta obnova tokenu HTTP ${exResp.status}`);
        }
        const expiresIn = Number(exData.expires_in) || (60 * 86400);
        const nextExp = new Date(Date.now() + expiresIn * 1000).toISOString();
        const enc = await encryptCredentials({ ...creds, accessToken: exData.access_token }, env.AUTOMATION_ENCRYPTION_KEY);
        await updateIntegrationRecord(env, provider, {
          encrypted_credentials: enc,
          status: 'connected',
          expires_at: nextExp,
          last_checked_at: nowIso,
          last_error: '',
          updated_at: nowIso,
        });
        results[provider] = { status: 'refreshed', expiresAt: nextExp };
      } else if (provider === 'aukro') {
        if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
          results[provider] = { status: 'skipped_no_refresh_token' };
          continue;
        }
        const refreshed = await refreshAukroAccessToken(env, creds);
        const enc = await encryptCredentials(
          { ...creds, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken },
          env.AUTOMATION_ENCRYPTION_KEY
        );
        await updateIntegrationRecord(env, provider, {
          encrypted_credentials: enc,
          status: 'connected',
          expires_at: refreshed.expiresAt,
          last_checked_at: nowIso,
          last_error: '',
          updated_at: nowIso,
        });
        results[provider] = { status: 'refreshed', expiresAt: refreshed.expiresAt };
      }
    } catch (err) {
      await updateIntegrationRecord(env, provider, {
        status: 'error',
        last_checked_at: nowIso,
        last_error: `Obnova tokenu zlyhala: ${err.message}`,
      });
      results[provider] = { status: 'error', error: err.message };
    }
  }
  return results;
};

const buildSocialCaptionServer = (artwork, origin) => {
  const title = artwork.title || 'Originálna maľba';
  const dims = artwork.dimensions || `${artwork.widthCm || 50} × ${artwork.heightCm || 70} cm`;
  const desc = (artwork.description || '').trim();
  const deepLink = origin ? `${origin}/?dielo=${encodeURIComponent(artwork.id)}` : '';
  const lines = [title, dims];
  if (desc) lines.push('', desc);
  if (deepLink) lines.push('', deepLink);
  lines.push(
    '',
    '#platenko #akrylnaplatne #abstraktneumenie #slovenskeumenie #originalmalba #fluidart #dutchpour #interierovydizajn'
  );
  return lines.join('\n').slice(0, 2200);
};

const buildMarketplaceDescriptionServer = (artwork, origin) => {
  const dims = artwork.dimensions || `${artwork.widthCm || 50} × ${artwork.heightCm || 70} cm`;
  const depth = artwork.depthCm ? ` (hrúbka rámu ${artwork.depthCm} cm)` : '';
  const medium = artwork.medium || 'Akryl na plátne';
  const deepLink = origin ? `${origin}/?dielo=${encodeURIComponent(artwork.id)}` : '';
  return [
    artwork.description ? artwork.description.trim() : `Originálna autorská maľba „${artwork.title}“ od Plátenko Akryl.`,
    '',
    `• Rozmery: ${dims}${depth}`,
    `• Médium: ${medium}`,
    artwork.technique ? `• Technika: ${artwork.technique}` : '',
    '• Podklad: Napnuté plátno na drevenom ráme, ošetrené UV ochranným lakom.',
    deepLink ? `• 3D & AR náhľad diela: ${deepLink}` : '',
  ].filter(Boolean).join('\n');
};

const resolvePortalPrice = (artwork, portalKey) => {
  const p = artwork.portalPrices && artwork.portalPrices[portalKey];
  if (p !== null && p !== undefined && p !== '' && Number(p) > 0) {
    return Number(p);
  }
  if (artwork.priceEur !== null && artwork.priceEur !== undefined && artwork.priceEur !== '' && Number(artwork.priceEur) > 0) {
    return Number(artwork.priceEur);
  }
  return null;
};

const MAX_PUBLISH_PHOTOS = 10;

const resolveArtworkPhotoList = (artwork, origin, mode = 'social', maxPhotos = MAX_PUBLISH_PHOTOS) => {
  const albumRel = Array.isArray(artwork.detailImages) && artwork.detailImages.length > 0
    ? artwork.detailImages
    : (artwork.coverImage ? [artwork.coverImage] : []);
  const rawList = mode === 'social'
    ? [artwork.socialImageUrl, ...albumRel]
    : [artwork.coverImage, ...albumRel];
  const seen = new Set();
  const deduped = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'string') continue;
    if (seen.has(item)) continue;
    seen.add(item);
    deduped.push(item);
  }
  const limit = Math.max(1, Math.min(MAX_PUBLISH_PHOTOS, Number(maxPhotos) || MAX_PUBLISH_PHOTOS));
  const relative = deduped.slice(0, limit);
  return {
    relative,
    absolute: relative.map((u) => toAbsoluteUrl(origin, u)).filter(Boolean),
  };
};

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const pollMetaContainer = async (baseGraphUrl, containerId, accessToken, maxAttempts = 8, delayMs = 2000) => {
  for (let i = 0; i < maxAttempts; i++) {
    const stResp = await fetch(
      `${baseGraphUrl}/${encodeURIComponent(containerId)}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`
    );
    const stData = await stResp.json().catch(() => ({}));
    if (stData.status_code === 'FINISHED' || stData.status_code === 'PUBLISHED') return;
    if (stData.status_code === 'ERROR' || stData.status_code === 'EXPIRED') {
      throw new Error(`Spracovanie média zlyhalo (${stData.status_code}).`);
    }
    await sleepMs(delayMs);
  }
};

const publishToSingleChannel = async (env, origin, artwork, channelRow) => {
  const key = channelRow.key;

  if (key === 'sashe') {
    const sashePhotos = resolveArtworkPhotoList(artwork, origin, 'marketplace', MAX_PUBLISH_PHOTOS);
    return {
      status: 'pending',
      photoCount: sashePhotos.absolute.length,
      note: `Sashe.sk nemá verejné API (pripravených ${sashePhotos.absolute.length} fotiek v poradí) — spusti lokálny Playwright: cd automation && node run.js --sashe --artwork=${artwork.id}`,
    };
  }

  if (key === 'instagram' || key === 'facebook') {
    const resolved = await resolveProviderCredentials(env, 'meta');
    if (resolved.error) throw new Error(resolved.error);
    const { creds } = resolved;
    const { absolute: photoUrls } = resolveArtworkPhotoList(artwork, origin, 'social', MAX_PUBLISH_PHOTOS);
    if (photoUrls.length === 0) throw new Error('Dielo nemá vybranú fotku pre sociálne siete ani titulnú fotku.');
    const caption = buildSocialCaptionServer(artwork, origin);
    const v = 'v21.0';
    const igGraphBase = `https://graph.facebook.com/${v}`;

    if (key === 'instagram') {
      if (!creds.accessToken || !creds.igUserId) {
        throw new Error('Meta integrácia nie je nakonfigurovaná (chýba Access Token alebo IG User ID).');
      }
      let containerIdToPublish = '';

      if (photoUrls.length === 1) {
        const createResp = await fetch(`${igGraphBase}/${encodeURIComponent(creds.igUserId)}/media`, {
          method: 'POST',
          body: new URLSearchParams({
            image_url: photoUrls[0],
            caption,
            access_token: creds.accessToken,
          }),
        });
        const createData = await createResp.json().catch(() => ({}));
        if (!createResp.ok || !createData.id) {
          throw new Error((createData.error && createData.error.message) || `IG /media HTTP ${createResp.status}`);
        }
        await pollMetaContainer(igGraphBase, createData.id, creds.accessToken, 8, 2000);
        containerIdToPublish = createData.id;
      } else {
        const childIds = [];
        for (const imgUrl of photoUrls) {
          const childResp = await fetch(`${igGraphBase}/${encodeURIComponent(creds.igUserId)}/media`, {
            method: 'POST',
            body: new URLSearchParams({
              image_url: imgUrl,
              is_carousel_item: 'true',
              access_token: creds.accessToken,
            }),
          });
          const childData = await childResp.json().catch(() => ({}));
          if (!childResp.ok || !childData.id) {
            throw new Error((childData.error && childData.error.message) || `IG carousel item HTTP ${childResp.status}`);
          }
          childIds.push(childData.id);
        }
        await Promise.all(childIds.map((cid) => pollMetaContainer(igGraphBase, cid, creds.accessToken, 6, 1500)));

        const parentResp = await fetch(`${igGraphBase}/${encodeURIComponent(creds.igUserId)}/media`, {
          method: 'POST',
          body: new URLSearchParams({
            media_type: 'CAROUSEL',
            children: childIds.join(','),
            caption,
            access_token: creds.accessToken,
          }),
        });
        const parentData = await parentResp.json().catch(() => ({}));
        if (!parentResp.ok || !parentData.id) {
          throw new Error((parentData.error && parentData.error.message) || `IG carousel container HTTP ${parentResp.status}`);
        }
        await pollMetaContainer(igGraphBase, parentData.id, creds.accessToken, 8, 2000);
        containerIdToPublish = parentData.id;
      }

      const pubResp = await fetch(`${igGraphBase}/${encodeURIComponent(creds.igUserId)}/media_publish`, {
        method: 'POST',
        body: new URLSearchParams({
          creation_id: containerIdToPublish,
          access_token: creds.accessToken,
        }),
      });
      const pubData = await pubResp.json().catch(() => ({}));
      if (!pubResp.ok || !pubData.id) {
        throw new Error((pubData.error && pubData.error.message) || `IG /media_publish HTTP ${pubResp.status}`);
      }
      let permalink = '';
      try {
        const pResp = await fetch(
          `${igGraphBase}/${pubData.id}?fields=permalink&access_token=${encodeURIComponent(creds.accessToken)}`
        );
        const pData = await pResp.json().catch(() => ({}));
        if (pData && pData.permalink) permalink = pData.permalink;
      } catch {}
      return {
        status: 'published',
        externalId: String(pubData.id),
        url: permalink,
        photoCount: photoUrls.length,
        note: photoUrls.length > 1 ? `Instagram Carousel (${photoUrls.length} fotiek)` : 'Instagram (1 fotka)',
      };
    }

    if (!creds.accessToken || !creds.fbPageId) {
      throw new Error('Meta integrácia nie je nakonfigurovaná (chýba Access Token alebo FB Page ID).');
    }
    if (photoUrls.length === 1) {
      const fbResp = await fetch(`${igGraphBase}/${encodeURIComponent(creds.fbPageId)}/photos`, {
        method: 'POST',
        body: new URLSearchParams({
          url: photoUrls[0],
          message: caption,
          access_token: creds.accessToken,
        }),
      });
      const fbData = await fbResp.json().catch(() => ({}));
      if (!fbResp.ok || (!fbData.id && !fbData.post_id)) {
        throw new Error((fbData.error && fbData.error.message) || `FB /photos HTTP ${fbResp.status}`);
      }
      const postId = String(fbData.post_id || fbData.id);
      return {
        status: 'published',
        externalId: postId,
        url: `https://www.facebook.com/${postId.replace('_', '/posts/')}`,
        photoCount: 1,
        note: 'Facebook (1 fotka)',
      };
    }

    const mediaFbIds = [];
    for (const imgUrl of photoUrls) {
      const upResp = await fetch(`${igGraphBase}/${encodeURIComponent(creds.fbPageId)}/photos`, {
        method: 'POST',
        body: new URLSearchParams({
          url: imgUrl,
          published: 'false',
          access_token: creds.accessToken,
        }),
      });
      const upData = await upResp.json().catch(() => ({}));
      if (!upResp.ok || !upData.id) {
        throw new Error((upData.error && upData.error.message) || `FB multi-upload HTTP ${upResp.status}`);
      }
      mediaFbIds.push(String(upData.id));
    }

    const feedParams = new URLSearchParams({
      message: caption,
      access_token: creds.accessToken,
    });
    mediaFbIds.forEach((fid, idx) => {
      feedParams.append(`attached_media[${idx}]`, JSON.stringify({ media_fbid: fid }));
    });
    const feedResp = await fetch(`${igGraphBase}/${encodeURIComponent(creds.fbPageId)}/feed`, {
      method: 'POST',
      body: feedParams,
    });
    const feedData = await feedResp.json().catch(() => ({}));
    if (!feedResp.ok || !feedData.id) {
      throw new Error((feedData.error && feedData.error.message) || `FB /feed HTTP ${feedResp.status}`);
    }
    const postId = String(feedData.id);
    return {
      status: 'published',
      externalId: postId,
      url: `https://www.facebook.com/${postId.replace('_', '/posts/')}`,
      photoCount: photoUrls.length,
      note: `Facebook galéria (${photoUrls.length} fotiek)`,
    };
  }

  if (key === 'aukro') {
    const resolved = await resolveProviderCredentials(env, 'aukro');
    if (resolved.error) throw new Error(resolved.error);
    const { creds, source } = resolved;
    const price = resolvePortalPrice(artwork, 'aukro');
    if (!(price > 0)) {
      throw new Error('Dielo nemá zadanú cenu pre Aukro (ani základnú cenu €).');
    }
    const base = String(creds.apiBaseUrl || 'https://api.aukro.cz/v1').replace(/\/+$/, '');
    let token = creds.accessToken;
    if (!token && creds.refreshToken && creds.clientId && creds.clientSecret) {
      const refreshed = await refreshAukroAccessToken(env, creds);
      token = refreshed.accessToken;
      if (source === 'db' && env.AUTOMATION_ENCRYPTION_KEY) {
        const enc = await encryptCredentials({ ...creds, ...refreshed }, env.AUTOMATION_ENCRYPTION_KEY);
        await updateIntegrationRecord(env, 'aukro', { encrypted_credentials: enc, expires_at: refreshed.expiresAt });
      }
    }
    if (!token) {
      throw new Error('Aukro integrácia nie je nakonfigurovaná (chýba Access Token).');
    }

    const { relative: photoRels } = resolveArtworkPhotoList(artwork, origin, 'marketplace', MAX_PUBLISH_PHOTOS);
    if (photoRels.length === 0) throw new Error('Dielo nemá žiadnu fotku pre Aukro.');

    const uploadedImages = [];
    for (const rel of photoRels) {
      const r2Key = urlToR2Key(rel);
      const obj = r2Key ? await env.IMAGES.get(r2Key) : null;
      if (!obj) continue;
      const imgBuf = await obj.arrayBuffer();
      const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg';
      const imgResp = await fetch(`${base}/offers/images`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': ct,
        },
        body: imgBuf,
      });
      const imgData = await imgResp.json().catch(() => ({}));
      if (!imgResp.ok) {
        throw new Error(imgData.message || `Aukro upload obrázka HTTP ${imgResp.status}`);
      }
      if (imgData.url) uploadedImages.push({ url: imgData.url });
      else if (imgData.id) uploadedImages.push({ id: imgData.id });
    }
    if (uploadedImages.length === 0) {
      throw new Error('Žiadnu fotku sa nepodarilo načítať z R2 pre Aukro.');
    }

    const asDraft = !channelRow.autoPublish;
    const payload = {
      name: String(artwork.title || 'Originálna akrylová maľba').slice(0, 75),
      description: buildMarketplaceDescriptionServer(artwork, origin),
      categoryId: creds.categoryId ? Number(creds.categoryId) : undefined,
      price: {
        amount: price,
        currency: creds.currency || 'EUR',
      },
      images: uploadedImages,
      active: !asDraft,
    };
    const offerResp = await fetch(`${base}/offers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const offerData = await offerResp.json().catch(() => ({}));
    if (!offerResp.ok || !offerData.id) {
      throw new Error(offerData.message || `Aukro vytvorenie ponuky HTTP ${offerResp.status}`);
    }
    return {
      status: asDraft ? 'drafted' : 'published',
      externalId: String(offerData.id),
      url: offerData.url || '',
      photoCount: uploadedImages.length,
      note: `Aukro (${uploadedImages.length} fotiek)`,
    };
  }

  if (key === 'threads') {
    const { absolute: photoUrls } = resolveArtworkPhotoList(artwork, origin, 'social', MAX_PUBLISH_PHOTOS);
    const resolved = await resolveProviderCredentials(env, 'threads');
    if (resolved.error) throw new Error(resolved.error);
    const { creds } = resolved;
    if (!creds.accessToken || !creds.userId) {
      return {
        status: 'pending',
        photoCount: photoUrls.length,
        note: `Threads je pripravené pre multi-foto (${photoUrls.length}/${MAX_PUBLISH_PHOTOS} fotiek) — doplň API kľúče v 🔑 Integrácie & Kľúče.`,
      };
    }
    if (photoUrls.length === 0) throw new Error('Dielo nemá fotku pre Threads.');
    const caption = buildSocialCaptionServer(artwork, origin).slice(0, 500);
    const thBase = `https://graph.threads.net/v1.0/${encodeURIComponent(creds.userId)}`;

    let creationId = '';
    if (photoUrls.length === 1) {
      const cResp = await fetch(`${thBase}/threads`, {
        method: 'POST',
        body: new URLSearchParams({
          media_type: 'IMAGE',
          image_url: photoUrls[0],
          text: caption,
          access_token: creds.accessToken,
        }),
      });
      const cData = await cResp.json().catch(() => ({}));
      if (!cResp.ok || !cData.id) {
        throw new Error((cData.error && cData.error.message) || `Threads /threads HTTP ${cResp.status}`);
      }
      creationId = cData.id;
    } else {
      const childIds = [];
      for (const imgUrl of photoUrls) {
        const chResp = await fetch(`${thBase}/threads`, {
          method: 'POST',
          body: new URLSearchParams({
            media_type: 'IMAGE',
            image_url: imgUrl,
            is_carousel_item: 'true',
            access_token: creds.accessToken,
          }),
        });
        const chData = await chResp.json().catch(() => ({}));
        if (!chResp.ok || !chData.id) {
          throw new Error((chData.error && chData.error.message) || `Threads carousel item HTTP ${chResp.status}`);
        }
        childIds.push(chData.id);
      }
      const pResp = await fetch(`${thBase}/threads`, {
        method: 'POST',
        body: new URLSearchParams({
          media_type: 'CAROUSEL',
          children: childIds.join(','),
          text: caption,
          access_token: creds.accessToken,
        }),
      });
      const pData = await pResp.json().catch(() => ({}));
      if (!pResp.ok || !pData.id) {
        throw new Error((pData.error && pData.error.message) || `Threads carousel parent HTTP ${pResp.status}`);
      }
      creationId = pData.id;
    }

    const pubResp = await fetch(`${thBase}/threads_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: creds.accessToken,
      }),
    });
    const pubData = await pubResp.json().catch(() => ({}));
    if (!pubResp.ok || !pubData.id) {
      throw new Error((pubData.error && pubData.error.message) || `Threads publish HTTP ${pubResp.status}`);
    }
    return {
      status: 'published',
      externalId: String(pubData.id),
      url: '',
      photoCount: photoUrls.length,
      note: `Threads (${photoUrls.length} fotiek)`,
    };
  }

  if (key === 'pinterest') {
    const { absolute: photoUrls } = resolveArtworkPhotoList(artwork, origin, 'social', 5);
    const resolved = await resolveProviderCredentials(env, 'pinterest');
    if (resolved.error) throw new Error(resolved.error);
    const { creds } = resolved;
    if (!creds.accessToken || !creds.boardId) {
      return {
        status: 'pending',
        photoCount: photoUrls.length,
        note: `Pinterest je pripravené pre multi-foto (${photoUrls.length}/5 fotiek) — doplň API kľúče v 🔑 Integrácie & Kľúče.`,
      };
    }
    if (photoUrls.length === 0) throw new Error('Dielo nemá fotku pre Pinterest.');
    const deepLink = origin ? `${origin}/?dielo=${encodeURIComponent(artwork.id)}` : '';
    const desc = buildSocialCaptionServer(artwork, origin).slice(0, 800);
    const titleStr = String(artwork.title || 'Originálna maľba').slice(0, 100);
    const mediaSource = photoUrls.length === 1
      ? { source_type: 'image_url', url: photoUrls[0] }
      : {
          source_type: 'multiple_image_urls',
          index: 0,
          items: photoUrls.map((u) => ({
            title: titleStr,
            description: desc,
            link: deepLink || undefined,
            url: u,
          })),
        };
    const pinResp = await fetch('https://api.pinterest.com/v5/pins', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        board_id: creds.boardId,
        title: titleStr,
        description: desc,
        link: deepLink || undefined,
        media_source: mediaSource,
      }),
    });
    const pinData = await pinResp.json().catch(() => ({}));
    if (!pinResp.ok || !pinData.id) {
      throw new Error(pinData.message || `Pinterest /v5/pins HTTP ${pinResp.status}`);
    }
    return {
      status: 'published',
      externalId: String(pinData.id),
      url: `https://www.pinterest.com/pin/${pinData.id}/`,
      photoCount: photoUrls.length,
      note: `Pinterest (${photoUrls.length} fotiek)`,
    };
  }

  if (key === 'tiktok') {
    const { absolute: photoUrls } = resolveArtworkPhotoList(artwork, origin, 'social', MAX_PUBLISH_PHOTOS);
    const resolved = await resolveProviderCredentials(env, 'tiktok');
    if (resolved.error) throw new Error(resolved.error);
    const { creds } = resolved;
    if (!creds.accessToken) {
      return {
        status: 'pending',
        photoCount: photoUrls.length,
        note: `TikTok Photo Mode je pripravený (${photoUrls.length}/${MAX_PUBLISH_PHOTOS} fotiek) — doplň API kľúče v 🔑 Integrácie & Kľúče.`,
      };
    }
    if (photoUrls.length === 0) throw new Error('Dielo nemá fotku pre TikTok.');
    const caption = buildSocialCaptionServer(artwork, origin);
    const tkResp = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: String(artwork.title || 'Originálna maľba').slice(0, 90),
          description: caption.slice(0, 4000),
          privacy_level: 'SELF_ONLY',
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: photoUrls,
        },
        post_mode: 'MEDIA_UPLOAD',
        media_type: 'PHOTO',
      }),
    });
    const tkData = await tkResp.json().catch(() => ({}));
    if (!tkResp.ok || (tkData.error && tkData.error.code && tkData.error.code !== 'ok')) {
      throw new Error((tkData.error && tkData.error.message) || `TikTok API HTTP ${tkResp.status}`);
    }
    const pubId = (tkData.data && tkData.data.publish_id) || '';
    return {
      status: 'drafted',
      externalId: String(pubId),
      url: '',
      photoCount: photoUrls.length,
      note: `TikTok Photo Mode (${photoUrls.length} fotiek)`,
    };
  }

  if (key === 'x') {
    const { relative: photoRels, absolute: photoUrls } = resolveArtworkPhotoList(artwork, origin, 'social', 4);
    const resolved = await resolveProviderCredentials(env, 'x');
    if (resolved.error) throw new Error(resolved.error);
    const { creds } = resolved;
    if (!creds.accessToken) {
      return {
        status: 'pending',
        photoCount: photoUrls.length,
        note: `X (Twitter) je pripravené pre multi-foto (${photoUrls.length}/4 fotiek) — doplň API kľúče v 🔑 Integrácie & Kľúče.`,
      };
    }
    if (photoRels.length === 0) throw new Error('Dielo nemá fotku pre X.');

    const mediaIds = [];
    for (const rel of photoRels) {
      const r2Key = urlToR2Key(rel);
      const obj = r2Key ? await env.IMAGES.get(r2Key) : null;
      if (!obj) continue;
      const buf = await obj.arrayBuffer();
      const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg';
      const fd = new FormData();
      fd.append('media', new Blob([buf], { type: ct }), 'artwork.jpg');
      fd.append('media_category', 'tweet_image');
      const mResp = await fetch('https://api.x.com/2/media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        body: fd,
      });
      const mData = await mResp.json().catch(() => ({}));
      const mid = (mData.data && mData.data.id) || mData.media_id_string;
      if (!mResp.ok || !mid) {
        throw new Error(mData.detail || mData.title || `X media upload HTTP ${mResp.status}`);
      }
      mediaIds.push(String(mid));
    }

    const tweetResp = await fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: buildSocialCaptionServer(artwork, origin).slice(0, 280),
        media: mediaIds.length > 0 ? { media_ids: mediaIds } : undefined,
      }),
    });
    const tweetData = await tweetResp.json().catch(() => ({}));
    if (!tweetResp.ok || !tweetData.data || !tweetData.data.id) {
      throw new Error(tweetData.detail || tweetData.title || `X /2/tweets HTTP ${tweetResp.status}`);
    }
    const tid = String(tweetData.data.id);
    return {
      status: 'published',
      externalId: tid,
      url: `https://x.com/i/web/status/${tid}`,
      photoCount: mediaIds.length,
      note: `X (${mediaIds.length} fotiek)`,
    };
  }

  if (key === 'etsy') {
    const { relative: photoRels } = resolveArtworkPhotoList(artwork, origin, 'marketplace', MAX_PUBLISH_PHOTOS);
    const resolved = await resolveProviderCredentials(env, 'etsy');
    if (resolved.error) throw new Error(resolved.error);
    const { creds } = resolved;
    if (!creds.apiKey || !creds.accessToken || !creds.shopId) {
      return {
        status: 'pending',
        photoCount: photoRels.length,
        note: `Etsy je pripravené pre multi-foto (${photoRels.length}/${MAX_PUBLISH_PHOTOS} fotiek) — doplň API kľúče v 🔑 Integrácie & Kľúče.`,
      };
    }
    const price = resolvePortalPrice(artwork, 'etsy');
    if (!(price > 0)) {
      throw new Error('Dielo nemá zadanú cenu pre Etsy (ani základnú cenu €).');
    }
    if (photoRels.length === 0) throw new Error('Dielo nemá fotku pre Etsy.');

    const etsyHeaders = {
      'x-api-key': creds.apiKey,
      Authorization: `Bearer ${creds.accessToken}`,
      'Content-Type': 'application/json',
    };
    const listingResp = await fetch(
      `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(creds.shopId)}/listings`,
      {
        method: 'POST',
        headers: etsyHeaders,
        body: JSON.stringify({
          quantity: 1,
          title: String(artwork.title || 'Originálna akrylová maľba').slice(0, 140),
          description: buildMarketplaceDescriptionServer(artwork, origin),
          price,
          who_made: 'i_did',
          when_made: '2020_2029',
          taxonomy_id: creds.taxonomyId ? Number(creds.taxonomyId) : 66,
          state: 'draft',
        }),
      }
    );
    const listingData = await listingResp.json().catch(() => ({}));
    if (!listingResp.ok || !listingData.listing_id) {
      throw new Error(listingData.error || `Etsy vytvorenie konceptu HTTP ${listingResp.status}`);
    }
    const listingId = listingData.listing_id;

    let uploadedCount = 0;
    for (let i = 0; i < photoRels.length; i++) {
      const r2Key = urlToR2Key(photoRels[i]);
      const obj = r2Key ? await env.IMAGES.get(r2Key) : null;
      if (!obj) continue;
      const buf = await obj.arrayBuffer();
      const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg';
      const fd = new FormData();
      fd.append('image', new Blob([buf], { type: ct }), `artwork_${i + 1}.jpg`);
      fd.append('rank', String(i + 1));
      const imgResp = await fetch(
        `https://openapi.etsy.com/v3/application/shops/${encodeURIComponent(creds.shopId)}/listings/${listingId}/images`,
        {
          method: 'POST',
          headers: {
            'x-api-key': creds.apiKey,
            Authorization: `Bearer ${creds.accessToken}`,
          },
          body: fd,
        }
      );
      if (!imgResp.ok) {
        const imgErr = await imgResp.json().catch(() => ({}));
        throw new Error(imgErr.error || `Etsy upload fotky #${i + 1} HTTP ${imgResp.status}`);
      }
      uploadedCount++;
    }

    return {
      status: 'drafted',
      externalId: String(listingId),
      url: listingData.url || '',
      photoCount: uploadedCount,
      note: `Etsy koncept (${uploadedCount} fotiek)`,
    };
  }

  return { status: 'skipped_unimplemented', note: `${channelRow.label} zatiaľ nie je implementované.` };
};

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshExpiringIntegrations(env, { force: false }));
  },

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

    if (pathname === '/api/auth/verify-password' && request.method === 'POST') {
      try {
        const session = await getAuthSession(request);
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

    if (pathname === '/api/auth/verify-password' && request.method === 'POST') {
      try {
        const session = await getAuthSession(request);
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

    if (pathname === '/api/auth/verify-password' && request.method === 'POST') {
      try {
        const session = await getAuthSession(request);
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

    if (pathname === '/api/auth/verify-password' && request.method === 'POST') {
      try {
        const session = await getAuthSession(request);
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

    // ---- 3. Automation Schema, Channels, Integrations & Direct Publishing ----

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
        portalPrices: parseJsonSafe(art.portal_prices_json, {}),
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

    // GET /api/automation/integrations (Authenticated)
    if (pathname === '/api/automation/integrations' && request.method === 'GET') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema(env);

        const integrations = [];
        for (const p of INTEGRATION_PROVIDERS) {
          const resolved = await resolveProviderCredentials(env, p.provider);
          integrations.push(sanitizeIntegrationSummary(resolved));
        }

        return jsonResponse({
          encryptionKeyConfigured: Boolean(env.AUTOMATION_ENCRYPTION_KEY && String(env.AUTOMATION_ENCRYPTION_KEY).trim()),
          integrations,
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // POST /api/automation/integrations/refresh (Authenticated)
    if (pathname === '/api/automation/integrations/refresh' && request.method === 'POST') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        const body = await request.json().catch(() => ({}));
        const results = await refreshExpiringIntegrations(env, { force: body && body.force !== false });
        return jsonResponse({ success: true, results });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // PUT /api/automation/integrations/:provider (Authenticated)
    if (pathname.startsWith('/api/automation/integrations/') && !pathname.endsWith('/test') && request.method === 'PUT') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema(env);

        const provider = decodeURIComponent(pathname.substring('/api/automation/integrations/'.length)).trim();
        const meta = getProviderMeta(provider);
        if (!meta) return jsonResponse({ error: 'Neznámy poskytovateľ integrácie.' }, 404);
        if (!env.AUTOMATION_ENCRYPTION_KEY || !String(env.AUTOMATION_ENCRYPTION_KEY).trim()) {
          return jsonResponse({
            error: 'Na serveri chýba AUTOMATION_ENCRYPTION_KEY v Cloudflare Secrets. Nastav ho príkazom: npx wrangler secret put AUTOMATION_ENCRYPTION_KEY',
          }, 400);
        }

        const body = await request.json();
        const incoming = body && typeof body.credentials === 'object' && body.credentials ? body.credentials : {};
        const prevResolved = await resolveProviderCredentials(env, provider);
        const merged = { ...(prevResolved.source === 'db' ? prevResolved.creds : {}) };
        for (const f of meta.fields) {
          if (incoming[f.key] !== undefined && String(incoming[f.key]).trim() !== '') {
            merged[f.key] = String(incoming[f.key]).trim();
          }
        }

        const encrypted = await encryptCredentials(merged, env.AUTOMATION_ENCRYPTION_KEY);
        const nowIso = new Date().toISOString();
        const expiresAt = body && typeof body.expiresAt === 'string'
          ? body.expiresAt.trim()
          : ((prevResolved.row && prevResolved.row.expires_at) || '');

        await updateIntegrationRecord(env, provider, {
          encrypted_credentials: encrypted,
          status: 'configured',
          expires_at: expiresAt,
          last_error: '',
          updated_at: nowIso,
        });

        const fresh = await resolveProviderCredentials(env, provider);
        return jsonResponse({ success: true, integration: sanitizeIntegrationSummary(fresh) });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // DELETE /api/automation/integrations/:provider (Authenticated)
    if (pathname.startsWith('/api/automation/integrations/') && !pathname.endsWith('/test') && request.method === 'DELETE') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema(env);

        const provider = decodeURIComponent(pathname.substring('/api/automation/integrations/'.length)).trim();
        if (!getProviderMeta(provider)) return jsonResponse({ error: 'Neznámy poskytovateľ integrácie.' }, 404);

        await updateIntegrationRecord(env, provider, {
          encrypted_credentials: '',
          account_id: '',
          account_name: '',
          status: 'disconnected',
          expires_at: '',
          last_error: '',
          updated_at: new Date().toISOString(),
        });

        const fresh = await resolveProviderCredentials(env, provider);
        return jsonResponse({ success: true, integration: sanitizeIntegrationSummary(fresh) });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // POST /api/automation/integrations/:provider/test (Authenticated)
    if (pathname.startsWith('/api/automation/integrations/') && pathname.endsWith('/test') && request.method === 'POST') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema(env);

        const provider = decodeURIComponent(
          pathname.slice('/api/automation/integrations/'.length, -'/test'.length)
        ).trim();
        if (!getProviderMeta(provider)) return jsonResponse({ error: 'Neznámy poskytovateľ integrácie.' }, 404);

        try {
          const testRes = await testProviderConnection(env, provider);
          const fresh = await resolveProviderCredentials(env, provider);
          return jsonResponse({ ok: true, ...testRes, integration: sanitizeIntegrationSummary(fresh) });
        } catch (testErr) {
          const fresh = await resolveProviderCredentials(env, provider);
          return jsonResponse({ ok: false, error: testErr.message, integration: sanitizeIntegrationSummary(fresh) }, 200);
        }
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // POST /api/automation/publish/:id - Direct 1-click publish to API channels (Authenticated)
    if (pathname.startsWith('/api/automation/publish/') && request.method === 'POST') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema(env);

        const id = decodeURIComponent(pathname.substring('/api/automation/publish/'.length)).trim();
        const artRow = await env.DB.prepare(`SELECT * FROM artworks WHERE id = ?`).bind(id).first();
        if (!artRow) return jsonResponse({ error: 'Dielo neexistuje.' }, 404);

        const [{ results: imgRows }, { results: chRows }] = await Promise.all([
          env.DB.prepare(`SELECT image_url FROM artwork_images WHERE artwork_id = ? ORDER BY sort_order ASC`).bind(id).all(),
          env.DB.prepare(`SELECT * FROM automation_channels ORDER BY sort_order ASC, channel_key ASC`).all(),
        ]);

        const imgMap = { [id]: (imgRows || []).map((r) => r.image_url) };
        const artwork = serializeArtworkRow(artRow, imgMap);
        const channels = (chRows || []).map(serializeChannelRow);
        const channelMap = new Map(channels.map((c) => [c.key, c]));

        const body = await request.json().catch(() => ({}));
        const requestedKeys = Array.isArray(body.channels) && body.channels.length > 0
          ? body.channels.map((k) => String(k).trim()).filter((k) => channelMap.has(k))
          : channels.filter((c) => c.enabled && artwork.publishChannels[c.key] !== false).map((c) => c.key);

        if (requestedKeys.length === 0) {
          return jsonResponse({ error: 'Nie je vybraný ani zapnutý žiadny cieľový kanál.' }, 400);
        }

        const currentStatus = { ...(artwork.publishStatus || {}) };
        const nowIso = new Date().toISOString();
        const results = {};
        let nextInstagramUrl = null;

        for (const key of requestedKeys) {
          const ch = channelMap.get(key);
          try {
            const res = await publishToSingleChannel(env, url.origin, artwork, ch);
            results[key] = res;
            if (res.status === 'published' || res.status === 'drafted' || res.status === 'pending') {
              currentStatus[key] = {
                status: res.status,
                externalId: res.externalId || '',
                url: res.url || '',
                note: res.note || '',
                photoCount: res.photoCount || 0,
                updatedAt: nowIso,
              };
              if (key === 'instagram' && res.url && !artwork.instagramUrl) {
                nextInstagramUrl = res.url;
              }
            }
          } catch (chErr) {
            const errMsg = chErr && chErr.message ? chErr.message : 'Neznáma chyba';
            results[key] = { status: 'error', error: errMsg };
            currentStatus[key] = {
              status: 'error',
              error: errMsg,
              updatedAt: nowIso,
            };
          }
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

        return jsonResponse({
          success: true,
          artworkId: id,
          results,
          publishStatus: currentStatus,
          instagramUrl: nextInstagramUrl || artwork.instagramUrl || '',
        });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // GET /api/automation/channels (Authenticated: Bearer key or Admin session)
    if (pathname === '/api/automation/channels' && request.method === 'GET') {
      try {
        const auth = await isAuthorizedForAutomation(request);
        if (!auth.authorized) return jsonResponse({ error: 'Unauthorized' }, 401);
        await ensureAutomationSchema(env);

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
        await ensureAutomationSchema(env);

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
        await ensureAutomationSchema(env);

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

          const socialList = resolveArtworkPhotoList(art, url.origin, 'social', MAX_PUBLISH_PHOTOS);
          const marketList = resolveArtworkPhotoList(art, url.origin, 'marketplace', MAX_PUBLISH_PHOTOS);
          artworksPayload.push({
            ...art,
            cleanImageUrl: toAbsoluteUrl(url.origin, art.coverImage),
            socialImagePublicUrl: toAbsoluteUrl(url.origin, art.socialImageUrl),
            detailImageUrls: (art.detailImages || []).map((u) => toAbsoluteUrl(url.origin, u)),
            socialImageUrls: socialList.absolute,
            marketplaceImageUrls: marketList.absolute,
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
        await ensureAutomationSchema(env);

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
        await ensureAutomationSchema(env);

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
        const resolvedSocialImg = (typeof socialImageUrl === 'string' && !socialImageUrl.startsWith('data:')) ? socialImageUrl : '';

        await env.DB.prepare(`
          INSERT OR REPLACE INTO artworks
            (id, folder_name, title, date_created, year, technique, medium, dimensions, width_cm, height_cm, depth_cm, price_eur, portal_prices_json, instagram_url, raw_image, social_image_url, publish_status_json, publish_channels_json, sort_order, status, description, cover_image, photo_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    // POST /api/artworks/:id/images/reorder - Persist album photo order & cover atomically (Authenticated)
    if (pathname.startsWith('/api/artworks/') && pathname.endsWith('/images/reorder') && request.method === 'POST') {
      try {
        const session = await getAuthSession(request);
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
          env.DB.prepare(`UPDATE artworks SET cover_image = ?, photo_count = ? WHERE id = ?`)
            .bind(finalUrls[0], finalUrls.length, id)
        );
        await env.DB.batch(stmts);

        return jsonResponse({
          success: true,
          id,
          coverImage: finalUrls[0],
          detailImages: finalUrls,
          photoCount: finalUrls.length,
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
            const cleanedRemoved = await deleteUnusedR2Images(removedUrls);
            deletedKeys.push(...cleanedRemoved);
          }
        }

        if (socialImageUrl !== undefined) {
          const safeSocial = (typeof resolvedSocialUrl === 'string' && !resolvedSocialUrl.startsWith('data:')) ? resolvedSocialUrl : '';
          await env.DB.prepare(`UPDATE artworks SET social_image_url = ? WHERE id = ?`)
            .bind(safeSocial, id)
            .run();
          if (existingArtRow && existingArtRow.social_image_url && existingArtRow.social_image_url !== safeSocial) {
            const cleanedSoc = await deleteUnusedR2Images([existingArtRow.social_image_url]);
            deletedKeys.push(...cleanedSoc);
          }
          resolvedSocialUrl = safeSocial;
        }

        const respPayload = { success: true, id, priceEur: syncedPrice, socialImageUrl: resolvedSocialUrl || '', deletedFiles: deletedKeys.length };
        if (syncedPortalPrices) respPayload.portalPrices = parseJsonSafe(syncedPortalPrices, {});
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
