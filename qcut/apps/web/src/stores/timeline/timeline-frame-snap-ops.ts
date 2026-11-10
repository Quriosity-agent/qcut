/**
 * Putting clip edges on whole frames as one undo step
 * (`editor timeline snap --to frames`); the rule is in `lib/timeline/frame-snap`.
 *
 * @module stores/timeline/timeline-frame-snap-ops
 */

import {
	type FrameSnapChange,
	type FrameSnapSkip,
	planFrameSnap,
} from "@/lib/timeline/frame-snap";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import type {
	OperationDeps,
	StoreGet,
	StoreSet,
} from "./timeline-store-operations";

export interface SnapElementsToFramesRequest {
	/** Which clips are snapped; the rest stay as they are. */
	isTargeted: (input: {
		track: TimelineTrack;
		element: TimelineElement;
	}) => boolean;
	/** Which media clips are pictures, with no source to run out of. */
	isStill?: (element: TimelineElement) => boolean;
	/** Work out the changes without making them. */
	dryRun?: boolean;
}

export interface SnapElementsToFramesResult {
	fps: number;
	checked: number;
	changed: FrameSnapChange[];
	skipped: FrameSnapSkip[];
}

export function createFrameSnapOps(
	get: StoreGet,
	_set: StoreSet,
	deps: OperationDeps
) {
	const { getProjectFps, updateTracksAndSave } = deps;

	return {
		snapElementsToFrames: ({
			isTargeted,
			isStill,
			dryRun = false,
		}: SnapElementsToFramesRequest): SnapElementsToFramesResult => {
			const fps = getProjectFps();
			const plan = planFrameSnap({
				tracks: get()._tracks,
				fps,
				isTargeted,
				isStill,
			});
			if (!dryRun && plan.changed.length > 0) {
				get().pushHistory();
				updateTracksAndSave(plan.tracks);
			}
			return {
				fps,
				checked: plan.checked,
				changed: plan.changed,
				skipped: plan.skipped,
			};
		},
	};
}
