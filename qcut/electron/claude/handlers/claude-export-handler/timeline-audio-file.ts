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
		volume: optionalNumber(read("volume"), 1),
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
