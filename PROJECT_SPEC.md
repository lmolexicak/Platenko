# PROJECT_SPEC.md — Hlavná architektúra & Znovupoužiteľná šablóna („White Cube“ digitálna galéria + CMS + 3D + WebAR)

Tento dokument slúži na dva účely:
1. **Živá technická dokumentácia projektu Plátenko Akryl** (`https://platenko.lm-olexicak.workers.dev/`, lokálne v `C:\Projects\Platenko`).
2. **Úvodná špecifikácia / blueprint pre ďalšie weby a portfóliá**, ktoré chceme na rovnakej architektúre postaviť a rozširovať bez zložitého buildu a platených serverov.

---

## 1. Prehľad & Koncept („White Cube“ digitálna galéria)

### Pre koho a na čo je táto šablóna určená
Architektúra je navrhnutá pre vizuálne orientované portfóliá a katalógy fyzických produktov/diel (obrazy, sochy, keramika, nábytok, dizajn, limitované edície), kde rozhoduje:
- **čistý múzejný minimalizmus** („White Cube“ estetika, kde pozadie ustupuje samotnému dielu),
- **nulový build krok** (čistý HTML5 + CSS3 + ES Modules — zmeny okamžite vidíš a ľahko ich udržuješ),
- **extrémne lacný a rýchly edge backend** (Cloudflare Workers + D1 SQLite + R2 object storage),
- **WOW zážitok bez externých platených SaaS platforiem** (3D virtuálna galéria + 1:1 WebAR na stene priamo v prehliadači),
- **plnohodnotné vlastné CMS** pre mobil aj desktop (fotenie, perspektívny orez, správa albumov a dynamických číselníkov).

---

## 2. Architektúra & Technologický stack

| Vrstva | Technológia | Úloha v systéme |
| :--- | :--- | :--- |
| **Frontend UI** | HTML5, CSS3 (Design Tokens, Light/Dark), Vanilla JS (ES Modules) | 2D galéria, vyhľadávanie, filtre, detail modal, `/admin` CMS, `/sorter.html` |
| **3D & WebAR Engine** | Three.js `0.170.0` (ESM cez CDN `importmap` v `index.html`) | 3D White Cube galéria, Guided Tour, WebXR `immersive-ar`, iOS `USDZExporter` |
| **Backend API & Proxy** | Cloudflare Worker (`worker.js`, `wrangler.toml`) | REST API, PBKDF2-SHA256 autentifikácia, R2 proxy s immutable cache a thumb fallbackom |
| **Databáza** | Cloudflare D1 (`platenko-db`) | Relačný katalóg diel, väzba na albumy fotiek, dynamické číselníky (`lookups`), auth sessions |
| **Úložisko médií** | Cloudflare R2 (`platenko-photos`) | Plné fotky (`paintings/...`) aj miniatúry (`thumbs/paintings/...`) |
| **Hosting & CI/CD** | GitHub (`main`, `dev`) → Cloudflare Workers Builds | Automatický deploy statických assetov + `worker.js` pri pushi na `main` |

---

## 3. Štruktúra repozitára & Mapa modulov

### Public / Verejná časť
- `index.html` — hlavná stránka katalógu, importmap pre Three.js, vstupný bod do 2D/3D/AR pohľadov
- `styles.css` — kompletný dizajnový systém (Light/Dark CSS premenné, 2-riadkový mobilný header, Justified riadky galérie, modály, Admin CMS štýly)
- `app.js` — načítanie `/api/artworks` a `/api/lookups`, dynamický Justified Equal-Height 2D grid, živé vyhľadávanie, dynamické filtre, správa URL parametrov (deep-linking)
- `detail-modal.js` — detail diela (viac fotiek v albume, metadata, `Zdieľať`, priamy prechod `/admin?edit={id}` pre prihláseného správcu)
- `gallery-3d.js` — multi-room 3D virtuálna galéria, mikro-cementová podlaha, 3500K osvetlenie, Guided Tour, kolmý Zoom-to-Fill a 2D Hi-Res crossfade
- `ar-viewer.js` — 3-úrovňový 1:1 WebAR náhľad na stene (Desktop QR, Android WebXR, iOS USDZ, Camera Fallback + kalibrácia ISO platobnou kartou, diptych/triptych drawer)
- `artworks.js` — historický statický fallback / export dát

### Admin CMS & Kurátorské nástroje
- `admin.html` & `admin.js` — unifikované Admin CMS (login brána, zoznam diel so zvýraznením aktívneho riadku, Album Photo Grid, multi-photo upload, 90° rotácie, prepojenie na orez a 3D Studio, zmena hesla, správa číselníkov)
- `perspective-warp.js` — interaktívny 4-bodový perspektívny výrez (projekčná homografia na `<canvas>`, 3× kruhová lupa, kolieskový zoom `1×–6×` na kurzor + pan, voľný alebo prehodený pomer strán)
- `cover-studio.js` — štúdio 3D obálky s nakloneným plátnom a tieňom (vrátane 3× lupy a zoomu `1×–6×`)
- `sorter.html` — vizuálny organizér poradia diel (`sort_order`) a hromadné zlučovanie albumov
- `studio.html` — pôvodný samostatný sprievodca (legacy nástroj)

### Backend, Konfigurácia & Lokálna údržba
- `worker.js` — Cloudflare Worker API + R2 media server
- `wrangler.toml` — väzby na D1 (`DB`), R2 (`IMAGES`) a statické `[assets]`
- `.assetsignore` — zoznam interných/lokálnych súborov, ktoré sa NIKDY nenasadzujú ako verejné statické assety
- `.gitignore` — chráni lokálne `.ps1`, `.sql`, `.env*`, `backups/` a `images/paintings/` pred GitHubom
- Lokálne PowerShell nástroje (gitignored, prenosné cez `$PSScriptRoot`):
  - `backup_d1.ps1` — záloha D1 tabuliek do `backups/d1_backup_*.json`
  - `upload_all_to_r2.ps1` — dávkový upload lokálnych obrázkov do R2 (AWS SigV4)
  - `generate_sql.ps1`, `folder_cleanup.ps1`, `sort_paintings.ps1`, `ai_smart_cluster.ps1`

---

## 4. Dátový model (Cloudflare D1) & R2 konvencie

### 4.1 Tabuľka `artworks`
| Stĺpec | Typ | Popis |
| :--- | :--- | :--- |
| `id` | `TEXT PRIMARY KEY` | Jednoznačný identifikátor diela (napr. `art-2023-02-01_svetelná-symfónia`) |
| `folder_name` | `TEXT UNIQUE` | Názov albumového priečinka v R2 |
| `title` | `TEXT` | Názov diela |
| `date_created` | `TEXT` | Dátum vytvorenia (`YYYY-MM-DD`) |
| `year` | `TEXT` | Rok vzniku |
| `technique` | `TEXT` | Kód techniky (viazaný na `lookups` kategórie `technique`, predvolene `Mixed`) |
| `medium` | `TEXT` | Médium / podklad (napr. `Akryl na plátne`) |
| `dimensions` | `TEXT` | Formátovaný rozmer (napr. `50 × 70 cm`) |
| `width_cm` | `REAL` | Reálna šírka v cm (pre 3D proporcie, WebAR mierku a Justified 2D grid) |
| `height_cm` | `REAL` | Reálna výška v cm |
| `depth_cm` | `REAL` | Hrúbka blindrámu v cm (predvolene `4`) |
| `instagram_url` | `TEXT` | Voliteľný odkaz na IG príspevok |
| `raw_image` | `TEXT` | Cesta k pôvodnej neupravenej titulnej fotke (ochrana originálu) |
| `sort_order` | `INTEGER` | Poradie v galérii a 3D miestnostiach |
| `status` | `TEXT` | Kód stavu (viazaný na `lookups` kategórie `status`, predvolene `Available`) |
| `description` | `TEXT` | Kurátorský popis diela |
| `cover_image` | `TEXT` | Aktívna titulná fotka zobrazovaná v galérii (napr. `cover_cropped_...jpg`) |
| `photo_count` | `INTEGER` | Počet fotiek v albume |
| `created_at` | `DATETIME` | Časová pečiatka vytvorenia záznamu |

### 4.2 Tabuľka `artwork_images`
- `id` (`INTEGER PRIMARY KEY AUTOINCREMENT`)
- `artwork_id` (`TEXT`, FK → `artworks.id`)
- `image_url` (`TEXT`, napr. `images/paintings/{folder}/{file}`)
- `is_cover` (`INTEGER`, `1` pre titulnú fotku)
- `sort_order` (`INTEGER`)

### 4.3 Tabuľka `lookups` (Dynamické číselníky)
Auto-bootstrapovaná priamo vo `worker.js` (`ensureLookupsReady`), naplnená pri prázdnej tabuľke z `DEFAULT_LOOKUPS`:
- `id`, `category` (`technique`, `status`, `medium`, `dimension_preset`), `code`, `label`, `color` (pri `status` napr. `green`, `yellow`, `gray`), `meta` (JSON, napr. `{"w":50,"h":70}` pre `dimension_preset`), `show_in_filter` (`1`/`0`), `sort_order`
- Unikátny index: `idx_lookups_cat_code` na `(category, code)`

### 4.4 Autentifikácia (`admin_auth`, `admin_sessions`)
- `admin_auth`: `id = 1`, `username`, `password_salt`, `password_hash` (PBKDF2-SHA256, 100 000 iterácií), `updated_at`
- `admin_sessions`: `token` (32 náhodných bajtov hex), `expires_at` (7 dní)
- Cookie: `platenko_session=...; Path=/; HttpOnly; SameSite=Lax` (+ `; Secure` na HTTPS)

### 4.5 R2 úložisko (`platenko-photos`)
- Plné rozlíšenie: `paintings/{folder}/{filename}` (URL `/images/paintings/{folder}/{filename}`)
- Miniatúry: `thumbs/paintings/{folder}/{filename}` (URL `/images/paintings/{folder}/{filename}?size=thumb`)
- Worker vráti thumbnail s hlavičkou `X-Platenko-Image: thumb`, alebo automaticky siahne po origináli (`original-fallback`), vždy s `Cache-Control: public, max-age=31536000, immutable`.

---

## 5. REST API Referencia (`worker.js`)

| Skupina | Metóda & Cesta | Auth | Popis |
| :--- | :--- | :--- | :--- |
| **Médiá** | `GET/HEAD /images/paintings/*` (aj `/paintings/*`) | Verejné | Servuje objekt z R2; pri `?size=thumb` preferuje `thumbs/...` s fallbackom na plný obrázok |
| **Auth** | `GET /api/auth/me` | Verejné | Overí platnosť `platenko_session` cookie |
| **Auth** | `POST /api/auth/login` | Verejné | Overí heslo cez PBKDF2-SHA256 a nastaví session cookie |
| **Auth** | `POST /api/auth/logout` | Cookie | Zmaže session z D1 a vymaže cookie |
| **Auth** | `POST /api/auth/change-password` | Admin | Zmení heslo (nová náhodná soľ) a zneplatní ostatné sessions |
| **Diela** | `GET /api/artworks` | Verejné | Vráti zoradený katalóg diel vrátane `detailImages`, `rawImage`, rozmerov |
| **Diela** | `POST /api/artworks` | Admin | Vytvorí alebo obnoví dielo vrátane uploadu obrázkov + thumbnailov do R2 |
| **Diela** | `PUT /api/artworks/:id` | Admin | Aktualizuje metadata, `date_created`/`year`, poradie fotiek, nedeštruktívne pridá orez/cover kópie do R2 a uprace osirotené súbory |
| **Diela** | `DELETE /api/artworks/:id` | Admin | Zmaže dielo, záznamy `artwork_images` a nepoužívané R2 kľúče |
| **Diela** | `POST /api/artworks/reorder` | Admin | Hromadne uloží `sort_order` |
| **Diela** | `POST /api/artworks/merge` | Admin | Zlúči fotky vybraných diel do jedného cieľového albumu |
| **Číselníky** | `GET /api/lookups` | Verejné | Vráti zoskupené číselníky (`technique`, `status`, `medium`, `dimension_preset`) |
| **Číselníky** | `POST /api/lookups` | Admin | Pridá novú položku číselníka |
| **Číselníky** | `PUT /api/lookups/:id` | Admin | Upraví label, farbu, viditeľnosť vo filtri alebo rozmery |
| **Číselníky** | `DELETE /api/lookups/:id` | Admin | Odstráni položku číselníka |
| **Číselníky** | `POST /api/lookups/reorder` | Admin | Preusporiada položky v kategórii |

---

## 6. Frontend funkcionality & UX štandardy

### 6.1 2D White Cube Galéria (`index.html`, `app.js`, `styles.css`)
- **Dynamický Justified Equal-Height Row Layout (`layoutJustifiedGallery`):**
  - Obrazy na šírku aj na výšku sa v každom desktopovom/tabletovom riadku automaticky zarovnajú na **presne rovnakú výšku** (`.gallery-row`) podľa reálneho pomeru strán (`widthCm / heightCm` alebo `naturalWidth / naturalHeight`).
  - Vznikajú kompaktné, vyvážené múzejné riadky bez prázdnych zubov a rozhádzaných spodných okrajov.
  - Na úzkych mobilných obrazovkách (`< 640px`) sa automaticky prepína do čistého 1-stĺpcového stacku (`.is-mobile-stack`) s prirodzenou výškou každého obrazu.
- **Responzívny mobilný header:** 2-riadková hlavička na úzkych obrazovkách (`390×844` overené s 0px horizontálnym pretečením).
- **Dynamické filtre & vyhľadávanie:** Filter chipy sa generujú priamo z `/api/lookups` (len položky s `showInFilter: true`), vyhľadávanie filtruje v reálnom čase podľa názvu, techniky, roku aj popisu.

### 6.2 Detail Modal & Deep-Linking (`detail-modal.js`)
- Podporované zdieľateľné URL parametre:
  - `/?dielo={id}` — otvorí priamo detail konkrétneho diela
  - `/?view=3d&dielo={id}` — vstúpi do 3D galérie priamo pred dané dielo
  - `/?dielo={id}&ar=1` — spustí 1:1 AR náhľad daného diela
- Tlačidlo **Zdieľať** využíva natívny `navigator.share` na mobile a fallback kopírovanie odkazu na desktope.
- Prihlásený správca vidí priamo v detaile akciu na otvorenie diela v CMS (`/admin.html?edit={id}`).

### 6.3 3D Virtuálna galéria & Guided Tour (`gallery-3d.js`)
- Viacmiestnostný **White Cube** priestor (`#F7F7F5`), mikro-cementová podlaha, 3500K múzejné reflektory.
- **Výkon a stabilita pamäte:** lazy-loading okno `±18` textúr okolo aktuálnej pozície, `pixelRatio <= 2`, prísne volanie `.dispose()` na textúry, geometrie a materiály pri uvoľnení scény.
- **Guided Tour + Plynulý prechod (Phase 4):** kompaktná Tour lišta (`Stop Tour + #idx/N`), kolmý pohyb kamery (Zoom-to-Fill) pred obraz a bezchybný 2D Hi-Res crossfade. Funkcia `syncEntryOrientationFromImage` automaticky zladí orientáciu 3D plátna so skutočným pomerom strán načítanej fotky.

### 6.4 3-úrovňový WebAR 1:1 náhľad (`ar-viewer.js`)
- **Tier 1 (Desktop):** QR kód na rýchle otvorenie priamo v mobile (`/?dielo={id}&ar=1`).
- **Tier 2 (Android / iOS natívny AR):** WebXR `immersive-ar` na Androide; dynamický export 3D plátna cez `USDZExporter` pre iOS Quick Look.
- **Tier 3 (Universal Camera Fallback):** živá kamera + 1-Tap kalibrácia mierky pomocou štandardnej ISO platobnej karty (`8.56 × 5.40 cm`), meradlo rozmerov na okrajoch a **Diptych / Triptych drawer** pre porovnanie 2–3 malieb vedľa seba s nastaviteľným rozostupom (`5`, `8` alebo `12 cm`).

---

## 7. Unifikované `/admin` CMS & Práca s fotkami

- **Jediné centrálne CMS (`/admin.html`):** prihlásenie cookie session, zoznam všetkých diel s automatickým zvýraznením a zachovaním aktívnej maľby po uložení (`.adm-table tr.is-active`).
- **Album Photo Grid:** nahrávanie viacerých fotiek naraz, výber titulnej fotky, zmena poradia, 90° rotácie priamo v prehliadači.
- **Nedeštruktívny workflow:**
  - 4-bodový perspektívny výrez (`perspective-warp.js`) aj 3D Cover Studio (`cover-studio.js`) **nikdy neprepíšu originálnu fotku**. Vždy vytvoria novú kópiu (`cover_cropped_...` / `cover_3d_...`), pridajú ju do `artwork_images` a nastavia ako `cover_image`, zatiaľ čo originál ostáva bezpečne v albume a v `raw_image`.
  - Oba vizuálne nástroje podporujú **kruhové 3× priblíženie (lupu)** pri ťahaní rohov/bodov a **kolieskový zoom `1×–6×` na pozíciu kurzora + posúvanie (pan)** pre presné zamierenie okrajov plátna.
- **Správca číselníkov (`⚙️ Číselníky`):** správa hodnôt pre *Techniky*, *Stavy* (vrátane farby odznaku a zobrazenia vo filtri), *Médiá* a *Predvoľby rozmerov* bez jediného zásahu do kódu.
- **Organizér (`sorter.html`):** rýchle drag-and-drop triedenie poradia diel v galérii a zlučovanie duplicitných albumov.

---

## 8. Bezpečnosť, Zálohovanie & Checklist pre spustenie nového webu

### Bezpečnostné pravidlá
- Tajné API tokeny patria výhradne do `.env.cloudflare` (lokálne) alebo do Cloudflare Secrets — nikdy do JS súborov ani Gitu.
- Všetky zmeny hesla používajú kryptograficky silnú náhodnú soľ a PBKDF2-SHA256 (`crypto.subtle`).
- Súbory `AGENTS.md`, `PROJECT_SPEC.md`, `README.md`, `*.ps1`, `*.sql` musia byť v `.assetsignore`.
- Pred každým väčším zásahom do dát spusti lokálnu zálohu D1: `powershell -NoProfile -ExecutionPolicy Bypass -File .\backup_d1.ps1`.

### Ako z tejto špecifikácie spustiť ďalší nový projekt (8 krokov)
1. **Skopíruj základ šablóny** do nového priečinka v `C:\Projects\<NovyProjekt>` (HTML/CSS/JS moduly + `worker.js` + `wrangler.toml` + `.gitignore` + `.assetsignore`).
2. **Vytvor novú Cloudflare D1 databázu a R2 bucket**, aktualizuj `name`, `database_name`, `database_id` a `bucket_name` vo `wrangler.toml`.
3. **Prispôsob vizuálnu identitu** v `styles.css` (CSS design tokens v `:root` a `[data-theme="dark"]`), logo a fonty v `index.html`.
4. **Uprav predvolené číselníky (`DEFAULT_LOOKUPS`)** vo `worker.js` podľa nového odboru (napr. kategórie produktov, materiály, stavy dostupnosti, rozmerové rady).
5. **Inicializuj schému D1** (`artworks`, `artwork_images`, `admin_auth`, `admin_sessions`; tabuľka `lookups` sa vytvorí sama) a nastav počiatočného admin používateľa.
6. **Prispôsob 3D / AR scénu** (`gallery-3d.js`, `ar-viewer.js`), ak prezentuješ iný typ predmetov než obrazy na stenu (alebo moduly vypni/prispôsob).
7. **Napoj GitHub repozitár na Cloudflare Workers Builds** (`main` ako produkčná vetva) a vlož `AGENTS.md` + túto `PROJECT_SPEC.md` do nového projektu ako projektovú pamäť pre Antigravity.
8. **Po nasadení over produkčný web** na desktope aj mobile (`390×844`), skontroluj login v `/admin`, nahratie skúšobnej položky a čistú konzolu bez sieťových chýb.
