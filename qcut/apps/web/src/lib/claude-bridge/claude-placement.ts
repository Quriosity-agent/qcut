import { getTimelineElementEndTime } from "@/lib/timeline";
import type { TimelineTrack } from "@/types/timeline";

/** The placement fields an add request may carry before they are resolved. */
interface PlacementRequest {
	trackId?: string;
	startTime?: unknown;
	duration?: unknown;
	after?: unknown;
	startFrame?: unknown;
	durationFrames?: unknown;
}

/** A whole number of frames, or an error naming the field. */
function readFrameCount({
	value,
	field,
	allowZero,
}: {
	value: unknown;
	field: string;
	allowZero: boolean;
}): number {
	if (
		typeof value === "number" &&
		Number.isInteger(value) &&
		(allowZero ? value >= 0 : value > 0)
	) {
		return value;
	}
	throw new Error(
		`${field} must be a whole number of frames${allowZero ? ", 0 or more" : " above 0"}`
	);
}

function trackEndTime({
	track,
	fps,
}: {
	track: TimelineTrack;
	fps: number;
}): number {
	let end = 0;
	for (const element of track.elements) {
		end = Math.max(end, getTimelineElementEndTime({ element, fps }));
	}
	return end;
}

/**
 * Turns the placement shorthands of an add request into plain seconds, so a
 * caller laying clips end to end never has to add up floating-point times:
 *
 * - `startTime: "end"` starts where the last element on `trackId` ends;
 * - `after: "<elementId>"` starts where that element ends, on its track
 *   unless `trackId` names another;
 * - `startFrame` / `durationFrames` count whole frames at the project rate.
 *
 * It reads the live tracks, so consecutive "end" adds in one batch chain. A
 * request without shorthands is returned unchanged.
 */
export function resolveClaudePlacement<T extends PlacementRequest>({
	element,
	tracks,
	fps,
}: {
	element: T;
	tracks: TimelineTrack[];
	fps: number;
}): T {
	const { after, startFrame, durationFrames } = element;
	const appendsToEnd = element.startTime === "end";
	const hasStartShorthand =
		appendsToEnd || after !== undefined || startFrame !== undefined;
	if (!hasStartShorthand && durationFrames === undefined) return element;

	const startForms = [
		element.startTime !== undefined,
		after !== undefined,
		startFrame !== undefined,
	].filter(Boolean).length;
	if (startForms > 1) {
		throw new Error("Give only one of startTime, after or startFrame");
	}
	if (element.duration !== undefined && durationFrames !== undefined) {
		throw new Error("Give duration or durationFrames, not both");
	}

	const {
		after: _after,
		startFrame: _startFrame,
		durationFrames: _durationFrames,
		...rest
	} = element;
	const resolved = { ...rest } as T;

	if (appendsToEnd) {
		if (!element.trackId) {
			throw new Error('startTime "end" needs a trackId');
		}
		const track = tracks.find((candidate) => candidate.id === element.trackId);
		if (!track) throw new Error(`Track not found: ${element.trackId}`);
		resolved.startTime = trackEndTime({ track, fps });
	} else if (after !== undefined) {
		if (typeof after !== "string" || after.length === 0) {
			throw new Error("after must be an element id");
		}
		const anchorTrack = tracks.find((track) =>
			track.elements.some((candidate) => candidate.id === after)
		);
		const anchor = anchorTrack?.elements.find(
			(candidate) => candidate.id === after
		);
		if (!anchorTrack || !anchor) {
			throw new Error(`Element not found for after: ${after}`);
		}
		resolved.startTime = getTimelineElementEndTime({ element: anchor, fps });
		if (!element.trackId) resolved.trackId = anchorTrack.id;
	} else if (startFrame !== undefined) {
		resolved.startTime =
			readFrameCount({
				value: startFrame,
				field: "startFrame",
				allowZero: true,
			}) / fps;
	}

	if (durationFrames !== undefined) {
		resolved.duration =
			readFrameCount({
				value: durationFrames,
				field: "durationFrames",
				allowZero: false,
			}) / fps;
	}
	return resolved;
}
