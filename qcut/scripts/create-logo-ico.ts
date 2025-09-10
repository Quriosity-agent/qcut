import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import toIco from 'to-ico';
import { fileURLToPath } from 'node:url';

interface ResizeOptions {
  fit: "contain" | "cover" | "fill" | "inside" | "outside";
  background: {
    r: number;
    g: number;
    b: number;
    alpha: number;
  };
}

async function createIcon(): Promise<void> {
  // Determine if we're running from dist or source
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const isCompiled = scriptDir.includes(`${path.sep}dist${path.sep}`);
  const rootDir = isCompiled
    ? path.join(scriptDir, '../../') // Go up from dist/scripts
    : path.join(scriptDir, '../');   // Go up from scripts

  const inputPath: string = path.join(
    rootDir,
    "apps/web/public/assets/logo-v4.png"
  );
  const icoPath: string = path.join(rootDir, "build/icon.ico");

  // Ensure build directory exists
  const buildDir: string = path.dirname(icoPath);
  await fs.mkdir(buildDir, { recursive: true });

  // Backup existing icon if it exists
  try {
    await fs.access(icoPath);
    await fs.rename(icoPath, path.join(buildDir, "icon-backup.ico"));
  } catch {
    // Icon doesn't exist, no backup needed
  }

  // Create multiple sizes for ICO - Windows standard sizes
  const sizes: number[] = [16, 32, 48, 64, 128, 256];
  const pngBuffers: Buffer[] = [];

  const resizeOptions: ResizeOptions = {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  };

  for (const size of sizes) {
    const buffer: Buffer = await sharp(inputPath)
      .resize(size, size, resizeOptions)
      .png()
      .toBuffer();

    pngBuffers.push(buffer);
  }

  // Convert PNG buffers to ICO using to-ico
  const icoBuffer: Buffer = await toIco(pngBuffers);
  await fs.writeFile(icoPath, icoBuffer);
}

createIcon().catch((err: Error) => {
  process.stderr.write(`create-logo-ico failed: ${err?.message || err}\n`);
  process.exitCode = 1;
});
