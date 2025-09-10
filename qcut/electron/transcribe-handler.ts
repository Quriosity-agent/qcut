import { ipcMain, IpcMainInvokeEvent } from "electron";
import fs from "fs/promises";
import path from "node:path";
import os from "node:os";

// Type definitions for transcription operations
interface TranscriptionRequestData {
  id: string;
  filename: string;
  language?: string;
  decryptionKey?: string;
  iv?: string;
  controller?: AbortController;
}

interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface TranscriptionResult {
  success: boolean;
  text?: string;
  segments?: TranscriptionSegment[];
  language?: string;
  error?: string;
  message?: string;
  id?: string;
}

interface ModalRequestBody {
  filename: string;
  language: string;
  decryptionKey?: string;
  iv?: string;
}

interface ConfigurationCheck {
  configured: boolean;
  missingVars: string[];
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  data?: any;
}

interface Logger {
  info: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  debug: (...args: any[]) => void;
}

interface CancelResult {
  success: boolean;
  message?: string;
  error?: string;
}

interface TranscribeHandlers {
  "transcribe:audio": (
    requestData: TranscriptionRequestData
  ) => Promise<TranscriptionResult>;
  "transcribe:cancel": (id: string) => Promise<CancelResult>;
}

// Try to load electron-log, fallback to no-op logger
let log: Logger;
try {
  log = require("electron-log");
} catch (error: any) {
  log = { info() {}, error() {}, warn() {}, debug() {} };
}

// Map to track ongoing transcription controllers
const controllers = new Map<string, AbortController>();

export default function setupTranscribeHandlers(): void {
  // Remove existing handlers to prevent duplicate registration
  try {
    ipcMain.removeHandler("transcribe:audio");
  } catch {}
  try {
    ipcMain.removeHandler("transcribe:cancel");
  } catch {}

  ipcMain.handle(
    "transcribe:audio",
    async (
      event: IpcMainInvokeEvent,
      requestData: TranscriptionRequestData
    ): Promise<TranscriptionResult> => {
      const { id } = requestData;
      if (!id) {
        return { success: false, error: "Transcription ID is required" };
      }

      // Create AbortController for this transcription
      const controller: AbortController = new AbortController();
      controllers.set(id, controller);

      try {
        const result: TranscriptionResult = await handleTranscription({
          ...requestData,
          controller,
        });
        return { ...result, id };
      } finally {
        controllers.delete(id);
      }
    }
  );

  ipcMain.handle(
    "transcribe:cancel",
    async (event: IpcMainInvokeEvent, id: string): Promise<CancelResult> => {
      const controller: AbortController | undefined = controllers.get(id);
      if (controller) {
        controller.abort();
        controllers.delete(id);
        return { success: true, message: `Transcription ${id} cancelled` };
      }
      return { success: false, error: `Transcription ${id} not found` };
    }
  );
}

async function handleTranscription(
  requestData: TranscriptionRequestData
): Promise<TranscriptionResult> {
  try {
    const {
      filename,
      language = "auto",
      decryptionKey,
      iv,
      controller,
    } = requestData;

    log.info("[Transcribe Handler] Starting transcription for:", filename);

    // Check if transcription is configured
    const transcriptionCheck: ConfigurationCheck = isTranscriptionConfigured();
    if (!transcriptionCheck.configured) {
      log.error(
        "[Transcribe Handler] Missing environment variables:",
        transcriptionCheck.missingVars
      );
      return {
        success: false,
        error: "Transcription not configured",
        message: `Auto-captions require environment variables: ${transcriptionCheck.missingVars.join(", ")}. Check README for setup instructions.`,
      };
    }

    // Prepare request body for Modal API (same as Next.js version)
    const modalRequestBody: ModalRequestBody = {
      filename,
      language,
    };

    // Add encryption parameters if provided (zero-knowledge)
    if (decryptionKey && iv) {
      modalRequestBody.decryptionKey = decryptionKey;
      modalRequestBody.iv = iv;
      log.info("[Transcribe Handler] Using zero-knowledge encryption");
    }

    log.info("[Transcribe Handler] Calling Modal API...");

    // Call Modal transcription service
    const response: Response = await fetch(
      process.env.MODAL_TRANSCRIPTION_URL!,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(modalRequestBody),
        signal: controller?.signal,
      }
    );

    if (!response.ok) {
      const errorText: string = await response.text();
      log.error(
        "[Transcribe Handler] Modal API error:",
        response.status,
        errorText
      );

      let errorMessage = "Transcription service unavailable";
      try {
        const errorData: any = JSON.parse(errorText);
        errorMessage = errorData.error || errorMessage;
      } catch {
        // Use default message if parsing fails
      }

      return {
        success: false,
        error: errorMessage,
        message: "Failed to process transcription request",
      };
    }

    const rawResult: any = await response.json();
    log.info("[Transcribe Handler] Modal API response received");

    // Validate and transform response (same structure as Next.js API)
    const result: ValidationResult = validateTranscriptionResponse(rawResult);
    if (!result.valid) {
      log.error(
        "[Transcribe Handler] Invalid Modal API response:",
        result.error
      );
      return {
        success: false,
        error: "Invalid response from transcription service",
      };
    }

    log.info(
      "[Transcribe Handler] Transcription successful, segments:",
      result.data.segments?.length || 0
    );

    return {
      success: true,
      text: result.data.text,
      segments: result.data.segments,
      language: result.data.language,
    };
  } catch (error: any) {
    log.error("[Transcribe Handler] Transcription API error:", error);
    return {
      success: false,
      error: "Internal server error",
      message: "An unexpected error occurred during transcription",
    };
  }
}

function isTranscriptionConfigured(): ConfigurationCheck {
  const requiredVars: string[] = ["MODAL_TRANSCRIPTION_URL"];
  const missingVars: string[] = requiredVars.filter(
    (varName: string) => !process.env[varName]
  );

  return {
    configured: missingVars.length === 0,
    missingVars,
  };
}

function validateTranscriptionResponse(rawResult: any): ValidationResult {
  // Implement same validation as Next.js route
  // This is a simplified version - full zod validation would be ideal
  if (
    !rawResult ||
    typeof rawResult.text !== "string" ||
    !Array.isArray(rawResult.segments)
  ) {
    return { valid: false, error: "Invalid response structure" };
  }

  // Validate segments structure (basic validation)
  const isValidSegments: boolean = rawResult.segments.every(
    (segment: any) =>
      typeof segment === "object" &&
      typeof segment.id === "number" &&
      typeof segment.start === "number" &&
      typeof segment.end === "number" &&
      typeof segment.text === "string"
  );

  if (!isValidSegments) {
    return { valid: false, error: "Invalid segments structure" };
  }

  return { valid: true, data: rawResult };
}

// CommonJS export for backward compatibility with main.js
module.exports = setupTranscribeHandlers;

// ES6 export for TypeScript files
export { setupTranscribeHandlers };
export type {
  TranscriptionRequestData,
  TranscriptionSegment,
  TranscriptionResult,
  TranscribeHandlers,
  CancelResult,
  ConfigurationCheck,
  ValidationResult,
};
