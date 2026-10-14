/**
 * Time-varying volume for compose clips and sounds.
 *
 * Keyframes give an item's level in dB at seconds from the item's start. The
 * level is interpolated linearly in dB between keyframes and held at the
 * first and last values outside them, which is how the editor evaluates its
 * own `audio.keyframes.volumeDb`. The keyframes are the item's whole level,
 * so they replace a fixed `volume`. The type, limits, and validator mirror
 * @qcut/editor-core/compose (compose-volume-keyframes.ts).
 */
import type { ComposeValidationIssue } from "./compose-protocol.js";

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

// Smaller audio frames keep each frame's constant gain step inaudible on a ramp.
const ENVELOPE_FRAME_SAMPLES = 256;

export function sortedVolumeKeyframes({
	keyframes,
}: {
	keyframes: readonly ComposeVolumeKeyframe[];
}): ComposeVolumeKeyframe[] {
	return [...keyframes].sort((left, right) => left.time - right.time);
}

/** The envelope's level at `time`; `keyframes` must be sorted. */
function volumeDbAt({
	keyframes,
	time,
}: {
	keyframes: ComposeVolumeKeyframe[];
	time: number;
}): number {
	const nextIndex = keyframes.findIndex((keyframe) => keyframe.time > time);
	if (nextIndex === 0) return keyframes[0].volumeDb;
	const previous =
		keyframes[(nextIndex < 0 ? keyframes.length : nextIndex) - 1];
	if (nextIndex < 0) return previous.volumeDb;
	const next = keyframes[nextIndex];
	return (
		previous.volumeDb +
		((next.volumeDb - previous.volumeDb) * (time - previous.time)) /
			(next.time - previous.time)
	);
}

/**
 * Keyframes counted from `offset` seconds into the item, for an editor element
 * that trims that much more off the item's head (a transition handle). Any
 * keyframe at or before the new start becomes one keyframe holding the level
 * there, so the envelope sounds the same.
 */
export function volumeKeyframesFrom({
	keyframes,
	offset,
}: {
	keyframes: readonly ComposeVolumeKeyframe[];
	offset: number;
}): ComposeVolumeKeyframe[] {
	const sorted = sortedVolumeKeyframes({ keyframes });
	if (offset <= 0) return sorted;
	const later = sorted
		.filter((keyframe) => keyframe.time > offset)
		.map((keyframe) => ({ ...keyframe, time: keyframe.time - offset }));
	if (later.length === sorted.length) return later;
	return [
		{ time: 0, volumeDb: volumeDbAt({ keyframes: sorted, time: offset }) },
		...later,
	];
}

function decimal({ value }: { value: number }): string {
	return Number(value.toFixed(6)).toString();
}

/** FFmpeg expression for the level in dB at `t` seconds. */
function decibelExpression({
	keyframes,
}: {
	keyframes: ComposeVolumeKeyframe[];
}): string {
	const last = keyframes[keyframes.length - 1];
	let expression = decimal({ value: last.volumeDb });
	for (let index = keyframes.length - 2; index >= 0; index -= 1) {
		const from = keyframes[index];
		const to = keyframes[index + 1];
		const span = to.time - from.time;
		const segment =
			span > 0
				? `${decimal({ value: from.volumeDb })}+(${decimal({ value: to.volumeDb - from.volumeDb })})*(t-${decimal({ value: from.time })})/${decimal({ value: span })}`
				: decimal({ value: to.volumeDb });
		expression = `if(lt(t,${decimal({ value: to.time })}),${segment},${expression})`;
	}
	return `if(lt(t,${decimal({ value: keyframes[0].time })}),${decimal({ value: keyframes[0].volumeDb })},${expression})`;
}

/**
 * Filters that apply the envelope; `t` must count from the item's start, so
 * they belong after the item's `asetpts=PTS-STARTPTS`.
 */
export function volumeEnvelopeFilters({
	keyframes,
}: {
	keyframes: readonly ComposeVolumeKeyframe[];
}): string[] {
	if (keyframes.length === 0) return [];
	const sorted = sortedVolumeKeyframes({ keyframes });
	return [
		`asetnsamples=n=${ENVELOPE_FRAME_SAMPLES}:p=0`,
		`volume='pow(10,(${decibelExpression({ keyframes: sorted })})/20)':eval=frame`,
	];
}

/**
 * The editor's audio settings for the envelope: `volumeDb` keyframes at
 * frames from the element's start. Keyframes landing on the same frame keep
 * the later one.
 */
export function editorVolumeAudio({
	keyframes,
	fps,
}: {
	keyframes: readonly ComposeVolumeKeyframe[];
	fps: number;
}): { keyframes: { volumeDb: JsonKeyframe[] } } | undefined {
	if (keyframes.length === 0) return;
	const byFrame = new Map<number, JsonKeyframe>();
	for (const keyframe of sortedVolumeKeyframes({ keyframes })) {
		const frame = Math.max(0, Math.round(keyframe.time * fps));
		byFrame.set(frame, {
			id: `volumeDb-${frame}`,
			frame,
			value: keyframe.volumeDb,
			easing: "linear",
		});
	}
	return { keyframes: { volumeDb: [...byFrame.values()] } };
}

interface JsonKeyframe {
	id: string;
	frame: number;
	value: number;
	easing: "linear";
}
