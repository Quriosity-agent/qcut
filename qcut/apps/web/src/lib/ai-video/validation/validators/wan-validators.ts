/**
 * WAN 2.5 and WAN 2.6 validators.
 */

import { ERROR_MESSAGES } from "@/components/editor/media-panel/views/ai/constants/ai-constants";

// ============================================
// WAN 2.5 Validators
// ============================================

export function validateWAN25Prompt(prompt: string): void {
	if (prompt.length > 800) {
		throw new Error("Prompt exceeds maximum length of 800 characters");
	}
}

export function validateWAN25NegativePrompt(negativePrompt: string): void {
	if (negativePrompt.length > 500) {
		throw new Error("Negative prompt exceeds maximum length of 500 characters");
	}
}

// ============================================
// WAN v2.6 Validators
// ============================================

export function validateWAN26Prompt(prompt: string): void {
	if (prompt.length > 2000) {
		throw new Error(ERROR_MESSAGES.WAN26_PROMPT_TOO_LONG);
	}
}

export function validateWAN26NegativePrompt(negativePrompt: string): void {
	if (negativePrompt.length > 1000) {
		throw new Error(ERROR_MESSAGES.WAN26_NEGATIVE_PROMPT_TOO_LONG);
	}
}

export function validateWAN26Duration(duration: number): void {
	if (![5, 10, 15].includes(duration)) {
		throw new Error(ERROR_MESSAGES.WAN26_INVALID_DURATION);
	}
}

export function validateWAN26Resolution(resolution: string): void {
	if (!["720p", "1080p"].includes(resolution)) {
		throw new Error(ERROR_MESSAGES.WAN26_INVALID_RESOLUTION);
	}
}

export function validateWAN26T2VResolution(resolution: string): void {
	if (!["720p", "1080p"].includes(resolution)) {
		throw new Error(ERROR_MESSAGES.WAN26_T2V_INVALID_RESOLUTION);
	}
}

export function validateWAN26AspectRatio(aspectRatio: string): void {
	if (!["16:9", "9:16", "1:1", "4:3", "3:4"].includes(aspectRatio)) {
		throw new Error(ERROR_MESSAGES.WAN26_INVALID_ASPECT_RATIO);
	}
}

export function isWAN26Model(modelId: string): boolean {
	return (
		modelId === "wan_26_t2v" ||
		modelId === "wan_26_i2v" ||
		modelId === "wan_26_ref2v"
	);
}

export function isWAN26Ref2VideoModel(modelId: string): boolean {
	return modelId === "wan_26_ref2v";
}

export function validateWAN26RefVideoUrl(
	referenceVideoUrl: string | undefined
): void {
	if (!referenceVideoUrl) {
		throw new Error(
			"Reference video is required for WAN v2.6 reference-to-video generation"
		);
	}
}
