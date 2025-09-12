/**
 * Setup script to copy FFmpeg WebAssembly files from node_modules to public directory
 * 
 * This script copies the necessary FFmpeg.wasm files to the public directory so they can be
 * served statically by the web server and loaded by the FFmpeg worker at runtime.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

async function setupFFmpeg() {
  try {
    console.log("🔧 Setting up FFmpeg WebAssembly files...");

    // Dynamically resolve @ffmpeg/core package path to handle different package managers
    const require = createRequire(import.meta.url);
    let ffmpegCoreRoot: string;
    let ffmpegCorePath: string;
    
    try {
      ffmpegCoreRoot = dirname(require.resolve("@ffmpeg/core/package.json"));
      ffmpegCorePath = join(ffmpegCoreRoot, "dist", "esm");
      console.log(`📦 Resolved @ffmpeg/core path: ${ffmpegCoreRoot}`);
      console.log(`📂 Using source directory: ${ffmpegCorePath}`);
    } catch (error) {
      throw new Error(`Failed to resolve @ffmpeg/core package. Make sure it's installed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const publicFFmpegPath = "apps/web/public/ffmpeg";
    const electronFFmpegPath = "electron/resources/ffmpeg";

    // Files to copy (worker.js may not exist in this version)
    const filesToCopy = [
      "ffmpeg-core.js",
      "ffmpeg-core.wasm"
    ];

    // Target directories to create
    const targetPaths = [publicFFmpegPath, electronFFmpegPath];

    // Create target directories if they don't exist
    for (const targetPath of targetPaths) {
      if (!existsSync(targetPath)) {
        await mkdir(targetPath, { recursive: true });
        console.log(`📁 Created directory: ${targetPath}`);
      }
    }

    // Copy files to both locations
    for (const file of filesToCopy) {
      const sourcePath = join(ffmpegCorePath, file);

      if (existsSync(sourcePath)) {
        for (const targetPath of targetPaths) {
          const destPath = join(targetPath, file);
          await copyFile(sourcePath, destPath);
          console.log(`✅ Copied: ${file} → ${targetPath}`);
        }
      } else {
        console.error(`❌ Source file not found: ${sourcePath}`);
        process.exit(1);
      }
    }

    console.log("🎉 FFmpeg setup completed successfully!");
    console.log(`📍 Web files: ${publicFFmpegPath}`);
    console.log(`📍 Electron files: ${electronFFmpegPath}`);
    console.log("ℹ️  Files excluded from git via .gitignore patterns");
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Failed to setup FFmpeg files:", errorMessage);
    process.exit(1);
  }
}

// Run the setup
setupFFmpeg();