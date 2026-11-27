# Art Gallery Multi-Channel Publishing & Automation Spec

## 1. Project Context & Goal
We have an existing artist portfolio web application deployed on **Cloudflare** (Cloudflare Workers + static `[assets]`, Cloudflare D1 database, and Cloudflare R2 storage).
The goal is to provide a self-sufficient, 1-click multi-channel publishing pipeline inside Admin CMS (usable even from a mobile phone, without needing a PC running):
1. **Manual 3D / Social Photo & Ordered Multi-Photo Upload (max 10):** The artist prepares 3D Cover images manually via **3D Cover Studio** (`cover-studio.js`), reorders thumbnails directly inside the album grid (`⋮⋮ #N` drag-and-drop), and marks the preferred first photo for social media with **`📱`** (`social_image_url`). Up to the **first 10 ordered photos** are published:
   - Social channels (`Instagram` Carousel, `Facebook` multi-photo feed, `Threads` Carousel, `TikTok` Photo Mode, `Pinterest` up to 5, `X` up to 4): `📱` photo first (if selected), followed by remaining album photos in order.
   - Marketplaces (`Aukro`, `Sashe.sk`, `Etsy`): first 10 album photos starting from Cover (`#1`).
2. **Direct Cloudflare Worker Publishing:** Published directly on 1 click (**`🚀 Publikovať teraz`**) from Admin CMS for Meta (`Instagram` / `Facebook`), `Aukro` (draft by default), plus multi-photo ready handlers for `Threads`, `Pinterest`, `TikTok`, `X`, and `Etsy` once credentials are entered.
3. **Sashe.sk Browser Automation:** Since Sashe.sk has no public REST API, a dedicated local **Playwright** script (`/automation/run.js --sashe`) uploads up to 10 ordered clean images, fills the form, and pauses at the review/draft screen.
4. **Per-Network Switches & Super-Admin Locked Integrations (`🚀 Automatizácia`):** Admin CMS provides individual ON/OFF switches per channel plus a password-locked **Integrácie & Kľúče** tab (default locked on modal open/close; unlocked via `POST /api/auth/verify-password`) where tokens/IDs are encrypted (AES-256-GCM via `AUTOMATION_ENCRYPTION_KEY`), tested live, and refreshed automatically by a weekly Cloudflare Cron Trigger.
5. **Per-Portal Pricing:** Each artwork supports a base `priceEur` plus optional overrides per marketplace (`portalPrices`: `aukro`, `sashe`, `etsy`).
6. **Extensible Adapter Architecture:** Pre-prepared channels & integrations for **Pinterest, TikTok, Threads, X (Twitter), and Etsy** ready to activate with credentials and API calls.

---

## 2. Social Caption & Marketplace Formatting
- **Social Media (`Instagram`, `Facebook`, etc.) — NO price:**
  ```text
  {Názov maľby}
  {Rozmer}

  {Kurátorský popis}

  https://platenko.lm-olexicak.workers.dev/?dielo={id}

  #platenko #akrylnaplatne #abstraktneumenie #slovenskeumenie #originalmalba #fluidart #dutchpour #interierovydizajn
  ```
- **Marketplaces (`Aukro`, `Sashe.sk`, `Etsy`):** clean artwork image (`cover_image`), portal-specific price (fallback to base `price_eur`), structured specs, and deep-link.

---

## 3. Architecture & Implemented Components

### Phase 1: Database, AES-GCM Crypto & Worker API (`worker.js`, `wrangler.toml`)
1. **Idempotent auto-migration (`ensureAutomationSchema`):**
   - `artworks` columns: `price_eur`, `portal_prices_json`, `social_image_url`, `publish_status_json`, `publish_channels_json`.
   - `automation_channels`: 9 seeded channels (`instagram`, `facebook`, `aukro`, `sashe`, plus pre-prepared `pinterest`, `tiktok`, `threads`, `x`, `etsy`), all `enabled = 0` by default.
   - `automation_integrations`: encrypted credential store (`provider`, `auth_type`, `encrypted_credentials`, `account_id`, `account_name`, `status`, `expires_at`, `last_checked_at`, `last_error`), ready for future OAuth flows (`auth_type = 'oauth'`).
2. **Credential Security & Weekly Cron:**
   - Credentials saved in Admin UI are encrypted with **AES-256-GCM** using `AUTOMATION_ENCRYPTION_KEY` (stored in Cloudflare Secrets) and are **never sent back to the browser**.
   - Fallback to Cloudflare Worker Secrets (`META_ACCESS_TOKEN`, `AUKRO_ACCESS_TOKEN`, etc.) when no DB credential is saved.
   - Weekly Cron Trigger (`[triggers] crons = ["0 3 * * 1"]` → `scheduled()` in `worker.js`) automatically exchanges/refreshes expiring Meta and Aukro tokens (within 14 days of expiry) and flags `status = 'error'` in Admin CMS if refresh fails.
3. **API Endpoints (Bearer `AUTOMATION_API_KEY` or Admin cookie session):**
   - `POST /api/auth/verify-password` — verifies Super-Admin password to unlock the Integrations & Keys editor without altering the session.
   - `POST /api/artworks/:id/images/reorder` — atomically saves reordered album thumbnail URLs (`cover_image`, `artwork_images.sort_order`, `is_cover`, `photo_count`).
   - `GET / PUT /api/automation/channels` — channel switches & pending summary.
   - `GET / PUT / DELETE /api/automation/integrations/:provider` — masked status & encrypted credential storage.
   - `POST /api/automation/integrations/:provider/test` — live upstream verification (`@ig_username`, Facebook Page name, Aukro user) + token expiry check.
   - `POST /api/automation/integrations/refresh` — manual trigger for token refresh.
   - `POST /api/automation/publish/:id` — direct 1-click publishing to selected channels with independent per-channel error isolation.
   - `GET /api/automation/pending`, `POST /api/automation/upload-social-image`, `PATCH /api/automation/status/:id` — queue/status sync (used by Sashe Playwright runner & status resets).

### Phase 2: Admin CMS UI (`admin.html`, `admin.js`, `styles.css`)
- **Ceny (€):** base `priceEur` + per-portal inputs for `Aukro`, `Sashe.sk`, and `Etsy`.
- **Album Photo Picker (`📱`) & Drag-and-Drop Reorder (`⋮⋮ #N`):** thumbnail cards support drag-and-drop reordering persisted immediately to D1 (first 10 photos used for multi-photo publishing) and **`📱`** to designate the 1st social-media image.
- **Per-Artwork Publish Panel (`#admPublishPanel`):** checkboxes for target channels, status badges, `↺` reset button, and **`🚀 Publikovať teraz`** button that saves changes and publishes up to 10 ordered photos per channel with result counts.
- **`🚀 Automatizácia` Modal:** two tabs — **🔀 Kanály (ON/OFF)** and **🔑 Integrácie & Kľúče** (protected by a Super-Admin password lock by default, with live *Otestovať pripojenie*, *Odpojiť*, and *Obnoviť tokeny*).

### Phase 3: Local Sashe.sk Runner (`/automation/`)
- Dedicated to **Sashe.sk** via Playwright (`headless: false`, persisted `.sessions/sashe-state.json`, pauses before final publish, uses `portalPrices.sashe ?? priceEur`).
- Optional fallback 4:5 `sharp` stylizer remains available via `npm run stylize` if needed.

---

## 4. Cloudflare Secrets & Environment Setup
- **Required on Cloudflare Worker for UI-stored Integrations:**
  - `AUTOMATION_ENCRYPTION_KEY` — random 32+ char secret (`npx wrangler secret put AUTOMATION_ENCRYPTION_KEY`)
  - Optional `AUTOMATION_API_KEY` — Bearer token for local Sashe CLI (`automation/.env`)
- **Optional fallback secrets / local `.env`:** see `/automation/.env.example`.
