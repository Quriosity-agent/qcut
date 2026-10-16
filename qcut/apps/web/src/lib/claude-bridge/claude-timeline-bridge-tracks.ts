import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { useMediaStore } from "@/stores/media/media-store";
import type { ClipTransition, TrackType } from "@/types/timeline";
import type {
	ClaudeTrackOperationRequest,
	ClaudeTrackOperationResponse,
} from "../../../../../electron/types/claude-api";
import { debugError } from "@/lib/debug/debug-config";
import {
	parseTimelineColorLabel,
	type TimelineColorLabel,
} from "@/lib/timeline/timeline-color-labels";
import type { ClaudeTimelineBridgeAPI } from "./claude-timeline-bridge";
import { describeTransitionRefusal } from "./claude-transition-refusal";

/** Mirrors the timeline store's jianying-local package-hash contract. */
const LOCAL_PACKAGE_HASH_PATTERN = /^[a-f0-9]{32,64}$/;

const TRACK_TYPES = new Set<TrackType>([
	"media",
	"effect",
	"text",
	"audio",
	"sticker",
	"captions",
	"adjustment",
	"remotion",
	"hyperframes",
	"markdown",
]);

function summarizeTracks(): ClaudeTrackOperationResponse["tracks"] {
	return useTimelineStore.getState().tracks.map((track, index) => ({
		id: track.id,
		index,
		type: track.type,
		name: track.name,
		elementCount: track.elements.length,
		isMain: track.isMain,
		colorLabel: track.colorLabel,
		muted: track.muted === true,
		hidden: track.hidden === true,
		locked: track.locked === true,
	}));
}

const TRACK_SWITCHES = ["muted", "hidden", "locked"] as const;

/**
 * Set a track's mute, visibility and lock through the header toggles, then
 * read them back so a refused switch is reported, not assumed.
 */
function applyTrackSwitches({
	trackId,
	request,
}: {
	trackId: string;
	request: ClaudeTrackOperationRequest;
}): void {
	const store = useTimelineStore.getState();
	const toggles = {
		muted: store.toggleTrackMute,
		hidden: store.toggleTrackHidden,
		locked: store.toggleTrackLocked,
	};
	for (const key of TRACK_SWITCHES) {
		const wanted = request[key];
		if (wanted === undefined) continue;
		const current =
			useTimelineStore
				.getState()
				.tracks.find((track) => track.id === trackId)?.[key] === true;
		if (current !== wanted) toggles[key](trackId);
	}
	const track = useTimelineStore
		.getState()
		.tracks.find((candidate) => candidate.id === trackId);
	for (const key of TRACK_SWITCHES) {
		const wanted = request[key];
		if (wanted !== undefined && (track?.[key] === true) !== wanted) {
			throw new Error(`The editor did not set the track's ${key} to ${wanted}`);
		}
	}
}

function requestsTrackSwitch(request: ClaudeTrackOperationRequest): boolean {
	return TRACK_SWITCHES.some((key) => request[key] !== undefined);
}

/** A request's colour: a label, undefined to clear (null/""), or a thrown list of valid ones. */
function requestedColorLabel(
	request: ClaudeTrackOperationRequest
): TimelineColorLabel | undefined {
	return parseTimelineColorLabel({ value: request.colorLabel });
}

/**
 * Give a track its default clip colour through the same store action as the
 * track menu, then read it back so a refused change is reported, not assumed.
 */
function applyTrackColor({
	trackId,
	request,
	pushHistory,
}: {
	trackId: string;
	request: ClaudeTrackOperationRequest;
	pushHistory: boolean;
}): void {
	const colorLabel = requestedColorLabel(request);
	const store = useTimelineStore.getState();
	const track = store.tracks.find((candidate) => candidate.id === trackId);
	if (track?.locked) throw new Error(`Track "${track.name}" is locked`);
	store.setTrackColorLabel({ trackId, colorLabel, pushHistory });
	const applied = useTimelineStore
		.getState()
		.tracks.find((candidate) => candidate.id === trackId)?.colorLabel;
	if (applied !== colorLabel) {
		throw new Error("Track color verification failed");
	}
}

/**
 * Colour a whole track's clips, or the listed clips, with one call to the
 * store's setColorLabelForElements, the action the clip menu uses. Clips that
 * cannot change are reported instead of silently skipped.
 */
function colorClips(
	request: ClaudeTrackOperationRequest
): ClaudeTrackOperationResponse {
	if (request.colorLabel === undefined) {
		throw new Error("colorLabel is required (null clears the clips' colour)");
	}
	const colorLabel = requestedColorLabel(request);
	const tracks = useTimelineStore.getState().tracks;
	const targets: Array<{ trackId: string; elementId: string }> = [];
	const skipped: Array<{ elementId: string; reason: string }> = [];

	if (request.elementIds && request.elementIds.length > 0) {
		for (const elementId of request.elementIds) {
			const track = tracks.find((candidate) =>
				candidate.elements.some((element) => element.id === elementId)
			);
			if (!track) {
				skipped.push({ elementId, reason: "not on the timeline" });
			} else if (request.trackId && track.id !== request.trackId) {
				skipped.push({ elementId, reason: `on track ${track.id}` });
			} else if (track.locked) {
				skipped.push({ elementId, reason: `track "${track.name}" is locked` });
			} else {
				targets.push({ trackId: track.id, elementId });
			}
		}
	} else {
		if (!request.trackId) throw new Error("Give trackId or elementIds");
		const track = tracks.find((candidate) => candidate.id === request.trackId);
		if (!track) throw new Error(`Track not found: ${request.trackId}`);
		if (track.locked) throw new Error(`Track "${track.name}" is locked`);
		for (const element of track.elements) {
			targets.push({ trackId: track.id, elementId: element.id });
		}
	}

	const updatedCount =
		targets.length > 0
			? useTimelineStore
					.getState()
					.setColorLabelForElements({ elements: targets, colorLabel })
			: 0;
	// Read back: every target must now carry the requested colour.
	const after = useTimelineStore.getState().tracks;
	for (const target of targets) {
		const element = after
			.find((track) => track.id === target.trackId)
			?.elements.find((candidate) => candidate.id === target.elementId);
		if (element?.colorLabel !== colorLabel) {
			skipped.push({
				elementId: target.elementId,
				reason: "the editor did not apply the colour",
			});
		}
	}
	return {
		success: true,
		trackId: request.trackId,
		updatedCount,
		skipped,
		tracks: summarizeTracks(),
	};
}

function applyTrackOperation(
	request: ClaudeTrackOperationRequest
): ClaudeTrackOperationResponse {
	const store = useTimelineStore.getState();

	if (request.action === "create") {
		if (!request.type || !TRACK_TYPES.has(request.type)) {
			throw new Error(`Unsupported track type: ${request.type || "missing"}`);
		}
		if (
			request.index !== undefined &&
			(!Number.isInteger(request.index) || request.index < 0)
		) {
			throw new Error("Track index must be a non-negative integer");
		}

		// Checked before the track exists, so a bad colour creates nothing.
		if (request.colorLabel !== undefined) requestedColorLabel(request);
		// Without an index the new lane goes where the editor would put one of
		// its kind (text and captions above the video, audio below), instead
		// of the bottom of the list where overlays hide behind the clips.
		const trackId =
			request.index === undefined
				? store.addTrackByStackingPolicy(request.type)
				: store.insertTrackAt(request.type, request.index);
		if (request.name?.trim()) store.renameTrack(trackId, request.name);
		if (request.colorLabel !== undefined && request.colorLabel !== null) {
			applyTrackColor({ trackId, request, pushHistory: false });
		}
		if (requestsTrackSwitch(request)) applyTrackSwitches({ trackId, request });
		const tracks = summarizeTracks();
		return {
			success: true,
			trackId,
			index: tracks.findIndex((track) => track.id === trackId),
			tracks,
		};
	}

	if (request.action === "color-clips") return colorClips(request);

	if (!request.trackId) {
		throw new Error("trackId is required");
	}

	const currentIndex = store.tracks.findIndex(
		(track) => track.id === request.trackId
	);
	if (currentIndex < 0) {
		throw new Error(`Track not found: ${request.trackId}`);
	}

	if (request.action === "move" || request.action === "update") {
		if (
			request.action === "update" &&
			request.index === undefined &&
			!request.name?.trim() &&
			request.colorLabel === undefined &&
			!requestsTrackSwitch(request)
		) {
			throw new Error(
				"Track update needs index, name, colorLabel, muted, hidden or locked"
			);
		}
		if (request.colorLabel !== undefined) requestedColorLabel(request);
		if (
			request.index !== undefined &&
			(!Number.isInteger(request.index) ||
				request.index < 0 ||
				request.index >= store.tracks.length)
		) {
			throw new Error(
				`Track index must be between 0 and ${Math.max(0, store.tracks.length - 1)}`
			);
		}
		if (request.index !== undefined)
			store.moveTrack(request.trackId, request.index);
		if (request.name?.trim()) store.renameTrack(request.trackId, request.name);
		if (request.colorLabel !== undefined) {
			applyTrackColor({
				trackId: request.trackId,
				request,
				pushHistory: true,
			});
		}
		if (requestsTrackSwitch(request)) {
			applyTrackSwitches({ trackId: request.trackId, request });
		}
		const tracks = summarizeTracks();
		const index = tracks.findIndex((track) => track.id === request.trackId);
		if (request.index !== undefined && index !== request.index) {
			throw new Error(
				`Track move verification failed: expected ${request.index}, got ${index}`
			);
		}
		if (request.name?.trim() && tracks[index]?.name !== request.name.trim()) {
			throw new Error("Track rename verification failed");
		}
		return { success: true, trackId: request.trackId, index, tracks };
	}

	if (request.action === "add-transition") {
		const transition = request.transition;
		if (!transition) throw new Error("transition is required");
		if (
			transition.engine !== undefined &&
			transition.engine !== "qcut" &&
			transition.engine !== "jianying-local"
		) {
			throw new Error(
				`Unsupported transition engine: ${String(transition.engine)}`
			);
		}
		if (transition.engine === "jianying-local") {
			if (
				typeof transition.packageHash !== "string" ||
				!LOCAL_PACKAGE_HASH_PATTERN.test(transition.packageHash)
			) {
				throw new Error(
					"jianying-local transitions need a 32-64 character lowercase hex packageHash"
				);
			}
		} else if (transition.packageHash !== undefined) {
			throw new Error(
				"packageHash is only valid with the jianying-local engine"
			);
		}
		const videoMediaIds = new Set(
			useMediaStore
				.getState()
				.mediaItems.filter((item) => item.type === "video")
				.map((item) => item.id)
		);
		const transitionId = store.addTransition({
			trackId: request.trackId,
			fromElementId: transition.fromElementId,
			toElementId: transition.toElementId,
			videoMediaIds,
			presetId: transition.presetId,
			engine: transition.engine,
			packageHash: transition.packageHash,
			type: transition.type as ClipTransition["type"],
			duration: transition.duration,
			direction: transition.direction,
			easing: transition.easing,
			tuning: transition.tuning as ClipTransition["tuning"],
			maskShape: transition.maskShape as ClipTransition["maskShape"],
		});
		if (!transitionId) {
			const mediaItems = useMediaStore.getState().mediaItems;
			throw new Error(
				`Transition could not be added: ${describeTransitionRefusal({
					track: store.tracks.find((item) => item.id === request.trackId),
					fromElementId: transition.fromElementId,
					toElementId: transition.toElementId,
					type: transition.type,
					videoMediaIds,
					mediaTypeOf: (mediaId) =>
						mediaItems.find((item) => item.id === mediaId)?.type,
				})}`
			);
		}
		return {
			success: true,
			trackId: request.trackId,
			transitionId,
			tracks: summarizeTracks(),
		};
	}

	const track = store.tracks[currentIndex];
	if (track.elements.length > 0 && !request.force) {
		throw new Error(
			`Track ${request.trackId} contains ${track.elements.length} element(s); use --force to delete it`
		);
	}
	if (request.ripple) {
		store.removeTrackWithRipple(request.trackId);
	} else {
		store.removeTrack(request.trackId);
	}
	const tracks = summarizeTracks();
	if (tracks.some((candidate) => candidate.id === request.trackId)) {
		throw new Error(`Track delete verification failed: ${request.trackId}`);
	}
	return { success: true, trackId: request.trackId, tracks };
}

export function setupTrackHandlers({
	claudeAPI,
}: {
	claudeAPI: ClaudeTimelineBridgeAPI;
}): void {
	if (
		typeof claudeAPI.onTrackOperation !== "function" ||
		typeof claudeAPI.sendTrackOperationResponse !== "function"
	) {
		return;
	}

	claudeAPI.onTrackOperation((data) => {
		try {
			const request = data.request as ClaudeTrackOperationRequest;
			claudeAPI.sendTrackOperationResponse(
				data.requestId,
				applyTrackOperation(request)
			);
		} catch (error) {
			debugError("[ClaudeTimelineBridge] Track operation failed:", error);
			claudeAPI.sendTrackOperationResponse(data.requestId, {
				success: false,
				tracks: summarizeTracks(),
				error:
					error instanceof Error ? error.message : "Track operation failed",
			});
		}
	});
}
