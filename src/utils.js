// Shared Cloudflare Worker utilities (crypto, auth sessions, R2 media cleanup)

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const jsonResponse = (payload, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });

export const hexToBytes = (hex) => {
  const clean = (hex || '').trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
};

export const bytesToHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const parseJsonSafe = (str, fallback) => {
  if (!str || typeof str !== 'string') return fallback;
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export const toAbsoluteUrl = (origin, relOrAbs) => {
  if (!relOrAbs || typeof relOrAbs !== 'string') return '';
  if (/^https?:\/\//i.test(relOrAbs)) return relOrAbs;
  return `${origin}/${relOrAbs.replace(/^\/+/, '')}`;
};

export const urlToR2Key = (imageUrl) => {
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

export const escapeHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const deriveAesKey = async (secret) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(secret).trim())
  );
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

export const encryptCredentials = async (obj, secret) => {
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

export const decryptCredentials = async (payloadStr, secret) => {
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

export const timingSafeEqualHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

export const pbkdf2HashHex = async (password, saltHex) => {
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

export const parseCookies = (req) => {
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

export const buildSessionCookie = (token, httpsFlag, maxAgeSeconds) => {
  let cookie = `platenko_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  if (httpsFlag) cookie += '; Secure';
  return cookie;
};

export const getAuthSession = async (env, req) => {
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

export const isAuthorizedForAutomation = async (env, req) => {
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
  const session = await getAuthSession(env, req);
  if (session.authenticated) {
    return { authorized: true, via: 'session' };
  }
  return { authorized: false };
};

export const parseDimPair = (dimensionsStr) => {
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

export const decodeDataImage = (dataUrl) => {
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

export const uploadDataImageWithThumb = async (env, dataUrl, thumbDataUrl, folder, prefix = 'cover') => {
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

export const deleteUnusedR2Images = async (env, candidateUrls) => {
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

export const serializeArtworkRow = (art, imgMap = {}) => {
  const detailImgs = imgMap[art.id] || (art.cover_image ? [art.cover_image] : []);
  const parsedDims = parseDimPair(art.dimensions);
  const widthCm = Number(art.width_cm) > 0 ? Number(art.width_cm) : parsedDims.widthCm;
  const heightCm = Number(art.height_cm) > 0 ? Number(art.height_cm) : parsedDims.heightCm;
  const depthCm = Number(art.depth_cm) > 0 ? Number(art.depth_cm) : 4;
  const rawPrice = art.price_eur !== null && art.price_eur !== undefined && art.price_eur !== ''
    ? Number(art.price_eur)
    : null;
  const rawRatio = Number(art.cover_aspect_ratio);
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
    coverAspectRatio: Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : null,
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
