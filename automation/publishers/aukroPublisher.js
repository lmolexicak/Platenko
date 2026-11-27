import { BasePublisherAdapter, MAX_PUBLISH_PHOTOS, resolveOrderedPhotos } from "./baseAdapter.js";
import { buildMarketplaceDescription } from "../captionBuilder.js";

class AukroAdapter extends BasePublisherAdapter {
  constructor() {
    super({
      key: "aukro",
      label: "Aukro",
      kind: "marketplace",
      imageVariant: "clean",
      maxPhotos: MAX_PUBLISH_PHOTOS,
      implemented: true,
      requiredEnv: ["AUKRO_ACCESS_TOKEN"],
    });
  }

  async ensureAccessToken(env) {
    if (String(env.AUKRO_ACCESS_TOKEN || "").trim()) {
      return env.AUKRO_ACCESS_TOKEN.trim();
    }
    if (env.AUKRO_CLIENT_ID && env.AUKRO_CLIENT_SECRET && env.AUKRO_REFRESH_TOKEN) {
      const base = String(env.AUKRO_API_BASE_URL || "https://api.aukro.cz/v1").replace(/\/+$/, "");
      const authBasic = Buffer.from(`${env.AUKRO_CLIENT_ID}:${env.AUKRO_CLIENT_SECRET}`).toString("base64");
      const resp = await fetch(`${base}/oauth/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authBasic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: env.AUKRO_REFRESH_TOKEN,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.access_token) {
        throw new Error("Aukro OAuth2 obnova tokenu zlyhala.");
      }
      return data.access_token;
    }
    throw new Error("Chýba AUKRO_ACCESS_TOKEN (alebo OAuth2 refresh credentials).");
  }

  async publish(artwork, ctx) {
    const { env, apiClient, channelConfig, dryRun } = ctx;
    const base = String(env.AUKRO_API_BASE_URL || "https://api.aukro.cz/v1").replace(/\/+$/, "");
    const portalPrice = artwork.portalPrices && Number(artwork.portalPrices.aukro) > 0
      ? Number(artwork.portalPrices.aukro)
      : null;
    const price = portalPrice ?? Number(artwork.priceEur);
    if (!(price > 0)) {
      throw new Error(`Dielo „${artwork.title}" nemá zadanú cenu pre Aukro (ani základnú cenu EUR) v Admin CMS.`);
    }
    const photoUrls = resolveOrderedPhotos(artwork, "marketplace", this.maxPhotos);
    if (photoUrls.length === 0) {
      throw new Error("Chýba čistá fotka diela pre Aukro.");
    }

    const asDraft = !(channelConfig && channelConfig.autoPublish);
    if (dryRun) {
      return {
        status: "pending",
        photoCount: photoUrls.length,
        note: `[DRY-RUN] Aukro (${asDraft ? "koncept" : "aktívna ponuka"}, ${photoUrls.length} fotiek): ${artwork.title}, ${price} €`,
      };
    }

    const token = await this.ensureAccessToken(env);
    const uploadedImages = [];
    for (const url of photoUrls) {
      const imgBuf = await apiClient.downloadImageBuffer(url);
      const imgResp = await fetch(`${base}/offers/images`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "image/jpeg",
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

    // 2. Create offer (inactive/draft by default for safety)
    const payload = {
      name: String(artwork.title || "Originálna akrylová maľba").slice(0, 75),
      description: buildMarketplaceDescription(artwork, ctx),
      categoryId: env.AUKRO_DEFAULT_CATEGORY_ID ? Number(env.AUKRO_DEFAULT_CATEGORY_ID) : undefined,
      price: {
        amount: price,
        currency: env.AUKRO_DEFAULT_CURRENCY || "EUR",
      },
      images: uploadedImages,
      active: !asDraft,
    };

    const offerResp = await fetch(`${base}/offers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const offerData = await offerResp.json().catch(() => ({}));
    if (!offerResp.ok || !offerData.id) {
      throw new Error(offerData.message || `Aukro vytvorenie ponuky HTTP ${offerResp.status}`);
    }

    return {
      status: asDraft ? "drafted" : "published",
      externalId: String(offerData.id),
      url: offerData.url || "",
      photoCount: uploadedImages.length,
      note: `Aukro (${uploadedImages.length} fotiek)`,
    };
  }
}

export const aukroAdapter = new AukroAdapter();
