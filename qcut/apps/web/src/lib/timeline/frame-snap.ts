/**
 * Putting clip edges on whole frames (`editor timeline snap --to frames`).
 *
 * A cut made by time rather than by frame (a range deleted on bar lines, a
 * split at 52.425333 s) leaves clips that start and end between frames. Each
 * edge is moved to a frame here without moving what the clip shows: the trim
 * on that side takes up the difference, so the same source frame stays at
 * the same timeline time. Two clips that meet at a cut keep meeting: the cut
 * goes to one frame for both.
 *
 * An edge can only move outwards while the clip has unused source on that
 * side. Where it has none, the edge goes to the frame on its inner side
 * instead; a cut with no spare source on either side stays where it is and
 * is reported.
 *
 * @module lib/timeline/frame-snap
 */

import { getTimelineElementDuration } from "@/lib/timeline";
import { clampPlaybackRate } from "@/lib/video/video-timing";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";

/** Closer to a frame than this (in frames) is float noise, not an offset. */
const ON_FRAME_TOLERANCE = 1e-3;
/** Two clips this close (in frames) meet at one cut. */
const SEAM_TOLERANCE = 0.5;

export interface FrameSnapChange {
	trackId: string;
	elementId: string;
	startTime: { from: number; to: number };
	endTime: { from: number; to: number };
}

export interface FrameSnapSkip {
	trackId: string;
	elementId: string;
	reason: string;
}

export interface FrameSnapPlan {
	tracks: TimelineTrack[];
	/** Clips looked at. */
	checked: number;
	changed: FrameSnapChange[];
	skipped: FrameSnapSkip[];
}

/** Whether `time` sits on a frame at `fps`. */
export function isOnFrame({
	time,
	fps,
}: {
	time: number;
	fps: number;
}): boolean {
	const frames = time * fps;
	return Math.abs(frames - Math.round(frames)) < ON_FRAME_TOLERANCE;
}

interface Edges {
	element: TimelineElement;
	start: number;
	end: number;
	/** Timeline seconds the start can move earlier, the end later. */
	headRoom: number;
	tailRoom: number;
	/** Why the clip cannot be retimed by its trims, if it cannot. */
	fixed?: string;
	targeted: boolean;
}

function describeEdges({
	element,
	fps,
	isStill,
	targeted,
}: {
	element: TimelineElement;
	fps: number;
	isStill: boolean;
	targeted: boolean;
}): Edges {
	const start = element.startTime;
	const end = start + getTimelineElementDuration({ element, fps });
	const base = { element, start, end, targeted };
	if (element.type !== "media" || isStill) {
		// No source to run out of: the clip is as long as it is told to be.
		return {
			...base,
			headRoom: Number.POSITIVE_INFINITY,
			tailRoom: Number.POSITIVE_INFINITY,
		};
	}
	if ((element.speedKeyframes?.length ?? 0) > 0) {
		return { ...base, headRoom: 0, tailRoom: 0, fixed: "it has a speed curve" };
	}
	if ((element.freezeFrameDuration ?? 0) > 0) {
		return {
			...base,
			headRoom: 0,
			tailRoom: 0,
			fixed: "it has a freeze frame",
		};
	}
	const rate = clampPlaybackRate(element.playbackRate);
	// Played backwards, the clip's start shows the end of its source span.
	const [head, tail] = element.reverse
		? [element.trimEnd, element.trimStart]
		: [element.trimStart, element.trimEnd];
	return { ...base, headRoom: head / rate, tailRoom: tail / rate };
}

function frameAt({ frames, fps }: { frames: number; fps: number }): number {
	return frames / fps;
}

/** The frame times around `time`: the nearest first, then the other side. */
function frameChoices({ time, fps }: { time: number; fps: number }): number[] {
	const frames = time * fps;
	const nearest = Math.round(frames);
	const other = nearest > frames ? Math.floor(frames) : Math.ceil(frames);
	return nearest === other
		? [frameAt({ frames: nearest, fps })]
		: [frameAt({ frames: nearest, fps }), frameAt({ frames: other, fps })];
}

/** Where a boundary goes, or why it stays between frames. */
type Boundary = { time: number } | { reason: string };

function canMove(edges: Edges): boolean {
	return edges.targeted && !edges.fixed;
}

/**
 * Where a boundary goes: the first frame around it that the clip ending
 * there (`ending`) and the clip starting there (`starting`) can both take.
 * A clip that is not being snapped, or cannot be retimed, stays put, so the
 * boundary cannot move at all.
 */
function resolveBoundary({
	time,
	fps,
	ending,
	starting,
}: {
	time: number;
	fps: number;
	ending?: Edges;
	starting?: Edges;
}): Boundary {
	const slack = 1e-9;
	for (const choice of frameChoices({ time, fps })) {
		const later = choice - time;
		if (Math.abs(later) <= slack) return { time: choice };
		if (ending && !canMove(ending)) continue;
		if (starting && !canMove(starting)) continue;
		// Later needs unused source after the clip that ends here; earlier
		// needs it before the clip that starts here.
		if (ending && later > ending.tailRoom + slack) continue;
		if (starting && -later > starting.headRoom + slack) continue;
		return { time: choice };
	}
	const held = [ending, starting].find(
		(edges) => edges !== undefined && !canMove(edges)
	);
	if (held?.fixed) {
		return { reason: `the clip at that cut cannot be retimed (${held.fixed})` };
	}
	if (held) return { reason: "the clip it meets there is not being snapped" };
	return {
		reason: "there is no unused source on either side of that cut",
	};
}

function retime({
	edges,
	start,
	end,
}: {
	edges: Edges;
	start: number;
	end: number;
}): TimelineElement {
	const { element } = edges;
	const length = end - start;
	if (!Number.isFinite(edges.headRoom)) {
		return {
			...element,
			startTime: start,
			duration: length + element.trimStart + element.trimEnd,
		};
	}
	if (element.type !== "media") return element;
	const rate = clampPlaybackRate(element.playbackRate);
	const headTrim = Math.max(
		0,
		(element.reverse ? element.trimEnd : element.trimStart) +
			(start - edges.start) * rate
	);
	const tailTrim = Math.max(0, element.duration - headTrim - length * rate);
	return {
		...element,
		startTime: start,
		...(element.reverse
			? { trimEnd: headTrim, trimStart: tailTrim }
			: { trimStart: headTrim, trimEnd: tailTrim }),
	};
}

/**
 * `tracks` with the edges of the chosen clips on whole frames, and what
 * changed. `isTargeted` picks the clips (the others stay as they are, and
 * no edge is moved into one); `isStill` says which media clips are pictures.
 */
export function planFrameSnap({
	tracks,
	fps,
	isTargeted,
	isStill = () => false,
}: {
	tracks: TimelineTrack[];
	fps: number;
	isTargeted: (input: {
		track: TimelineTrack;
		element: TimelineElement;
	}) => boolean;
	isStill?: (element: TimelineElement) => boolean;
}): FrameSnapPlan {
	const changed: FrameSnapChange[] = [];
	const skipped: FrameSnapSkip[] = [];
	let checked = 0;
	const seam = SEAM_TOLERANCE / fps;

	const snapped = tracks.map((track) => {
		const all = track.elements
			.map((element) =>
				describeEdges({
					element,
					fps,
					isStill: isStill(element),
					targeted: isTargeted({ track, element }),
				})
			)
			.sort((left, right) => left.start - right.start);
		if (!all.some((edges) => edges.targeted)) return track;

		// One decision per boundary, shared by the clips on both sides of it.
		const startOf = new Map<Edges, Boundary>();
		const endOf = new Map<Edges, Boundary>();
		for (const [index, edges] of all.entries()) {
			const previous = all[index - 1];
			const previousEnd = previous ? endOf.get(previous) : undefined;
			const meetsPrevious =
				previous !== undefined && Math.abs(previous.end - edges.start) <= seam;
			startOf.set(
				edges,
				meetsPrevious && previousEnd
					? previousEnd
					: resolveBoundary({ time: edges.start, fps, starting: edges })
			);
			const next = all[index + 1];
			const meetsNext =
				next !== undefined && Math.abs(edges.end - next.start) <= seam;
			endOf.set(
				edges,
				resolveBoundary({
					time: edges.end,
					fps,
					ending: edges,
					...(meetsNext ? { starting: next } : {}),
				})
			);
		}

		const byId = new Map<string, TimelineElement>();
		for (const edges of all) {
			if (!edges.targeted) continue;
			checked += 1;
			if (
				isOnFrame({ time: edges.start, fps }) &&
				isOnFrame({ time: edges.end, fps })
			) {
				continue;
			}
			const skip = (reason: string) =>
				skipped.push({
					trackId: track.id,
					elementId: edges.element.id,
					reason,
				});
			if (edges.fixed) {
				skip(`${edges.fixed}, so its trims cannot take up the difference`);
				continue;
			}
			const startAt = startOf.get(edges) as Boundary;
			const endAt = endOf.get(edges) as Boundary;
			if ("reason" in startAt)
				skip(`its start stays between frames: ${startAt.reason}`);
			if ("reason" in endAt)
				skip(`its end stays between frames: ${endAt.reason}`);
			const start = "time" in startAt ? startAt.time : edges.start;
			const end = "time" in endAt ? endAt.time : edges.end;
			if (end - start < 1 / fps - 1e-9) {
				skip("it would be left shorter than a frame");
				continue;
			}
			if (
				Math.abs(start - edges.start) < 1e-9 &&
				Math.abs(end - edges.end) < 1e-9
			) {
				continue;
			}
			byId.set(edges.element.id, retime({ edges, start, end }));
			changed.push({
				trackId: track.id,
				elementId: edges.element.id,
				startTime: { from: edges.start, to: start },
				endTime: { from: edges.end, to: end },
			});
		}
		if (byId.size === 0) return track;
		return {
			...track,
			elements: track.elements.map(
				(element) => byId.get(element.id) ?? element
			),
		};
	});

	return { tracks: snapped, checked, changed, skipped };
}

/** The clips of `tracks` with an edge between frames. */
export function findOffFrameElements({
	tracks,
	fps,
}: {
	tracks: TimelineTrack[];
	fps: number;
}): Array<{
	trackId: string;
	elementId: string;
	startTime: number;
	endTime: number;
}> {
	return tracks.flatMap((track) =>
		track.elements.flatMap((element) => {
			const startTime = element.startTime;
			const endTime = startTime + getTimelineElementDuration({ element, fps });
			return isOnFrame({ time: startTime, fps }) &&
				isOnFrame({ time: endTime, fps })
				? []
				: [{ trackId: track.id, elementId: element.id, startTime, endTime }];
		})
	);
}
