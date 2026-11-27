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

## Dávka B — XSS & Bezpečnosť dopytov ⬜
- [ ] **#1** Stored XSS v `admin.js` (dopyty) + limity dĺžky polí v `src/site.js`
- [ ] **#2** Escapovanie textov diel / chýb API (`app.js`, `detail-modal.js`, `admin.js`)
- [ ] **#8** Anti-spam `/api/inquiry` (rate-limit/honeypot, limity polí, `ctx.waitUntil` pre webhook)

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
