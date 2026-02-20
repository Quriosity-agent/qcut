export function getStoreSnapshot(store: any) {
	return JSON.parse(JSON.stringify(store.getState()));
}

export function snapshotAllStores() {
	const { useMediaStore } = require("@/stores/media-store");
	const { useTimelineStore } = require("@/stores/timeline-store");
	const { usePlaybackStore } = require("@/stores/playback-store");
	const { useEditorStore } = require("@/stores/editor-store");

	return {
		media: getStoreSnapshot(useMediaStore),
		timeline: getStoreSnapshot(useTimelineStore),
		playback: getStoreSnapshot(usePlaybackStore),
		editor: getStoreSnapshot(useEditorStore),
	};
}
