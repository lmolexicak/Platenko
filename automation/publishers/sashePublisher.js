import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BasePublisherAdapter, MAX_PUBLISH_PHOTOS, resolveOrderedPhotos } from "./baseAdapter.js";
import { buildMarketplaceDescription } from "../captionBuilder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.resolve(__dirname, "..", ".sessions", "sashe-state.json");
const TEMP_IMG_DIR = path.resolve(__dirname, "..", "output", "tmp_clean");

class SasheAdapter extends BasePublisherAdapter {
  constructor() {
    super({
      key: "sashe",
      label: "Sashe.sk",
      kind: "marketplace",
      imageVariant: "clean",
      maxPhotos: MAX_PUBLISH_PHOTOS,
      implemented: true,
      requiredEnv: ["SASHE_BASE_URL"],
    });
  }

  getMissingEnv(env = process.env) {
    // Sashe can work with saved browser session even without credentials in .env
    if (!String(env.SASHE_BASE_URL || "").trim() && !String(env.SASHE_ADD_ITEM_URL || "").trim()) {
      return ["SASHE_BASE_URL"];
    }
    return [];
  }

  async publish(artwork, ctx) {
    const { env, apiClient, dryRun } = ctx;
    const baseUrl = String(env.SASHE_BASE_URL || "https://www.sashe.sk").replace(/\/+$/, "");
    const addUrl = String(env.SASHE_ADD_ITEM_URL || `${baseUrl}/pridat-vecicku`);
    const photoUrls = resolveOrderedPhotos(artwork, "marketplace", this.maxPhotos);

    if (photoUrls.length === 0) {
      throw new Error("Chýba čistá fotka diela pre Sashe.sk.");
    }
    if (dryRun) {
      return {
        status: "pending",
        photoCount: photoUrls.length,
        note: `[DRY-RUN] Sashe.sk Playwright koncept (${photoUrls.length} fotiek): ${artwork.title}`,
      };
    }

    await fs.mkdir(path.dirname(SESSION_PATH), { recursive: true });
    await fs.mkdir(TEMP_IMG_DIR, { recursive: true });

    const safeId = String(artwork.id || "art").replace(/[^a-zA-Z0-9._-]+/g, "_");
    const localPaths = [];
    for (let i = 0; i < photoUrls.length; i++) {
      const buf = await apiClient.downloadImageBuffer(photoUrls[i]);
      const p = path.join(TEMP_IMG_DIR, `${safeId}_${i + 1}.jpg`);
      await fs.writeFile(p, buf);
      localPaths.push(p);
    }

    let hasSavedSession = false;
    try {
      await fs.access(SESSION_PATH);
      hasSavedSession = true;
    } catch {}

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext(
      hasSavedSession ? { storageState: SESSION_PATH } : {}
    );
    const page = await context.newPage();

    try {
      await page.goto(addUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

      // If redirected to login, attempt credential fill if configured, otherwise wait for user
      const isLoginPage = /prihlas|login/i.test(page.url());
      if (isLoginPage) {
        if (env.SASHE_USERNAME && env.SASHE_PASSWORD) {
          const userInput = page.locator('input[type="email"], input[name*="nick"], input[name*="login"], input[name*="user"]').first();
          const passInput = page.locator('input[type="password"]').first();
          if (await userInput.count()) await userInput.fill(env.SASHE_USERNAME);
          if (await passInput.count()) await passInput.fill(env.SASHE_PASSWORD);
        }
        console.log("   ⏳ Dokonči prihlásenie na Sashe.sk v otvorenom prehliadači (čakám max 2 minúty)...");
        await page.waitForURL((u) => !/prihlas|login/i.test(u.href), { timeout: 120000 });
        if (page.url() !== addUrl) {
          await page.goto(addUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        }
      }

      await context.storageState({ path: SESSION_PATH });

      const titleInput = page.locator('input[name*="nazov"], input[name*="title"], #nazov').first();
      if (await titleInput.count()) {
        await titleInput.fill(String(artwork.title || ""));
      }

      const descInput = page.locator('textarea[name*="popis"], textarea[name*="description"], #popis').first();
      if (await descInput.count()) {
        await descInput.fill(buildMarketplaceDescription(artwork, ctx));
      }

      const sashePrice = artwork.portalPrices && Number(artwork.portalPrices.sashe) > 0
        ? Number(artwork.portalPrices.sashe)
        : (artwork.priceEur && Number(artwork.priceEur) > 0 ? Number(artwork.priceEur) : null);
      if (sashePrice) {
        const priceInput = page.locator('input[name*="cena"], input[name*="price"], #cena').first();
        if (await priceInput.count()) {
          await priceInput.fill(String(sashePrice));
        }
      }

      const dimsInput = page.locator('input[name*="rozmer"], input[name*="velkost"]').first();
      if (await dimsInput.count()) {
        await dimsInput.fill(String(artwork.dimensions || `${artwork.widthCm} × ${artwork.heightCm} cm`));
      }

      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count()) {
        const supportsMultiple = await fileInput.evaluate((el) => Boolean(el.multiple));
        if (supportsMultiple) {
          await fileInput.setInputFiles(localPaths);
        } else {
          await fileInput.setInputFiles(localPaths[0]);
          const allFileInputs = page.locator('input[type="file"]');
          const inputCount = await allFileInputs.count();
          for (let i = 1; i < Math.min(localPaths.length, inputCount); i++) {
            await allFileInputs.nth(i).setInputFiles(localPaths[i]).catch(() => {});
          }
        }
      }

      // Safety rule: NEVER auto-click final Publish. Pause on review/draft screen for user confirmation.
      console.log(`   ⏸️  Sashe.sk formulár je predvyplnený ako koncept (${localPaths.length} fotiek).`);
      console.log("   👉 Skontroluj kategóriu/tagy v otvorenom okne, ulož koncept a potom okno zatvor pre pokračovanie.");
      await page.waitForEvent("close", { timeout: 300000 }).catch(() => {});
      await context.storageState({ path: SESSION_PATH }).catch(() => {});

      return {
        status: "drafted",
        url: page.url(),
        photoCount: localPaths.length,
        note: `Predvyplnené v Playwright okne (${localPaths.length} fotiek, bezpečnostný režim).`,
      };
    } finally {
      await browser.close().catch(() => {});
      await Promise.all(localPaths.map((p) => fs.unlink(p).catch(() => {})));
    }
  }
}

export const sasheAdapter = new SasheAdapter();
