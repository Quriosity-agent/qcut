/**
 * ElevenLabs Speech-to-Text Handler
 *
 * Provides transcription using FAL AI's ElevenLabs Scribe v2 model.
 * Features:
 * - Word-level timestamps
 * - Speaker diarization
 * - Audio event tagging (laughter, applause, etc.)
 * - 99 language support with auto-detection
 *
 * @see https://fal.ai/models/fal-ai/elevenlabs/speech-to-text/scribe-v2/api
 */

import { ipcMain, app, safeStorage } from "electron";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for ElevenLabs transcription request.
 */
export interface ElevenLabsTranscribeOptions {
  /** Path to the audio file to transcribe */
  audioPath: string;
  /** Language code (e.g., "eng", "spa"). Default: auto-detect */
  language?: string;
  /** Enable speaker diarization. Default: true */
  diarize?: boolean;
  /** Tag audio events (laughter, applause). Default: true */
  tagAudioEvents?: boolean;
  /** Words/phrases to bias transcription toward. +30% cost if used */
  keyterms?: string[];
}

/**
 * Word-level transcription item from ElevenLabs.
 */
export interface TranscriptionWord {
  /** The transcribed word or event text */
  text: string;
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Type of element: word, spacing, audio_event, punctuation */
  type: "word" | "spacing" | "audio_event" | "punctuation";
  /** Speaker identifier (if diarization enabled) */
  speaker_id: string | null;
}

/**
 * Full transcription result from ElevenLabs Scribe v2.
 */
export interface ElevenLabsTranscribeResult {
  /** Full transcription text */
  text: string;
  /** Detected/specified language code */
  language_code: string;
  /** Confidence score for language detection */
  language_probability: number;
  /** Word-level transcription data */
  words: TranscriptionWord[];
}

/**
 * Logger interface for consistent logging.
 */
interface Logger {
  info(message?: unknown, ...args: unknown[]): void;
  warn(message?: unknown, ...args: unknown[]): void;
  error(message?: unknown, ...args: unknown[]): void;
  debug(message?: unknown, ...args: unknown[]): void;
}

// ============================================================================
// Logger Setup
// ============================================================================

let log: Logger;
try {
  log = require("electron-log");
} catch {
  const noop = (): void => {};
  log = { info: noop, warn: noop, error: noop, debug: noop };
}

// ============================================================================
// Constants
// ============================================================================

const FAL_STORAGE_URL = "https://fal.ai/api/storage/upload";
const FAL_ELEVENLABS_URL =
  "https://fal.run/fal-ai/elevenlabs/speech-to-text/scribe-v2";
const LOG_PREFIX = "[ElevenLabs]";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Retrieves the FAL API key from secure storage.
 * Falls back to environment variable in development.
 *
 * @returns The FAL API key
 * @throws Error if no API key is found
 */
async function getFalApiKey(): Promise<string> {
  const userDataPath = app.getPath("userData");
  const apiKeysFilePath = path.join(userDataPath, "api-keys.json");

  log.info(`${LOG_PREFIX} Checking for FAL API key...`);

  // Try to load from secure storage
  if (fsSync.existsSync(apiKeysFilePath)) {
    try {
      const fileContent = fsSync.readFileSync(apiKeysFilePath, "utf8");
      const encryptedData = JSON.parse(fileContent);

      if (encryptedData.falApiKey) {
        if (safeStorage.isEncryptionAvailable()) {
          try {
            const decrypted = safeStorage.decryptString(
              Buffer.from(encryptedData.falApiKey, "base64")
            );
            log.info(`${LOG_PREFIX} FAL API key loaded from secure storage`);
            return decrypted;
          } catch {
            // Decryption failed, try plain text
            log.warn(`${LOG_PREFIX} Decryption failed, using plain text`);
            return encryptedData.falApiKey;
          }
        } else {
          // No encryption, use plain text
          return encryptedData.falApiKey;
        }
      }
    } catch (error) {
      log.warn(`${LOG_PREFIX} Failed to read API keys file:`, error);
    }
  }

  // Fallback to environment variable (development only)
  if (process.env.VITE_FAL_API_KEY) {
    log.info(`${LOG_PREFIX} Using FAL API key from environment variable`);
    return process.env.VITE_FAL_API_KEY;
  }

  throw new Error(
    "FAL API key not found. Please configure your API key in Settings → API Keys."
  );
}

/**
 * Uploads a file to FAL storage.
 *
 * @param filePath - Path to the file to upload
 * @param apiKey - FAL API key
 * @returns URL of the uploaded file
 */
async function uploadToFalStorage(
  filePath: string,
  apiKey: string
): Promise<string> {
  log.info(`${LOG_PREFIX} Uploading file to FAL storage...`);

  const fileBuffer = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const fileSize = fileBuffer.length;

  log.info(`${LOG_PREFIX} File: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

  const response = await fetch(FAL_STORAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/octet-stream",
      "X-Filename": fileName,
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FAL storage upload failed: ${response.status} ${errorText}`);
  }

  const result = (await response.json()) as { url?: string };

  if (!result.url) {
    throw new Error("FAL storage upload did not return a URL");
  }

  log.info(`${LOG_PREFIX} File uploaded successfully`);
  return result.url;
}

/**
 * Calls the ElevenLabs Scribe v2 API via FAL.
 *
 * @param audioUrl - URL of the audio file (from FAL storage)
 * @param options - Transcription options
 * @param apiKey - FAL API key
 * @returns Transcription result
 */
async function callElevenLabsApi(
  audioUrl: string,
  options: ElevenLabsTranscribeOptions,
  apiKey: string
): Promise<ElevenLabsTranscribeResult> {
  log.info(`${LOG_PREFIX} Calling ElevenLabs Scribe v2 API...`);
  log.info(`${LOG_PREFIX} Options: diarize=${options.diarize ?? true}, tagAudioEvents=${options.tagAudioEvents ?? true}`);

  const requestBody: Record<string, unknown> = {
    audio_url: audioUrl,
    diarize: options.diarize ?? true,
    tag_audio_events: options.tagAudioEvents ?? true,
  };

  // Add optional parameters
  if (options.language) {
    requestBody.language_code = options.language;
    log.info(`${LOG_PREFIX} Language: ${options.language}`);
  }

  if (options.keyterms && options.keyterms.length > 0) {
    requestBody.keyterms = options.keyterms;
    log.info(`${LOG_PREFIX} Keyterms: ${options.keyterms.length} terms (+30% cost)`);
  }

  const response = await fetch(FAL_ELEVENLABS_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} ${errorText}`);
  }

  const result = (await response.json()) as ElevenLabsTranscribeResult;

  log.info(`${LOG_PREFIX} Transcription complete`);
  log.info(`${LOG_PREFIX} Language: ${result.language_code} (confidence: ${(result.language_probability * 100).toFixed(1)}%)`);
  log.info(`${LOG_PREFIX} Words: ${result.words?.length || 0}`);
  log.info(`${LOG_PREFIX} Text length: ${result.text?.length || 0} characters`);

  return result;
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Registers ElevenLabs transcription IPC handlers.
 * Call this function during app initialization.
 */
export function registerElevenLabsTranscribeHandler(): void {
  /**
   * Main transcription handler.
   * Uploads audio to FAL storage, then calls ElevenLabs Scribe v2.
   */
  ipcMain.handle(
    "transcribe:elevenlabs",
    async (_, options: ElevenLabsTranscribeOptions): Promise<ElevenLabsTranscribeResult> => {
      log.info(`${LOG_PREFIX} ========================================`);
      log.info(`${LOG_PREFIX} Transcription request received`);
      log.info(`${LOG_PREFIX} Audio path: ${options.audioPath}`);

      try {
        // Validate input
        if (!options.audioPath) {
          throw new Error("Audio path is required");
        }

        // Check file exists
        try {
          await fs.access(options.audioPath);
        } catch {
          throw new Error(`Audio file not found: ${options.audioPath}`);
        }

        // Get API key
        const apiKey = await getFalApiKey();

        // Upload to FAL storage
        const audioUrl = await uploadToFalStorage(options.audioPath, apiKey);

        // Call ElevenLabs API
        const result = await callElevenLabsApi(audioUrl, options, apiKey);

        log.info(`${LOG_PREFIX} Transcription completed successfully`);
        log.info(`${LOG_PREFIX} ========================================`);

        return result;
      } catch (error) {
        log.error(`${LOG_PREFIX} Transcription failed:`, error);
        throw error;
      }
    }
  );

  /**
   * Upload file to FAL storage (standalone handler).
   * Useful for uploading files separately from transcription.
   */
  ipcMain.handle(
    "transcribe:upload-to-fal",
    async (_, filePath: string): Promise<{ url: string }> => {
      log.info(`${LOG_PREFIX} Upload request received: ${filePath}`);

      try {
        const apiKey = await getFalApiKey();
        const url = await uploadToFalStorage(filePath, apiKey);
        return { url };
      } catch (error) {
        log.error(`${LOG_PREFIX} Upload failed:`, error);
        throw error;
      }
    }
  );

  log.info(`${LOG_PREFIX} IPC handlers registered`);
}

// ============================================================================
// Module Exports
// ============================================================================

// CommonJS export for backward compatibility
module.exports = { registerElevenLabsTranscribeHandler };

// ES6 exports
export default { registerElevenLabsTranscribeHandler };
