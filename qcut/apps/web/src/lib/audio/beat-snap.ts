/**
 * Snapping clips to a beat grid: for each clip, the nearest beat to the
 * chosen edge within `maxDistance`, and the start time that puts the edge on
 * it. Pure, so the editor API and the UI can share the plan.
 */

export interface BeatSnapCandidate {
	elementId: string;
	trackId: string;
	startTime: number;
	/** Length on the timeline. */
	duration: number;
}

export interface BeatSnapPlan {
	elementId: string;
	trackId: string;
	from: number;
	to: number;
	moved: number;
	beat: number | null;
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
}: {
	elements: readonly BeatSnapCandidate[];
	beats: readonly number[];
	edge?: "start" | "end";
	maxDistance?: number;
}): BeatSnapPlan[] {
	const sorted = [...beats].sort((a, b) => a - b);
	return elements.map((element) => {
		const edgeTime =
			edge === "end" ? element.startTime + element.duration : element.startTime;
		const beat = nearestBeat({ beats: sorted, time: edgeTime, maxDistance });
		if (beat === null) {
			return {
				elementId: element.elementId,
				trackId: element.trackId,
				from: element.startTime,
				to: element.startTime,
				moved: 0,
				beat: null,
				reason: `no beat within ${maxDistance} s of the clip's ${edge}`,
			};
		}
		const to = Math.max(0, edge === "end" ? beat - element.duration : beat);
		return {
			elementId: element.elementId,
			trackId: element.trackId,
			from: element.startTime,
			to,
			moved: to - element.startTime,
			beat,
		};
	});
}
