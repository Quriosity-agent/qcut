import { TRANSITION_SEAM_TOLERANCE_SECONDS } from "@qcut/editor-core/timeline";
import { getTimelineElementEndTime } from "@/lib/timeline";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";

/**
 * A track is a single lane: at any instant it plays exactly one element.
 *
 * Clips that merely touch — one ending where the next begins — are the normal
 * result of a split, so the occupied range is half-open: [start, end). Seams
 * computed in floating point rarely meet exactly (100.20833 + 17.041667 is
 * 117.24999700000001, a hair past 117.249997), so an overlap shorter than half
 * a frame still counts as touching: two frame-aligned positions are never that
 * close, so only rounding produces one. Capped at the transition seam tolerance
 * so every seam this accepts is one transitions also treat as a cut. It
 * deliberately applies to every track type: stacking is what the CapCut draft
 * validator rejects on export as OVERLAPPING_TRACK_SEGMENTS.
 */
export function getSeamToleranceSeconds(fps = 30): number {
	const frameRate = Number.isFinite(fps) && fps > 0 ? fps : 30;
	return Math.min(0.5 / frameRate, TRANSITION_SEAM_TOLERANCE_SECONDS);
}

/**
 * The element already occupying [startTime, startTime + duration) on this
 * track, or null when the span is free. Returns the element itself so callers
 * can name the obstruction instead of only refusing.
 */
export function findOccupyingElement({
	track,
	startTime,
	duration,
	excludeElementId,
	fps = 30,
}: {
	track: TimelineTrack;
	startTime: number;
	duration: number;
	excludeElementId?: string;
	fps?: number;
}): TimelineElement | null {
	const tolerance = getSeamToleranceSeconds(fps);
	const endTime = startTime + duration;
	for (const element of track.elements) {
		if (element.id === excludeElementId) continue;
		const elementEnd = getTimelineElementEndTime({ element, fps });
		const startsBeforeItEnds = startTime < elementEnd - tolerance;
		const endsAfterItStarts = endTime > element.startTime + tolerance;
		if (startsBeforeItEnds && endsAfterItStarts) return element;
	}
	return null;
}

/**
 * The first pair of elements sharing a span, or null when the lane is clean.
 *
 * Sorting by start time makes an adjacent check sufficient: an element nested
 * inside another still starts after it and before it ends.
 */
export function findOverlappingPair({
	elements,
	fps = 30,
}: {
	elements: TimelineElement[];
	fps?: number;
}): [TimelineElement, TimelineElement] | null {
	const tolerance = getSeamToleranceSeconds(fps);
	const sorted = [...elements].sort((a, b) => a.startTime - b.startTime);
	for (let index = 1; index < sorted.length; index++) {
		const previous = sorted[index - 1];
		const current = sorted[index];
		const previousEnd = getTimelineElementEndTime({ element: previous, fps });
		if (current.startTime < previousEnd - tolerance) {
			return [previous, current];
		}
	}
	return null;
}

/**
 * The earliest time at or after `notBefore` where `duration` fits on this
 * track. Used to make a rejection actionable rather than a dead end.
 */
export function firstFreeStartTime({
	track,
	duration,
	notBefore = 0,
	excludeElementId,
	fps = 30,
}: {
	track: TimelineTrack;
	duration: number;
	notBefore?: number;
	excludeElementId?: string;
	fps?: number;
}): number {
	const occupied = track.elements
		.filter((element) => element.id !== excludeElementId)
		.map((element) => ({
			start: element.startTime,
			end: getTimelineElementEndTime({ element, fps }),
		}))
		.sort((a, b) => a.start - b.start);

	const tolerance = getSeamToleranceSeconds(fps);
	let candidate = notBefore;
	for (const span of occupied) {
		if (span.end <= candidate + tolerance) continue;
		if (candidate + duration <= span.start + tolerance) break;
		candidate = span.end;
	}
	return candidate;
}

export interface OccupancyConflict {
	occupant: TimelineElement;
	occupantStart: number;
	occupantEnd: number;
	/** Earliest start at or after the requested one where the clip fits. */
	nextFreeStart: number;
	/** Names the blocking clip, its span and the next free start. */
	message: string;
}

/** Seconds as a caller would type them back: up to six decimals, no padding. */
export function formatSeconds(seconds: number): string {
	return `${Number(seconds.toFixed(6))}s`;
}

/**
 * Why [startTime, startTime + duration) cannot go on this track, or null when
 * it can. A rejection that names the obstruction and the next free start lets
 * a caller fix the request instead of guessing.
 */
export function describeOccupancyConflict({
	track,
	startTime,
	duration,
	excludeElementId,
	fps = 30,
}: {
	track: TimelineTrack;
	startTime: number;
	duration: number;
	excludeElementId?: string;
	fps?: number;
}): OccupancyConflict | null {
	const occupant = findOccupyingElement({
		track,
		startTime,
		duration,
		excludeElementId,
		fps,
	});
	if (!occupant) return null;
	const occupantStart = occupant.startTime;
	const occupantEnd = getTimelineElementEndTime({ element: occupant, fps });
	const nextFreeStart = firstFreeStartTime({
		track,
		duration,
		notBefore: startTime,
		excludeElementId,
		fps,
	});
	return {
		occupant,
		occupantStart,
		occupantEnd,
		nextFreeStart,
		message: `${formatSeconds(startTime)}–${formatSeconds(startTime + duration)} on track "${track.name}" overlaps "${occupant.name}" (${formatSeconds(occupantStart)}–${formatSeconds(occupantEnd)}). A track plays one element at a time; the next free start for this ${formatSeconds(duration)} clip is ${formatSeconds(nextFreeStart)}.`,
	};
}
