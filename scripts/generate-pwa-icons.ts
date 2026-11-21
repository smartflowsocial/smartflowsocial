import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";

const publicDir = join(process.cwd(), "public");
const appIconPath = join(publicDir, "AppIcon.svg");

/** Vista-style ICO that embeds one PNG. Width 256 must be stored as 0. */
function pngToIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  const dimension = size >= 256 ? 0 : size;
  entry.writeUInt8(dimension, 0);
  entry.writeUInt8(dimension, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

async function generateIcons() {
  try {
    const svgBuffer = readFileSync(appIconPath);

    // Generate apple-touch-icon.png (180x180) - required for iOS home screen
    const appleTouchIcon = await sharp(svgBuffer)
      .resize(180, 180, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
    writeFileSync(join(publicDir, "apple-touch-icon.png"), appleTouchIcon);
    console.log("✓ Generated apple-touch-icon.png (180x180)");

    // Generate icon-192.png - standard PWA icon
    const icon192 = await sharp(svgBuffer)
      .resize(192, 192, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
    writeFileSync(join(publicDir, "icon-192.png"), icon192);
    console.log("✓ Generated icon-192.png");

    // Generate icon-512.png - high-resolution PWA icon
    const icon512 = await sharp(svgBuffer)
      .resize(512, 512, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
    writeFileSync(join(publicDir, "icon-512.png"), icon512);
    console.log("✓ Generated icon-512.png");

    // Browsers request /favicon.ico even when other icons are linked.
    const faviconPng = await sharp(svgBuffer)
      .resize(32, 32, {
        fit: "contain",
        background: { r: 21, g: 22, b: 24, alpha: 1 },
      })
      .png()
      .toBuffer();
    writeFileSync(join(publicDir, "favicon.ico"), pngToIco(faviconPng, 32));
    console.log("✓ Generated favicon.ico (32x32)");

    console.log("\n✅ All PWA icons generated successfully!");
    console.log("📱 Icons are ready for iOS home screen and PWA installation.");
  } catch (error) {
    console.error("❌ Error generating icons:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
    }
    process.exit(1);
  }
}

generateIcons();
