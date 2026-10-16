import { mapMediaSourceTime } from "@/lib/video/video-timing";
import type { MediaElement, TimelineTrack } from "@/types/timeline";

export interface TimelineSceneBoundary {
	timestamp: number;
	confidence: number;
}

/** A cut the split will make: where it is in the source and on the timeline. */
export interface TimelineShotCut {
	sourceTime: number;
	timelineTime: number;
}

/** A detected boundary that will not become a cut, and why. */
export interface TimelineShotSkip {
	sourceTime?: number;
	timelineTime?: number;
	reason: string;
}

/**
 * Turns detected boundaries (source seconds) into timeline cut points for one
 * clip: boundaries outside the clip's trimmed range, within a frame of its
 * edges or of each other, and cuts that would leave a shot shorter than
 * `minShotSeconds` are set aside with a reason instead of dropped silently.
 */
export function planSceneTimelineSplits({
	element,
	scenes,
	fps,
	minShotSeconds = 0,
}: {
	element: MediaElement;
	scenes: TimelineSceneBoundary[];
	fps: number;
	minShotSeconds?: number;
}): { cuts: TimelineShotCut[]; skipped: TimelineShotSkip[] } {
	const frameDuration = 1 / Math.max(1, fps);
	const sourceStart = element.trimStart;
	const sourceEnd = element.duration - element.trimEnd;
	const skipped: TimelineShotSkip[] = [];
	const mapped: TimelineShotCut[] = [];
	for (const scene of scenes) {
		const sourceTime = scene.timestamp;
		if (!Number.isFinite(sourceTime)) {
			skipped.push({ reason: "not a number" });
			continue;
		}
		// Detectors report the clip's own start as a boundary; it is not a cut.
		if (sourceTime <= sourceStart && sourceTime <= 0) continue;
		if (sourceTime <= sourceStart || sourceTime >= sourceEnd) {
			skipped.push({
				sourceTime,
				reason: "outside the clip's trimmed range",
			});
			continue;
		}
		if (
			sourceTime <= sourceStart + frameDuration ||
			sourceTime >= sourceEnd - frameDuration
		) {
			skipped.push({
				sourceTime,
				reason: "within one frame of the clip's edge",
			});
			continue;
		}
		mapped.push({
			sourceTime,
			timelineTime:
				element.startTime + mapMediaSourceTime({ element, sourceTime, fps }),
		});
	}
	mapped.sort((left, right) => left.timelineTime - right.timelineTime);

	const timelineEnd =
		element.startTime +
		mapMediaSourceTime({ element, sourceTime: sourceEnd, fps });
	const cuts: TimelineShotCut[] = [];
	for (const cut of mapped) {
		const previous = cuts[cuts.length - 1]?.timelineTime ?? element.startTime;
		if (cut.timelineTime - previous < frameDuration) {
			skipped.push({ ...cut, reason: "within one frame of another cut" });
			continue;
		}
		if (
			minShotSeconds > 0 &&
			(cut.timelineTime - previous < minShotSeconds ||
				timelineEnd - cut.timelineTime < minShotSeconds)
		) {
			skipped.push({
				...cut,
				reason: `would leave a shot shorter than ${minShotSeconds} s`,
			});
			continue;
		}
		cuts.push(cut);
	}
	return { cuts, skipped };
}

export function sceneTimelineSplitTimes({
	element,
	scenes,
	fps,
}: {
	element: MediaElement;
	scenes: TimelineSceneBoundary[];
	fps: number;
}): number[] {
	return planSceneTimelineSplits({ element, scenes, fps }).cuts.map(
		(cut) => cut.timelineTime
	);
}

/**
 * Splits one clip at every time in order, as a single undo step, and says
 * which times the editor refused instead of leaving a shorter result
 * unexplained.
 */
export function applyTimelineSceneSplits({
	trackId,
	elementId,
	splitTimes,
	pushHistory,
	splitElement,
}: {
	trackId: string;
	elementId: string;
	splitTimes: number[];
	pushHistory: () => void;
	splitElement: (
		trackId: string,
		elementId: string,
		splitTime: number,
		pushHistory: boolean
	) => string | null;
}): { createdElementIds: string[]; skipped: TimelineShotSkip[] } {
	if (splitTimes.length === 0) return { createdElementIds: [], skipped: [] };
	pushHistory();
	const createdElementIds: string[] = [];
	const skipped: TimelineShotSkip[] = [];
	let rightElementId = elementId;
	for (const splitTime of splitTimes) {
		const createdElementId = splitElement(
			trackId,
			rightElementId,
			splitTime,
			false
		);
		if (!createdElementId) {
			skipped.push({
				timelineTime: splitTime,
				reason:
					"the editor refused the split (locked track, or the time is outside the clip)",
			});
			continue;
		}
		createdElementIds.push(createdElementId);
		rightElementId = createdElementId;
	}
	return { createdElementIds, skipped };
}

export function rollbackTimelineSceneSplits({
	tracks,
	trackId,
	sourceElement,
	createdElementIds,
}: {
	tracks: TimelineTrack[];
	trackId: string;
	sourceElement: MediaElement;
	createdElementIds: string[];
}): TimelineTrack[] {
	const splitElementIds = new Set([sourceElement.id, ...createdElementIds]);
	return tracks.map((track) => {
		if (track.id !== trackId) return track;
		const retained = track.elements.filter(
			(element) => !splitElementIds.has(element.id)
		);
		return {
			...track,
			elements: [...retained, structuredClone(sourceElement)].sort(
				(left, right) => left.startTime - right.startTime
			),
		};
	});
}
