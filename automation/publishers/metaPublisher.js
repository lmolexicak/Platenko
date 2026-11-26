import { BasePublisherAdapter } from "./baseAdapter.js";
import { buildSocialCaption } from "../captionBuilder.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class InstagramAdapter extends BasePublisherAdapter {
  constructor() {
    super({
      key: "instagram",
      label: "Instagram",
      kind: "social",
      imageVariant: "stylized",
      implemented: true,
      requiredEnv: ["META_ACCESS_TOKEN", "IG_USER_ID"],
    });
  }

  async publish(artwork, ctx) {
    const { env, dryRun } = ctx;
    const version = env.META_GRAPH_VERSION || "v21.0";
    const igUserId = env.IG_USER_ID;
    const token = env.META_ACCESS_TOKEN;
    const imageUrl = artwork.socialImagePublicUrl || artwork.cleanImageUrl;
    const caption = buildSocialCaption(artwork, ctx, { maxLength: 2200 });

    if (!imageUrl) {
      throw new Error("Chýba verejná URL obrázka pre Instagram.");
    }
    if (dryRun) {
      return { status: "pending", note: `[DRY-RUN] Instagram: ${imageUrl}` };
    }

    // 1. Create media container
    const createParams = new URLSearchParams({
      image_url: imageUrl,
      caption,
      access_token: token,
    });
    const createResp = await fetch(`https://graph.facebook.com/${version}/${igUserId}/media`, {
      method: "POST",
      body: createParams,
    });
    const createData = await createResp.json();
    if (!createResp.ok || !createData.id) {
      throw new Error((createData.error && createData.error.message) || `IG /media HTTP ${createResp.status}`);
    }
    const creationId = createData.id;

    // 2. Poll container status until FINISHED
    for (let attempt = 0; attempt < 12; attempt++) {
      const statusUrl = `https://graph.facebook.com/${version}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`;
      const stResp = await fetch(statusUrl);
      const stData = await stResp.json();
      if (stData.status_code === "FINISHED") break;
      if (stData.status_code === "ERROR") {
        throw new Error("Instagram spracovanie media kontajnera zlyhalo (ERROR).");
      }
      await sleep(2500);
    }

    // 3. Publish media container
    const pubParams = new URLSearchParams({
      creation_id: creationId,
      access_token: token,
    });
    const pubResp = await fetch(`https://graph.facebook.com/${version}/${igUserId}/media_publish`, {
      method: "POST",
      body: pubParams,
    });
    const pubData = await pubResp.json();
    if (!pubResp.ok || !pubData.id) {
      throw new Error((pubData.error && pubData.error.message) || `IG /media_publish HTTP ${pubResp.status}`);
    }

    // Fetch permalink if available
    let permalink = "";
    try {
      const linkResp = await fetch(
        `https://graph.facebook.com/${version}/${pubData.id}?fields=permalink&access_token=${encodeURIComponent(token)}`
      );
      const linkData = await linkResp.json();
      if (linkData && linkData.permalink) permalink = linkData.permalink;
    } catch {}

    return {
      status: "published",
      externalId: String(pubData.id),
      url: permalink,
    };
  }
}

class FacebookAdapter extends BasePublisherAdapter {
  constructor() {
    super({
      key: "facebook",
      label: "Facebook",
      kind: "social",
      imageVariant: "stylized",
      implemented: true,
      requiredEnv: ["META_ACCESS_TOKEN", "FB_PAGE_ID"],
    });
  }

  async publish(artwork, ctx) {
    const { env, dryRun } = ctx;
    const version = env.META_GRAPH_VERSION || "v21.0";
    const pageId = env.FB_PAGE_ID;
    const token = env.META_ACCESS_TOKEN;
    const imageUrl = artwork.socialImagePublicUrl || artwork.cleanImageUrl;
    const message = buildSocialCaption(artwork, ctx, { maxLength: 5000 });

    if (!imageUrl) {
      throw new Error("Chýba verejná URL obrázka pre Facebook.");
    }
    if (dryRun) {
      return { status: "pending", note: `[DRY-RUN] Facebook Page ${pageId}: ${imageUrl}` };
    }

    const params = new URLSearchParams({
      url: imageUrl,
      message,
      access_token: token,
    });
    const resp = await fetch(`https://graph.facebook.com/${version}/${pageId}/photos`, {
      method: "POST",
      body: params,
    });
    const data = await resp.json();
    if (!resp.ok || (!data.id && !data.post_id)) {
      throw new Error((data.error && data.error.message) || `FB /photos HTTP ${resp.status}`);
    }

    const postId = String(data.post_id || data.id);
    return {
      status: "published",
      externalId: postId,
      url: `https://www.facebook.com/${postId.replace("_", "/posts/")}`,
    };
  }
}

export const instagramAdapter = new InstagramAdapter();
export const facebookAdapter = new FacebookAdapter();
