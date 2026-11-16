import { useEffect } from "react";
import { debugWarn } from "@/lib/debug/debug-config";
import { refreshChangedMediaSources } from "@/lib/project/media-source-refresh";
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
	const mediaLoaded = useMediaStore(
		(state) => state.hasInitialized && !state.isLoading
	);

	useEffect(() => {
		if (!projectId || !mediaLoaded) return;
		let lastRun = 0;
		const check = () => {
			if (document.visibilityState === "hidden") return;
			const now = Date.now();
			if (now - lastRun < MIN_INTERVAL_MS) return;
			lastRun = now;
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
		};
	}, [projectId, mediaLoaded]);
}
