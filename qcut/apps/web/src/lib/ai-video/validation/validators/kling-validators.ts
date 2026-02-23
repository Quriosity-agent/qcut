/**
 * Kling Avatar v2 and prompt validators.
 */

import { ERROR_MESSAGES } from "@/components/editor/media-panel/views/ai/constants/ai-constants";

export function validateKlingAvatarV2Audio(
	audioFile: File,
	audioDuration?: number
): void {
	const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
	const MIN_DURATION_SEC = 2;
	const MAX_DURATION_SEC = 60;

	if (audioFile.size > MAX_SIZE_BYTES) {
		throw new Error(ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LARGE);
	}

	if (audioDuration !== undefined) {
		if (audioDuration < MIN_DURATION_SEC) {
			throw new Error(ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_SHORT);
		}
		if (audioDuration > MAX_DURATION_SEC) {
			throw new Error(ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LONG);
		}
	}
}

export function validateKlingPrompt(prompt: string): void {
	if (prompt.length > 2500) {
		throw new Error("Prompt exceeds maximum length of 2,500 characters");
	}
}
