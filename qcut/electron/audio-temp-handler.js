const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Initialize electron-log early
let log = null;
try {
  log = require("electron-log");
} catch (error) {
  // electron-log not available, will use fallback
}
const logger = log || console;

/**
 * Save audio data to a temporary file for FFmpeg processing
 * @param {Buffer|ArrayBuffer} audioData - The audio data to save
 * @param {string} filename - The filename to save as
 * @returns {Promise<string>} The full path to the saved file
 */
async function saveAudioToTemp(audioData, filename) {
  try {
    // Create temp directory for audio files
    const tempDir = path.join(app.getPath('temp'), 'qcut-audio');
    await fs.promises.mkdir(tempDir, { recursive: true });
    
    // Generate unique filename if needed
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(tempDir, safeName);
    
    // Convert ArrayBuffer to Buffer if needed
    const buffer = Buffer.isBuffer(audioData) 
      ? audioData 
      : Buffer.from(audioData);
    
    // Write file (async)
    await fs.promises.writeFile(filePath, buffer);
    logger.info(`[Audio Temp] Saved audio file: ${filePath} (${buffer.length} bytes)`);
    return filePath;
  } catch (error) {
    logger.error('[Audio Temp] Failed to save audio file:', error);
    throw error;
  }
}

/**
 * Clean up temporary audio files for a session
 * @param {string} sessionId - The export session ID
 */
function cleanupAudioFiles(sessionId) {
  try {
    const tempDir = path.join(app.getPath('temp'), 'qcut-audio');
    
    if (!fs.existsSync(tempDir)) {
      return;
    }
    
    const files = fs.readdirSync(tempDir);
    let cleaned = 0;
    
    files.forEach(file => {
      // Clean files matching this session pattern
      if (file.includes(sessionId) || file.startsWith(`audio_${sessionId}`)) {
        const filePath = path.join(tempDir, file);
        try {
          fs.unlinkSync(filePath);
          cleaned++;
        } catch (err) {
          logger.warn(`[Audio Temp] Failed to delete ${file}:`, err.message);
        }
      }
    });
    
    if (cleaned > 0) {
      logger.log(`[Audio Temp] Cleaned up ${cleaned} audio files for session ${sessionId}`);
    }
  } catch (error) {
    logger.error('[Audio Temp] Cleanup error:', error);
  }
}

/**
 * Clean up all temporary audio files (called on app quit)
 */
function cleanupAllAudioFiles() {
  try {
    const tempDir = path.join(app.getPath('temp'), 'qcut-audio');
    
    if (!fs.existsSync(tempDir)) {
      return;
    }
    
    // Use rmSync with recursive and force options
    fs.rmSync(tempDir, { recursive: true, force: true });
    logger.info('[Audio Temp] Cleaned up all audio files and removed temp directory');
  } catch (error) {
    logger.error('[Audio Temp] Failed to clean all audio files:', error);
  }
}

module.exports = {
  saveAudioToTemp,
  cleanupAudioFiles,
  cleanupAllAudioFiles
};