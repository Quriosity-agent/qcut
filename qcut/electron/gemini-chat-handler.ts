import { ipcMain, app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import { safeStorage } from "electron";

// Import types from @google/generative-ai for type safety
import type {
	GoogleGenerativeAI as GoogleGenerativeAIType,
	Content,
	Part,
} from "@google/generative-ai";

// Dynamic import for @google/generative-ai to support packaged app
// Using typeof to preserve type information while allowing dynamic loading
let GoogleGenerativeAI: typeof GoogleGenerativeAIType;
try {
	// Try standard import first (development)
	GoogleGenerativeAI = require("@google/generative-ai").GoogleGenerativeAI;
	console.log("[Gemini Chat] Loaded SDK from standard path");
} catch (error) {
	console.warn("[Gemini Chat] Failed to load SDK from standard path:", error);
	// In packaged app, load from extraResources
	const modulePath = path.join(
		process.resourcesPath,
		"node_modules/@google/generative-ai/dist/index.js"
	);
	try {
		GoogleGenerativeAI = require(modulePath).GoogleGenerativeAI;
		console.log("[Gemini Chat] Loaded SDK from production path:", modulePath);
	} catch (prodError) {
		console.error(
			"[Gemini Chat] Failed to load SDK from production path:",
			prodError
		);
		throw new Error("Failed to load @google/generative-ai SDK");
	}
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

// ============================================================================
// API Key Retrieval (reuses pattern from gemini-transcribe-handler.ts)
// ============================================================================

async function getGeminiApiKey(): Promise<string> {
	const userDataPath = app.getPath("userData");
	const apiKeysFilePath = path.join(userDataPath, "api-keys.json");

	let geminiApiKey = "";

	const fileExists = fsSync.existsSync(apiKeysFilePath);

	if (fileExists) {
		try {
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
		} catch (error) {
			// Ignore corrupt/unreadable file; will fallback to environment variable below
			console.warn("[Gemini Chat] Failed to read API keys file:", error);
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
// Path Validation (Security)
// ============================================================================

/**
 * Validates that a file path is safe to read.
 * Prevents path traversal attacks by ensuring paths are:
 * 1. Absolute paths
 * 2. Within allowed directories (user home, app data, temp)
 * 3. Not containing suspicious patterns
 */
function isPathSafe(filePath: string): boolean {
	// Normalize the path to resolve any .. or . segments
	const normalizedPath = path.normalize(filePath);

	// Must be an absolute path
	if (!path.isAbsolute(normalizedPath)) {
		console.warn("[Gemini Chat] Rejected relative path:", filePath);
		return false;
	}

	// Check for suspicious patterns (null bytes, URL-encoded null)
	// Note: We check segments for ".." instead of string includes to avoid
	// false positives on valid paths like "my..cache" or "foo..bar.txt"
	const segments = filePath.split(path.sep);
	if (
		segments.includes("..") ||
		filePath.includes("\0") ||
		filePath.includes("%00")
	) {
		console.warn(
			"[Gemini Chat] Rejected path with suspicious patterns:",
			filePath
		);
		return false;
	}

	// Define allowed base directories
	const allowedDirs = [
		app.getPath("home"),
		app.getPath("userData"),
		app.getPath("temp"),
		app.getPath("documents"),
		app.getPath("downloads"),
		app.getPath("pictures"),
		app.getPath("videos"),
		app.getPath("music"),
		app.getPath("desktop"),
	];

	// Check if path is within an allowed directory
	const isAllowed = allowedDirs.some((allowedDir) => {
		const normalizedAllowed = path.normalize(allowedDir);
		return (
			normalizedPath.startsWith(normalizedAllowed + path.sep) ||
			normalizedPath === normalizedAllowed
		);
	});

	if (!isAllowed) {
		console.warn(
			"[Gemini Chat] Rejected path outside allowed directories:",
			filePath
		);
		return false;
	}

	return true;
}

// ============================================================================
// Attachment Encoding
// ============================================================================

async function encodeAttachment(attachment: FileAttachment): Promise<Part[]> {
	try {
		// Resolve symlinks and validate the real path before reading
		const realPath = await fs.realpath(attachment.path);
		if (!isPathSafe(realPath)) {
			throw new Error(
				`Access denied: ${realPath} is not in an allowed directory`
			);
		}

		if (attachment.mimeType.startsWith("image/")) {
			const buffer = await fs.readFile(realPath);
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
			// For large videos, limit to first 10MB - read only needed bytes to avoid memory spikes
			const maxSize = 10 * 1024 * 1024; // 10MB
			const fileHandle = await fs.open(realPath, "r");
			try {
				const { size } = await fileHandle.stat();
				const readSize = Math.min(size, maxSize);
				const buffer = Buffer.alloc(readSize);
				await fileHandle.read(buffer, 0, readSize, 0);
				return [
					{
						inlineData: {
							mimeType: attachment.mimeType,
							data: buffer.toString("base64"),
						},
					},
				];
			} finally {
				await fileHandle.close();
			}
		}

		if (attachment.mimeType.startsWith("audio/")) {
			const buffer = await fs.readFile(realPath);
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
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(
			`[Gemini Chat] Failed to encode attachment ${attachment.name}:`,
			errorMessage
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
): Promise<Content[]> {
	const contents: Content[] = [];

	for (const message of request.messages) {
		const parts: Part[] = [{ text: message.content }];
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

			// Validate request payload
			if (!Array.isArray(request.messages) || request.messages.length === 0) {
				return { success: false, error: "No messages provided" };
			}

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
				const result = await model.generateContentStream({ contents });

				for await (const chunk of result.stream) {
					// Check if renderer is still alive before sending
					if (event.sender.isDestroyed()) {
						console.log("[Gemini Chat] Sender destroyed, stopping stream");
						break;
					}
					const text = chunk.text();
					if (text) {
						event.sender.send("gemini:stream-chunk", { text });
					}
				}

				if (!event.sender.isDestroyed()) {
					event.sender.send("gemini:stream-complete");
				}
				console.log("[Gemini Chat] Stream completed successfully");
				return { success: true };
			} catch (error: unknown) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				console.error("[Gemini Chat] Error:", errorMessage);
				if (!event.sender.isDestroyed()) {
					event.sender.send("gemini:stream-error", { message: errorMessage });
				}
				return { success: false, error: errorMessage };
			}
		}
	);

	console.log("[Gemini Chat] Chat handler registered");
}
