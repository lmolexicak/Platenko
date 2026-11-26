# Plátenko — Lokálny Automation Runner

Lokálny Node.js balík (`/automation`) prepojený s Admin CMS (`🚀 Automatizácia`) na Cloudflare Worker API.

## Prvé nastavenie
1. Nainštaluj závislosti:
   ```bash
   cd automation
   npm install
   npx playwright install chromium
   ```
2. Skopíruj `.env.example` na `.env` a doplň `AUTOMATION_API_KEY` + kľúče pre siete, ktoré chceš používať.
3. Rovnaký `AUTOMATION_API_KEY` nastav na Cloudflare Worker ako secret:
   ```bash
   npx wrangler secret put AUTOMATION_API_KEY
   ```
4. V **Admin CMS → 🚀 Automatizácia** zapni prepínače pre požadované siete a portály.

## Príkazy
- `npm run status` — suchý beh (`--dry-run`), vypíše zapnuté kanály a čakajúce diela bez odoslania
- `npm run stylize` — vygeneruje a nahrá 4:5 obrázky s tieňom do R2 (`--stylize-only`)
- `npm run publish-art` — spustí publikovanie na všetky kanály zapnuté v Admin CMS
- `node run.js --artwork=art-... --ig --fb` — spracuje konkrétne dielo na vybraných sieťach

## Pridanie novej sociálnej siete
1. Implementuj adaptér v `publishers/` (rozšír `BasePublisherAdapter` alebo doplň existujúci stub v `publishers/socialStubs.js`).
2. Zaregistruj ho v `publishers/registry.js` a nastav `implemented: 1` v `DEFAULT_AUTOMATION_CHANNELS` vo `worker.js`.
