import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const CANVAS_W = 1080;
const CANVAS_H = 1350;
const MAX_FG_W = 860;
const MAX_FG_H = 1080;
const SHADOW_PAD = 44;
const SHADOW_OFFSET_X = 14;
const SHADOW_OFFSET_Y = 24;

/**
 * Generates a 4:5 (1080x1350) stylized social media JPEG from a clean artwork buffer:
 * - Blurred & brightened background derived from the painting itself
 * - Centered crisp painting with realistic 3D drop shadow
 * - Plus a 600px thumbnail for Admin CMS preview
 */
export async function generateStylizedSocialImage(inputBuffer, artworkId, outputDir) {
  const bgBuffer = await sharp(inputBuffer)
    .rotate()
    .resize(CANVAS_W, CANVAS_H, { fit: "cover", position: "centre" })
    .blur(45)
    .modulate({ brightness: 1.15, saturation: 0.9 })
    .toBuffer();

  const { data: fgBuffer, info: fgInfo } = await sharp(inputBuffer)
    .rotate()
    .resize(MAX_FG_W, MAX_FG_H, { fit: "inside", withoutEnlargement: false })
    .toBuffer({ resolveWithObject: true });

  const fgW = fgInfo.width;
  const fgH = fgInfo.height;
  const fgLeft = Math.round((CANVAS_W - fgW) / 2);
  const fgTop = Math.round((CANVAS_H - fgH) / 2);

  // Create realistic soft drop shadow rectangle under the foreground painting
  const shadowW = fgW + SHADOW_PAD * 2;
  const shadowH = fgH + SHADOW_PAD * 2;
  const shadowSvg = Buffer.from(
    `<svg width="${shadowW}" height="${shadowH}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${SHADOW_PAD}" y="${SHADOW_PAD}" width="${fgW}" height="${fgH}" rx="4" ry="4" fill="rgba(12,12,18,0.56)" />` +
    `</svg>`
  );
  const shadowBuffer = await sharp(shadowSvg)
    .blur(22)
    .toBuffer();

  const shadowLeft = Math.max(0, fgLeft - SHADOW_PAD + SHADOW_OFFSET_X);
  const shadowTop = Math.max(0, fgTop - SHADOW_PAD + SHADOW_OFFSET_Y);

  const finalBuffer = await sharp(bgBuffer)
    .composite([
      { input: shadowBuffer, left: shadowLeft, top: shadowTop },
      { input: fgBuffer, left: fgLeft, top: fgTop },
    ])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const thumbBuffer = await sharp(finalBuffer)
    .resize(600, 600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  let savedPath = null;
  if (outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    const safeName = String(artworkId || "artwork").replace(/[^a-zA-Z0-9._-]+/g, "_");
    savedPath = path.join(outputDir, `${safeName}_4x5.jpg`);
    await fs.writeFile(savedPath, finalBuffer);
  }

  return {
    buffer: finalBuffer,
    thumbBuffer,
    imageDataUrl: `data:image/jpeg;base64,${finalBuffer.toString("base64")}`,
    thumbDataUrl: `data:image/jpeg;base64,${thumbBuffer.toString("base64")}`,
    savedPath,
    width: CANVAS_W,
    height: CANVAS_H,
  };
}
