import { BasePublisherAdapter } from "./baseAdapter.js";

/**
 * Pre-prepared extensible adapters for additional social networks & marketplaces.
 * Each adapter validates its own credentials and can be implemented independently
 * without changing Admin CMS, D1 schema, or run.js orchestration.
 */
class PreparedChannelAdapter extends BasePublisherAdapter {
  constructor(meta) {
    super({ ...meta, implemented: false });
    this.endpointHint = meta.endpointHint || "";
  }

  async publish(artwork, ctx) {
    const missing = this.getMissingEnv(ctx.env);
    const hint = missing.length > 0
      ? `Chýbajú kľúče v .env: ${missing.join(", ")}.`
      : `Kľúče sú pripravené, stačí doplniť API volanie (${this.endpointHint}).`;
    return {
      status: "skipped_unimplemented",
      note: `${this.label} je v režime predprípravy pre „${artwork.title}". ${hint}`,
    };
  }
}

export const pinterestAdapter = new PreparedChannelAdapter({
  key: "pinterest",
  label: "Pinterest",
  kind: "social",
  imageVariant: "stylized",
  requiredEnv: ["PINTEREST_ACCESS_TOKEN", "PINTEREST_BOARD_ID"],
  endpointHint: "POST https://api.pinterest.com/v5/pins",
});

export const tiktokAdapter = new PreparedChannelAdapter({
  key: "tiktok",
  label: "TikTok",
  kind: "social",
  imageVariant: "stylized",
  requiredEnv: ["TIKTOK_ACCESS_TOKEN"],
  endpointHint: "POST https://open.tiktokapis.com/v2/post/publish/content/init/",
});

export const threadsAdapter = new PreparedChannelAdapter({
  key: "threads",
  label: "Threads",
  kind: "social",
  imageVariant: "stylized",
  requiredEnv: ["THREADS_USER_ID", "THREADS_ACCESS_TOKEN"],
  endpointHint: "POST https://graph.threads.net/v1.0/{user-id}/threads",
});

export const xAdapter = new PreparedChannelAdapter({
  key: "x",
  label: "X (Twitter)",
  kind: "social",
  imageVariant: "stylized",
  requiredEnv: ["X_ACCESS_TOKEN"],
  endpointHint: "POST https://api.x.com/2/tweets + v1.1 media/upload",
});

export const etsyAdapter = new PreparedChannelAdapter({
  key: "etsy",
  label: "Etsy",
  kind: "marketplace",
  imageVariant: "clean",
  requiredEnv: ["ETSY_API_KEY", "ETSY_ACCESS_TOKEN", "ETSY_SHOP_ID"],
  endpointHint: "POST https://openapi.etsy.com/v3/application/shops/{shop_id}/listings",
});
