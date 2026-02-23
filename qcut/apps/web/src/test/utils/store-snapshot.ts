export function getStoreSnapshot(store: any) {
	return JSON.parse(JSON.stringify(store.getState()));
}

export function snapshotAllStores() {
	const { useMediaStore } = require("@/stores/media/media-store");
	const { useTimelineStore } = require("@/stores/timeline/timeline-store");
	const { usePlaybackStore } = require("@/stores/editor/playback-store");
	const { useEditorStore } = require("@/stores/editor/editor-store");

	return {
		media: getStoreSnapshot(useMediaStore),
		timeline: getStoreSnapshot(useTimelineStore),
		playback: getStoreSnapshot(usePlaybackStore),
		editor: getStoreSnapshot(useEditorStore),
	};
}
