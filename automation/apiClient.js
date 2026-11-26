/**
 * Authenticated HTTP client for Platenko Cloudflare Worker Automation API.
 */
export class PlatenkoApiClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.apiKey = String(apiKey || "").trim();
    if (!this.baseUrl) {
      throw new Error("WEB_API_BASE_URL nie je nastavené v .env");
    }
    if (!this.apiKey) {
      throw new Error("AUTOMATION_API_KEY nie je nastavený v .env");
    }
  }

  async request(path, options = {}) {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    };
    const resp = await fetch(url, {
      ...options,
      headers,
      body: options.body && typeof options.body !== "string"
        ? JSON.stringify(options.body)
        : options.body,
    });
    const text = await resp.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!resp.ok) {
      const msg = (json && (json.error || json.message)) || `HTTP ${resp.status}`;
      throw new Error(`${options.method || "GET"} ${path} zlyhalo: ${msg}`);
    }
    return json;
  }

  getChannels() {
    return this.request("/api/automation/channels");
  }

  getPending({ channel, artworkId, includeAll = false } = {}) {
    const qs = new URLSearchParams();
    if (channel) qs.set("channel", channel);
    if (artworkId) qs.set("artworkId", artworkId);
    if (includeAll) qs.set("includeAll", "1");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request(`/api/automation/pending${suffix}`);
  }

  uploadSocialImage({ artworkId, imageDataUrl, thumbDataUrl }) {
    return this.request("/api/automation/upload-social-image", {
      method: "POST",
      body: { artworkId, imageDataUrl, thumbDataUrl },
    });
  }

  patchStatus(artworkId, payload) {
    return this.request(`/api/automation/status/${encodeURIComponent(artworkId)}`, {
      method: "PATCH",
      body: payload,
    });
  }

  async downloadImageBuffer(imageUrl) {
    const absUrl = imageUrl.startsWith("http")
      ? imageUrl
      : `${this.baseUrl}/${imageUrl.replace(/^\/+/, "")}`;
    const resp = await fetch(absUrl);
    if (!resp.ok) {
      throw new Error(`Nepodarilo sa stiahnuť obrázok (${resp.status}): ${absUrl}`);
    }
    const arr = await resp.arrayBuffer();
    return Buffer.from(arr);
  }
}
