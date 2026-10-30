import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import type { ClaudeTimeline } from "../../../../../electron/types/claude-api";
import { debugLog, debugError } from "@/lib/debug/debug-config";
import { normalizeProjectAudioMixSettings } from "@/lib/audio/audio-mix-settings";
import {
	calculateTimelineDuration,
	formatTracksForExport,
	applyTimelineToStore,
} from "./claude-timeline-bridge-helpers";
import type { ClaudeTimelineBridgeAPI } from "./claude-timeline-bridge";
import {
	isLoadedProject,
	loadStoredProjectView,
	storedProjectNotFound,
} from "./claude-stored-project";

function liveTimeline(): ClaudeTimeline {
	const project = useProjectStore.getState().activeProject;
	const tracks = useTimelineStore.getState().tracks;
	const fps = project?.fps || 30;
	return {
		name: project?.name || "Untitled",
		duration: calculateTimelineDuration({ tracks, fps }),
		width: project?.canvasSize?.width || 1920,
		height: project?.canvasSize?.height || 1080,
		fps,
		tracks: formatTracksForExport({ tracks, fps }),
		projectId: project?.id,
		audioMix: normalizeProjectAudioMixSettings({
			audioMix: project?.audioMix,
		}),
	};
}

/** A project the editor does not have loaded, as it was last saved (N23). */
async function storedTimeline({
	projectId,
}: {
	projectId: string;
}): Promise<ClaudeTimeline> {
	const stored = await loadStoredProjectView({ projectId });
	if (!stored) throw storedProjectNotFound({ projectId });
	const { project, tracks, media } = stored;
	const names = new Map(media.map((item) => [item.id, item.name]));
	const fps = project.fps || 30;
	return {
		name: project.name || "Untitled",
		duration: calculateTimelineDuration({ tracks, fps }),
		width: project.canvasSize?.width || 1920,
		height: project.canvasSize?.height || 1080,
		fps,
		tracks: formatTracksForExport({
			tracks,
			fps,
			mediaName: (mediaId) => names.get(mediaId),
		}),
		projectId: project.id,
		audioMix: normalizeProjectAudioMixSettings({ audioMix: project.audioMix }),
		readFromStorage: true,
	};
}

export function setupRequestHandlers({
	claudeAPI,
}: {
	claudeAPI: ClaudeTimelineBridgeAPI;
}): void {
	// Respond to timeline export request from main process, echoing its id
	// so main matches this answer to the request that asked for it. A request
	// naming a project the editor does not have loaded reads it from storage.
	claudeAPI.onRequest(async (request) => {
		try {
			debugLog("[ClaudeTimelineBridge] Received timeline export request");
			const projectId = request?.projectId;
			const timeline =
				projectId === undefined || isLoadedProject({ projectId })
					? liveTimeline()
					: await storedTimeline({ projectId });
			claudeAPI.sendResponse(timeline, request?.requestId);
			debugLog("[ClaudeTimelineBridge] Sent timeline response");
		} catch (error) {
			debugError(
				"[ClaudeTimelineBridge] Failed to handle timeline export request:",
				error
			);
			claudeAPI.sendResponse(
				null,
				request?.requestId,
				error instanceof Error ? error.message : "Timeline request failed"
			);
		}
	});

	// Handle timeline import from Claude
	claudeAPI.onApply(async (timeline: any, replace?: boolean) => {
		try {
			debugLog(
				"[ClaudeTimelineBridge] Received timeline to apply:",
				timeline.name,
				"replace:",
				replace
			);

			if (replace) {
				const timelineStore = useTimelineStore.getState();
				timelineStore.pushHistory();
				for (const track of [...timelineStore.tracks]) {
					for (const element of [...track.elements]) {
						useTimelineStore
							.getState()
							.removeElementFromTrack(track.id, element.id, false);
					}
				}
			}

			await applyTimelineToStore(timeline);
		} catch (error) {
			debugError("[ClaudeTimelineBridge] Failed to apply timeline:", error);
		}
	});
}
