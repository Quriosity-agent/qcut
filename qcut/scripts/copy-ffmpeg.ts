/**
 * Cross-platform FFmpeg resource copying script
 *
 * Copies FFmpeg binaries and dependencies to the packaged Electron app.
 * Only runs on Windows since the package:win target is Windows-specific.
 */

import { cp } from "node:fs/promises";
import { platform } from "node:os";
import { existsSync } from "node:fs";

// Only run on Windows for the Windows packaging target
if (platform() !== "win32") {
  console.log("Skipping FFmpeg copy on non-Windows platform");
  process.exit(0);
}

const sourceDir: string = "electron/resources";
const targetDir: string = "dist-packager-new/QCut-win32-x64/resources";

try {
  // Check if source directory exists
  if (!existsSync(sourceDir)) {
    console.warn(
      `Source directory ${sourceDir} not found, skipping FFmpeg copy`
    );
    process.exit(0);
  }

  console.log(`Copying FFmpeg resources from ${sourceDir} to ${targetDir}...`);

  // Copy all resources recursively with force overwrite
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
  });

  console.log("✅ FFmpeg resources copied successfully");
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("❌ Failed to copy FFmpeg resources:", errorMessage);
  process.exit(1);
}
