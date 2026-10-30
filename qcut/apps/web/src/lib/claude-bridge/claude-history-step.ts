/**
 * The undo step of an editor API batch, taken back when the batch changed
 * nothing (N28, 2026-10-30 trailer report: a refused replace-media left an
 * empty "Edit" step on the undo stack and emptied the redo stack, so one
 * undo no longer took back the last replacement).
 *
 * @module lib/claude-bridge/claude-history-step
 */

import { useTimelineStore } from "@/stores/timeline/timeline-store";
import {
	captureHistoryLabels,
	restoreHistoryLabels,
} from "./claude-transaction-bridge";

/**
 * Pushes the batch's undo step now, where it always went, and `finish`
 * takes it back if the timeline is unchanged: the undo and redo stacks,
 * labels included, are then as they were before the batch.
 */
export function beginHistoryStep(): { finish: () => void } {
	const before = useTimelineStore.getState();
	const saved = {
		tracks: before._tracks,
		history: before.history,
		redoStack: before.redoStack,
		labels: captureHistoryLabels(),
	};
	before.pushHistory();
	const opened = useTimelineStore.getState().history;
	return {
		finish: () => {
			const now = useTimelineStore.getState();
			// Folded into a transaction, or another step came after this one.
			if (opened === saved.history || now.history !== opened) return;
			if (
				now._tracks !== saved.tracks &&
				JSON.stringify(now._tracks) !== JSON.stringify(saved.tracks)
			) {
				return;
			}
			useTimelineStore.setState({
				history: saved.history,
				redoStack: saved.redoStack,
			});
			restoreHistoryLabels({ labels: saved.labels });
		},
	};
}
