import { planBeatSnaps } from "@/lib/audio/beat-snap";
import { mapMediaBeatToTimeline } from "@/lib/audio/timeline-beats";
import { debugError } from "@/lib/debug/debug-config";
import { useBeatDetectionStore } from "@/stores/beat-detection-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { MediaElement } from "@/types/timeline";
import type {
	ClaudeBeatsMarkRequest,
	ClaudeBeatsMarkResponse,
	ClaudeSnapToBeatsRequest,
	ClaudeSnapToBeatsResponse,
	ClaudeSnapToBeatsResult,
} from "../../../../../electron/types/claude-api";

/**
 * Beats over the editor API, through the same stores the beat panel uses:
 * `beats mark` puts a clip's detection result in the beat store (the ruler's
 * beat markers read it) and may add bookmarks; `timeline snap --to beats`
 * moves clips onto those beats with the store's own move, so an occupied
 * span or a locked track refuses it the same way a drag would.
 */

type BeatsBridgeAPI = {
	onBeatsMark?: (
		callback: (data: { requestId: string; request: unknown }) => void
	) => void;
	sendBeatsMarkResponse?: (
		requestId: string,
		result:
			| { ok: true; response: Record<string, unknown> }
			| { ok: false; error: string }
	) => void;
	onSnapToBeats?: (
		callback: (data: { requestId: string; request: unknown }) => void
	) => void;
	sendSnapToBeatsResponse?: (
		requestId: string,
		result:
			| { ok: true; response: Record<string, unknown> }
			| { ok: false; error: string }
	) => void;
};

function findMediaElement({ elementId }: { elementId: string }): {
	element: MediaElement;
	trackId: string;
} {
	for (const track of useTimelineStore.getState()._tracks) {
		const element = track.elements.find((item) => item.id === elementId);
		if (!element) continue;
		if (element.type !== "media") {
			throw new Error(`Element ${elementId} is not a media clip`);
		}
		return { element, trackId: track.id };
	}
	throw new Error(`Element not found: ${elementId}`);
}

function assertProjectOpen({ projectId }: { projectId: string }): void {
	if (useProjectStore.getState().loadedProjectId !== projectId) {
		throw new Error(
			`Project ${projectId} is not open in the editor; open it first (qcut editor navigator open --project-id ${projectId})`
		);
	}
}

/** Beats mapped onto the timeline through the clip's trims and speed. */
function timelineBeats({
	element,
	fps,
}: {
	element: MediaElement;
	fps: number;
}) {
	const result = useBeatDetectionStore.getState().cache.get(element.id);
	if (!result) return undefined;
	return result.beats.map((beat) => ({
		sourceTime: beat.timestamp,
		timelineTime: mapMediaBeatToTimeline({
			element,
			sourceTimestamp: beat.timestamp,
			fps,
		}),
		isDownbeat: beat.isDownbeat,
		strength: beat.strength,
	}));
}

export async function performBeatsMark({
	request,
}: {
	request: ClaudeBeatsMarkRequest;
}): Promise<ClaudeBeatsMarkResponse> {
	assertProjectOpen({ projectId: request.projectId });
	const { element, trackId } = findMediaElement({
		elementId: request.elementId,
	});
	const fps = useProjectStore.getState().activeProject?.fps ?? 30;
	const beatStore = useBeatDetectionStore.getState();
	// The same cache the panel fills: the ruler's beat markers follow it.
	const cache = new Map(beatStore.cache);
	cache.set(element.id, request.result);
	useBeatDetectionStore.setState({
		cache,
		activeElementId: element.id,
		error: null,
		progress: 1,
	});
	const beats = timelineBeats({ element, fps }) ?? [];
	const onTimeline = beats.filter((beat) => beat.timelineTime !== null);
	let bookmarksAdded = 0;
	const wanted = request.bookmarks ?? "none";
	if (wanted !== "none") {
		const projectStore = useProjectStore.getState();
		const existing = projectStore.activeProject?.bookmarks ?? [];
		for (const beat of onTimeline) {
			if (wanted === "downbeats" && !beat.isDownbeat) continue;
			const time = Math.round((beat.timelineTime as number) * fps) / fps;
			if (existing.some((mark) => Math.abs(mark - time) < 0.001)) continue;
			if (projectStore.isBookmarked(time)) continue;
			await projectStore.toggleBookmark(time);
			bookmarksAdded += 1;
		}
	}
	return {
		projectId: request.projectId,
		elementId: element.id,
		trackId,
		bpm: request.result.bpm,
		confidence: request.result.confidence,
		beats,
		onTimeline: onTimeline.length,
		bookmarksAdded,
	};
}

export function performSnapToBeats({
	request,
}: {
	request: ClaudeSnapToBeatsRequest;
}): ClaudeSnapToBeatsResponse {
	assertProjectOpen({ projectId: request.projectId });
	const store = useTimelineStore.getState();
	const fps = useProjectStore.getState().activeProject?.fps ?? 30;
	const cache = useBeatDetectionStore.getState().cache;
	const beatsElementId =
		request.beatsElementId ??
		(() => {
			const marked = store._tracks
				.flatMap((track) => track.elements)
				.filter((element) => cache.has(element.id));
			if (marked.length === 1) return marked[0].id;
			throw new Error(
				marked.length === 0
					? "No clip has marked beats; run editor beats mark first"
					: "Several clips have marked beats; pass --beats-from <element-id>"
			);
		})();
	const grid = timelineBeats({
		element: findMediaElement({ elementId: beatsElementId }).element,
		fps,
	});
	if (!grid) {
		throw new Error(`Clip ${beatsElementId} has no marked beats`);
	}
	const beats = grid
		.filter(
			(beat) =>
				beat.timelineTime !== null &&
				(!request.downbeatsOnly || beat.isDownbeat)
		)
		.map((beat) => beat.timelineTime as number);
	const edge = request.edge ?? "start";
	const candidates = request.elementIds.map((elementId) => {
		for (const track of store._tracks) {
			const element = track.elements.find((item) => item.id === elementId);
			if (element) {
				const duration =
					element.type === "media"
						? Math.max(
								0,
								element.duration - element.trimStart - element.trimEnd
							) / (element.playbackRate ?? 1)
						: element.duration;
				return {
					elementId,
					trackId: track.id,
					startTime: element.startTime,
					duration,
				};
			}
		}
		throw new Error(`Element not found: ${elementId}`);
	});
	const plans = planBeatSnaps({
		elements: candidates,
		beats,
		edge,
		maxDistance: request.maxDistance ?? 0.5,
	});
	const results: ClaudeSnapToBeatsResult[] = [];
	let pushedHistory = false;
	for (const plan of plans) {
		if (plan.beat === null || Math.abs(plan.moved) < 1e-9) {
			results.push({ ...plan, applied: false });
			continue;
		}
		if (request.dryRun) {
			results.push({ ...plan, applied: false, reason: "dry run" });
			continue;
		}
		if (!pushedHistory) {
			store.pushHistory();
			pushedHistory = true;
		}
		// The store's own move: it refuses an occupied span or a locked track.
		const moved = useTimelineStore
			.getState()
			.updateElementStartTime(plan.trackId, plan.elementId, plan.to, false);
		results.push(
			moved
				? { ...plan, applied: true }
				: {
						...plan,
						to: plan.from,
						moved: 0,
						applied: false,
						reason:
							"the editor refused the move (occupied span or locked track)",
					}
		);
	}
	return {
		projectId: request.projectId,
		beatsElementId,
		edge,
		dryRun: request.dryRun === true,
		results,
		moved: results.filter((result) => result.applied).length,
	};
}

export function setupBeatsHandlers({
	claudeAPI,
}: {
	claudeAPI: BeatsBridgeAPI;
}) {
	// An older preload has no beats channels; the panel still works without them.
	if (claudeAPI.onBeatsMark && claudeAPI.sendBeatsMarkResponse) {
		const respond = claudeAPI.sendBeatsMarkResponse;
		claudeAPI.onBeatsMark(async (data) => {
			try {
				const response = await performBeatsMark({
					request: data.request as ClaudeBeatsMarkRequest,
				});
				respond(data.requestId, {
					ok: true,
					response: response as unknown as Record<string, unknown>,
				});
			} catch (error) {
				debugError("[ClaudeBeatsBridge] Beats mark failed:", error);
				respond(data.requestId, {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}
	if (claudeAPI.onSnapToBeats && claudeAPI.sendSnapToBeatsResponse) {
		const respond = claudeAPI.sendSnapToBeatsResponse;
		claudeAPI.onSnapToBeats((data) => {
			try {
				const response = performSnapToBeats({
					request: data.request as ClaudeSnapToBeatsRequest,
				});
				respond(data.requestId, {
					ok: true,
					response: response as unknown as Record<string, unknown>,
				});
			} catch (error) {
				debugError("[ClaudeBeatsBridge] Snap to beats failed:", error);
				respond(data.requestId, {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}
}
