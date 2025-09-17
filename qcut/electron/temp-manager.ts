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

interface ExportSession {
  sessionId: string;
  frameDir: string;
  outputDir: string;
}

interface Logger {
  warn(message?: any, ...optionalParams: any[]): void;
}

class TempManager {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(app.getPath("temp"), "qcut-export");
    this.ensureTempDir();
  }

  private ensureTempDir(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  createExportSession(): ExportSession {
    const sessionId: string = Date.now().toString();
    const sessionDir: string = path.join(this.tempDir, sessionId);
    const frameDir: string = path.join(sessionDir, "frames");
    const outputDir: string = path.join(sessionDir, "output");

    // Create directories
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.mkdirSync(frameDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    return {
      sessionId,
      frameDir,
      outputDir,
    };
  }

  cleanup(sessionId: string): void {
    // Clean up audio files first
    try {
      const { cleanupAudioFiles } = require("./audio-temp-handler.js");
      cleanupAudioFiles(sessionId);
    } catch (error: any) {
      (logger as Logger).warn(
        "Failed to cleanup audio files for session:",
        sessionId,
        error.message
      );
    }

    // Clean up session directory
    const sessionDir: string = path.join(this.tempDir, sessionId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }

  cleanupOldSessions(): void {
    // Clean up sessions older than 1 hour
    const cutoff: number = Date.now() - 60 * 60 * 1000;

    if (fs.existsSync(this.tempDir)) {
      const sessions: string[] = fs.readdirSync(this.tempDir);
      sessions.forEach((sessionId: string) => {
        const timestamp: number = parseInt(sessionId);
        if (timestamp < cutoff) {
          this.cleanup(sessionId);
        }
      });
    }
  }

  // Get temp directory path for debugging
  getTempDir(): string {
    return this.tempDir;
  }

  // Get session directory path
  getSessionDir(sessionId: string): string {
    return path.join(this.tempDir, sessionId);
  }

  // Get frame directory path
  getFrameDir(sessionId: string): string {
    return path.join(this.tempDir, sessionId, "frames");
  }

  // Get output directory path
  getOutputDir(sessionId: string): string {
    return path.join(this.tempDir, sessionId, "output");
  }
}

// CommonJS export for backward compatibility with ffmpeg-handler.js
module.exports = { TempManager };

// ES6 export for TypeScript files
export { TempManager };
export default TempManager;
export type { ExportSession, Logger };
