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
