# AUDIT_PROGRESS — implementácia auditu (po dávkach)

Pravidlá: jedna dávka na odpoveď, minimálne cielené zmeny, po dávke kontrola syntaxe a zastavenie.
Interné súbory: `AUDIT_PROGRESS.md` nepatrí na verejný hosting (pozri poznámku dole).

## Dávka A — Rýchle poistky ✅
- [x] **#9** `images/paintings/` pridané do `.assetsignore` (lokálny `wrangler deploy` už nenahrá 665 MB fotiek ako statické assety). *Zmenené: `.assetsignore`*
- [x] **#12** `renderer.forceContextLoss()` po `renderer.dispose()` pri zatvorení 3D galérie. *Zmenené: `gallery-3d.js`*
- [x] **#5** Verejné `GET /api/artworks` už nevracia `publishStatus`, `portalPrices`, `publishChannels`, `rawImage` (len prihlásený admin ich dostane); chyba 500 vracia všeobecnú správu a detail ide len do `console.error`. *Zmenené: `src/artworks.js`*
- Cache-busting `?v=20261127f` → `20261127g`. *Zmenené: `index.html`, `admin.html`, `sorter.html`, `whatsnew.html`, `app.js`*
- Poznámka: `node` nie je na PATH, `node --check` sa nedal spustiť; zmeny som skontroloval ručne cez `git diff`.
- Poznámka k #5: `err.message` ostáva v ostatných 500-kách (iné route). Rieši sa neskôr podľa potreby.

## Dávka B — XSS & Bezpečnosť dopytov ✅
- [x] **#1** Stored XSS v `admin.js` (escapovanie polí v `renderInquiriesList()`, `renderIntegrationsList()`, `renderArtworkPublishPanel()`, `publishNowForArtwork()`, `renderInventory()`) + limity dĺžky polí a validácia kontaktu v `src/site.js`. *Zmenené: `admin.js`, `src/site.js`*
- [x] **#2** Escapovanie textov diel / chýb API cez `escapeHtml` helper v `app.js` (`renderNextBatch`), `detail-modal.js` (`open` miniatúry) a `admin.js`. *Zmenené: `app.js`, `detail-modal.js`, `admin.js`*
- [x] **#8** Anti-spam `/api/inquiry`: skryté honeypot pole `website` (`index.html`, `detail-modal.js`, `src/site.js`), `maxlength` atribúty, D1 rate-limit max 5 dopytov za 15 minút podľa `sender_ip` (vrátane migrácie stĺpca `sender_ip`), `AbortSignal.timeout(8000)` + `ctx.waitUntil` pre webhook a všeobecná 500 chybová hláška. *Zmenené: `worker.js`, `src/site.js`, `index.html`, `detail-modal.js`*
- Kontrola po Gemini: doplnené escapovanie v `ar-viewer.js` a `sorter.html`, honeypot premenovaný na `inquiryHp`/`hp_extra_field` (ochrana pred autofillom). Cache-busting `20261128c`.
- Cache-busting `?v=20261128a` → `20261128b`. *Zmenené: `index.html`, `admin.html`, `sorter.html`, `whatsnew.html`, `app.js`*

## Dávka C — Bezpečné publikovanie & Zámok ⬜
- [ ] **#3** Ochrana proti duplicitnému publikovaniu (`src/automation.js`, `admin.js`)
- [ ] **#10** `INSERT OR REPLACE` v `POST /api/artworks` nesmie mazať stav publikovania
- [ ] **#6** Serverový zámok zápisu integrácií + allowlist `apiBaseUrl`

## Dávka D — Draft stav & Potvrdenie v Adminovi ⬜
- [ ] **#4** Draft stav + checklist pred zverejnením
- [ ] **#19** Potvrdenie pred publikovaním, jemnejšie mazanie, vlastné dialógy

## Dávka G1 — OG obrázok & Skrytie `/whatsnew.md` ✅
- [x] **#14** OG obrázok pri zdieľaní (`social_image_url` / `?size=thumb`, absolútne percent-enkódované URL, `og:image:width`, `og:image:height`, `og:image:alt`, `twitter:image:alt`, `<link rel="canonical">`). *Zmenené: `src/site.js`*
- [x] **#21** Ochrana `/whatsnew.md` na strane Workera (kontrola admin session + `run_worker_first` + `Cache-Control: private, no-store`). *Zmenené: `wrangler.toml`, `worker.js`, `whatsnew.html`*

## Dávka G2 — Výkon, Cache & Odstránenie starého fallbacku ✅
- [x] **#13** `caches.default` + `ETag`/304 pre R2 obrázky, flag `lookupsReady` v `ensureLookupsReady`, `Cache-Control: public, max-age=60, stale-while-revalidate=300` + `Vary: Cookie` pre verejné GET endpointy (`/api/artworks`, `/api/lookups`, `/api/site-settings`). *Zmenené: `worker.js`, `src/utils.js`, `src/lookups.js`, `src/artworks.js`, `src/site.js`*
- [x] **#16** `loading="eager"` a `fetchpriority="high"` pre prvých 6 kariet, rozšírený `clampRatio` (`0.3`–`3.2`) a `object-fit: contain`. *Zmenené: `app.js`, `styles.css`*
- [x] **#20** Odstránenie zastaraného `artworks.js` (122 KB) aj fallback logiky naň, čistá chybová hláška s tlačidlom „Skúsiť znova“. *Zmenené: `artworks.js` (zmazaný), `app.js`, `sorter.html`, `index.html`*
- Cache-busting `?v=20261127g`/`h` → `20261127i`. *Zmenené: `index.html`, `admin.html`, `sorter.html`, `whatsnew.html`, `app.js`*

## Dávka G3 — Bezpečnostné hlavičky, Timeouty API & 3D mobilný výkon ✅
- [x] **#22** Vytvorený `_headers` (`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `CSP frame-ancestors 'self'; object-src 'none'`) + `Access-Control-Allow-Origin` zúžené na same-origin pre `/api/*` (`*` ostáva len pre R2 obrázky). *Zmenené: `_headers`, `src/utils.js`, `worker.js`*
- [x] **#23** `safeFetch` helper s `AbortSignal.timeout(15000)` na všetky externé volania v `src/automation.js` + presun `access_token` z URL query do `Authorization: Bearer` hlavičky pri Meta Graph GET volaniach. *Zmenené: `src/automation.js`*
- [x] **#18** Na dotykových zariadeniach `pixelRatio` max `1.5` a vypnutý `antialias`; pozastavenie render slučky pri `document.hidden` a pri nečinnosti kamery (on-demand `requestRender()`). *Zmenené: `gallery-3d.js`*
- Cache-busting `?v=20261127i` → `20261127j`. *Zmenené: `index.html`, `admin.html`, `sorter.html`, `whatsnew.html`, `app.js`*

## ASCII migrácia (D1 + R2), prevencia diakritiky & oprava OG náhľadov
- [x] **Krok 1 — `toAsciiSlug` prevencia pre budúce diela a R2 uploady:** Pridaný jednotný helper `toAsciiSlug(text)` a `toAsciiFilename(filename)` v `src/utils.js`, aplikovaný na `uploadDataImageWithThumb` (R2 kľúče `paintings/<ascii-folder>/<ascii-prefix>-<ts>-<rand>.<ext>`), `POST /api/artworks` (normalizácia `id` aj `folder_name`), `PUT/POST /api/artworks/:id` a `POST /api/automation/upload-social-image` (sanitizácia R2 priečinka bez zásahu do existujúceho D1 `id`) a v `admin.js` (`toAsciiSlug`, `saveArtworkForm`). Cache-busting `?v=20261127j` → `20261127k`. *Zmenené: `src/utils.js`, `src/artworks.js`, `src/automation.js`, `admin.js`, `admin.html`, `index.html`, `sorter.html`, `whatsnew.html`, `app.js`*
- [x] **Krok 2 — Bezpečný migračný nástroj** (D1 záloha → Dry-run → Copy & Update → Oddelený Cleanup)
  - Pripravený a nasadený endpoint `/api/admin/migrate-ascii` ([src/migrate.js](file:///c:/Projects/Platenko/src/migrate.js), [worker.js](file:///c:/Projects/Platenko/worker.js)).
  - **Záloha D1:** `backups/d1_prod_backup_2026-11-27_225059.sql` (`181.04 KB`, 9 tabuliek).
  - **Dry-run:** `90` diel, `423` R2 objektov (+ `423` thumbnailov), `0` kolízií, `0` chýbajúcich R2 zdrojov, `0` neočakávaných D1 stĺpcov (`backups/migration_dry_run_2026-11-27.json`).
  - **Režim 2 (`migrate`) dokončený:** všetkých `90 / 90` diel a R2 kľúčov (`420` záznamov `artwork_images` + `cover_image`/`raw_image`/`social_image_url`) bezpečne skopírovaných a zaktualizovaných v D1 (`0` chýb, `0` zmazaných starých R2 objektov).
  - **Režim 3 (`cleanup`) dokončený po vizuálnej kontrole:** `422` starých R2 kľúčov (+ ich `thumbs/...`) bezpečne zmazaných; `1` kľúč (`paintings/2024-04-10_modrá-dynamika/IMG_20240410_104439557_1.jpg`) ostal preskočený (v D1 už nemá žiadne odkazy a jeho nová ASCII kópia aj thumbnail vracajú `200 OK`). Kontrola celej D1 po cleanupe: `BAD_ART_COUNT=0`, `BAD_IMG_COUNT=0`, vzorové `HEAD` kontroly fotiek a `?size=thumb` vracajú `200 OK`. Dočasný endpoint `src/migrate.js` a routa vo `worker.js` boli odstránené.
- [x] **Krok 3 — Oprava OG obrázka a zdieľania** *(preskočené po dohode s Máriom — po ASCII migrácii OG náhľady na Facebooku a mobilnom Messengeri fungujú)*
