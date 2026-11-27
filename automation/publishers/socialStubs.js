import { BasePublisherAdapter, MAX_PUBLISH_PHOTOS, resolveOrderedPhotos } from "./baseAdapter.js";

/**
 * Pre-prepared extensible adapters for additional social networks & marketplaces.
 * Each adapter resolves up to 10 ordered album photos and is wired in worker.js for 1-click cloud publishing once API keys are configured.
 */
class PreparedChannelAdapter extends BasePublisherAdapter {
  constructor(meta) {
    super({ ...meta, implemented: false });
    this.endpointHint = meta.endpointHint || "";
  }

  async publish(artwork, ctx) {
    const missing = this.getMissingEnv(ctx.env);
    const photos = resolveOrderedPhotos(artwork, this.kind, this.maxPhotos || MAX_PUBLISH_PHOTOS);
    const hint = missing.length > 0
      ? `Chýbajú kľúče (${missing.join(", ")}).`
      : `Kľúče sú pripravené (${this.endpointHint}).`;
    return {
      status: "skipped_unimplemented",
      photoCount: photos.length,
      note: `${this.label} podporuje multi-foto upload (${photos.length}/${this.maxPhotos} fotiek) cez cloud v Admin CMS. ${hint}`,
    };
  }
}

export const pinterestAdapter = new PreparedChannelAdapter({
  key: "pinterest",
  label: "Pinterest",
  kind: "social",
  imageVariant: "stylized",
  maxPhotos: 5,
  requiredEnv: ["PINTEREST_ACCESS_TOKEN", "PINTEREST_BOARD_ID"],
  endpointHint: "POST https://api.pinterest.com/v5/pins",
});

export const tiktokAdapter = new PreparedChannelAdapter({
  key: "tiktok",
  label: "TikTok",
  kind: "social",
  imageVariant: "stylized",
  maxPhotos: MAX_PUBLISH_PHOTOS,
  requiredEnv: ["TIKTOK_ACCESS_TOKEN"],
  endpointHint: "POST https://open.tiktokapis.com/v2/post/publish/content/init/",
});

export const threadsAdapter = new PreparedChannelAdapter({
  key: "threads",
  label: "Threads",
  kind: "social",
  imageVariant: "stylized",
  maxPhotos: MAX_PUBLISH_PHOTOS,
  requiredEnv: ["THREADS_USER_ID", "THREADS_ACCESS_TOKEN"],
  endpointHint: "POST https://graph.threads.net/v1.0/{user-id}/threads",
});

export const xAdapter = new PreparedChannelAdapter({
  key: "x",
  label: "X (Twitter)",
  kind: "social",
  imageVariant: "stylized",
  maxPhotos: 4,
  requiredEnv: ["X_ACCESS_TOKEN"],
  endpointHint: "POST https://api.x.com/2/tweets + 2/media/upload",
});

export const etsyAdapter = new PreparedChannelAdapter({
  key: "etsy",
  label: "Etsy",
  kind: "marketplace",
  imageVariant: "clean",
  maxPhotos: MAX_PUBLISH_PHOTOS,
  requiredEnv: ["ETSY_API_KEY", "ETSY_ACCESS_TOKEN", "ETSY_SHOP_ID"],
  endpointHint: "POST https://openapi.etsy.com/v3/application/shops/{shop_id}/listings",
});
