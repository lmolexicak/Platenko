# AGENTS.md — Plátenko Akryl Workspace Rules

## 1. Identita projektu a prostredie
- **Projekt:** Plátenko Akryl (`@platenko.akryl`) — digitálna White Cube galéria originálnych akrylových malieb
- **Produkčný web:** `https://platenko.lm-olexicak.workers.dev/`
- **GitHub repozitár:** `https://github.com/lmolexicak/Platenko.git` (vetvy `main` a `dev`)
- **Lokálny root:** `C:\Projects\Platenko`
- **Cloudflare stack:** Worker `platenko`, D1 databáza `platenko-db`, R2 bucket `platenko-photos` (konfigurácia v `wrangler.toml`)
- **Kompletná architektúra a znovupoužiteľná šablóna:** pozri `PROJECT_SPEC.md`

## 2. Komunikácia a jazyk
- Používateľ je **Mario**, asistentka je **Angie**.
- Komunikuj prirodzenou **slovenčinou**. Všetky verejné texty na webe, v Admin CMS, hláseniach a tooltipoch píš v bezchybnej slovenčine (technické identifikátory a názvy súborov ostávajú v angličtine).

## 3. Architektúra a mapa kľúčových súborov
Zero-build architektúra: čistý HTML5 + CSS3 + Vanilla JS ES Modules (Three.js 0.170 cez CDN importmap) + Cloudflare Workers (`worker.js` ako API aj proxy pre R2).
- `index.html`, `styles.css`, `app.js` — hlavná galéria: Justified Equal-Height 2D grid, vyhľadávanie, dynamické filtre z D1 číselníkov, Light/Dark téma, deep-linking (`/?dielo=`, `/?view=3d`, `/?ar=1`), ozubené koliesko `⚙️` smeruje priamo do `/admin`
- `detail-modal.js` — detail diela, album fotiek, zdieľanie, priamy prechod do CMS (`/admin?edit={id}`)
- `gallery-3d.js` — 3D White Cube virtuálna galéria (Shadow-Box plávajúce rámy s ceduľkami, prehľadný vstup do Sály 1, obvodová navigácia a plynulé prechody cez portály), Guided Tour, kolmý Zoom-to-Fill a 2D Hi-Res crossfade
- `ar-viewer.js` — 3-úrovňový WebAR 1:1 náhľad na stene (Desktop QR, Android WebXR, iOS USDZ, Camera Fallback + kalibrácia ISO platobnou kartou `8.56 × 5.40 cm`, diptych/triptych)
- `admin.html`, `admin.js`, `perspective-warp.js`, `cover-studio.js` — unifikované Admin CMS s jednotným horným menu (`.admin-subnav`: Katalóg & Editor, Organizér, Automatizácia, Číselníky, Účet & Heslo `#accountModal`, Čo je nové `/whatsnew`), podporou `?open=automation|lookups|account`, drag-and-drop poradím diel `⋮⋮` + klikateľným číslom pozície `#N`, prepínačmi automatizácie a heslom zamknutými šifrovanými integráciami `🚀 Automatizácia`, cenami pre každý portál zvlášť, album gridom s drag-and-drop poradím fotiek `⋮⋮ #N`, výberom `📱` prvej fotky pre soc. siete, 1-klik viacfotkovým publikovaním až 10 fotiek `🚀 Publikovať teraz`, multi-uploadom, 90° rotáciami, 4-bodovým orezom a 3D Cover Studiom (`1×–6×`), správcom číselníkov `⚙️ Číselníky`
- `sorter.html` — hromadné triedenie poradia a zlučovanie albumov (zdieľa rovnaké jednotné Admin menu `.admin-subnav`)
- `whatsnew.html`, `whatsnew.md` — chránená admin podstránka `/whatsnew` vykresľujúca dátumovo oddelené Markdown príspevky zmien a návodov s rýchlym skokom a vyhľadávaním
- `worker.js` — REST API (`/api/auth/*` vrátane `verify-password`, `/api/artworks/*` vrátane `:id/images/reorder`, `/api/lookups/*`, `/api/automation/*` vrátane šifrovaných integrácií, priameho multi-foto publikovania pre IG/FB/Aukro/Threads/Pinterest/TikTok/X/Etsy a týždenného Cron refreshu tokenov), `/images/paintings/*` R2 proxy + automatické thumbnaily (`thumbs/...`)
- `automation/` — lokálny Node.js CLI runner vyhradený hlavne pre `Sashe.sk` (`playwright`), napojený na `/api/automation/*` cez `AUTOMATION_API_KEY`
- `md_specs/` — technické špecifikácie (`CORE_GALLERY_SPEC.md`, `WOW_FEATURES_SPEC.md`, `ART_AUTOMATION_SPEC.md`, `SOCIAL_PUBLISHING_GUIDE.md`) vylúčené z verejného hostingu v `.assetsignore`

## 4. Pravidlá nasadzovania a verifikácie
1. **Git & CI/CD:** Push na `main` automaticky nasadzuje na Cloudflare Workers. Vetvu `dev` drž vždy zosynchronizovanú s `main`.
2. **Cache-busting:** Pri každej úprave CSS alebo JS zvýš query parameter `?v=YYYYMMDDx` v `index.html`, `admin.html`, `sorter.html` a `whatsnew.html` (pre staršie externé importy aj v `admin.js` / príslušných moduloch).
3. **Changelog `/whatsnew`:** Pri výraznejších používateľských novinkách doplň nový dátumový záznam (`## YYYY-MM-DD — ...`) navrch súboru `whatsnew.md`.
4. **Živá verifikácia:** Po nasadení over produkčný web v prehliadači na desktope aj mobile (`390×844` bez horizontálneho prelievania) s **0 console errors** a **0 failed HTTP requests**.

## 5. Bezpečnostné a dátové obmedzenia (NIKDY neporušiť)
- **Tajné údaje:** Nikdy nečítaj zbytočne, nevypisuj do odpovedí ani necommituj `.env.cloudflare`. Súbory `*.ps1`, `*.sql`, `backups/` a `images/paintings/` nesmú ísť do Gitu (`.gitignore`) ani na verejný hosting (`.assetsignore`).
- **Interná dokumentácia:** Udržuj `AGENTS.md`, `PROJECT_SPEC.md` a `README.md` zapísané v `.assetsignore`, aby ich Cloudflare `[assets]` verejne neservíroval.
- **Archív fotiek a prístup:** Nikdy neupravuj ani nemaž pôvodný archív `c:\media\platenko\fotky`. Nikdy neresetuj ani neprepisuj heslo v tabuľke `admin_auth`.
- **Nedeštruktívny orez a obálky:** 4-bodový výrez (`perspective-warp.js`) aj 3D obálka (`cover-studio.js`) musia **vždy** vytvoriť novú kópiu v R2 a `artwork_images` a zachovať originál v `raw_image` a v albume diela.
- **Windows PowerShell 5.1:** Pri zápise súborov zo skriptov používaj explicitne UTF-8 bez BOM; lokálne `.ps1` skripty spúšťaj s `-ExecutionPolicy Bypass`.
