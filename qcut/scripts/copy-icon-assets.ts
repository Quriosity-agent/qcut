import sharp from "sharp";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

interface ResizeOptions {
  fit: "contain" | "cover" | "fill" | "inside" | "outside";
  background: {
    r: number;
    g: number;
    b: number;
    alpha: number;
  };
}

async function copyIconAssets(): Promise<void> {
  // Determine if we're running from dist or source
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const isCompiled = currentDir.includes(`${path.sep}dist${path.sep}`);
  const rootDir = isCompiled
    ? path.join(currentDir, "../../") // Go up from dist/scripts
    : path.join(currentDir, "../"); // Go up from scripts

  const inputPath: string = path.join(
    rootDir,
    "apps/web/public/assets/logo-v4.png"
  );

  // Ensure build directory exists
  const buildDir: string = path.join(rootDir, "build");
  fs.mkdirSync(buildDir, { recursive: true });

  // Create icon.png in build folder (256x256)
  const iconPngPath: string = path.join(buildDir, "icon.png");
  const resizeOptions: ResizeOptions = {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  };

  await sharp(inputPath).resize(256, 256, resizeOptions).toFile(iconPngPath);
  process.stdout.write("Created icon.png in build folder\n");

  // Copy to various locations that might be used
  const destinations: string[] = [
    "apps/web/public/favicon.ico",
    "apps/web/dist/favicon.ico",
  ];

  const icoPath: string = path.join(rootDir, "build/icon.ico");

  // Check if ICO file exists before trying to copy it
  if (!fs.existsSync(icoPath)) {
    process.stderr.write(`Skipping ICO copies: ${icoPath} not found\n`);
    return;
  }

  for (const dest of destinations) {
    const destPath: string = path.join(rootDir, dest);
    const destDir: string = path.dirname(destPath);

    // Ensure destination directory exists
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(icoPath, destPath);
    process.stdout.write(`Copied icon to ${dest}\n`);
  }
}

// Execute the function with error handling
copyIconAssets().catch((err: Error) => {
  process.stderr.write(`Error copying icon assets: ${err.message}\n`);
  process.exit(1);
});
