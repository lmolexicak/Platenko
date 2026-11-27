export const MAX_PUBLISH_PHOTOS = 10;

/**
 * Resolve up to maxPhotos (capped at 10) ordered absolute URLs for an artwork.
 * - mode 'social': [socialImagePublicUrl, ...detailImageUrls]
 * - mode 'marketplace': [cleanImageUrl, ...detailImageUrls]
 */
export function resolveOrderedPhotos(artwork, mode = "social", maxPhotos = MAX_PUBLISH_PHOTOS) {
  const limit = Math.max(1, Math.min(MAX_PUBLISH_PHOTOS, Number(maxPhotos) || MAX_PUBLISH_PHOTOS));
  const precomputed = mode === "social" ? artwork.socialImageUrls : artwork.marketplaceImageUrls;
  if (Array.isArray(precomputed) && precomputed.length > 0) {
    return precomputed.filter((u) => typeof u === "string" && u.length > 0).slice(0, limit);
  }
  const albumUrls = Array.isArray(artwork.detailImageUrls) && artwork.detailImageUrls.length > 0
    ? artwork.detailImageUrls
    : (artwork.cleanImageUrl ? [artwork.cleanImageUrl] : []);
  const raw = mode === "social"
    ? [artwork.socialImagePublicUrl, ...albumUrls]
    : [artwork.cleanImageUrl, ...albumUrls];
  const seen = new Set();
  const deduped = [];
  for (const u of raw) {
    if (!u || typeof u !== "string" || seen.has(u)) continue;
    seen.add(u);
    deduped.push(u);
  }
  return deduped.slice(0, limit);
}

/**
 * Common adapter contract for every publishing channel (social networks & marketplaces).
 * New social networks implement this interface and register in publishers/registry.js.
 */
export class BasePublisherAdapter {
  constructor(meta) {
    this.key = meta.key;
    this.label = meta.label;
    this.kind = meta.kind; // 'social' | 'marketplace'
    this.imageVariant = meta.imageVariant || "stylized"; // 'stylized' | 'clean'
    this.maxPhotos = meta.maxPhotos || MAX_PUBLISH_PHOTOS;
    this.implemented = Boolean(meta.implemented);
    this.requiredEnv = meta.requiredEnv || [];
  }

  getMissingEnv(env = process.env) {
    return this.requiredEnv.filter((k) => !String(env[k] || "").trim());
  }

  isConfigured(env = process.env) {
    return this.getMissingEnv(env).length === 0;
  }

  /**
   * @param {object} artwork
   * @param {object} ctx - { env, apiClient, baseUrl, channelConfig, dryRun }
   * @returns {Promise<{ status: string, externalId?: string, url?: string, error?: string, note?: string }>}
   */
  async publish(_artwork, _ctx) {
    return {
      status: "skipped_unimplemented",
      note: `Adaptér pre „${this.label}" je predpripravený (čaká na implementáciu API a kľúče).`,
    };
  }
}
