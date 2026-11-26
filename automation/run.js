import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PlatenkoApiClient } from "./apiClient.js";
import { generateStylizedSocialImage } from "./imageProcessor.js";
import { getAdapter } from "./publishers/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "output");

function parseCliArgs(argv) {
  const args = {
    dryRun: false,
    stylizeOnly: false,
    artworkId: "",
    limit: 0,
    explicitChannels: new Set(),
  };

  const flagAliases = {
    "--ig": "instagram",
    "--instagram": "instagram",
    "--fb": "facebook",
    "--facebook": "facebook",
    "--aukro": "aukro",
    "--sashe": "sashe",
    "--pinterest": "pinterest",
    "--tiktok": "tiktok",
    "--threads": "threads",
    "--x": "x",
    "--etsy": "etsy",
  };

  for (const raw of argv) {
    if (raw === "--dry-run") {
      args.dryRun = true;
    } else if (raw === "--stylize-only") {
      args.stylizeOnly = true;
    } else if (raw.startsWith("--artwork=")) {
      args.artworkId = raw.slice("--artwork=".length).trim();
    } else if (raw.startsWith("--limit=")) {
      args.limit = Math.max(0, parseInt(raw.slice("--limit=".length), 10) || 0);
    } else if (raw.startsWith("--channels=")) {
      raw
        .slice("--channels=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((k) => args.explicitChannels.add(k));
    } else if (flagAliases[raw]) {
      args.explicitChannels.add(flagAliases[raw]);
    }
  }
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const apiClient = new PlatenkoApiClient(process.env.WEB_API_BASE_URL, process.env.AUTOMATION_API_KEY);

  console.log("🚀 Plátenko Multi-Channel Automation Runner");
  console.log(`   API: ${apiClient.baseUrl}${args.dryRun ? " [DRY-RUN]" : ""}${args.stylizeOnly ? " [STYLIZE-ONLY]" : ""}`);

  const data = await apiClient.getPending({
    artworkId: args.artworkId || undefined,
    includeAll: Boolean(args.artworkId || args.explicitChannels.size > 0),
  });

  const channelMap = new Map((data.channels || []).map((c) => [c.key, c]));
  const enabledKeys = new Set(data.enabledChannelKeys || []);

  // Honor Admin CMS toggles unless user explicitly forced specific CLI flags
  const targetChannelKeys = args.explicitChannels.size > 0
    ? Array.from(args.explicitChannels)
    : Array.from(enabledKeys);

  console.log("\n📡 Stav prepínačov z Admin CMS:");
  for (const ch of data.channels || []) {
    const state = ch.enabled ? "ON " : "OFF";
    const impl = ch.implemented ? "pripravené" : "predpríprava";
    const forced = args.explicitChannels.has(ch.key) && !ch.enabled ? " (vynútené cez CLI)" : "";
    console.log(`   - [${state}] ${ch.label} (${ch.key}, ${impl})${forced}`);
  }

  let artworks = data.artworks || [];
  if (args.limit > 0) {
    artworks = artworks.slice(0, args.limit);
  }

  if (!args.stylizeOnly && targetChannelKeys.length === 0) {
    console.log("\nℹ️  V Admin CMS nie je zapnutá žiadna sieť a neboli zadané CLI vlajky (--ig --fb --aukro --sashe).");
    console.log("   Zapni požadované kanály v Admin CMS -> 🚀 Automatizácia alebo spusti --stylize-only.");
    return;
  }

  if (artworks.length === 0) {
    console.log("\n✅ Všetky diela sú pre zapnuté kanály spracované.");
    return;
  }

  const needsStylized = args.stylizeOnly || targetChannelKeys.some((k) => {
    const adapter = getAdapter(k);
    return adapter && adapter.imageVariant === "stylized";
  });

  let processedCount = 0;
  for (const art of artworks) {
    const perArtPending = targetChannelKeys.filter((k) => {
      if (art.publishChannels && art.publishChannels[k] === false) return false;
      const st = art.publishStatus && art.publishStatus[k] && art.publishStatus[k].status;
      return st !== "published" && st !== "drafted";
    });

    const shouldStylize = needsStylized && !art.socialImageUrl;
    if (!shouldStylize && perArtPending.length === 0) {
      continue;
    }

    processedCount++;
    console.log(`\n🎨 [${processedCount}] ${art.title} (${art.id})`);

    // Step A: Generate & upload 4:5 stylized image if missing and needed
    if (shouldStylize) {
      if (!art.cleanImageUrl) {
        console.log("   ⚠️  Chýba cover fotka — preskakujem stylizáciu.");
      } else {
        console.log("   🖼️  Generujem 4:5 (1080×1350) štylizovaný obrázok s tieňom...");
        const cleanBuf = await apiClient.downloadImageBuffer(art.cleanImageUrl);
        const stylized = await generateStylizedSocialImage(cleanBuf, art.id, OUTPUT_DIR);
        console.log(`   💾 Lokálna kópia: ${stylized.savedPath}`);
        if (!args.dryRun) {
          const uploaded = await apiClient.uploadSocialImage({
            artworkId: art.id,
            imageDataUrl: stylized.imageDataUrl,
            thumbDataUrl: stylized.thumbDataUrl,
          });
          art.socialImageUrl = uploaded.socialImageUrl;
          art.socialImagePublicUrl = uploaded.publicUrl;
          console.log(`   ☁️  Nahraté do R2: ${uploaded.publicUrl}`);
        }
      }
    }

    if (args.stylizeOnly) continue;

    // Step B: Dispatch to each pending enabled channel
    for (const key of perArtPending) {
      const adapter = getAdapter(key);
      const channelConfig = channelMap.get(key) || { key, autoPublish: false };

      if (!adapter) {
        console.log(`   ⚠️  Neznámy adaptér pre kanál „${key}" — preskakujem.`);
        continue;
      }

      if (!adapter.implemented) {
        const res = await adapter.publish(art, { env: process.env, apiClient, baseUrl: data.baseUrl, channelConfig, dryRun: args.dryRun });
        console.log(`   ⏭️  ${adapter.label}: ${res.note}`);
        continue;
      }

      const missingEnv = adapter.getMissingEnv(process.env);
      if (missingEnv.length > 0) {
        console.log(`   🔑 ${adapter.label}: chýbajú premenné v .env (${missingEnv.join(", ")}) — preskakujem.`);
        continue;
      }

      try {
        console.log(`   📤 Publikujem na ${adapter.label}...`);
        const res = await adapter.publish(art, {
          env: process.env,
          apiClient,
          baseUrl: data.baseUrl,
          channelConfig,
          dryRun: args.dryRun,
        });
        console.log(`   ✅ ${adapter.label}: ${res.status}${res.url ? ` (${res.url})` : ""}${res.note ? ` — ${res.note}` : ""}`);

        if (!args.dryRun && (res.status === "published" || res.status === "drafted")) {
          await apiClient.patchStatus(art.id, {
            channel: key,
            status: res.status,
            externalId: res.externalId || "",
            url: res.url || "",
            note: res.note || "",
          });
        }
      } catch (err) {
        console.error(`   ❌ ${adapter.label} chyba: ${err.message}`);
        if (!args.dryRun) {
          await apiClient.patchStatus(art.id, {
            channel: key,
            status: "error",
            error: err.message,
          }).catch(() => {});
        }
      }
    }
  }

  console.log(`\n🏁 Hotovo. Spracovaných diel: ${processedCount}.`);
}

main().catch((err) => {
  console.error("❌ Kritická chyba automatizácie:", err);
  process.exit(1);
});
