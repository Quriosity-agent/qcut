/**
 * LTX Video 2.0 validators and constants.
 */

import {
	ERROR_MESSAGES,
	LTXV2_FAST_CONFIG,
} from "@/components/editor/media-panel/views/ai/constants/ai-constants";

// ============================================
// Duration/Resolution Constants
// ============================================

export const LTXV2_STANDARD_T2V_DURATIONS = [6, 8, 10] as const;
export const LTXV2_FAST_T2V_DURATIONS = LTXV2_FAST_CONFIG.DURATIONS;
export const LTXV2_STANDARD_I2V_DURATIONS = [6, 8, 10] as const;
export const LTXV2_STANDARD_I2V_RESOLUTIONS = [
	"1080p",
	"1440p",
	"2160p",
] as const;
export const LTXV2_FAST_I2V_DURATIONS = LTXV2_FAST_CONFIG.DURATIONS;
export const LTXV2_FAST_I2V_RESOLUTIONS =
	LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD;
export const LTXV2_FAST_EXTENDED_THRESHOLD =
	LTXV2_FAST_CONFIG.EXTENDED_DURATION_THRESHOLD;
export const LTXV2_FAST_EXTENDED_RESOLUTIONS =
	LTXV2_FAST_CONFIG.RESOLUTIONS.EXTENDED;
export const LTXV2_FAST_EXTENDED_FPS = LTXV2_FAST_CONFIG.FPS_OPTIONS.EXTENDED;
export const LTXV2_FAST_I2V_FPS = LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD;

// ============================================
// LTX Video 2.0 Validators
// ============================================

export function validateLTXV2Resolution(resolution: string): void {
	if (!["1080p", "1440p", "2160p"].includes(resolution)) {
		throw new Error(ERROR_MESSAGES.LTXV2_INVALID_RESOLUTION);
	}
}

export function isFastLTXV2TextModel(modelId: string): boolean {
	return modelId === "ltxv2_fast_t2v";
}

export function validateLTXV2T2VDuration(
	duration: number,
	modelId: string
): void {
	const isFast = isFastLTXV2TextModel(modelId);

	if (isFast) {
		if (
			!LTXV2_FAST_T2V_DURATIONS.includes(
				duration as (typeof LTXV2_FAST_T2V_DURATIONS)[number]
			)
		) {
			throw new Error(ERROR_MESSAGES.LTXV2_FAST_T2V_INVALID_DURATION);
		}
	} else {
		if (
			!LTXV2_STANDARD_T2V_DURATIONS.includes(
				duration as (typeof LTXV2_STANDARD_T2V_DURATIONS)[number]
			)
		) {
			throw new Error(ERROR_MESSAGES.LTXV2_INVALID_DURATION);
		}
	}
}

export function isStandardLTXV2ImageModel(modelId: string): boolean {
	return modelId === "ltxv2_i2v";
}

export function validateLTXV2I2VDuration(
	duration: number,
	modelId: string
): void {
	const isStandard = isStandardLTXV2ImageModel(modelId);

	if (isStandard) {
		const allowedDurations = LTXV2_STANDARD_I2V_DURATIONS;
		if (
			!allowedDurations.includes(duration as (typeof allowedDurations)[number])
		) {
			throw new Error(ERROR_MESSAGES.LTXV2_STD_I2V_INVALID_DURATION);
		}
	} else {
		const allowedDurations = LTXV2_FAST_I2V_DURATIONS;
		if (
			!allowedDurations.includes(duration as (typeof allowedDurations)[number])
		) {
			throw new Error(ERROR_MESSAGES.LTXV2_I2V_INVALID_DURATION);
		}
	}
}

export function validateLTXV2I2VResolution(
	resolution: string,
	modelId: string
): void {
	const allowedResolutions = isStandardLTXV2ImageModel(modelId)
		? LTXV2_STANDARD_I2V_RESOLUTIONS
		: LTXV2_FAST_I2V_RESOLUTIONS;

	if (
		!allowedResolutions.includes(
			resolution as (typeof allowedResolutions)[number]
		)
	) {
		throw new Error(
			isStandardLTXV2ImageModel(modelId)
				? ERROR_MESSAGES.LTXV2_STD_I2V_INVALID_RESOLUTION
				: ERROR_MESSAGES.LTXV2_I2V_INVALID_RESOLUTION
		);
	}
}

export function validateLTXV2FastExtendedConstraints(
	duration: number,
	resolution: string,
	fps: number,
	errorMessage: string = ERROR_MESSAGES.LTXV2_I2V_EXTENDED_DURATION_CONSTRAINT
): void {
	if (duration <= LTXV2_FAST_EXTENDED_THRESHOLD) {
		return;
	}

	const hasAllowedResolution = LTXV2_FAST_EXTENDED_RESOLUTIONS.includes(
		resolution as (typeof LTXV2_FAST_EXTENDED_RESOLUTIONS)[number]
	);

	const hasAllowedFps = LTXV2_FAST_EXTENDED_FPS.includes(
		fps as (typeof LTXV2_FAST_EXTENDED_FPS)[number]
	);

	if (!hasAllowedResolution || !hasAllowedFps) {
		throw new Error(errorMessage);
	}
}
