# Plátenko Akryl — Portfólio originálnych malieb

Moderná zero-build webová galéria a CMS postavená na **Cloudflare Workers + D1 + R2** a **Three.js** pre prezentáciu originálnych akrylových malieb na plátne (`@platenko.akryl`).

- **Produkčná galéria:** https://platenko.lm-olexicak.workers.dev/
- **Admin CMS:** `/admin.html` (prihlásenie, katalóg, 4-bodový výrez, 3D Cover Studio, číselníky)
- **Organizér & zlučovanie albumov:** `/sorter.html`
- **Lokálny priečinok projektu:** `C:\Projects\Platenko`

---

## Dokumentácia v repozitári
- **[AGENTS.md](AGENTS.md)** — projektové pravidlá, bezpečnostné mantinely a pracovný postup pre Antigravity.
- **[PROJECT_SPEC.md](PROJECT_SPEC.md)** — kompletná technická špecifikácia systému, dátového modelu, API a znovupoužiteľná šablóna pre nové weby.

---

## Hlavné funkcie
- **2D White Cube galéria:** dynamický **Justified Equal-Height** layout riadkov (rovnaká výška kariet pre portrait aj landscape formáty), responzívny 2-riadkový mobilný header, Light/Dark režim, živé vyhľadávanie a dynamické filtre z D1 číselníkov.
- **3D Virtuálna galéria & Guided Tour:** multi-room 3D expozícia s 3500K múzejným osvetlením, lazy-loadingom textúr a plynulým kolmým Zoom-to-Fill + Hi-Res 2D prechodom.
- **WebAR 1:1 náhľad na stene:** Desktop QR kód, Android WebXR, iOS USDZ export, univerzálny kamera fallback s kalibráciou ISO platobnou kartou (`8.56 × 5.40 cm`) a diptych/triptych režimom.
- **Unifikované `/admin` CMS:** nedeštruktívna práca s originálmi (`raw_image`), multi-photo albumy, 90° rotácie, 4-bodový perspektívny výrez a 3D Cover Studio s 3× lupou a kolieskovým zoomom (`1×–6×`), dynamický správca číselníkov (`⚙️ Číselníky`).

---

## Nasadenie & Zálohy
- **Deploy:** push na vetvu `main` automaticky nasadzuje do Cloudflare Workers (držíme `dev` zosynchronizovaný s `main`).
- **Záloha D1 databázy (lokálne):** `powershell -NoProfile -ExecutionPolicy Bypass -File .\backup_d1.ps1` (vyžaduje `.env.cloudflare`, zálohy idú do `backups/`).
