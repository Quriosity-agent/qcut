import { useEffect } from "react";
import { debugWarn } from "@/lib/debug/debug-config";
import { refreshChangedMediaSources } from "@/lib/project/media-source-refresh";
import { settleUnsettledMediaRenames } from "@/stores/media/media-rename";
import { useMediaStore } from "@/stores/media/media-store";
import { useProjectStore } from "@/stores/project-store";

/** A window that keeps taking focus does not scan the folder each time. */
const MIN_INTERVAL_MS = 3000;

/**
 * Keeps the editor's copies of the open project's media files current: once
 * when the project's media has loaded, and each time the window is looked at
 * again after another app had it (the moment a file rendered again elsewhere
 * is expected to show in the preview). The check is one scan of the project's
 * media folder; only a file that changed is read.
 */
export function useRefreshChangedMedia(): void {
	const projectId = useProjectStore((state) => state.activeProject?.id);
	const projectLoaded = useProjectStore(
		(state) =>
			state.loadedProjectId !== null &&
			state.loadedProjectId === state.activeProject?.id
	);
	const mediaLoaded = useMediaStore(
		(state) => state.hasInitialized && !state.isLoading
	);

	// A rename that ended with the editor and the folder apart is settled
	// once the project is all there: its timelines are then in the stores as
	// they are stored.
	useEffect(() => {
		if (!projectId || !projectLoaded) return;
		settleUnsettledMediaRenames({ projectId }).catch((error: unknown) => {
			debugWarn("[RefreshChangedMedia] Noted renames were not settled:", error);
		});
	}, [projectId, projectLoaded]);

	useEffect(() => {
		if (!projectId || !mediaLoaded) return;
		let lastRun = 0;
		let later: ReturnType<typeof setTimeout> | undefined;
		const check = () => {
			if (document.visibilityState === "hidden") return;
			const wait = lastRun + MIN_INTERVAL_MS - Date.now();
			if (wait > 0) {
				// Too soon after the last check. It is made once the interval is
				// over: the window may stay in front from here on, and a file
				// that changed in between would not be looked at again.
				later ??= setTimeout(() => {
					later = undefined;
					check();
				}, wait);
				return;
			}
			lastRun = Date.now();
			refreshChangedMediaSources({ projectId }).catch((error: unknown) => {
				debugWarn("[RefreshChangedMedia] The check failed:", error);
			});
		};
		check();
		window.addEventListener("focus", check);
		document.addEventListener("visibilitychange", check);
		return () => {
			window.removeEventListener("focus", check);
			document.removeEventListener("visibilitychange", check);
			clearTimeout(later);
		};
	}, [projectId, mediaLoaded]);
}
