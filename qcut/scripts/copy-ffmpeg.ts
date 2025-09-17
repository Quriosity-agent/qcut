/**
 * Cross-platform FFmpeg resource copying script
 *
 * Copies FFmpeg native binaries and dependencies to the packaged Electron app.
 * Excludes WebAssembly files which are managed as npm dependencies.
 * Only runs on Windows since the package:win target is Windows-specific.
 */

import { cp, readdir, mkdir, copyFile } from "node:fs/promises";
import { platform } from "node:os";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";

// Only run on Windows for the Windows packaging target
if (platform() !== "win32") {
  console.log("Skipping FFmpeg copy on non-Windows platform");
  process.exit(0);
}

const sourceDir: string = "electron/resources";
const targetDir: string = "dist-packager-new/QCut-win32-x64/resources";

// Files and extensions to include (native binaries only)
const allowedExtensions = [".exe", ".dll"];
const allowedFiles = ["README.md"];

/**
 * Recursively copies allowed files from source to target directory
 * Skips WebAssembly files and directories containing only WebAssembly files
 */
async function copyAllowedFiles(
  srcDir: string,
  destDir: string
): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });

  // Create destination directory
  if (!existsSync(destDir)) {
    await mkdir(destDir, { recursive: true });
  }

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      // Skip ffmpeg subdirectory (contains only WebAssembly files)
      if (entry.name === "ffmpeg") {
        console.log(`⏭️  Skipping WebAssembly directory: ${entry.name}`);
        continue;
      }

      // Recursively copy allowed files from subdirectories
      await copyAllowedFiles(srcPath, destPath);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();

      // Copy if it's an allowed extension or specific allowed file
      if (
        allowedExtensions.includes(ext) ||
        allowedFiles.includes(entry.name)
      ) {
        await copyFile(srcPath, destPath);
        console.log(`✅ Copied: ${entry.name}`);
      } else {
        console.log(`⏭️  Skipped: ${entry.name}`);
      }
    }
  }
}

try {
  // Check if source directory exists
  if (!existsSync(sourceDir)) {
    console.warn(
      `Source directory ${sourceDir} not found, skipping FFmpeg copy`
    );
    process.exit(0);
  }

  console.log(
    `Copying FFmpeg native binaries from ${sourceDir} to ${targetDir}...`
  );
  console.log(`Including extensions: ${allowedExtensions.join(", ")}`);
  console.log(`Including files: ${allowedFiles.join(", ")}`);

  await copyAllowedFiles(sourceDir, targetDir);

  console.log("✅ FFmpeg native binaries copied successfully");
  console.log("ℹ️  WebAssembly files excluded (managed as npm dependencies)");
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("❌ Failed to copy FFmpeg resources:", errorMessage);
  process.exit(1);
}
