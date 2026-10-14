/**
 * Time-varying volume on compose sound and clip operations: the level in dB
 * at seconds from the item's start, interpolated linearly between keyframes
 * and held at the first and last values outside them. The keyframes are the
 * item's whole level, so they replace a fixed `volume`.
 */
import type { ComposeValidationIssue } from "./compose-validation.js";

export interface ComposeVolumeKeyframe {
	/** Seconds from the start of the clip or sound. */
	time: number;
	volumeDb: number;
}

/** The editor's `volumeDb` keyframe range. */
export const COMPOSE_VOLUME_DB_MIN = -60;
export const COMPOSE_VOLUME_DB_MAX = 12;
export const MAX_COMPOSE_VOLUME_KEYFRAMES = 64;

export function validateComposeVolumeKeyframes({
	keyframes,
	path,
	operationId,
}: {
	keyframes: unknown;
	path: string;
	operationId: string;
}): ComposeValidationIssue[] {
	if (keyframes === undefined) return [];
	if (
		!Array.isArray(keyframes) ||
		keyframes.length > MAX_COMPOSE_VOLUME_KEYFRAMES
	) {
		return [
			{
				severity: "error",
				code: "invalid-range",
				path: `${path}.volumeKeyframes`,
				operationId,
				message: `volumeKeyframes must be an array of at most ${MAX_COMPOSE_VOLUME_KEYFRAMES} keyframes.`,
			},
		];
	}
	const issues: ComposeValidationIssue[] = [];
	for (const [index, keyframe] of keyframes.entries()) {
		const { time, volumeDb } = (keyframe ??
			{}) as Partial<ComposeVolumeKeyframe>;
		if (
			typeof time === "number" &&
			Number.isFinite(time) &&
			time >= 0 &&
			typeof volumeDb === "number" &&
			Number.isFinite(volumeDb) &&
			volumeDb >= COMPOSE_VOLUME_DB_MIN &&
			volumeDb <= COMPOSE_VOLUME_DB_MAX
		) {
			continue;
		}
		issues.push({
			severity: "error",
			code: "invalid-range",
			path: `${path}.volumeKeyframes.${index}`,
			operationId,
			message: `Volume keyframes need time >= 0 and volumeDb between ${COMPOSE_VOLUME_DB_MIN} and ${COMPOSE_VOLUME_DB_MAX}.`,
		});
	}
	return issues;
}
