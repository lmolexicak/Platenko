# Art Gallery Multi-Channel Publishing & Automation Spec

## 1. Project Context & Goal
We have an existing artist portfolio web application deployed on **Cloudflare** (Cloudflare Workers + static `[assets]`, Cloudflare D1 database, and Cloudflare R2 storage).
The goal is to provide an automated, controllable multi-channel publishing pipeline so that whenever a new painting (clean, cropped canvas image + metadata) is uploaded to Admin CMS, the system can:
1. Automatically generate a stylized social media version of the image (blurred & brightened background derived from the painting itself + centered original painting with a realistic 3D drop shadow, **4:5 portrait 1080×1350px**).
2. Publish the stylized image + Slovak caption to **Instagram** and **Facebook** via Meta Graph API.
3. Publish the clean image + listing details to **Aukro** via Aukro REST API (initially as draft/inactive by default).
4. Run a local browser automation script (**Playwright**) to log into **Sashe.sk**, fill out the new product form with clean images and metadata, and pause/save as draft for one-click review.
5. **Control every network/portal individually from Admin CMS (`🚀 Automatizácia`)** via ON/OFF switches stored in D1, plus per-artwork publish status & opt-out checkboxes.
6. **Pre-prepare an extensible adapter architecture** (`automation/publishers/`) ready for additional social networks and marketplaces (**Pinterest, TikTok, Threads, X (Twitter), Etsy**) so adding a new channel only requires credentials + implementing its adapter without rewriting Admin CMS or database schemas.

---

## 2. Architecture Constraints (Cloudflare Compatibility)
- **Cloudflare Workers** do not natively support heavy Node.js binary libraries like `sharp` or `playwright`.
- Therefore, the automation is split cleanly into two cooperating parts:
  - **Web / Cloudflare Side (`worker.js`, `admin.html`, `admin.js`, D1, R2):**
    - Stores artwork metadata (`price_eur`, `social_image_url`, `publish_status_json`, `publish_channels_json`) and per-channel ON/OFF switches (`automation_channels`) in D1, plus images in R2.
    - Exposes protected REST API endpoints (authenticated either by Bearer `AUTOMATION_API_KEY` secret or Admin CMS session cookie).
    - Provides the Admin CMS UI (`🚀 Automatizácia` modal + per-artwork publish status panel + `Cena (€)` input).
  - **Automation Runner (`/automation` Node.js CLI):**
    - Dedicated `/automation` folder (excluded from Cloudflare `[assets]` via `.assetsignore`) using Node.js ESM (`sharp`, `playwright`, `dotenv`).
    - Reads active channel switches from Cloudflare API, processes missing 4:5 stylized images, uploads them back to R2, dispatches posts only to enabled channels via modular publisher adapters, and reports results back to D1.

---

## 3. Implemented Architecture & Phases

### Phase 1: Database & Automation API (`worker.js`)
1. **Idempotent auto-migration (`ensureAutomationSchema`):**
   - Extends `artworks` table (if columns are missing):
     - `price_eur REAL`
     - `social_image_url TEXT DEFAULT ''`
     - `publish_status_json TEXT DEFAULT '{}'`
     - `publish_channels_json TEXT DEFAULT '{}'`
   - Creates `automation_channels` table (`channel_key`, `label`, `kind`, `image_variant`, `adapter`, `implemented`, `enabled`, `auto_publish`, `config_json`, `sort_order`, `updated_at`) and seeds 9 channels (all `enabled = 0` by default for safety):
     - **Ready (`implemented = 1`):** `instagram`, `facebook`, `aukro`, `sashe`
     - **Pre-prepared (`implemented = 0`):** `pinterest`, `tiktok`, `threads`, `x`, `etsy`
2. **Protected API Endpoints (`Authorization: Bearer <AUTOMATION_API_KEY>` or Admin session cookie):**
   - `GET /api/automation/channels` — lists all channels with ON/OFF state, readiness, and summary counts (`enabledCount`, `pendingArtworksCount`).
   - `PUT /api/automation/channels/:key` — toggles `enabled`, `autoPublish` (draft vs publish), and optional non-secret config in D1.
   - `GET /api/automation/pending` — returns artworks missing `social_image_url` or pending for any globally enabled channel (respecting per-artwork `publishChannels[key] === false` opt-outs). Supports `?channel=`, `?artworkId=`, `?includeAll=1`.
   - `POST /api/automation/upload-social-image` — uploads the generated 4:5 image + 600px thumbnail to R2 (`social_4x5_...`) and updates `artworks.social_image_url` without modifying `cover_image` or `raw_image`.
   - `PATCH /api/automation/status/:id` — updates per-channel status (`pending | drafted | published | error`), `externalId`, `url`, `error`, and `updatedAt` in `publish_status_json` (and fills `instagram_url` if empty).

### Phase 2: Admin CMS Controls (`admin.html`, `admin.js`, `styles.css`)
1. **Header button `🚀 Automatizácia`:** opens `#automationModal` grouped into **Sociálne siete (4:5 štylizovaná fotka s tieňom)** and **Predajné portály (čistá fotka diela)**.
2. **Per-network ON/OFF switches (`.adm-switch`):** instantaneously persist via `PUT /api/automation/channels/:key`. Marketplaces also include a *Len koncept* (`!autoPublish`) toggle.
3. **Price & Per-Artwork Status Panel:**
   - Optional `Cena (€)` input (`#admPriceEur`) saved on artworks for Aukro/Sashe/Etsy.
   - Compact `#admPublishPanel` inside artwork edit view displaying the 4:5 stylized thumbnail (if generated), per-channel publish status pills, per-artwork opt-in/out checkboxes (`publishChannels`), and a `↺` reset button to re-queue errored or already published items.

### Phase 3: Automated Image Stylizer (`/automation/imageProcessor.js`)
Using `sharp`, transforms any clean cover image into a **4:5 portrait** (`1080×1350px`) JPEG:
1. **Background layer:** cover-cropped to `1080×1350`, heavy Gaussian blur (`blur(45)`), brightened & softened (`modulate({ brightness: 1.15, saturation: 0.9 })`).
2. **Foreground layer:** resized cleanly inside `860×1080px` preserving aspect ratio.
3. **3D Drop Shadow:** soft offset blurred shadow composited under the foreground painting.
4. **Output:** saved locally under `automation/output/` and uploaded to R2 + thumbnail via `POST /api/automation/upload-social-image`.

### Phase 4: Extensible Publisher Adapters (`/automation/publishers/`)
Every channel implements `BasePublisherAdapter` (`baseAdapter.js`) and is registered in `registry.js`:
- **Instagram & Facebook (`metaPublisher.js`):** Meta Graph API (`/{IG_USER_ID}/media` + status polling + `media_publish`; `/{FB_PAGE_ID}/photos`) using `socialImagePublicUrl`.
- **Aukro (`aukroPublisher.js`):** Aukro REST API with OAuth2 token/refresh flow, clean image upload, and draft/inactive offer creation by default.
- **Sashe.sk (`sashePublisher.js`):** Playwright browser automation (`headless: false`) with persisted session (`automation/.sessions/sashe-state.json`), fills metadata & uploads clean image, and pauses on the review/draft screen without auto-publishing.
- **Pre-prepared Social & Marketplace Adapters (`socialStubs.js`):** `pinterestAdapter` (Pinterest API v5), `tiktokAdapter` (TikTok Content Posting API), `threadsAdapter` (Meta Threads API), `xAdapter` (X API v2), and `etsyAdapter` (Etsy Open API v3) — ready with env key validation and endpoint contracts.

### Phase 5: Master CLI Runner (`/automation/run.js`)
- `npm run status` (`--dry-run`) — inspects Admin CMS switches and lists pending artworks without publishing.
- `npm run stylize` (`--stylize-only`) — generates and uploads missing 4:5 stylized images to R2.
- `npm run publish-art` — runs enabled channels from Admin CMS for all pending artworks.
- Supports targeted flags: `--ig`, `--fb`, `--aukro`, `--sashe`, `--pinterest`, `--tiktok`, `--threads`, `--x`, `--etsy`, `--channels=a,b`, `--artwork=<id>`, `--limit=<n>`.

---

## 4. Environment Variables Template (`/automation/.env.example`)
See `/automation/.env.example` for all keys (`WEB_API_BASE_URL`, `AUTOMATION_API_KEY`, Meta IG/FB, Aukro, Sashe, plus pre-prepared Pinterest, TikTok, Threads, X, and Etsy variables).
`AUTOMATION_API_KEY` must also be stored as a Cloudflare Worker secret (`npx wrangler secret put AUTOMATION_API_KEY`).
