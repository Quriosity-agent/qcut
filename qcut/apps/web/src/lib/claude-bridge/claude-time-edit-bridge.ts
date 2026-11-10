import { debugError } from "@/lib/debug/debug-config";
import { useMediaStore } from "@/stores/media/media-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import type {
	ClaudeInsertGapRequest,
	ClaudeInsertGapResponse,
	ClaudeSnapToFramesRequest,
	ClaudeSnapToFramesResponse,
	ClaudeTimeEditRequest,
	ClaudeTimeEditResponse,
} from "../../../../../electron/types/claude-api";

/**
 * Edits of the timeline's time over the editor API, each one undo step:
 * `editing insert-gap` opens empty time (the reverse of a ripple delete of a
 * range), and `timeline snap --to frames` puts clip edges on whole frames
 * without moving what the clips show.
 */

type TimeEditBridgeAPI = {
	onTimeEdit?: (
		callback: (data: { requestId: string; request: unknown }) => void
	) => void;
	sendTimeEditResponse?: (
		requestId: string,
		result:
			| { ok: true; response: Record<string, unknown> }
			| { ok: false; error: string }
	) => void;
};

function assertProjectOpen({ projectId }: { projectId: string }): void {
	if (useProjectStore.getState().loadedProjectId !== projectId) {
		throw new Error(
			`Project ${projectId} is not open in the editor; open it first (qcut editor navigator open --project-id ${projectId})`
		);
	}
}

export function performInsertGap({
	request,
}: {
	request: ClaudeInsertGapRequest;
}): ClaudeInsertGapResponse {
	assertProjectOpen({ projectId: request.projectId });
	const result = useTimelineStore.getState().insertTimeGap({
		time: request.time,
		duration: request.duration,
		trackIds: request.trackIds,
		keepAutomation: request.keepAutomation === true,
	});
	if (!result.ok) throw new Error(result.error);
	const { ok: _ok, ...applied } = result;
	return { projectId: request.projectId, ...applied };
}

/** The named tracks, each of which must exist and be unlocked. */
function requireEditableTracks({
	tracks,
	trackIds,
}: {
	tracks: TimelineTrack[];
	trackIds: string[];
}): void {
	for (const trackId of trackIds) {
		const track = tracks.find((candidate) => candidate.id === trackId);
		if (!track) throw new Error(`Track not found: ${trackId}`);
		if (track.locked) {
			throw new Error(`Track ${trackId} (${track.name}) is locked`);
		}
	}
}

export function performSnapToFrames({
	request,
}: {
	request: ClaudeSnapToFramesRequest;
}): ClaudeSnapToFramesResponse {
	assertProjectOpen({ projectId: request.projectId });
	const store = useTimelineStore.getState();
	const tracks = store._tracks;
	if (request.trackIds) {
		requireEditableTracks({ tracks, trackIds: request.trackIds });
	}
	const elementIds = request.elementIds
		? new Set(request.elementIds)
		: undefined;
	if (elementIds) {
		for (const elementId of elementIds) {
			const track = tracks.find((candidate) =>
				candidate.elements.some((element) => element.id === elementId)
			);
			if (!track) throw new Error(`Element not found: ${elementId}`);
			if (track.locked) {
				throw new Error(
					`Element ${elementId} is on a locked track (${track.name})`
				);
			}
		}
	}
	const trackIds = request.trackIds ? new Set(request.trackIds) : undefined;
	const mediaTypes = new Map(
		useMediaStore.getState().mediaItems.map((item) => [item.id, item.type])
	);
	const mediaTypeOf = (element: TimelineElement) =>
		element.type === "media" ? mediaTypes.get(element.mediaId) : undefined;
	const includeSound = request.frameAlign === "all";

	const dryRun = request.dryRun === true;
	const result = store.snapElementsToFrames({
		dryRun,
		isStill: (element) => mediaTypeOf(element) === "image",
		isTargeted: ({ track, element }) => {
			if (track.locked) return false;
			if (trackIds && !trackIds.has(track.id)) return false;
			if (elementIds && !elementIds.has(element.id)) return false;
			// Sound may sit between frames; anything seen has to start on one.
			const isSound =
				track.type === "audio" || mediaTypeOf(element) === "audio";
			return includeSound || !isSound;
		},
	});
	return { projectId: request.projectId, dryRun, ...result };
}

function performTimeEdit({
	request,
}: {
	request: ClaudeTimeEditRequest;
}): ClaudeTimeEditResponse {
	switch (request.operation) {
		case "insert-gap":
			return performInsertGap({ request });
		case "snap-to-frames":
			return performSnapToFrames({ request });
		default:
			throw new Error(
				`Unknown time edit: ${String((request as { operation?: unknown }).operation)}`
			);
	}
}

export function setupTimeEditHandlers({
	claudeAPI,
}: {
	claudeAPI: TimeEditBridgeAPI;
}) {
	// An older preload has no such channel; the editor works without it.
	if (!claudeAPI.onTimeEdit || !claudeAPI.sendTimeEditResponse) return;
	const respond = claudeAPI.sendTimeEditResponse;
	claudeAPI.onTimeEdit((data) => {
		try {
			const response = performTimeEdit({
				request: data.request as ClaudeTimeEditRequest,
			});
			respond(data.requestId, {
				ok: true,
				response: response as unknown as Record<string, unknown>,
			});
		} catch (error) {
			debugError("[ClaudeTimeEditBridge] Time edit failed:", error);
			respond(data.requestId, {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});
}
