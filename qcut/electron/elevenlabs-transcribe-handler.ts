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

const FAL_STORAGE_INITIATE_URL =
  "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";
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
 * Uploads a file to FAL storage using the two-step process.
 * Step 1: Initiate upload to get signed URL
 * Step 2: Upload file to signed URL
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
  console.log(`${LOG_PREFIX} Uploading file to FAL storage...`);

  const fileBuffer = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const fileSize = fileBuffer.length;

  log.info(`${LOG_PREFIX} File: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`${LOG_PREFIX} File: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

  // Determine content type based on file extension
  const ext = fileName.split(".").pop()?.toLowerCase();
  const contentTypeMap: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  const contentType = contentTypeMap[ext ?? ""] ?? "audio/mpeg";

  // Step 1: Initiate upload to get signed URL
  console.log(`${LOG_PREFIX} Step 1: Initiating upload...`);
  const initResponse = await fetch(FAL_STORAGE_INITIATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_name: fileName,
      content_type: contentType,
    }),
  });

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    console.error(`${LOG_PREFIX} Initiate failed: ${initResponse.status} - ${errorText}`);
    throw new Error(`FAL storage initiate failed: ${initResponse.status} ${errorText}`);
  }

  const initData = (await initResponse.json()) as {
    upload_url?: string;
    file_url?: string;
  };
  const { upload_url, file_url } = initData;

  if (!upload_url || !file_url) {
    console.error(`${LOG_PREFIX} Missing URLs in response:`, initData);
    throw new Error("FAL storage did not return upload URLs");
  }

  console.log(`${LOG_PREFIX} Step 2: Uploading to signed URL...`);

  // Step 2: Upload file to the signed URL
  const uploadResponse = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: fileBuffer,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.error(`${LOG_PREFIX} Upload failed: ${uploadResponse.status} - ${errorText}`);
    throw new Error(`FAL storage upload failed: ${uploadResponse.status} ${errorText}`);
  }

  log.info(`${LOG_PREFIX} File uploaded successfully: ${file_url}`);
  console.log(`${LOG_PREFIX} File uploaded successfully: ${file_url}`);
  return file_url;
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
  console.log(`${LOG_PREFIX} registerElevenLabsTranscribeHandler() called`);

  /**
   * Main transcription handler.
   * Uploads audio to FAL storage, then calls ElevenLabs Scribe v2.
   */
  ipcMain.handle(
    "transcribe:elevenlabs",
    async (_, options: ElevenLabsTranscribeOptions): Promise<ElevenLabsTranscribeResult> => {
      console.log(`${LOG_PREFIX} ========================================`);
      console.log(`${LOG_PREFIX} IPC handler "transcribe:elevenlabs" invoked`);
      console.log(`${LOG_PREFIX} Options received:`, JSON.stringify(options, null, 2));
      log.info(`${LOG_PREFIX} ========================================`);
      log.info(`${LOG_PREFIX} Transcription request received`);
      log.info(`${LOG_PREFIX} Audio path: ${options.audioPath}`);

      try {
        // Validate input
        if (!options.audioPath) {
          console.error(`${LOG_PREFIX} ERROR: Audio path is required`);
          throw new Error("Audio path is required");
        }

        // Check file exists
        console.log(`${LOG_PREFIX} Checking if file exists: ${options.audioPath}`);
        try {
          await fs.access(options.audioPath);
          console.log(`${LOG_PREFIX} File exists ✓`);
        } catch {
          console.error(`${LOG_PREFIX} ERROR: File not found: ${options.audioPath}`);
          throw new Error(`Audio file not found: ${options.audioPath}`);
        }

        // Get API key
        console.log(`${LOG_PREFIX} Getting FAL API key...`);
        const apiKey = await getFalApiKey();
        console.log(`${LOG_PREFIX} Got API key (length: ${apiKey?.length || 0})`);

        // Upload to FAL storage
        console.log(`${LOG_PREFIX} Uploading to FAL storage...`);
        const audioUrl = await uploadToFalStorage(options.audioPath, apiKey);
        console.log(`${LOG_PREFIX} Uploaded! URL: ${audioUrl}`);

        // Call ElevenLabs API
        console.log(`${LOG_PREFIX} Calling ElevenLabs API...`);
        const result = await callElevenLabsApi(audioUrl, options, apiKey);
        console.log(`${LOG_PREFIX} API call complete!`);
        console.log(`${LOG_PREFIX} Result text length: ${result.text?.length}`);
        console.log(`${LOG_PREFIX} Result words count: ${result.words?.length}`);

        log.info(`${LOG_PREFIX} Transcription completed successfully`);
        log.info(`${LOG_PREFIX} ========================================`);
        console.log(`${LOG_PREFIX} ========================================`);

        return result;
      } catch (error) {
        console.error(`${LOG_PREFIX} Transcription FAILED:`, error);
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
      console.log(`${LOG_PREFIX} IPC handler "transcribe:upload-to-fal" invoked`);
      console.log(`${LOG_PREFIX} filePath: ${filePath}`);
      log.info(`${LOG_PREFIX} Upload request received: ${filePath}`);

      try {
        const apiKey = await getFalApiKey();
        const url = await uploadToFalStorage(filePath, apiKey);
        console.log(`${LOG_PREFIX} Upload complete! URL: ${url}`);
        return { url };
      } catch (error) {
        console.error(`${LOG_PREFIX} Upload FAILED:`, error);
        log.error(`${LOG_PREFIX} Upload failed:`, error);
        throw error;
      }
    }
  );

  console.log(`${LOG_PREFIX} IPC handlers registered successfully`);
  log.info(`${LOG_PREFIX} IPC handlers registered`);
}

// ============================================================================
// Module Exports
// ============================================================================

// CommonJS export for backward compatibility
module.exports = { registerElevenLabsTranscribeHandler };

// ES6 exports
export default { registerElevenLabsTranscribeHandler };
