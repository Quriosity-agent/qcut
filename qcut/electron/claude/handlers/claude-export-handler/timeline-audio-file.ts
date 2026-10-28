/**
 * One timeline clip's sound as an input of the native export's audio mix.
 *
 * @module electron/claude/handlers/claude-export-handler/timeline-audio-file
 */

import type { AudioSettings } from "../../../ffmpeg/audio-settings.js";
import type { AudioFile } from "../../../ffmpeg/types.js";
import {
	buildAudioEffectTransforms,
	buildAudioEnvelopeFilter,
} from "../../../ffmpeg-audio-effects.js";
import type { ClaudeElement } from "../../../types/claude-api.js";

export function optionalNumber(
	value: unknown,
	fallback?: number
): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function optionalBoolean(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/**
 * The clip's gain for the mix. A serialized element carries both the modern
 * `audio` settings and the legacy linear `volume`, but the legacy field is
 * only mirrored from the settings when a project loads — a gain patched
 * through the API (`audio.volumeDb`) is newer than it until then. Prefer
 * `audio.volumeDb` with the renderer graph's own −60 dB silence floor, the
 * same precedence the in-app export engine applies; elements without
 * settings keep the legacy field.
 */
export function timelineClipGain({
	audio,
	fallback,
}: {
	audio: unknown;
	fallback: number | undefined;
}): number | undefined {
	if (typeof audio !== "object" || audio === null || Array.isArray(audio)) {
		return fallback;
	}
	const settings = audio as { enabled?: unknown; volumeDb?: unknown };
	if (settings.enabled === false) return 0;
	const volumeDb = optionalNumber(settings.volumeDb);
	if (volumeDb === undefined) return fallback;
	if (volumeDb <= -60) return 0;
	return 10 ** (volumeDb / 20);
}

const AUDIO_SETTINGS_GROUPS = [
	"loudness",
	"denoise",
	"voiceEnhance",
	"pitch",
	"equalizer",
	"compressor",
	"reverb",
	"echo",
];

/**
 * A clip's `audio` settings when they have the full shape `timeline export`
 * gives (the editor normalizes them); a partial record is read for its gain
 * only (`timelineClipGain`).
 */
export function readClipAudioSettings(
	value: unknown
): AudioSettings | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const audio = value as Record<string, unknown>;
	const complete =
		typeof audio.enabled === "boolean" &&
		typeof audio.volumeDb === "number" &&
		typeof audio.fadeIn === "number" &&
		typeof audio.fadeOut === "number" &&
		AUDIO_SETTINGS_GROUPS.every(
			(group) => typeof audio[group] === "object" && audio[group] !== null
		);
	return complete ? (value as AudioSettings) : undefined;
}

/**
 * A joined clip's own sound in the native export, for its segment's audio
 * filter: its gain, mute, volume keyframes and fades, as the mix applies
 * them to every other clip (N16, 2026-10-28 trailer report: all of them
 * were ignored, so the export matched the previous one sample for sample).
 * The clip's other effects (EQ, denoise, pitch…) are only applied by the
 * mix, which is what `audioEffectsNotApplied` reports.
 */
export function segmentAudioFields({
	element,
	duration,
	fps,
}: {
	element: ClaudeElement;
	/** The clip's length on the timeline, in seconds. */
	duration: number;
	/** The timeline's frame rate, which keyframe frames count in. */
	fps: number;
}): { audioEnvelope?: string; audioEffectsNotApplied?: true } {
	const record = element as unknown as Record<string, unknown>;
	const audio = readClipAudioSettings(record.audio);
	const envelope = audio
		? buildAudioEnvelopeFilter({
				audio,
				fallbackVolume: 1,
				effectiveDuration: duration,
				fps,
			})
		: gainFilter(
				timelineClipGain({
					audio: record.audio,
					fallback: optionalNumber(record.volume),
				})
			);
	return {
		...(envelope ? { audioEnvelope: envelope } : {}),
		...(audio && buildAudioEffectTransforms({ audio, fps }).length > 0
			? { audioEffectsNotApplied: true }
			: {}),
	};
}

/**
 * The export's warning naming the joined clips whose other audio effects it
 * left out (`audioEffectsNotApplied`), or null when there are none.
 */
export function audioEffectsNotAppliedWarning(
	segments: ReadonlyArray<{ elementId: string; audioEffectsNotApplied?: true }>
): string | null {
	const clipIds = segments
		.filter((segment) => segment.audioEffectsNotApplied)
		.map((segment) => segment.elementId);
	return clipIds.length === 0
		? null
		: `The native export applied the volume, mute, volume keyframes and fades of main-track clip(s) ${clipIds.join(", ")}, but not their other audio effects (EQ, denoise, pitch, compressor, reverb…); export with --engine muxer to keep them.`;
}

function gainFilter(gain: number | undefined): string | null {
	return gain === undefined || gain === 1 ? null : `volume=${gain}`;
}

/**
 * The mix input for `element`, read from `mediaPath` on the track `trackId`,
 * or null when the clip plays for no time. Fields missing on the element fall
 * back to its `props`.
 */
export function buildTimelineAudioFile({
	element,
	trackId,
	mediaPath,
}: {
	element: ClaudeElement;
	trackId: string;
	mediaPath: string;
}): AudioFile | null {
	const elementRecord = element as unknown as Record<string, unknown>;
	const props =
		typeof element.props === "object" && element.props !== null
			? element.props
			: {};
	const read = (key: string): unknown =>
		elementRecord[key] !== undefined ? elementRecord[key] : props[key];
	const trimStart = optionalNumber(element.trimStart, 0) ?? 0;
	const trimEnd = optionalNumber(element.trimEnd, 0) ?? 0;
	const visibleDuration =
		optionalNumber(element.duration) ??
		Math.max(0, element.endTime - element.startTime);
	if (!visibleDuration || visibleDuration <= 0) return null;
	const audio = readClipAudioSettings(read("audio"));
	// The serialized timeline reports how long the clip plays, while the
	// audio filter graph expects the source length and subtracts the trims
	// itself. Without converting back, a trimmed clip collapses to silence.
	const duration = visibleDuration + trimStart + trimEnd;
	return {
		elementId: element.id,
		trackId,
		path: mediaPath,
		startTime: Math.max(0, element.startTime),
		volume: timelineClipGain({
			audio: read("audio"),
			fallback: optionalNumber(read("volume"), 1),
		}),
		// The full settings take the mix's whole clip chain (effects, volume
		// keyframes, fades); without them it reads the legacy fields below.
		...(audio ? { audio } : {}),
		sourceGain: optionalNumber(read("sourceGain"), 1),
		trimStart,
		trimEnd,
		duration,
		fadeIn: optionalNumber(read("audioFadeIn"), 0),
		fadeOut: optionalNumber(read("audioFadeOut"), 0),
		normalize: optionalBoolean(read("audioNormalize")),
		denoise: optionalNumber(read("audioDenoise"), 0),
		pan: optionalNumber(read("audioPan"), 0),
		playbackRate: optionalNumber(read("playbackRate"), 1),
		reverse: optionalBoolean(read("reverse")),
		freezeFrameTime: optionalNumber(read("freezeFrameTime")),
		freezeFrameDuration: optionalNumber(read("freezeFrameDuration"), 0),
	};
}
