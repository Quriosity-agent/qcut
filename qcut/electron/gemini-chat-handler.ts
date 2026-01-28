import { ipcMain, app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import { safeStorage } from "electron";

// Dynamic import for @google/generative-ai to support packaged app
let GoogleGenerativeAI: any;
try {
  // Try standard import first (development)
  GoogleGenerativeAI = require("@google/generative-ai").GoogleGenerativeAI;
} catch {
  // In packaged app, load from extraResources
  const modulePath = path.join(
    process.resourcesPath,
    "node_modules/@google/generative-ai/dist/index.js"
  );
  GoogleGenerativeAI = require(modulePath).GoogleGenerativeAI;
}

// ============================================================================
// Types
// ============================================================================

interface GeminiChatRequest {
  messages: ChatMessage[];
  attachments?: FileAttachment[];
  model?: string; // default: gemini-2.0-flash
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface FileAttachment {
  path: string; // Absolute file path
  mimeType: string; // e.g., "image/jpeg", "video/mp4"
  name: string; // Display name
}

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

// ============================================================================
// API Key Retrieval (reuses pattern from gemini-transcribe-handler.ts)
// ============================================================================

async function getGeminiApiKey(): Promise<string> {
  const userDataPath = app.getPath("userData");
  const apiKeysFilePath = path.join(userDataPath, "api-keys.json");

  let geminiApiKey = "";

  const fileExists = fsSync.existsSync(apiKeysFilePath);

  if (fileExists) {
    const fileContent = fsSync.readFileSync(apiKeysFilePath, "utf8");
    const encryptedData = JSON.parse(fileContent);

    if (encryptedData.geminiApiKey) {
      const encryptionAvailable = safeStorage.isEncryptionAvailable();

      if (encryptionAvailable) {
        try {
          geminiApiKey = safeStorage.decryptString(
            Buffer.from(encryptedData.geminiApiKey, "base64")
          );
        } catch {
          // Fallback to plain text if decryption fails
          geminiApiKey = encryptedData.geminiApiKey || "";
        }
      } else {
        geminiApiKey = encryptedData.geminiApiKey || "";
      }
    }
  }

  // Fallback to environment variable if no encrypted key found (development only)
  if (!geminiApiKey && process.env.VITE_GEMINI_API_KEY) {
    geminiApiKey = process.env.VITE_GEMINI_API_KEY;
    console.log(
      "[Gemini Chat] Using API key from environment variable (development mode)"
    );
  }

  if (!geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY not found. Please configure your API key in Settings. Get your API key from: https://aistudio.google.com/app/apikey"
    );
  }

  return geminiApiKey;
}

// ============================================================================
// Attachment Encoding
// ============================================================================

async function encodeAttachment(
  attachment: FileAttachment
): Promise<GeminiPart[]> {
  try {
    const buffer = await fs.readFile(attachment.path);

    if (attachment.mimeType.startsWith("image/")) {
      return [
        {
          inlineData: {
            mimeType: attachment.mimeType,
            data: buffer.toString("base64"),
          },
        },
      ];
    }

    if (attachment.mimeType.startsWith("video/")) {
      // Gemini 2.0 Flash supports video natively
      // For large videos, limit to first 10MB
      const maxSize = 10 * 1024 * 1024; // 10MB
      const truncatedBuffer =
        buffer.length > maxSize ? buffer.subarray(0, maxSize) : buffer;

      return [
        {
          inlineData: {
            mimeType: attachment.mimeType,
            data: truncatedBuffer.toString("base64"),
          },
        },
      ];
    }

    if (attachment.mimeType.startsWith("audio/")) {
      return [
        {
          inlineData: {
            mimeType: attachment.mimeType,
            data: buffer.toString("base64"),
          },
        },
      ];
    }

    // Unsupported type - return text description
    return [
      {
        text: `[Attached file: ${attachment.name} (${attachment.mimeType})]`,
      },
    ];
  } catch (error: any) {
    console.error(
      `[Gemini Chat] Failed to encode attachment ${attachment.name}:`,
      error.message
    );
    return [
      {
        text: `[Failed to load attachment: ${attachment.name}]`,
      },
    ];
  }
}

async function formatRequestContents(
  request: GeminiChatRequest
): Promise<any[]> {
  const contents: any[] = [];

  for (const message of request.messages) {
    const parts: GeminiPart[] = [{ text: message.content }];
    contents.push({
      role: message.role === "user" ? "user" : "model",
      parts,
    });
  }

  // Add attachments to the last user message
  if (request.attachments && request.attachments.length > 0) {
    // Find last user message index (compatible with older ES targets)
    let lastUserIndex = -1;
    for (let i = contents.length - 1; i >= 0; i--) {
      if (contents[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex >= 0) {
      for (const attachment of request.attachments) {
        const attachmentParts = await encodeAttachment(attachment);
        contents[lastUserIndex].parts.push(...attachmentParts);
      }
    }
  }

  return contents;
}

// ============================================================================
// IPC Handler Setup
// ============================================================================

export function setupGeminiChatIPC(): void {
  ipcMain.handle(
    "gemini:chat",
    async (
      event,
      request: GeminiChatRequest
    ): Promise<{ success: boolean; error?: string }> => {
      console.log("[Gemini Chat] Chat request received");
      console.log(
        "[Gemini Chat] Messages:",
        request.messages.length,
        "Attachments:",
        request.attachments?.length || 0
      );

      try {
        // Get API key
        const apiKey = await getGeminiApiKey();
        console.log("[Gemini Chat] API key retrieved successfully");

        // Initialize Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: request.model || "gemini-2.0-flash",
        });
        console.log(
          "[Gemini Chat] Using model:",
          request.model || "gemini-2.0-flash"
        );

        // Format request contents
        const contents = await formatRequestContents(request);
        console.log("[Gemini Chat] Formatted contents, starting stream...");

        // Stream the response
        const result = await model.generateContentStream(contents);

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            event.sender.send("gemini:stream-chunk", { text });
          }
        }

        event.sender.send("gemini:stream-complete");
        console.log("[Gemini Chat] Stream completed successfully");
        return { success: true };
      } catch (error: any) {
        console.error("[Gemini Chat] Error:", error.message);
        event.sender.send("gemini:stream-error", { message: error.message });
        return { success: false, error: error.message };
      }
    }
  );

  console.log("[Gemini Chat] Chat handler registered");
}
