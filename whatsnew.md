# Plátenko Akryl — Novinky a návody (`/whatsnew`)

Kompletný chronologický prehľad všetkého, čo sme na projekte **Plátenko Akryl** vybudovali — od úvodného triedenia fotografií až po 3D galériu, WebAR 1:1 a cloudovú publikačnú automatizáciu.

---

## 2026-11-27 — Nové Admin menu, `/whatsnew`, viacfotkový upload (10 fotiek), zamknutie kľúčov & poradie fotiek

### Čo pribudlo
- **Priamy vstup cez ozubené koliesko (`⚙️`):** kliknutie na `⚙️` v hlavičke verejnej galérie otvorí priamo **Admin CMS** (`/admin`) bez zbytočného medzikroku.
- **Zjednotené Admin menu (`.admin-subnav`):** na všetkých admin podstránkach (`/admin`, `/sorter.html`, `/whatsnew`) máš jednotnú navigačnú lištu so 6 sekciami:
  1. `🏛️ Katalóg & Editor` (`/admin`)
  2. `📋 Organizér` (`/sorter.html`)
  3. `🚀 Automatizácia` (prepínače sietí a šifrované kľúče)
  4. `⚙️ Číselníky` (techniky, stavy, médiá, predvoľby rozmerov)
  5. `🔐 Účet & Heslo` (zmena hesla správcu a odhlásenie priamo v Admin CMS)
  6. `🆕 Čo je nové` (`/whatsnew`)
- **Podstránka `/whatsnew`:** chránený chronologický prehľad zmien a návodov generovaný z tohto súboru `whatsnew.md`, s rýchlym skokom podľa dátumov a fulltextovým vyhľadávaním.
- **Viacfotkový upload (až 10 fotiek v poradí):**
  - Pri **Instagram** (Carousel), **Facebook** (galéria v príspevku), **Threads**, **TikTok Photo Mode** (do 10), **Pinterest** (do 5), **X** (do 4), ako aj na portáloch **Aukro**, **Etsy** a **Sashe.sk** sa odošle **prvých 10 fotiek v poradí** (pri sociálnych sieťach ide ako prvá fotka označená `📱`, pri portáloch Titulná `#1`).
- **Presúvanie poradia fotiek v albume (`⋮⋮ #N`):** malé náhľady v albume diela sa dajú priamo chytiť a presunúť myšou alebo prstom; fotky za limitom `10` sú označené štítkom `mimo 10`.
- **Zamknutie záložky `🔑 Integrácie & Kľúče`:** technické polia pre API tokeny sú pri otvorení modalu automaticky zamknuté proti nechcenému zmazaniu; úpravy sa odomknú až po zadaní hesla správcu.
- **Priame 1-klik publikovanie z Cloudflare Workera & Ceny podľa portálu:** v detaile diela pribudli samostatné polia pre cenu na **Aukro / Sashe.sk / Etsy**, panel **`🚀 Publikovať teraz`** (funguje aj z mobilu bez PC pre IG, FB a Aukro) a týždenná automatická obnova končiacich tokenov cez Cron.

### Ako sa to používa
1. V galérii klikni na **`⚙️`** → prihlás sa do **Admin CMS** a v hornej lište sa preklikaj kam potrebuješ.
2. V editore diela potiahni malé náhľady fotiek za **`⋮⋮ #N`** do požadovaného poradia (poradie sa hneď uloží). Ikonou **`📱`** určíš hlavnú fotku pre sociálne siete (napr. 3D Cover), ostatné fotky pôjdu za ňou ako ďalšie slajdy.
3. Vyplň ceny a popis → klikni **`🚀 Publikovať teraz`**. Pre **Sashe.sk** (keďže nemá verejné API) použi na PC lokálny príkaz `cd automation && node run.js --sashe`.
4. Pre úpravu API tokenov otvor `🚀 Automatizácia` → `🔑 Integrácie & Kľúče` → zadaj heslo správcu → klikni **`🔓 Odomknúť úpravy`**.

---

## 2026-11-26 — Poradie diel ťahaním (`⋮⋮`), skok na pozíciu (`#N`), šablóna & základ automatizácie

### Čo pribudlo
- **Drag-and-drop poradie diel v Admin katalógu:** riadky v katalógu diel sa presúvajú úchytom **`⋮⋮`** s automatickým posúvaním zoznamu pri hornom/dolnom okraji (staré šípky `↑ / ↓` a riadkové tlačidlo orezu boli odstránené).
- **Klikateľné číslo pozície (`#N`):** kliknutím na číslo poradia zadáš presnú cieľovú pozíciu a stlačíš `Enter`.
- **Zlepšená mobilná responzivita `/admin`:** opravené pretekanie tabuľky a kariet na šírke `390×844 px`.
- **Architektúra šablóny:** vznikol návod `TEMPLATE_GUIDE.md` a aktualizovaný blueprint `PROJECT_SPEC.md` na opakované nasadenie galérie pre ďalších umelcov.
- **Základ publikačnej automatizácie (`automation/` + `ART_AUTOMATION_SPEC.md`):** pridaný lokálny CLI runner (vrátane Playwright skriptu pre **Sashe.sk**) a prepínače `ON/OFF` pre jednotlivé siete v Admin CMS.

### Ako sa to používa
- V pravom paneli **Katalóg diel** chyť dielo za **`⋮⋮`** a presuň ho vyššie/nižšie, alebo klikni priamo na číslo pozície (napr. `#12`), napíš nové číslo (napr. `2`) a potvrď klávesou `Enter`. Poradie sa hneď premietne do 2D galérie aj 3D miestností.

---

## 2026-11-25 — White Cube galéria, 3D Galéria, WebAR 1:1, Admin CMS & Dynamické číselníky

### Čo pribudlo
- **White Cube 2D Galéria:** dynamická „Justified Equal-Height“ mriežka bez orezávania okrajov plátien, čisté múzejné pozadie `#F8F8F6` (Light/Dark režim), vyhľadávanie a deep-linking odkazy (`/?dielo=...`, `/?view=3d`, `/?ar=1`).
- **3-záložkový Detail diela (`detail-modal.js`):**
  1. **Detail & Štruktúra:** hlboký zoom + WebGL **Bočné nasvietenie** (*Raking Light*), ktoré zvýrazní textúru a reliéf farby.
  2. **V interiéri:** mierkový simulátor obrazu nad pohovkou (voliteľná šírka pohovky, výška stropu a 4 farby steny).
  3. **Informácie & Dopyt:** kompletné parametre, odkaz na Instagram, e-mailový dopyt a priamy preklik **`✏️ Upraviť v CMS`**.
- **3D Virtuálna galéria (`gallery-3d.js`):** viacsálový White Cube priestor s obvodovým rozložením malieb, plávajúcimi *Shadow-Box* rámami a ceduľkami, prehľadným vstupom do Sály 1, prechodmi cez portály medzi sálami, automatickou prehliadkou (*Guided Tour*) a kolmým priblížením do Hi-Res 2D kvality.
- **WebAR 1:1 na stene (`ar-viewer.js`):**
  - Desktop vygeneruje **QR kód** pre mobil.
  - Android (WebXR), iPhone (Apple AR Quick Look `.usdz`) aj záložný kamerový náhľad s **kalibráciou podľa platobnej karty (`8,56 × 5,40 cm`)** a možnosťou zložiť si na stenu **diptych / triptych** až z 3 malieb.
- **Unifikované Admin CMS (`/admin`) & Nedeštruktívne úpravy:**
  - Fotenie kamerou mobilu alebo drag-and-drop nahratie súboru.
  - **4-bodové vyrovnanie perspektívy (`perspective-warp.js`)** s 3× lupou, zoomom `1×–6×` a otočením `±90°` + **3D Cover Studio (`cover-studio.js`)** s 3× lupou. Obe vždy vytvoria novú kópiu a **nikdy nezničia pôvodnú fotku** (`raw_image`).
- **Správca číselníkov (`⚙️ Číselníky`):** dynamické úpravy techník, stavov, médií a rozmerových predvolieb v databáze D1.

### Ako sa to používa
1. V galérii prepni hore medzi **Katalóg** a **3D Galéria** (v 3D klikaj na obrazy, podlahu alebo používaj šípky `‹ ›`).
2. V detaile obrazu použi **💡 Bočné nasvietenie** alebo **📱 Vyskúšať na stene (AR)** v reálnej veľkosti 1:1.
3. V **Admin CMS** nahraj novú fotku → vyrovnaj 4 rohy plátna → voliteľne cez `✨` vytvor 3D Cover → klikni **💾 Uložiť do cloudu**.

---

## 2026-11-23 – 2026-11-24 — Migrácia na Cloudflare Cloud (Workers, D1, R2) & Zabezpečenie

### Čo pribudlo
- **Zero-build Cloudflare stack:** backend prešiel na **Cloudflare Worker** (`worker.js`), relačnú databázu **D1** (`artworks`, `artwork_images`) a objektové úložisko **R2** pre stovky fotografií bez platených serverov.
- **Automatické miniatúry (`?size=thumb`):** rýchle načítavanie 600 px náhľadov z R2 s immutable cache a automatickým čistením nepoužitých obrázkov pri mazaní diela.
- **Prihlasovanie & ochrana (`PBKDF2-SHA256`):** cookie session autentifikácia chráni všetky zápisy do databázy a zmeny v katalógu.
- **Vizuálny podpis značky:** hlavička dostala kurzívové logo *Plátenko* (*Dancing Script*).

### Ako sa to používa
- Každá zmena v **Admin CMS** alebo **Organizéri** sa ukladá priamo do cloudovej databázy D1 a fotky do R2 — bez potreby manuálneho exportu statických súborov.

---

## 2026-11-17 – 2026-11-21 — Zrod Plátenko Akryl, AI triedenie archívu & Organizér

### Čo pribudlo
- **Vznik portfólia Plátenko Akryl:** prvá verzia galérie s vlastným SVG/PNG logom, tmavým/svetlým režimom a detailom albumov.
- **Spracovanie a AI triedenie archívu:** skripty na pretriedenie vyše 1 000 pôvodných záberov na čisté albumy malieb (422 validných fotografií v 90+ albumoch s pôvodnými názvami, technikami a dátumami).
- **Organizér malieb (`sorter.html`):** prvá hromadná tabuľka na premenovanie malieb, úpravu stavov, zlučovanie viacerých albumov do jedného celku a hromadnú organizáciu katalógu.

### Ako sa to používa
- **Organizér** (`📋 Organizér`) naďalej slúži na rýchlu hromadnú správu — hromadné prepisovanie názvov, rokov a **zlučovanie viacerých albumov** do jedného diela cez zaškrtávacie políčka.
