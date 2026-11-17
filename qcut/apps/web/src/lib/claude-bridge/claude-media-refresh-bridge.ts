/**
 * The editor's side of `POST /api/claude/media/:projectId/refresh`, and of
 * the check the desktop app asks for before an export: read again every
 * media file of the open project that was written over in the project
 * folder, and say which ones.
 *
 * @module lib/claude-bridge/claude-media-refresh-bridge
 */
import type { PlatformClaudeMediaAPI } from "@qcut/platform-core";
import { refreshChangedMediaSources } from "@/lib/project/media-source-refresh";
import { useProjectStore } from "@/stores/project-store";

export function setupMediaRefreshHandler({
	media,
}: {
	media?: PlatformClaudeMediaAPI;
}): void {
	if (!media?.onMediaRefresh) return;
	media.onMediaRefresh(async (candidate: unknown) => {
		const projectId =
			typeof candidate === "object" && candidate !== null
				? (candidate as { projectId?: unknown }).projectId
				: undefined;
		if (typeof projectId !== "string" || !projectId.trim()) {
			throw new Error("Invalid media refresh request");
		}
		const activeProjectId = useProjectStore.getState().activeProject?.id;
		if (activeProjectId !== projectId) {
			throw new Error(`Cannot refresh media for inactive project ${projectId}`);
		}
		return refreshChangedMediaSources({ projectId });
	});
}
