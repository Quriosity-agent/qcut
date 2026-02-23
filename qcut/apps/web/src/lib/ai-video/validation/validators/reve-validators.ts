/**
 * Reve/image generation validators and constants.
 */

import { debugLogger } from "@/lib/debug-logger";

const VALIDATOR_LOG_COMPONENT = "Validators";

// ============================================
// Image Generation Constants
// ============================================

export const VALID_OUTPUT_FORMATS = ["jpeg", "png", "webp"] as const;
export type OutputFormat = (typeof VALID_OUTPUT_FORMATS)[number];
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = "jpeg";

export const DEFAULT_ASPECT_RATIO = "1:1";

export const IMAGE_SIZE_TO_ASPECT_RATIO: Record<string, string> = {
	square: "1:1",
	square_hd: "1:1",
	portrait_3_4: "3:4",
	portrait_9_16: "9:16",
	landscape_4_3: "4:3",
	landscape_16_9: "16:9",
};

const ASPECT_RATIO_PATTERN = /^\d+:\d+$/;

export const MIN_REVE_IMAGES = 1;
export const MAX_REVE_IMAGES = 4;
export const MAX_REVE_PROMPT_LENGTH = 2560;

// ============================================
// Aspect Ratio Validators
// ============================================

export function normalizeAspectRatio(
	value?: string | null
): string | undefined {
	if (!value) {
		return;
	}

	const normalized = value.replace(/\s+/g, "");
	if (ASPECT_RATIO_PATTERN.test(normalized)) {
		return normalized;
	}

	return;
}

export function imageSizeToAspectRatio(
	imageSize: string | number | undefined
): string {
	if (typeof imageSize === "string") {
		if (IMAGE_SIZE_TO_ASPECT_RATIO[imageSize]) {
			return IMAGE_SIZE_TO_ASPECT_RATIO[imageSize];
		}

		const ratio = normalizeAspectRatio(imageSize);
		if (ratio) {
			return ratio;
		}

		const converted = normalizeAspectRatio(imageSize.replace(/_/g, ":"));
		if (converted) {
			return converted;
		}
	}

	return DEFAULT_ASPECT_RATIO;
}

// ============================================
// Output Format Validators
// ============================================

export function normalizeOutputFormat(
	format?: string | null,
	fallback: OutputFormat = DEFAULT_OUTPUT_FORMAT
): OutputFormat {
	if (!format) {
		return fallback;
	}

	const normalized = format.toString().toLowerCase() as OutputFormat;
	if (VALID_OUTPUT_FORMATS.includes(normalized)) {
		return normalized;
	}

	debugLogger.warn(VALIDATOR_LOG_COMPONENT, "OUTPUT_FORMAT_INVALID", {
		requestedFormat: format,
		fallback,
	});

	return fallback;
}

// ============================================
// Reve Model Validators
// ============================================

export function clampReveNumImages(value?: number): number {
	if (value === undefined || value === null) {
		return MIN_REVE_IMAGES;
	}

	if (typeof value !== "number" || Number.isNaN(value)) {
		debugLogger.warn(VALIDATOR_LOG_COMPONENT, "REVE_NUM_IMAGES_INVALID", {
			input: value,
			defaultValue: MIN_REVE_IMAGES,
		});
		return MIN_REVE_IMAGES;
	}

	const rounded = Math.floor(value);
	const clamped = Math.min(Math.max(rounded, MIN_REVE_IMAGES), MAX_REVE_IMAGES);

	if (rounded !== value || clamped !== rounded) {
		debugLogger.warn(VALIDATOR_LOG_COMPONENT, "REVE_NUM_IMAGES_ADJUSTED", {
			originalValue: value,
			roundedValue: rounded,
			clampedValue: clamped,
			min: MIN_REVE_IMAGES,
			max: MAX_REVE_IMAGES,
		});
	}

	return clamped;
}

export function truncateRevePrompt(prompt: string): string {
	if (prompt.length > MAX_REVE_PROMPT_LENGTH) {
		debugLogger.warn(VALIDATOR_LOG_COMPONENT, "REVE_PROMPT_TRUNCATED", {
			originalLength: prompt.length,
			maxLength: MAX_REVE_PROMPT_LENGTH,
		});
	}

	return prompt.length > MAX_REVE_PROMPT_LENGTH
		? prompt.slice(0, MAX_REVE_PROMPT_LENGTH)
		: prompt;
}

export function validateRevePrompt(prompt: string): void {
	if (typeof prompt !== "string") {
		throw new Error("Prompt must be provided as a string.");
	}

	const trimmedPrompt = prompt.trim();

	if (!trimmedPrompt) {
		throw new Error("Prompt cannot be empty.");
	}

	if (trimmedPrompt.length > MAX_REVE_PROMPT_LENGTH) {
		throw new Error(
			`Prompt must be ${MAX_REVE_PROMPT_LENGTH} characters or fewer.`
		);
	}
}

export function validateReveNumImages(value?: number): void {
	if (value === undefined || value === null) {
		return;
	}

	if (!Number.isFinite(value)) {
		throw new Error("Number of images must be a finite value.");
	}

	if (!Number.isInteger(value)) {
		throw new Error("Number of images must be a whole number.");
	}

	if (value < MIN_REVE_IMAGES || value > MAX_REVE_IMAGES) {
		throw new Error(
			`Reve supports between ${MIN_REVE_IMAGES} and ${MAX_REVE_IMAGES} images per request. You requested ${value}.`
		);
	}
}
