/**
 * Explains why the editor refused to move an element.
 *
 * The renderer applies a move without replying, and the route learns the
 * outcome by reading the timeline back. So the reason is reconstructed from
 * that snapshot: a locked lane, or the clip already on the requested span.
 * The span check mirrors the renderer's occupancy rule
 * (apps/web/src/lib/timeline-occupancy.ts): an overlap shorter than half a
 * frame is a seam, not a collision.
 *
 * @module electron/claude/http/timeline-move-refusal
 */

import type {
	ClaudeElement,
	ClaudeTimeline,
	ClaudeTrack,
} from "../../types/claude-api.js";
import {
	elementLabel,
	SEAM_TOLERANCE_SECONDS,
} from "./timeline-overlap-diagnostic.js";

/** Half a frame at the timeline's rate, capped at the transition seam. */
function seamTolerance({ fps }: { fps: number | undefined }): number {
	const frameRate = typeof fps === "number" && fps > 0 ? fps : 30;
	return Math.min(0.5 / frameRate, SEAM_TOLERANCE_SECONDS);
}

/** Seconds as a caller would type them back: up to six decimals. */
function formatSeconds(seconds: number): string {
	return `${Number(seconds.toFixed(6))}s`;
}

function describeTrack(track: ClaudeTrack): string {
	return track.id
		? `track "${track.name}" (${track.id})`
		: `track "${track.name}"`;
}

/** Earliest start at or after `notBefore` where `duration` fits. */
function nextFreeStart({
	elements,
	duration,
	notBefore,
	tolerance,
}: {
	elements: ClaudeElement[];
	duration: number;
	notBefore: number;
	tolerance: number;
}): number {
	const spans = elements
		.map((element) => ({ start: element.startTime, end: element.endTime }))
		.sort((a, b) => a.start - b.start);
	let candidate = notBefore;
	for (const span of spans) {
		if (span.end <= candidate + tolerance) continue;
		if (candidate + duration <= span.start + tolerance) break;
		candidate = span.end;
	}
	return candidate;
}

/**
 * The 409 message for a move the editor did not apply. `startTime` is the
 * requested start, or undefined when the move only changed lanes.
 */
export function describeRefusedMove({
	timeline,
	elementId,
	toTrackId,
	startTime,
}: {
	timeline: ClaudeTimeline;
	elementId: string;
	toTrackId: string;
	startTime: number | undefined;
}): string {
	const tracks = timeline.tracks ?? [];
	const fromTrack = tracks.find((track) =>
		(track.elements ?? []).some((element) => element.id === elementId)
	);
	const element = fromTrack?.elements.find(
		(candidate) => candidate.id === elementId
	);
	if (!fromTrack || !element) {
		return `The editor refused the move: element ${elementId} is not on the timeline.`;
	}
	const stillAt = `The element is still on ${describeTrack(fromTrack)} at ${formatSeconds(element.startTime)}.`;
	const toTrack = tracks.find((track) => track.id === toTrackId);
	if (!toTrack) {
		return `The editor refused the move: track ${toTrackId} does not exist. ${stillAt}`;
	}

	const lockedTrack = [fromTrack, toTrack].find((track) => track.locked);
	if (lockedTrack) {
		return `The editor refused the move: ${describeTrack(lockedTrack)} is locked. ${stillAt}`;
	}

	const requestedStart = Math.max(0, startTime ?? element.startTime);
	const duration = element.endTime - element.startTime;
	const requestedEnd = requestedStart + duration;
	const tolerance = seamTolerance({ fps: timeline.fps });
	const others = (toTrack.elements ?? []).filter(
		(candidate) => candidate.id !== elementId
	);
	const occupant = others.find(
		(candidate) =>
			requestedStart < candidate.endTime - tolerance &&
			requestedEnd > candidate.startTime + tolerance
	);
	if (occupant) {
		const freeStart = nextFreeStart({
			elements: others,
			duration,
			notBefore: requestedStart,
			tolerance,
		});
		return `The editor refused the move: ${formatSeconds(requestedStart)}–${formatSeconds(requestedEnd)} on ${describeTrack(toTrack)} overlaps "${elementLabel({ element: occupant })}" (${formatSeconds(occupant.startTime)}–${formatSeconds(occupant.endTime)}). A track plays one element at a time; the next free start for this ${formatSeconds(duration)} element is ${formatSeconds(freeStart)}. ${stillAt}`;
	}

	return `The editor refused to move the element to ${formatSeconds(requestedStart)} on ${describeTrack(toTrack)}; check that the element type fits that track. ${stillAt}`;
}
