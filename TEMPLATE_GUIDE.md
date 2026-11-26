# TEMPLATE_GUIDE.md — Postup na vytvorenie znovupoužiteľnej šablóny z Plátenka

Tento postup spusti až vtedy, keď bude **Plátenko** doladené k maximálnej spokojnosti. Získaš tým čistý **GitHub Template**, z ktorého rozbehneš novú galériu pre ďalšieho umelca za pár minút.

---

## 1. Čistá kópia kódu (bez dát a tajných údajov)

Vytvor nový priečinok (napr. `C:\Projects\WhiteCube-Gallery-Template`) a skopíruj **len** jadro aplikácie:

**Skopírovať:**
- `index.html`, `admin.html`, `sorter.html`
- `styles.css`, `app.js`, `detail-modal.js`, `gallery-3d.js`, `ar-viewer.js`, `admin.js`, `perspective-warp.js`, `cover-studio.js`
- `worker.js`, `wrangler.toml`, `.gitignore`, `.assetsignore`
- `PROJECT_SPEC.md`, `AGENTS.md` (upravené pre šablónu)

**NIKDY nekopírovať do šablóny:**
- `.env.cloudflare` a akékoľvek API tokeny / heslá
- `images/paintings/`, `backups/`, `*.sql` dáta Plátenka a lokálne jednoúčelové `.ps1` skripty
- `.git/` históriu Plátenka
- obsah `artworks.js` (nahradiť prázdnym `window.ARTWORKS = [];`)
- `images/logo_only_IG_transparent.png` (nahradiť neutrálnym placeholder logom)

> **Tip:** Do koreňa šablóny pridaj čistý `schema.sql` (iba štruktúra tabuliek `artworks`, `artwork_images`, `admin_auth`, `admin_sessions`, bez dát a bez pevného hesla — tabuľku `lookups` si `worker.js` vytvorí sám).

---

## 2. Vyčistenie značky Plátenko & centralizácia nastavení

Vytvor spoločný konfiguračný súbor `site-config.js` (názov značky, podtitul, e-mail pre dopyty, Instagram URL, predvolené meno admina, texty hero a pätičky) a oddeľ tieto miesta naviazané na Plátenko:

- **HTML šablóny (`index.html`, `admin.html`, `sorter.html`):** `<title>`, `<meta name="description">`, logo, názov značky, hero texty, odkazy `@platenko.akryl`, predvyplnený `value="mario"` v login formulároch.
- **Frontend JS (`app.js`, `detail-modal.js`, `sorter.html`):** názvy v zdieľaní (`Plátenko · ...`), cieľový e-mail/text dopytu a `localStorage` kľúče (`platenko_theme` → neutrálny kľúč).
- **Backend (`worker.js`, `wrangler.toml`):** názov session cookie (`platenko_session` → neutrálny názov), hlavička `X-Platenko-Image`, predvolené `DEFAULT_LOOKUPS` (prispôsobiteľné pre odbor) a placeholder hodnoty vo `wrangler.toml` (`name`, `database_name`, `database_id`, `bucket_name`).
- **Dizajn & 3D scéna (`styles.css`, `gallery-3d.js`):** CSS premenné v `:root` a `[data-theme="dark"]` pre rýchly reskin, plus farby stien a rámu v `gallery-3d.js` vytiahnuté do prehľadnej konštanty navrchu súboru.

---

## 3. Aktivácia GitHub Template repozitára

1. Inicializuj nový git repozitár v priečinku šablóny (`git init`) a nahraj ho na GitHub (napr. `whitecube-gallery-template`).
2. Na GitHube otvor **Settings → General** a zaškrtni **Template repository**.

---

## 4. Spustenie nového webu pre ďalšieho umelca (5 krokov)

1. Na GitHube klikni na **Use this template → Create a new repository** a naklonuj ho do `C:\Projects\<NovyUmelec>`.
2. Vytvor novú Cloudflare **D1 databázu** a **R2 bucket**, aktualizuj `wrangler.toml` a spusti čistý `schema.sql` + nastav nové admin heslo v `admin_auth`.
3. **Reskin vzhľadu:** uprav `site-config.js`, logo, paletu/fonty v `styles.css`, `DEFAULT_LOOKUPS` vo `worker.js` a štýl sály/rámu v `gallery-3d.js`.
4. Napoj repozitár na **Cloudflare Workers Builds** (automatický deploy z `main`).
5. Over produkčný web na desktope (`1280×800`) aj mobile (`390×844`) — 0 chýb konzoly, funkčný login v `/admin`, 2D/3D galéria aj AR.

---

## 5. Pripravený prompt pre Antigravity (keď príde ten čas)

Keď bude Plátenko hotové a budeš chcieť šablónu vygenerovať automaticky, otvor novú konverzáciu a pošli mi túto správu:

> *„Podľa `TEMPLATE_GUIDE.md` vytvor v `C:\Projects\WhiteCube-Gallery-Template` čistú znovupoužiteľnú šablónu z projektu Plátenko (bez dát, fotiek, záloh a `.env.cloudflare`), vyčisti všetky odkazy na Plátenko a Maria do `site-config.js`, priprav prázdny `schema.sql` pre D1 a skontroluj `.assetsignore` aj `.gitignore`.”*
