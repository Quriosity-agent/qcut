/**
 * Snapping clips to a beat grid: for each clip, the nearest beat to the
 * chosen point within `maxDistance`, and the start time that puts the point
 * on it. Pure, so the editor API and the UI can share the plan.
 */

export type BeatSnapEdge = "start" | "end" | "onset";

export interface BeatSnapCandidate {
	elementId: string;
	trackId: string;
	startTime: number;
	/** Length on the timeline. */
	duration: number;
	/**
	 * For edge "onset": seconds from the clip's start to the attack that lands
	 * on the beat; absent when the clip has no onset to offer.
	 */
	offset?: number;
	/** Round the snapped start onto the frame grid (`fps`). */
	alignToFrames?: boolean;
}

export interface BeatSnapPlan {
	elementId: string;
	trackId: string;
	from: number;
	to: number;
	moved: number;
	beat: number | null;
	/** For edge "onset": the offset that was put on the beat. */
	offset?: number;
	/** Whether `to` sits on the frame grid by request. */
	frameAligned: boolean;
	reason?: string;
}

/** The beat nearest `time`, or null when the nearest is farther than `maxDistance`. */
export function nearestBeat({
	beats,
	time,
	maxDistance,
}: {
	beats: readonly number[];
	time: number;
	maxDistance: number;
}): number | null {
	let best: number | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const beat of beats) {
		const distance = Math.abs(beat - time);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = beat;
		}
	}
	return best !== null && bestDistance <= maxDistance ? best : null;
}

export function planBeatSnaps({
	elements,
	beats,
	edge = "start",
	maxDistance = 0.5,
	fps = 30,
}: {
	elements: readonly BeatSnapCandidate[];
	beats: readonly number[];
	edge?: BeatSnapEdge;
	maxDistance?: number;
	/** The project's frame rate, for clips that align to frames. */
	fps?: number;
}): BeatSnapPlan[] {
	const sorted = [...beats].sort((a, b) => a - b);
	return elements.map((element) => {
		const stay = (reason: string): BeatSnapPlan => ({
			elementId: element.elementId,
			trackId: element.trackId,
			from: element.startTime,
			to: element.startTime,
			moved: 0,
			beat: null,
			frameAligned: false,
			reason,
		});
		let offset: number;
		if (edge === "onset") {
			if (element.offset === undefined) {
				return stay("no onset was found in the clip");
			}
			offset = element.offset;
		} else {
			offset = edge === "end" ? element.duration : 0;
		}
		const beat = nearestBeat({
			beats: sorted,
			time: element.startTime + offset,
			maxDistance,
		});
		if (beat === null) {
			return stay(`no beat within ${maxDistance} s of the clip's ${edge}`);
		}
		const alignToFrames = element.alignToFrames === true && fps > 0;
		const exact = Math.max(0, beat - offset);
		const to = alignToFrames ? Math.round(exact * fps) / fps : exact;
		return {
			elementId: element.elementId,
			trackId: element.trackId,
			from: element.startTime,
			to,
			moved: to - element.startTime,
			beat,
			...(edge === "onset" ? { offset } : {}),
			frameAligned: alignToFrames,
		};
	});
}
