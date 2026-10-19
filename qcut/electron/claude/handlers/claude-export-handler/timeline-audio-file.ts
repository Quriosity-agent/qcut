/**
 * One timeline clip's sound as an input of the native export's audio mix.
 *
 * @module electron/claude/handlers/claude-export-handler/timeline-audio-file
 */

import type { AudioFile } from "../../../ffmpeg/types.js";
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
