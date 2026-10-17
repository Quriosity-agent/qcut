import {
	runSmartShotSplit,
	videoElementsOfTrack,
} from "@/lib/timeline/smart-shot-split";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type {
	ClaudeShotSplitClipResult,
	ClaudeShotSplitRequest,
	ClaudeShotSplitResponse,
} from "../../../../../electron/types/claude-api";
import { debugError } from "@/lib/debug/debug-config";

type ShotSplitBridgeAPI = {
	onShotSplit?: (
		callback: (data: { requestId: string; request: unknown }) => void
	) => void;
	sendShotSplitResponse?: (
		requestId: string,
		result:
			| { ok: true; response: Record<string, unknown> }
			| { ok: false; error: string }
	) => void;
};

/**
 * The editor API's shot split: one clip, or every video clip on a track, through
 * the same `runSmartShotSplit` the context menu uses. A whole track is one
 * undo step.
 */
export async function performShotSplit({
	request,
}: {
	request: ClaudeShotSplitRequest;
}): Promise<ClaudeShotSplitResponse> {
	const common = {
		projectId: request.projectId,
		engine: request.engine,
		cuts: request.cuts,
		threshold: request.threshold,
		minShotSeconds: request.minShotSeconds,
		dryRun: request.dryRun,
	};
	if (request.elementId) {
		const trackId = useTimelineStore
			.getState()
			._tracks.find((track) =>
				track.elements.some((element) => element.id === request.elementId)
			)?.id;
		if (!trackId) throw new Error(`Element not found: ${request.elementId}`);
		const result = await runSmartShotSplit({
			...common,
			trackId,
			elementId: request.elementId,
		});
		return { results: [result as ClaudeShotSplitClipResult], failed: [] };
	}
	const trackId = request.trackId as string;
	const elements = videoElementsOfTrack({ trackId });
	if (elements.length === 0) {
		throw new Error(`Track ${trackId} has no video clips to split`);
	}
	const results: ClaudeShotSplitClipResult[] = [];
	const failed: ClaudeShotSplitResponse["failed"] = [];
	let historyPushed = false;
	for (const element of elements) {
		try {
			if (!request.dryRun && !historyPushed) {
				useTimelineStore.getState().pushHistory();
				historyPushed = true;
			}
			results.push(
				(await runSmartShotSplit({
					...common,
					trackId,
					elementId: element.id,
					history: "none",
				})) as ClaudeShotSplitClipResult
			);
		} catch (error) {
			failed.push({
				elementId: element.id,
				elementName: element.name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { results, failed };
}

export function setupShotSplitHandlers({
	claudeAPI,
}: {
	claudeAPI: ShotSplitBridgeAPI;
}) {
	// An older preload has no shot-split channel; the menu still works without it.
	if (!claudeAPI.onShotSplit || !claudeAPI.sendShotSplitResponse) return;
	const respond = claudeAPI.sendShotSplitResponse;
	claudeAPI.onShotSplit(async (data) => {
		try {
			const response = await performShotSplit({
				request: data.request as ClaudeShotSplitRequest,
			});
			respond(data.requestId, {
				ok: true,
				response: response as unknown as Record<string, unknown>,
			});
		} catch (error) {
			debugError("[ClaudeShotSplitBridge] Shot split failed:", error);
			respond(data.requestId, {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});
}
