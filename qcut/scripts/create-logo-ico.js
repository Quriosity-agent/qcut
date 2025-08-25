const sharp = require("sharp");
const fs = require("fs").promises;
const path = require("path");
const toIco = require("to-ico");

async function createIcon() {
  const inputPath = path.join(
    __dirname,
    "../apps/web/public/assets/logo-v4.png"
  );
  const icoPath = path.join(__dirname, "../build/icon.ico");

  // Ensure build directory exists
  const buildDir = path.dirname(icoPath);
  await fs.mkdir(buildDir, { recursive: true });

  // Backup existing icon if it exists
  try {
    await fs.access(icoPath);
    await fs.rename(icoPath, path.join(buildDir, "icon-backup.ico"));
  } catch {
    // Icon doesn't exist, no backup needed
  }

  // Create multiple sizes for ICO - Windows standard sizes
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  for (const size of sizes) {
    const buffer = await sharp(inputPath)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    pngBuffers.push(buffer);
  }

  // Convert PNG buffers to ICO using to-ico
  const icoBuffer = await toIco(pngBuffers);
  await fs.writeFile(icoPath, icoBuffer);
}

createIcon().catch((err) => {
  process.stderr.write(`create-logo-ico failed: ${err?.message || err}\n`);
  process.exitCode = 1;
});
