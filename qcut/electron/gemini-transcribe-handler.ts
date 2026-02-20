import { ipcMain, app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

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
import fsSync from "node:fs";
import { safeStorage } from "electron";

interface GeminiTranscriptionRequest {
	audioPath: string;
	language?: string;
}

interface TranscriptionSegment {
	id: number;
	seek: number;
	start: number;
	end: number;
	text: string;
	tokens: number[];
	temperature: number;
	avg_logprob: number;
	compression_ratio: number;
	no_speech_prob: number;
}

interface TranscriptionResult {
	text: string;
	segments: TranscriptionSegment[];
	language: string;
}

// Helper function to parse SRT format to segments
function parseSrtToSegments(srtContent: string): TranscriptionSegment[] {
	const blocks = srtContent.trim().split(/\n\n+/);

	return blocks
		.map((block, index) => {
			const lines = block.split("\n");
			if (lines.length < 3) return null;

			// Parse timestamp line: "00:00:00,000 --> 00:00:03,500"
			const timestampMatch = lines[1].match(
				/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
			);
			if (!timestampMatch) return null;

			const startTime = parseTimestamp(timestampMatch.slice(1, 5));
			const endTime = parseTimestamp(timestampMatch.slice(5, 9));
			const text = lines.slice(2).join(" ");

			return {
				id: index,
				seek: 0,
				start: startTime,
				end: endTime,
				text,
				tokens: [],
				temperature: 0.3,
				avg_logprob: 0,
				compression_ratio: 0,
				no_speech_prob: 0,
			};
		})
		.filter(Boolean) as TranscriptionSegment[];
}

function parseTimestamp(parts: string[]): number {
	const [h, m, s, ms] = parts.map(Number);
	return h * 3600 + m * 60 + s + ms / 1000;
}

export function setupGeminiHandlers() {
	ipcMain.handle(
		"transcribe:audio",
		async (
			event,
			request: GeminiTranscriptionRequest
		): Promise<TranscriptionResult> => {
			console.log("[Gemini Handler] 🎯 Transcription request received");
			console.log("[Gemini Handler] Audio path:", request.audioPath);
			console.log(
				"[Gemini Handler] Language:",
				request.language || "auto-detect"
			);

			try {
				// Get API key from secure storage
				console.log("[Gemini Handler] 🔍 Checking API key...");
				const userDataPath = app.getPath("userData");
				const apiKeysFilePath = path.join(userDataPath, "api-keys.json");
				console.log(`[Gemini Handler] 📁 API keys file: ${apiKeysFilePath}`);

				let geminiApiKey = "";

				const fileExists = fsSync.existsSync(apiKeysFilePath);
				console.log(`[Gemini Handler] ✅ File exists: ${fileExists}`);

				if (fileExists) {
					const fileContent = fsSync.readFileSync(apiKeysFilePath, "utf8");
					console.log(
						`[Gemini Handler] 📄 File content length: ${fileContent.length} bytes`
					);

					const encryptedData = JSON.parse(fileContent);
					console.log(
						`[Gemini Handler] 📦 Keys in file: ${Object.keys(encryptedData).join(", ")}`
					);
					console.log(
						`[Gemini Handler] 🔑 geminiApiKey field exists: ${!!encryptedData.geminiApiKey}`
					);

					if (encryptedData.geminiApiKey) {
						const encryptionAvailable = safeStorage.isEncryptionAvailable();
						console.log(
							`[Gemini Handler] 🔒 Encryption available: ${encryptionAvailable}`
						);

						if (encryptionAvailable) {
							try {
								console.log("[Gemini Handler] 🔓 Attempting decryption...");
								geminiApiKey = safeStorage.decryptString(
									Buffer.from(encryptedData.geminiApiKey, "base64")
								);
								console.log(
									`[Gemini Handler] ✅ Decryption successful (key length: ${geminiApiKey.length})`
								);
							} catch (decryptError: any) {
								console.error(
									"[Gemini Handler] ❌ Decryption failed:",
									decryptError.message
								);
								console.log(
									"[Gemini Handler] 🔄 Falling back to plain text..."
								);
								// Fallback to plain text if decryption fails
								geminiApiKey = encryptedData.geminiApiKey || "";
							}
						} else {
							console.log(
								"[Gemini Handler] 📝 Using plain text (encryption not available)"
							);
							geminiApiKey = encryptedData.geminiApiKey || "";
						}
					} else {
						console.error(
							"[Gemini Handler] ❌ geminiApiKey field is missing in encrypted data"
						);
					}
				} else {
					console.error(
						`[Gemini Handler] ❌ API keys file not found at: ${apiKeysFilePath}`
					);
				}

				// Fallback to environment variable if no encrypted key found (development only)
				if (!geminiApiKey && process.env.VITE_GEMINI_API_KEY) {
					geminiApiKey = process.env.VITE_GEMINI_API_KEY;
					console.log(
						"[Gemini Handler] 🔄 Using API key from environment variable (development mode)"
					);
				}

				// Check for API key
				if (!geminiApiKey) {
					console.error(
						"[Gemini Handler] ❌ GEMINI_API_KEY not found in secure storage or environment"
					);
					console.error("[Gemini Handler] 💡 File exists:", fileExists);
					console.error(
						"[Gemini Handler] 💡 Please configure your API key in Settings → API Keys"
					);
					throw new Error(
						"GEMINI_API_KEY not found. Please configure your API key in Settings. Get your API key from: https://aistudio.google.com/app/apikey"
					);
				}
				console.log(
					`[Gemini Handler] ✅ API key loaded (length: ${geminiApiKey.length})`
				);

				// Read audio file
				console.log("[Gemini Handler] Reading audio file...");
				const audioBuffer = await fs.readFile(request.audioPath);
				console.log(
					"[Gemini Handler] Audio file size:",
					audioBuffer.length,
					"bytes"
				);

				const audioBase64 = audioBuffer.toString("base64");
				console.log(
					"[Gemini Handler] Audio encoded to base64, length:",
					audioBase64.length
				);

				// Determine MIME type from extension
				const ext = path.extname(request.audioPath).toLowerCase();
				const mimeTypeMap: Record<string, string> = {
					".wav": "audio/wav",
					".mp3": "audio/mp3",
					".webm": "audio/webm",
					".m4a": "audio/mp4",
					".aac": "audio/aac",
					".ogg": "audio/ogg",
					".flac": "audio/flac",
				};
				const mimeType = mimeTypeMap[ext] || "audio/wav";

				// Initialize Gemini API
				console.log("[Gemini Handler] Initializing Gemini API client...");
				const genAI = new GoogleGenerativeAI(geminiApiKey);
				const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
				console.log("[Gemini Handler] Using model: gemini-2.5-pro");

				// Generate SRT transcription
				console.log(
					"[Gemini Handler] Sending transcription request to Gemini..."
				);
				const prompt = `Transcribe this audio into SRT subtitle format with precise timestamps.

Format requirements:
1. Number each subtitle block sequentially (1, 2, 3...)
2. Use timestamp format: HH:MM:SS,mmm --> HH:MM:SS,mmm
3. Each subtitle should be 1-2 sentences maximum
4. Add blank line between blocks
5. Language: ${request.language || "auto-detect"}

Example format:
1
00:00:00,000 --> 00:00:03,500
Hello, welcome to the video.

2
00:00:03,500 --> 00:00:07,200
Today we'll learn about captions.

Provide ONLY the SRT content, no additional text.`;

				const result = await model.generateContent([
					prompt,
					{
						inlineData: {
							mimeType,
							data: audioBase64,
						},
					},
				]);

				const response = await result.response;
				const srtContent = response.text();
				console.log("[Gemini Handler] ✅ Received response from Gemini");
				console.log(
					"[Gemini Handler] SRT content length:",
					srtContent.length,
					"characters"
				);

				// Parse SRT to segments
				console.log("[Gemini Handler] Parsing SRT content to segments...");
				const segments = parseSrtToSegments(srtContent);
				console.log("[Gemini Handler] ✅ Parsed", segments.length, "segments");

				// Extract full text
				const text = segments.map((s) => s.text).join(" ");
				console.log(
					"[Gemini Handler] Full text length:",
					text.length,
					"characters"
				);

				const resultData = {
					text,
					segments,
					language: request.language || "auto",
				};

				console.log(
					"[Gemini Handler] 🎉 Transcription completed successfully!"
				);
				console.log("[Gemini Handler] Result:", {
					segmentCount: segments.length,
					textLength: text.length,
					language: resultData.language,
				});

				return resultData;
			} catch (error: any) {
				console.error("[Gemini Handler] ❌ Error during transcription:", error);
				console.error("[Gemini Handler] Error details:", {
					message: error.message,
					stack: error.stack,
				});
				throw new Error(
					`Transcription failed: ${error.message || "Unknown error"}`
				);
			}
		}
	);

	console.log("[Gemini] ✅ Transcription handler registered");
}
