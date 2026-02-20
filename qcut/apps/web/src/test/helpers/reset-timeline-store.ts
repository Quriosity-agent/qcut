import { useTimelineStore } from "@/stores/timeline-store";

export function resetTimelineStore() {
	const store = useTimelineStore.getState();
	if (typeof store.clearTimeline === "function") {
		store.clearTimeline();
		return;
	}
	// Fallback for older store versions: don't touch tracks to preserve invariants.
	useTimelineStore.setState({
		history: [],
		redoStack: [],
		selectedElements: [],
	});
}
