import fs from "fs";
import path from "path";
import { app } from "electron";

// Initialize electron-log early
let log: any = null;
try {
  log = require("electron-log");
} catch (error) {
  // electron-log not available, will use fallback
}
const logger = log || console;

interface Logger {
  info(message?: any, ...optionalParams: any[]): void;
  error(message?: any, ...optionalParams: any[]): void;
  warn(message?: any, ...optionalParams: any[]): void;
  log(message?: any, ...optionalParams: any[]): void;
}

/**
 * Save audio data to a temporary file for FFmpeg processing
 * @param audioData - The audio data to save (Buffer or ArrayBuffer)
 * @param filename - The filename to save as
 * @returns Promise resolving to the full path to the saved file
 */
async function saveAudioToTemp(
  audioData: Buffer | ArrayBuffer, 
  filename: string
): Promise<string> {
  try {
    // Create temp directory for audio files
    const tempDir: string = path.join(app.getPath("temp"), "qcut-audio");
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Generate unique filename if needed
    const safeName: string = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath: string = path.join(tempDir, safeName);

    // Convert ArrayBuffer to Buffer if needed
    const buffer: Buffer = Buffer.isBuffer(audioData)
      ? audioData
      : Buffer.from(audioData);

    // Write file (async)
    await fs.promises.writeFile(filePath, buffer);
    (logger as Logger).info(
      `[Audio Temp] Saved audio file: ${filePath} (${buffer.length} bytes)`
    );
    return filePath;
  } catch (error: any) {
    (logger as Logger).error("[Audio Temp] Failed to save audio file:", error);
    throw error;
  }
}

/**
 * Clean up temporary audio files for a session
 * @param sessionId - The export session ID
 */
function cleanupAudioFiles(sessionId: string): void {
  try {
    const tempDir: string = path.join(app.getPath("temp"), "qcut-audio");

    if (!fs.existsSync(tempDir)) {
      return;
    }

    const files: string[] = fs.readdirSync(tempDir);
    let cleaned: number = 0;

    files.forEach((file: string) => {
      // Clean files matching this session pattern
      if (file.includes(sessionId) || file.startsWith(`audio_${sessionId}`)) {
        const filePath: string = path.join(tempDir, file);
        try {
          fs.unlinkSync(filePath);
          cleaned++;
        } catch (err: any) {
          (logger as Logger).warn(`[Audio Temp] Failed to delete ${file}:`, err.message);
        }
      }
    });

    if (cleaned > 0) {
      (logger as Logger).log(
        `[Audio Temp] Cleaned up ${cleaned} audio files for session ${sessionId}`
      );
    }
  } catch (error: any) {
    (logger as Logger).error("[Audio Temp] Cleanup error:", error);
  }
}

/**
 * Clean up all temporary audio files (called on app quit)
 */
function cleanupAllAudioFiles(): void {
  try {
    const tempDir: string = path.join(app.getPath("temp"), "qcut-audio");

    if (!fs.existsSync(tempDir)) {
      return;
    }

    // Use rmSync with recursive and force options
    fs.rmSync(tempDir, { recursive: true, force: true });
    (logger as Logger).info(
      "[Audio Temp] Cleaned up all audio files and removed temp directory"
    );
  } catch (error: any) {
    (logger as Logger).error("[Audio Temp] Failed to clean all audio files:", error);
  }
}

// CommonJS export for backward compatibility with main.js and temp-manager.ts
module.exports = {
  saveAudioToTemp,
  cleanupAudioFiles,
  cleanupAllAudioFiles,
};

// ES6 export for TypeScript files
export {
  saveAudioToTemp,
  cleanupAudioFiles,
  cleanupAllAudioFiles,
};
export type { Logger };