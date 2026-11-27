# Plátenko — Lokálny Runner pre Sashe.sk (Playwright)

**Instagram, Facebook a Aukro** sa publikujú priamo z **Cloudflare Workera na 1 klik v Admin CMS** (`🚀 Publikovať teraz`) aj z mobilu — bez zapnutého PC.

Tento lokálny Node.js balík (`/automation`) slúži prioritne pre **Sashe.sk** (keďže nemá verejné API a vyžaduje prehliadač Playwright) a ako voliteľná záloha z príkazového riadka.

## Prvé nastavenie
1. Nainštaluj závislosti:
   ```bash
   cd automation
   npm install
   npx playwright install chromium
   ```
2. Skopíruj `.env.example` na `.env` a doplň `AUTOMATION_API_KEY` (rovnaký nastav ako Cloudflare Secret: `npx wrangler secret put AUTOMATION_API_KEY`).
3. V **Admin CMS → 🚀 Automatizácia → 🔑 Integrácie & Kľúče** ulož šifrované prístupy pre Meta a Aukro (pre šifrovanie v D1 nastav na Workeri secret `AUTOMATION_ENCRYPTION_KEY`).

## Príkazy
- `node run.js --sashe` — otvorí Playwright a predvyplní čakajúce diela na Sashe.sk ako koncept
- `node run.js --sashe --artwork=art-...` — predvyplní konkrétne dielo na Sashe.sk
- `npm run status` — suchý beh (`--dry-run`), vypíše zapnuté kanály a čakajúce diela
- `npm run stylize` — voliteľné lokálne generovanie 4:5 obrázka (`--stylize-only`), ak ho nevyberieš ručne cez 3D Cover Studio a tlačidlo `📱` v albume
