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
