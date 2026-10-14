/**
 * Audio changes for media elements sent through the editor API
 * (`editor:timeline:update-element --changes '{"audio": {...}}'`).
 *
 * The value is a partial `MediaAudioSettings`: each settings group merges
 * into the element's current settings, and `keyframes` replaces the listed
 * properties' keyframes (`[]` or `null` removes them). Keyframe frames count
 * from the element's start at the project frame rate, the same as the
 * editor's own audio keyframes. Values outside a property's range are
 * clamped; malformed input throws, so the caller sees why nothing applied.
 *
 * @module lib/claude-bridge/claude-media-audio-changes
 */

import {
	AUDIO_KEYFRAME_DEFINITIONS,
	normalizeMediaAudioSettings,
} from "@/lib/audio/audio-properties";
import type {
	AudioKeyframeProperty,
	MediaAudioSettings,
	MediaPropertyKeyframe,
} from "@/types/timeline";

/** The element fields its audio settings derive from. */
type MediaAudioSource = Parameters<
	typeof normalizeMediaAudioSettings
>[0]["element"];

const KEYFRAME_EASINGS: ReadonlySet<MediaPropertyKeyframe["easing"]> = new Set([
	"linear",
	"easeIn",
	"easeOut",
	"easeInOut",
	"spring",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseKeyframes({
	property,
	value,
}: {
	property: AudioKeyframeProperty;
	value: unknown;
}): MediaPropertyKeyframe[] {
	if (!Array.isArray(value)) {
		throw new Error(`audio.keyframes.${property} must be an array`);
	}
	const { min, max } = AUDIO_KEYFRAME_DEFINITIONS[property];
	const byFrame = new Map<number, MediaPropertyKeyframe>();
	for (const [index, raw] of value.entries()) {
		const path = `audio.keyframes.${property}[${index}]`;
		if (!isPlainObject(raw)) throw new Error(`${path} must be an object`);
		const { frame, value: keyframeValue, easing = "linear", id } = raw;
		if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 0) {
			throw new Error(`${path}.frame must be a whole number of frames >= 0`);
		}
		if (typeof keyframeValue !== "number" || !Number.isFinite(keyframeValue)) {
			throw new Error(`${path}.value must be a number`);
		}
		if (
			typeof easing !== "string" ||
			!KEYFRAME_EASINGS.has(easing as MediaPropertyKeyframe["easing"])
		) {
			throw new Error(
				`${path}.easing must be one of ${[...KEYFRAME_EASINGS].join(", ")}`
			);
		}
		byFrame.set(frame, {
			id: typeof id === "string" && id ? id : `${property}-${frame}`,
			frame,
			value: Math.min(max, Math.max(min, keyframeValue)),
			easing: easing as MediaPropertyKeyframe["easing"],
		});
	}
	return [...byFrame.values()].sort((left, right) => left.frame - right.frame);
}

function mergeKeyframes({
	current,
	value,
}: {
	current: MediaAudioSettings["keyframes"];
	value: unknown;
}): MediaAudioSettings["keyframes"] {
	if (!isPlainObject(value)) {
		throw new Error("audio.keyframes must be an object");
	}
	const merged: Record<string, MediaPropertyKeyframe[]> = { ...current };
	for (const [property, keyframes] of Object.entries(value)) {
		if (!(property in AUDIO_KEYFRAME_DEFINITIONS)) {
			throw new Error(
				`Unknown audio keyframe property "${property}". Known: ${Object.keys(AUDIO_KEYFRAME_DEFINITIONS).join(", ")}`
			);
		}
		if (keyframes === null || (Array.isArray(keyframes) && !keyframes.length)) {
			delete merged[property];
			continue;
		}
		merged[property] = parseKeyframes({
			property: property as AudioKeyframeProperty,
			value: keyframes,
		});
	}
	return merged;
}

/** The element's audio settings after `value` is applied, normalized. */
export function parseClaudeMediaAudioChanges({
	element,
	value,
}: {
	element: MediaAudioSource;
	value: unknown;
}): MediaAudioSettings {
	if (!isPlainObject(value)) throw new Error("audio must be an object");
	const current = normalizeMediaAudioSettings({ element });
	const merged: Record<string, unknown> = { ...current };
	for (const [key, change] of Object.entries(value)) {
		if (key === "keyframes") {
			merged.keyframes = mergeKeyframes({
				current: current.keyframes,
				value: change,
			});
			continue;
		}
		const existing = merged[key];
		merged[key] =
			isPlainObject(existing) && isPlainObject(change)
				? { ...existing, ...change }
				: change;
	}
	return normalizeMediaAudioSettings({
		element: { ...element, audio: merged as unknown as MediaAudioSettings },
	});
}
