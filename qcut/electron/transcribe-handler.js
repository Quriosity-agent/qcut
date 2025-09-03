const { ipcMain } = require("electron");
const fs = require("fs/promises");
const path = require("node:path");
const os = require("node:os");

// Try to load electron-log, fallback to no-op logger
let log;
try {
  log = require("electron-log");
} catch (error) {
  log = { info() {}, error() {}, warn() {}, debug() {} };
}

// Map to track ongoing transcription controllers
const controllers = new Map();

module.exports = function setupTranscribeHandlers() {
  // Remove existing handlers to prevent duplicate registration
  try {
    ipcMain.removeHandler("transcribe:audio");
  } catch {}
  try {
    ipcMain.removeHandler("transcribe:cancel");
  } catch {}

  ipcMain.handle("transcribe:audio", async (event, requestData) => {
    const { id } = requestData;
    if (!id) {
      return { success: false, error: "Transcription ID is required" };
    }

    // Create AbortController for this transcription
    const controller = new AbortController();
    controllers.set(id, controller);

    try {
      const result = await handleTranscription({ ...requestData, controller });
      return { ...result, id };
    } finally {
      controllers.delete(id);
    }
  });

  ipcMain.handle("transcribe:cancel", async (event, id) => {
    const controller = controllers.get(id);
    if (controller) {
      controller.abort();
      controllers.delete(id);
      return { success: true, message: `Transcription ${id} cancelled` };
    }
    return { success: false, error: `Transcription ${id} not found` };
  });
};

async function handleTranscription(requestData) {
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
    const transcriptionCheck = isTranscriptionConfigured();
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
    const modalRequestBody = {
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
    const response = await fetch(process.env.MODAL_TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(modalRequestBody),
      signal: controller?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(
        "[Transcribe Handler] Modal API error:",
        response.status,
        errorText
      );

      let errorMessage = "Transcription service unavailable";
      try {
        const errorData = JSON.parse(errorText);
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

    const rawResult = await response.json();
    log.info("[Transcribe Handler] Modal API response received");

    // Validate and transform response (same structure as Next.js API)
    const result = validateTranscriptionResponse(rawResult);
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
  } catch (error) {
    log.error("[Transcribe Handler] Transcription API error:", error);
    return {
      success: false,
      error: "Internal server error",
      message: "An unexpected error occurred during transcription",
    };
  }
}

function isTranscriptionConfigured() {
  const requiredVars = ["MODAL_TRANSCRIPTION_URL"];
  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  return {
    configured: missingVars.length === 0,
    missingVars,
  };
}

function validateTranscriptionResponse(rawResult) {
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
  const isValidSegments = rawResult.segments.every(
    (segment) =>
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
