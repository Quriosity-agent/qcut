import type { SetFn, GetFn } from "./types";

/** Creates actions for syncing playback state across Remotion instances. */
export function createSyncActions(set: SetFn, get: GetFn) {
	return {
		syncToGlobalFrame: (frame: number) => {
			const state = get();

			set({
				syncState: {
					...state.syncState,
					globalFrame: frame,
					lastSyncTime: Date.now(),
				},
			});

			for (const elementId of state.syncState.activeElementIds) {
				const instance = state.instances.get(elementId);
				if (instance?.playerRef) {
					instance.playerRef.seekTo(instance.localFrame);
				}
			}
		},

		syncPlayState: (isPlaying: boolean) => {
			const state = get();

			set({
				syncState: {
					...state.syncState,
					isPlaying,
					lastSyncTime: Date.now(),
				},
			});

			for (const elementId of state.syncState.activeElementIds) {
				if (isPlaying) {
					get().playInstance(elementId);
				} else {
					get().pauseInstance(elementId);
				}
			}
		},

		syncPlaybackRate: (rate: number) => {
			const state = get();

			set({
				syncState: {
					...state.syncState,
					playbackRate: rate,
					lastSyncTime: Date.now(),
				},
			});

			for (const elementId of state.syncState.activeElementIds) {
				get().setInstancePlaybackRate(elementId, rate);
			}
		},

		updateActiveElements: (elementIds: string[]) => {
			set((state) => ({
				syncState: {
					...state.syncState,
					activeElementIds: elementIds,
				},
			}));
		},
	};
}
