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

/**
 * Manages temporary files and directories for video export operations
 * Handles session-based cleanup and automatic cleanup of old sessions
 */
class TempManager {
  private tempDir: string;

  /**
   * Creates a new TempManager instance
   * Initializes the temp directory for export operations
   */
  constructor() {
    this.tempDir = path.join(app.getPath("temp"), "qcut-export");
    this.ensureTempDir();
  }

  private ensureTempDir(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Creates a new export session with dedicated directories
   * @returns Export session object with sessionId and directory paths
   */
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

  /**
   * Cleans up all temporary files for a specific export session
   * Removes audio files and session directories
   * @param sessionId - The session ID to clean up
   */
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

  /**
   * Automatically cleans up export sessions older than 1 hour
   * Should be called periodically to prevent disk space buildup
   */
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

  /**
   * Gets the base temporary directory path
   * Useful for debugging and diagnostics
   * @returns Absolute path to the temp directory
   */
  getTempDir(): string {
    return this.tempDir;
  }

  /**
   * Gets the directory path for a specific export session
   * @param sessionId - The session ID
   * @returns Absolute path to the session directory
   */
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
