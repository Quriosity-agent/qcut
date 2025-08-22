const fs = require("fs");
const path = require("path");
const { app } = require("electron");

// Initialize electron-log early
let log = null;
try {
  log = require("electron-log");
} catch (error) {
  // electron-log not available, will use fallback
}
const logger = log || console;

class TempManager {
  constructor() {
    this.tempDir = path.join(app.getPath("temp"), "qcut-export");
    this.ensureTempDir();
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  createExportSession() {
    const sessionId = Date.now().toString();
    const sessionDir = path.join(this.tempDir, sessionId);
    const frameDir = path.join(sessionDir, "frames");
    const outputDir = path.join(sessionDir, "output");

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

  cleanup(sessionId) {
    // Clean up audio files first
    try {
      const { cleanupAudioFiles } = require('./audio-temp-handler.js');
      cleanupAudioFiles(sessionId);
    } catch (error) {
      logger.warn('Failed to cleanup audio files for session:', sessionId, error.message);
    }
    
    // Clean up session directory
    const sessionDir = path.join(this.tempDir, sessionId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }

  cleanupOldSessions() {
    // Clean up sessions older than 1 hour
    const cutoff = Date.now() - 60 * 60 * 1000;

    if (fs.existsSync(this.tempDir)) {
      const sessions = fs.readdirSync(this.tempDir);
      sessions.forEach((sessionId) => {
        const timestamp = parseInt(sessionId);
        if (timestamp < cutoff) {
          this.cleanup(sessionId);
        }
      });
    }
  }

  // Get temp directory path for debugging
  getTempDir() {
    return this.tempDir;
  }

  // Get session directory path
  getSessionDir(sessionId) {
    return path.join(this.tempDir, sessionId);
  }

  // Get frame directory path
  getFrameDir(sessionId) {
    return path.join(this.tempDir, sessionId, "frames");
  }

  // Get output directory path
  getOutputDir(sessionId) {
    return path.join(this.tempDir, sessionId, "output");
  }
}

module.exports = { TempManager };
