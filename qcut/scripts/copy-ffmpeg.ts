/**
 * Cross-platform FFmpeg resource copying script for electron-packager builds.
 *
 * Copies FFmpeg and FFprobe static binaries from node_modules to the
 * electron-packager output directory. Only needed for electron-packager
 * builds (e.g., package:win). electron-builder uses asarUnpack instead.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";

const targetDir = "dist-packager-new/QCut-win32-x64/resources";

async function copyFFmpegBinaries(): Promise<void> {
  // Resolve binary paths from npm packages
  const ffmpegPath: string = require("ffmpeg-static");
  const ffprobePath: string = require("ffprobe-static").path;

  if (!existsSync(ffmpegPath)) {
    console.error(`FFmpeg binary not found at: ${ffmpegPath}`);
    console.error("Run 'bun install' to download ffmpeg-static.");
    process.exit(1);
  }

  if (!existsSync(ffprobePath)) {
    console.error(`FFprobe binary not found at: ${ffprobePath}`);
    console.error("Run 'bun install' to download ffprobe-static.");
    process.exit(1);
  }

  // Ensure target directory exists
  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
  }

  // Copy ffmpeg binary
  const ffmpegDest = join(targetDir, basename(ffmpegPath));
  await copyFile(ffmpegPath, ffmpegDest);
  console.log(`Copied: ${basename(ffmpegPath)} -> ${ffmpegDest}`);

  // Copy ffprobe binary
  const ffprobeDest = join(targetDir, basename(ffprobePath));
  await copyFile(ffprobePath, ffprobeDest);
  console.log(`Copied: ${basename(ffprobePath)} -> ${ffprobeDest}`);

  console.log(
    "FFmpeg binaries copied successfully (from ffmpeg-static/ffprobe-static)"
  );
}

try {
  await copyFFmpegBinaries();
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("Failed to copy FFmpeg binaries:", errorMessage);
  process.exit(1);
}
