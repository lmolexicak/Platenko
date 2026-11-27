/**
 * Builds consistent Slovak social media captions & marketplace descriptions from artwork metadata.
 */
export function buildSocialCaption(artwork, ctx = {}, options = {}) {
  const title = artwork.title || "Originálna maľba";
  const dims = artwork.dimensions || `${artwork.widthCm || 50} × ${artwork.heightCm || 70} cm`;
  const desc = (artwork.description || "").trim();
  const baseUrl = String(ctx.baseUrl || "").replace(/\/+$/, "");
  const deepLink = baseUrl ? `${baseUrl}/?dielo=${encodeURIComponent(artwork.id)}` : "";

  // Format: Názov maľby, Rozmer, Popis, Link na web, Hashtagy (bez ceny)
  const lines = [title, dims];
  if (desc) {
    lines.push("", desc);
  }
  if (deepLink) {
    lines.push("", deepLink);
  }
  lines.push(
    "",
    "#platenko #akrylnaplatne #abstraktneumenie #slovenskeumenie #originalmalba #fluidart #dutchpour #interierovydizajn"
  );

  let text = lines.join("\n");
  const maxLen = options.maxLength || 2200;
  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen - 1)}…`;
  }
  return text;
}

export function buildMarketplaceDescription(artwork, ctx = {}) {
  const dims = artwork.dimensions || `${artwork.widthCm || 50} × ${artwork.heightCm || 70} cm`;
  const depth = artwork.depthCm ? ` (hrúbka rámu ${artwork.depthCm} cm)` : "";
  const medium = artwork.medium || "Akryl na plátne";
  const baseUrl = String(ctx.baseUrl || "").replace(/\/+$/, "");
  const deepLink = baseUrl ? `${baseUrl}/?dielo=${encodeURIComponent(artwork.id)}` : "";

  const parts = [
    artwork.description ? artwork.description.trim() : `Originálna autorská maľba „${artwork.title}" od Plátenko Akryl.`,
    "",
    `• Rozmery: ${dims}${depth}`,
    `• Médium: ${medium}`,
    artwork.technique ? `• Technika: ${artwork.technique}` : "",
    "• Podklad: Napnuté plátno na drevenom ráme, ošetrené UV ochranným lakom.",
    deepLink ? `• 3D & AR náhľad diela: ${deepLink}` : "",
  ].filter(Boolean);

  return parts.join("\n");
}
