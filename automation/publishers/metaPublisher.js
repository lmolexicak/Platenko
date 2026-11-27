import { BasePublisherAdapter, MAX_PUBLISH_PHOTOS, resolveOrderedPhotos } from "./baseAdapter.js";
import { buildSocialCaption } from "../captionBuilder.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollIgContainer(version, creationId, token, maxAttempts = 12, delayMs = 2500) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusUrl = `https://graph.facebook.com/${version}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`;
    const stResp = await fetch(statusUrl);
    const stData = await stResp.json().catch(() => ({}));
    if (stData.status_code === "FINISHED" || stData.status_code === "PUBLISHED") return;
    if (stData.status_code === "ERROR" || stData.status_code === "EXPIRED") {
      throw new Error(`Instagram spracovanie media kontajnera zlyhalo (${stData.status_code}).`);
    }
    await sleep(delayMs);
  }
}

class InstagramAdapter extends BasePublisherAdapter {
  constructor() {
    super({
      key: "instagram",
      label: "Instagram",
      kind: "social",
      imageVariant: "stylized",
      maxPhotos: MAX_PUBLISH_PHOTOS,
      implemented: true,
      requiredEnv: ["META_ACCESS_TOKEN", "IG_USER_ID"],
    });
  }

  async publish(artwork, ctx) {
    const { env, dryRun } = ctx;
    const version = env.META_GRAPH_VERSION || "v21.0";
    const igUserId = env.IG_USER_ID;
    const token = env.META_ACCESS_TOKEN;
    const photoUrls = resolveOrderedPhotos(artwork, "social", this.maxPhotos);
    const caption = buildSocialCaption(artwork, ctx, { maxLength: 2200 });

    if (photoUrls.length === 0) {
      throw new Error("Chýba verejná URL obrázka pre Instagram.");
    }
    if (dryRun) {
      return {
        status: "pending",
        photoCount: photoUrls.length,
        note: `[DRY-RUN] Instagram (${photoUrls.length} fotiek): ${photoUrls[0]}`,
      };
    }

    let containerIdToPublish = "";
    if (photoUrls.length === 1) {
      const createResp = await fetch(`https://graph.facebook.com/${version}/${igUserId}/media`, {
        method: "POST",
        body: new URLSearchParams({
          image_url: photoUrls[0],
          caption,
          access_token: token,
        }),
      });
      const createData = await createResp.json().catch(() => ({}));
      if (!createResp.ok || !createData.id) {
        throw new Error((createData.error && createData.error.message) || `IG /media HTTP ${createResp.status}`);
      }
      await pollIgContainer(version, createData.id, token, 12, 2500);
      containerIdToPublish = createData.id;
    } else {
      const childIds = [];
      for (const imgUrl of photoUrls) {
        const chResp = await fetch(`https://graph.facebook.com/${version}/${igUserId}/media`, {
          method: "POST",
          body: new URLSearchParams({
            image_url: imgUrl,
            is_carousel_item: "true",
            access_token: token,
          }),
        });
        const chData = await chResp.json().catch(() => ({}));
        if (!chResp.ok || !chData.id) {
          throw new Error((chData.error && chData.error.message) || `IG carousel item HTTP ${chResp.status}`);
        }
        childIds.push(chData.id);
      }
      await Promise.all(childIds.map((cid) => pollIgContainer(version, cid, token, 8, 2000)));

      const parentResp = await fetch(`https://graph.facebook.com/${version}/${igUserId}/media`, {
        method: "POST",
        body: new URLSearchParams({
          media_type: "CAROUSEL",
          children: childIds.join(","),
          caption,
          access_token: token,
        }),
      });
      const parentData = await parentResp.json().catch(() => ({}));
      if (!parentResp.ok || !parentData.id) {
        throw new Error((parentData.error && parentData.error.message) || `IG carousel container HTTP ${parentResp.status}`);
      }
      await pollIgContainer(version, parentData.id, token, 12, 2500);
      containerIdToPublish = parentData.id;
    }

    const pubResp = await fetch(`https://graph.facebook.com/${version}/${igUserId}/media_publish`, {
      method: "POST",
      body: new URLSearchParams({
        creation_id: containerIdToPublish,
        access_token: token,
      }),
    });
    const pubData = await pubResp.json().catch(() => ({}));
    if (!pubResp.ok || !pubData.id) {
      throw new Error((pubData.error && pubData.error.message) || `IG /media_publish HTTP ${pubResp.status}`);
    }

    let permalink = "";
    try {
      const linkResp = await fetch(
        `https://graph.facebook.com/${version}/${pubData.id}?fields=permalink&access_token=${encodeURIComponent(token)}`
      );
      const linkData = await linkResp.json().catch(() => ({}));
      if (linkData && linkData.permalink) permalink = linkData.permalink;
    } catch {}

    return {
      status: "published",
      externalId: String(pubData.id),
      url: permalink,
      photoCount: photoUrls.length,
      note: photoUrls.length > 1 ? `Instagram Carousel (${photoUrls.length} fotiek)` : "Instagram (1 fotka)",
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
      maxPhotos: MAX_PUBLISH_PHOTOS,
      implemented: true,
      requiredEnv: ["META_ACCESS_TOKEN", "FB_PAGE_ID"],
    });
  }

  async publish(artwork, ctx) {
    const { env, dryRun } = ctx;
    const version = env.META_GRAPH_VERSION || "v21.0";
    const pageId = env.FB_PAGE_ID;
    const token = env.META_ACCESS_TOKEN;
    const photoUrls = resolveOrderedPhotos(artwork, "social", this.maxPhotos);
    const message = buildSocialCaption(artwork, ctx, { maxLength: 5000 });

    if (photoUrls.length === 0) {
      throw new Error("Chýba verejná URL obrázka pre Facebook.");
    }
    if (dryRun) {
      return {
        status: "pending",
        photoCount: photoUrls.length,
        note: `[DRY-RUN] Facebook Page ${pageId} (${photoUrls.length} fotiek): ${photoUrls[0]}`,
      };
    }

    if (photoUrls.length === 1) {
      const resp = await fetch(`https://graph.facebook.com/${version}/${pageId}/photos`, {
        method: "POST",
        body: new URLSearchParams({
          url: photoUrls[0],
          message,
          access_token: token,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || (!data.id && !data.post_id)) {
        throw new Error((data.error && data.error.message) || `FB /photos HTTP ${resp.status}`);
      }
      const postId = String(data.post_id || data.id);
      return {
        status: "published",
        externalId: postId,
        url: `https://www.facebook.com/${postId.replace("_", "/posts/")}`,
        photoCount: 1,
      };
    }

    const mediaFbIds = [];
    for (const imgUrl of photoUrls) {
      const upResp = await fetch(`https://graph.facebook.com/${version}/${pageId}/photos`, {
        method: "POST",
        body: new URLSearchParams({
          url: imgUrl,
          published: "false",
          access_token: token,
        }),
      });
      const upData = await upResp.json().catch(() => ({}));
      if (!upResp.ok || !upData.id) {
        throw new Error((upData.error && upData.error.message) || `FB multi-upload HTTP ${upResp.status}`);
      }
      mediaFbIds.push(String(upData.id));
    }

    const feedParams = new URLSearchParams({
      message,
      access_token: token,
    });
    mediaFbIds.forEach((fid, idx) => {
      feedParams.append(`attached_media[${idx}]`, JSON.stringify({ media_fbid: fid }));
    });
    const feedResp = await fetch(`https://graph.facebook.com/${version}/${pageId}/feed`, {
      method: "POST",
      body: feedParams,
    });
    const feedData = await feedResp.json().catch(() => ({}));
    if (!feedResp.ok || !feedData.id) {
      throw new Error((feedData.error && feedData.error.message) || `FB /feed HTTP ${feedResp.status}`);
    }

    const postId = String(feedData.id);
    return {
      status: "published",
      externalId: postId,
      url: `https://www.facebook.com/${postId.replace("_", "/posts/")}`,
      photoCount: photoUrls.length,
      note: `Facebook galéria (${photoUrls.length} fotiek)`,
    };
  }
}

export const instagramAdapter = new InstagramAdapter();
export const facebookAdapter = new FacebookAdapter();
