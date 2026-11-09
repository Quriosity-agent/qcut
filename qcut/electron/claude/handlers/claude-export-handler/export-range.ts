/**
 * Part of the timeline, for `export start --start-time/--end-time` and
 * `mix loudness` over a stretch.
 *
 * @module electron/claude/handlers/claude-export-handler/export-range
 */

import type { ClaudeTimeRange } from "../../../types/claude-api.js";

/** A resolved range on the timeline, in seconds. */
export interface TimelineRange {
	start: number;
	end: number;
}

function formatSeconds(seconds: number): string {
	return `${Number(seconds.toFixed(3))} s`;
}

function snapToFrame({ seconds, fps }: { seconds: number; fps?: number }) {
	if (!fps || !Number.isFinite(fps) || fps <= 0) return seconds;
	return Math.round(seconds * fps) / fps;
}

/**
 * The range on a timeline `duration` seconds long: a missing start is 0, a
 * missing end the timeline's end, and with `fps` both land on the nearest
 * frame. A range outside the timeline, or shorter than a frame, is refused
 * rather than cut to fit.
 */
export function resolveTimelineRange({
	range,
	duration,
	fps,
}: {
	range: ClaudeTimeRange;
	duration: number;
	fps?: number;
}): TimelineRange {
	const requestedStart = range.startTime ?? 0;
	const requestedEnd = range.endTime ?? duration;
	if (!Number.isFinite(requestedStart) || requestedStart < 0) {
		throw new Error("The range start must be a number of seconds, 0 or more");
	}
	if (!Number.isFinite(requestedEnd)) {
		throw new Error("The range end must be a number of seconds");
	}
	const start = snapToFrame({ seconds: requestedStart, fps });
	const end = snapToFrame({ seconds: requestedEnd, fps });
	const halfFrame = fps && fps > 0 ? 0.5 / fps : 0;
	if (start >= duration) {
		throw new Error(
			`The range starts at ${formatSeconds(requestedStart)}, at or after the end of the timeline (${formatSeconds(duration)})`
		);
	}
	if (end > duration + halfFrame) {
		throw new Error(
			`The range ends at ${formatSeconds(requestedEnd)}, after the end of the timeline (${formatSeconds(duration)}); leave the end out to run to it`
		);
	}
	if (end <= start) {
		throw new Error(
			`The range ${formatSeconds(requestedStart)}–${formatSeconds(requestedEnd)} is empty${fps ? " at the export's frame rate" : ""}`
		);
	}
	return { start, end: Math.min(end, duration) };
}
