/**
 * Audio changes for media elements sent through the editor API
 * (`editor:timeline:update-element --changes '{"audio": {...}}'`).
 *
 * The value is a partial `MediaAudioSettings`: settings groups merge, at any
 * depth, into the element's current settings, and `keyframes` replaces the
 * listed properties' keyframes (`[]` or `null` removes them). Keyframe frames
 * count from the element's start at the project frame rate, the same as the
 * editor's own audio keyframes. Keyframe values outside a property's range
 * are clamped. Malformed input throws, so the caller sees why nothing
 * applied: an unknown setting, or a value whose type differs from the
 * setting's current one (`"false"` for a boolean).
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
		if (!Object.hasOwn(AUDIO_KEYFRAME_DEFINITIONS, property)) {
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

/**
 * `change` merged into `current`, a setting the element already has. Objects
 * merge key by key and must only name existing settings; lists are replaced,
 * each item merged onto the item at its index (or the first one); anything
 * else must have the current value's type.
 */
function mergedSetting({
	path,
	current,
	change,
}: {
	path: string;
	current: unknown;
	change: unknown;
}): unknown {
	if (isPlainObject(current)) {
		if (!isPlainObject(change)) throw new Error(`${path} must be an object`);
		const merged: Record<string, unknown> = { ...current };
		for (const [key, value] of Object.entries(change)) {
			if (!Object.hasOwn(current, key)) {
				throw new Error(
					`Unknown audio setting "${path}.${key}". Known: ${Object.keys(current).join(", ")}`
				);
			}
			merged[key] = mergedSetting({
				path: `${path}.${key}`,
				current: current[key],
				change: value,
			});
		}
		return merged;
	}
	if (Array.isArray(current)) {
		if (!Array.isArray(change)) throw new Error(`${path} must be an array`);
		if (current.length === 0) {
			throw new Error(`${path} cannot be set through the editor API`);
		}
		return change.map((item, index) =>
			mergedSetting({
				path: `${path}[${index}]`,
				current: current[index] ?? current[0],
				change: item,
			})
		);
	}
	if (typeof current === "boolean" && typeof change !== "boolean") {
		throw new Error(`${path} must be true or false`);
	}
	if (
		typeof current === "number" &&
		(typeof change !== "number" || !Number.isFinite(change))
	) {
		throw new Error(`${path} must be a number`);
	}
	if (typeof current === "string" && typeof change !== "string") {
		throw new Error(`${path} must be a string`);
	}
	if (current === undefined || current === null) {
		throw new Error(`${path} cannot be set through the editor API`);
	}
	return change;
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
	const { keyframes: currentKeyframes, ...currentSettings } =
		normalizeMediaAudioSettings({ element });
	const { keyframes, ...settings } = value;
	const merged = mergedSetting({
		path: "audio",
		current: currentSettings,
		change: settings,
	}) as Record<string, unknown>;
	merged.keyframes =
		keyframes === undefined
			? currentKeyframes
			: mergeKeyframes({ current: currentKeyframes, value: keyframes });
	return normalizeMediaAudioSettings({
		element: { ...element, audio: merged as unknown as MediaAudioSettings },
	});
}
