/**
 * Sync Lipsync React-1 validators and constants.
 */

import { ERROR_MESSAGES } from "@/components/editor/media-panel/views/ai/constants/ai-constants";

export const SYNC_LIPSYNC_REACT1_MAX_DURATION = 15;

export const SYNC_LIPSYNC_REACT1_EMOTIONS = [
	"happy",
	"angry",
	"sad",
	"neutral",
	"disgusted",
	"surprised",
] as const;

export const SYNC_LIPSYNC_REACT1_MODEL_MODES = [
	"lips",
	"face",
	"head",
] as const;

export const SYNC_LIPSYNC_REACT1_SYNC_MODES = [
	"cut_off",
	"loop",
	"bounce",
	"silence",
	"remap",
] as const;

export function validateSyncLipsyncReact1VideoDuration(
	duration: number | null | undefined
): void {
	if (
		duration !== null &&
		duration !== undefined &&
		duration > SYNC_LIPSYNC_REACT1_MAX_DURATION
	) {
		throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_VIDEO_TOO_LONG);
	}
}

export function validateSyncLipsyncReact1AudioDuration(
	duration: number | null | undefined
): void {
	if (
		duration !== null &&
		duration !== undefined &&
		duration > SYNC_LIPSYNC_REACT1_MAX_DURATION
	) {
		throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_AUDIO_TOO_LONG);
	}
}

export function validateSyncLipsyncReact1Emotion(
	emotion: string | null | undefined
): void {
	if (!emotion) {
		throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_MISSING_EMOTION);
	}
	if (
		!SYNC_LIPSYNC_REACT1_EMOTIONS.includes(
			emotion as (typeof SYNC_LIPSYNC_REACT1_EMOTIONS)[number]
		)
	) {
		throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_INVALID_EMOTION);
	}
}

export function validateSyncLipsyncReact1Temperature(
	temperature: number | undefined
): void {
	if (temperature !== undefined && (temperature < 0 || temperature > 1)) {
		throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_INVALID_TEMPERATURE);
	}
}

export function validateSyncLipsyncReact1Inputs(params: {
	videoUrl?: string;
	audioUrl?: string;
	videoDuration?: number | null;
	audioDuration?: number | null;
	emotion?: string | null;
	temperature?: number;
}): void {
	if (!params.videoUrl) {
		throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_MISSING_VIDEO);
	}
	if (!params.audioUrl) {
		throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_MISSING_AUDIO);
	}

	validateSyncLipsyncReact1VideoDuration(params.videoDuration);
	validateSyncLipsyncReact1AudioDuration(params.audioDuration);
	validateSyncLipsyncReact1Emotion(params.emotion);
	validateSyncLipsyncReact1Temperature(params.temperature);
}
