/**
 * Vidu Q2 and Q3 validators.
 */

import { ERROR_MESSAGES } from "@/components/editor/media-panel/views/ai/constants/ai-constants";

// ============================================
// Vidu Q2 Validators
// ============================================

export function validateViduQ2Prompt(prompt: string): void {
	if (prompt.length > 3000) {
		throw new Error(
			`Prompt too long for Vidu Q2. Maximum 3000 characters allowed (current: ${prompt.length})`
		);
	}
}

export function validateViduQ2Duration(duration: number): void {
	if (duration < 2 || duration > 8) {
		throw new Error(ERROR_MESSAGES.VIDU_Q2_INVALID_DURATION);
	}
}

// ============================================
// Vidu Q3 Constants & Validators
// ============================================

export const VIDU_Q3_RESOLUTIONS = ["360p", "540p", "720p", "1080p"] as const;

export const VIDU_Q3_ASPECT_RATIOS = [
	"16:9",
	"9:16",
	"4:3",
	"3:4",
	"1:1",
] as const;

export const VIDU_Q3_MAX_PROMPT_LENGTH = 2000;
export const VIDU_Q3_MIN_DURATION = 1;
export const VIDU_Q3_MAX_DURATION = 16;
export const VIDU_Q3_DEFAULT_DURATION = 5;

export function validateViduQ3Prompt(prompt: string): void {
	if (prompt.length > VIDU_Q3_MAX_PROMPT_LENGTH) {
		throw new Error(
			`Prompt too long for Vidu Q3. Maximum ${VIDU_Q3_MAX_PROMPT_LENGTH} characters allowed (current: ${prompt.length})`
		);
	}
}

export function validateViduQ3Duration(duration: number): void {
	if (duration < VIDU_Q3_MIN_DURATION || duration > VIDU_Q3_MAX_DURATION) {
		throw new Error(
			`Invalid duration for Vidu Q3. Supported: ${VIDU_Q3_MIN_DURATION}–${VIDU_Q3_MAX_DURATION} seconds (got: ${duration})`
		);
	}
}

export function validateViduQ3Resolution(resolution: string): void {
	if (
		!VIDU_Q3_RESOLUTIONS.includes(
			resolution as (typeof VIDU_Q3_RESOLUTIONS)[number]
		)
	) {
		throw new Error(
			`Invalid resolution for Vidu Q3. Supported: ${VIDU_Q3_RESOLUTIONS.join(", ")}`
		);
	}
}

export function validateViduQ3AspectRatio(aspectRatio: string): void {
	if (
		!VIDU_Q3_ASPECT_RATIOS.includes(
			aspectRatio as (typeof VIDU_Q3_ASPECT_RATIOS)[number]
		)
	) {
		throw new Error(
			`Invalid aspect ratio for Vidu Q3. Supported: ${VIDU_Q3_ASPECT_RATIOS.join(", ")}`
		);
	}
}

export function isViduQ3Model(modelId: string): boolean {
	return modelId === "vidu_q3_t2v" || modelId === "vidu_q3_i2v";
}
