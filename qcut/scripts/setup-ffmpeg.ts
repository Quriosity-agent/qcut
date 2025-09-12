/**
 * Setup script to copy FFmpeg WebAssembly files from node_modules to public directory
 * 
 * This script copies the necessary FFmpeg.wasm files to the public directory so they can be
 * served statically by the web server and loaded by the FFmpeg worker at runtime.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

async function setupFFmpeg() {
  try {
    console.log("🔧 Setting up FFmpeg WebAssembly files...");

    // Define source paths (from node_modules)
    const ffmpegCorePath = "node_modules/@ffmpeg/core/dist";
    const publicFFmpegPath = "apps/web/public/ffmpeg";

    // Files to copy
    const filesToCopy = [
      "ffmpeg-core.js",
      "ffmpeg-core.wasm",
      "ffmpeg-core.worker.js"
    ];

    // Create public/ffmpeg directory if it doesn't exist
    if (!existsSync(publicFFmpegPath)) {
      await mkdir(publicFFmpegPath, { recursive: true });
      console.log(`📁 Created directory: ${publicFFmpegPath}`);
    }

    // Copy each file
    for (const file of filesToCopy) {
      const sourcePath = join(ffmpegCorePath, file);
      const targetPath = join(publicFFmpegPath, file);

      if (existsSync(sourcePath)) {
        await copyFile(sourcePath, targetPath);
        console.log(`✅ Copied: ${file}`);
      } else {
        console.warn(`⚠️  Source file not found: ${sourcePath}`);
      }
    }

    console.log("🎉 FFmpeg setup completed successfully!");
    console.log(`📍 Files available at: ${publicFFmpegPath}`);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Failed to setup FFmpeg files:", errorMessage);
    process.exit(1);
  }
}

// Run the setup
setupFFmpeg();