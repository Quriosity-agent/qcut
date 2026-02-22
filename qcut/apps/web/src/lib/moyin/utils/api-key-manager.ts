/**
 * API Key Manager with rotation and blacklist support
 * Ported from moyin-creator (provider-agnostic parts only)
 */

// ==================== Types ====================

export type ModelCapability =
	| "text"
	| "vision"
	| "function_calling"
	| "image_generation"
	| "video_generation"
	| "web_search"
	| "reasoning"
	| "embedding";

// ==================== Model Classification ====================

/**
 * Classify model capabilities by name pattern.
 * Used for dynamic model auto-classification.
 */
export function classifyModelByName(modelName: string): ModelCapability[] {
	const name = modelName.toLowerCase();

	// Video generation models
	const videoPatterns = [
		"veo",
		"sora",
		"wan",
		"kling",
		"runway",
		"luma",
		"seedance",
		"cogvideo",
		"hunyuan-video",
		"minimax-video",
		"pika",
		"gen-3",
		"gen3",
		"mochi",
		"ltx",
	];
	if (/grok[- ]?video/.test(name)) return ["video_generation"];
	if (videoPatterns.some((p) => name.includes(p))) return ["video_generation"];

	// Image generation models
	const imageGenPatterns = [
		"dall-e",
		"dalle",
		"flux",
		"midjourney",
		"imagen",
		"cogview",
		"gpt-image",
		"ideogram",
		"sd3",
		"stable-diffusion",
		"sdxl",
		"playground",
		"recraft",
		"kolors",
	];
	if (imageGenPatterns.some((p) => name.includes(p)))
		return ["image_generation"];
	if (/image[- ]?preview/.test(name)) return ["image_generation"];

	// Vision models
	if (/vision/.test(name)) return ["text", "vision"];

	// TTS / Audio models
	if (/tts|whisper|audio/.test(name)) return ["text"];

	// Embedding models
	if (/embed/.test(name)) return ["embedding"];

	// Reasoning models
	if (/[- ](r1|thinking|reasoner|reason)/.test(name) || /^o[1-9]/.test(name))
		return ["text", "reasoning"];

	// Default: text/chat model
	return ["text"];
}

// ==================== Utilities ====================

/**
 * Parse API keys from a string (comma or newline separated)
 */
export function parseApiKeys(apiKey: string): string[] {
	if (!apiKey) return [];
	return apiKey
		.split(/[,\n]/)
		.map((k) => k.trim())
		.filter((k) => k.length > 0);
}

/**
 * Get the count of API keys
 */
export function getApiKeyCount(apiKey: string): number {
	return parseApiKeys(apiKey).length;
}

/**
 * Mask an API key for display
 */
export function maskApiKey(key: string): string {
	if (!key || key.length === 0) return "(not set)";
	if (key.length <= 10) return `${key.slice(0, 4)}***`;
	return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

// ==================== ApiKeyManager ====================

interface BlacklistedKey {
	key: string;
	blacklistedAt: number;
}

const BLACKLIST_DURATION_MS = 90 * 1000; // 90 seconds

/**
 * API Key Manager with rotation and blacklist support.
 * Manages multiple API keys with automatic rotation on failures.
 */
export class ApiKeyManager {
	private keys: string[];
	private currentIndex: number;
	private blacklist: Map<string, BlacklistedKey> = new Map();

	constructor(apiKeyString: string) {
		this.keys = parseApiKeys(apiKeyString);
		// Start with a random index for load balancing
		this.currentIndex =
			this.keys.length > 0 ? Math.floor(Math.random() * this.keys.length) : 0;
	}

	/** Get the current API key */
	getCurrentKey(): string | null {
		this.cleanupBlacklist();

		if (this.keys.length === 0) return null;

		// Find a non-blacklisted key starting from current index
		for (let i = 0; i < this.keys.length; i++) {
			const index = (this.currentIndex + i) % this.keys.length;
			const key = this.keys[index];

			if (!this.blacklist.has(key)) {
				this.currentIndex = index;
				return key;
			}
		}

		// All keys are blacklisted, return the first key anyway
		return this.keys.length > 0 ? this.keys[0] : null;
	}

	/** Rotate to the next available key */
	rotateKey(): string | null {
		this.cleanupBlacklist();

		if (this.keys.length <= 1) return this.getCurrentKey();

		this.currentIndex = (this.currentIndex + 1) % this.keys.length;

		for (let i = 0; i < this.keys.length; i++) {
			const index = (this.currentIndex + i) % this.keys.length;
			const key = this.keys[index];

			if (!this.blacklist.has(key)) {
				this.currentIndex = index;
				return key;
			}
		}

		return this.keys[this.currentIndex];
	}

	/** Mark the current key as failed and blacklist it temporarily */
	markCurrentKeyFailed(): void {
		const key = this.keys[this.currentIndex];
		if (key) {
			this.blacklist.set(key, {
				key,
				blacklistedAt: Date.now(),
			});
		}
		this.rotateKey();
	}

	/**
	 * Handle API errors and decide whether to rotate.
	 * Returns true if key was rotated.
	 */
	handleError(statusCode: number): boolean {
		if (statusCode === 429 || statusCode === 401 || statusCode === 503) {
			this.markCurrentKeyFailed();
			return true;
		}
		return false;
	}

	/** Get the number of available (non-blacklisted) keys */
	getAvailableKeyCount(): number {
		this.cleanupBlacklist();
		return this.keys.filter((k) => !this.blacklist.has(k)).length;
	}

	/** Get total key count */
	getTotalKeyCount(): number {
		return this.keys.length;
	}

	/** Check if manager has any keys */
	hasKeys(): boolean {
		return this.keys.length > 0;
	}

	/** Clean up expired blacklist entries */
	private cleanupBlacklist(): void {
		const now = Date.now();
		for (const [key, entry] of this.blacklist.entries()) {
			if (now - entry.blacklistedAt >= BLACKLIST_DURATION_MS) {
				this.blacklist.delete(key);
			}
		}
	}

	/** Reset the manager with new keys */
	reset(apiKeyString: string): void {
		this.keys = parseApiKeys(apiKeyString);
		this.currentIndex =
			this.keys.length > 0 ? Math.floor(Math.random() * this.keys.length) : 0;
		this.blacklist.clear();
	}
}
