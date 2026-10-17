import { platform } from "@qcut/platform-core";
import { ipcErrorMessage } from "@/lib/claude-bridge/ipc-error-message";
import {
	applyTimelineSceneSplits,
	planSceneTimelineSplits,
	type TimelineSceneBoundary,
	type TimelineShotCut,
	type TimelineShotSkip,
} from "@/components/editor/timeline/timeline-smart-split";
import { useMediaStore } from "@/stores/media/media-store";
import { useProjectStore } from "@/stores/project-store";
import { useSceneStore } from "@/stores/timeline/scene-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { MediaElement } from "@/types/timeline";

/**
 * Splitting one clip by its shots, the way the timeline's "smart shot split"
 * menu does it: detect boundaries (or take given cuts), check the clip is
 * still what it was, turn source times into frame-snapped timeline times, and
 * cut as one undo step. The context menu and the editor API both call this,
 * so a CLI run and a right-click produce the same cuts.
 */

export type ShotSplitEngine = "jianying" | "onnx" | "ffmpeg";
export type ShotSplitEngineChoice = "auto" | ShotSplitEngine;

export interface SmartShotSplitResult {
	projectId: string;
	trackId: string;
	elementId: string;
	elementName: string;
	/** The engine asked for, or "manual" when the cut points were given. */
	requestedEngine: ShotSplitEngineChoice | "manual";
	/** The engine that found the boundaries, or "manual" for given cuts. */
	engine?: ShotSplitEngine | "manual";
	route?: string;
	/** Engines `auto` passed over, with the reason each was unavailable. */
	fallbacks?: Array<{ engine: ShotSplitEngine; reason: string }>;
	dryRun: boolean;
	/** The cuts made (or, on a dry run, the cuts that would be made). */
	cuts: TimelineShotCut[];
	/** Boundaries that did not become cuts, each with its reason. */
	skipped: TimelineShotSkip[];
	/** Why there is nothing to cut, when `cuts` and `skipped` are both empty. */
	message?: string;
	/** Options the engine that ran could not honour, e.g. a threshold for a model engine. */
	warnings?: string[];
	createdElementIds: string[];
	/** The clip ids left on the track in time order: the source, then the new ones. */
	elementIds: string[];
}

export type AnalyzeScenesForShotSplit = (
	projectId: string,
	options: {
		mediaId: string;
		engine?: ShotSplitEngineChoice;
		threshold?: number;
		aiAnalysis?: boolean;
	}
) => Promise<{
	engine: ShotSplitEngine;
	route?: string;
	fallbacks?: Array<{ engine: ShotSplitEngine; reason: string }>;
	warnings?: string[];
	scenes: TimelineSceneBoundary[];
}>;

export class ShotSplitCancelledError extends Error {
	constructor() {
		super("Shot split cancelled");
		this.name = "ShotSplitCancelledError";
	}
}

export interface ShotSplitSource {
	sourceElement: MediaElement;
	mediaId: string;
	fps: number;
	/** The project, scene and media are still the ones captured. */
	contextMatches: () => boolean;
	/** `contextMatches` and the clip itself is unchanged since capture. */
	isCurrent: () => boolean;
	dispose: () => void;
}

/**
 * Checks that the clip is an unlocked video clip of the active project and
 * takes a snapshot of it; the handle reports when anything the split relies
 * on changes underneath it (a move, a relink, a project switch), even if
 * that change is later undone.
 */
export function captureShotSplitSource({
	projectId,
	trackId,
	elementId,
}: {
	projectId: string;
	trackId: string;
	elementId: string;
}): ShotSplitSource {
	const project = useProjectStore.getState().activeProject;
	const sourceTrack = useTimelineStore
		.getState()
		._tracks.find((item) => item.id === trackId);
	const element = sourceTrack?.elements.find((item) => item.id === elementId);
	const media =
		element?.type === "media"
			? useMediaStore
					.getState()
					.mediaItems.find((item) => item.id === element.mediaId)
			: undefined;
	if (
		!project ||
		project.id !== projectId ||
		useProjectStore.getState().isLoading ||
		!element ||
		element.type !== "media" ||
		sourceTrack?.locked ||
		media?.type !== "video"
	) {
		throw new Error(
			"Shot splitting needs an unlocked video clip in the active project"
		);
	}
	const sourceElement = structuredClone(element);
	const elementSnapshot = JSON.stringify(sourceElement);
	const sceneId = useSceneStore.getState().currentScene?.id;
	const sourceFile = media.file;
	const sourceIdentity = JSON.stringify([
		media.localPath,
		media.url,
		media.originalUrl,
		media.importMetadata,
	]);
	const contextMatches = () => {
		const current = useProjectStore.getState();
		const currentMedia = useMediaStore
			.getState()
			.mediaItems.find((item) => item.id === media.id);
		return (
			!current.isLoading &&
			current.activeProject?.id === projectId &&
			current.activeProject.currentSceneId === project.currentSceneId &&
			current.activeProject.fps === project.fps &&
			useSceneStore.getState().currentScene?.id === sceneId &&
			currentMedia?.type === "video" &&
			currentMedia.file === sourceFile &&
			JSON.stringify([
				currentMedia.localPath,
				currentMedia.url,
				currentMedia.originalUrl,
				currentMedia.importMetadata,
			]) === sourceIdentity
		);
	};
	const sourceMatches = () => {
		const currentTrack = useTimelineStore
			.getState()
			._tracks.find((item) => item.id === trackId);
		return (
			contextMatches() &&
			!currentTrack?.locked &&
			JSON.stringify(
				currentTrack?.elements.find((item) => item.id === elementId)
			) === elementSnapshot
		);
	};
	let stale = false;
	const observe = () => {
		stale ||= !sourceMatches();
	};
	// Latch invalidation even when a move, relink, or project switch is later undone.
	const subscriptions = [
		useTimelineStore.subscribe(observe),
		useProjectStore.subscribe(observe),
		useSceneStore.subscribe(observe),
		useMediaStore.subscribe(observe),
	];
	return {
		sourceElement,
		mediaId: media.id,
		fps: project.fps ?? 30,
		contextMatches,
		isCurrent: () => !stale && sourceMatches(),
		dispose: () => {
			for (const unsubscribe of subscriptions) unsubscribe();
		},
	};
}

export async function runSmartShotSplit({
	projectId,
	trackId,
	elementId,
	engine = "auto",
	cuts,
	threshold,
	minShotSeconds = 0,
	dryRun = false,
	history = "push",
	source: givenSource,
	analyzeScenes = platform().claude?.analyze.scenes,
	isCanceled,
}: {
	projectId: string;
	trackId: string;
	elementId: string;
	engine?: ShotSplitEngineChoice;
	/** Cut points in source seconds; given, nothing is detected. */
	cuts?: number[];
	/** FFmpeg scene threshold; only that engine reads it. */
	threshold?: number;
	minShotSeconds?: number;
	dryRun?: boolean;
	/** "none" when the caller already pushed one undo step for several clips. */
	history?: "push" | "none";
	/** A capture the caller made (and owns) before starting, e.g. to offer cancel. */
	source?: ShotSplitSource;
	analyzeScenes?: AnalyzeScenesForShotSplit;
	isCanceled?: () => boolean;
}): Promise<SmartShotSplitResult> {
	const source =
		givenSource ?? captureShotSplitSource({ projectId, trackId, elementId });
	try {
		let scenes: TimelineSceneBoundary[];
		let detection: Awaited<ReturnType<AnalyzeScenesForShotSplit>> | undefined;
		if (cuts) {
			// Given seconds land on the project's frame grid, like detected ones.
			scenes = cuts.map((timestamp) => ({
				timestamp: Math.round(timestamp * source.fps) / source.fps,
				confidence: 1,
			}));
		} else {
			if (!analyzeScenes) {
				throw new Error("智能镜头分割仅支持桌面版");
			}
			try {
				detection = await analyzeScenes(projectId, {
					mediaId: source.mediaId,
					engine,
					aiAnalysis: false,
					...(threshold !== undefined &&
					(engine === "ffmpeg" || engine === "auto")
						? { threshold }
						: {}),
				});
			} catch (error) {
				// Without Electron's "Error invoking remote method" wrapper.
				throw new Error(ipcErrorMessage(error));
			}
			if (isCanceled?.()) throw new ShotSplitCancelledError();
			if (engine !== "auto" && detection.engine !== engine) {
				throw new Error(
					"Scene detection returned a different engine; timeline unchanged"
				);
			}
			scenes = detection.scenes;
		}
		if (!source.isCurrent()) {
			throw new Error(
				"Clip, source media, or active project changed during detection; timeline unchanged"
			);
		}
		const plan = planSceneTimelineSplits({
			element: source.sourceElement,
			scenes,
			fps: source.fps,
			minShotSeconds,
		});
		let createdElementIds: string[] = [];
		let applied = plan.cuts;
		const skipped = [...plan.skipped];
		if (!dryRun) {
			const timeline = useTimelineStore.getState();
			const outcome = applyTimelineSceneSplits({
				trackId,
				elementId,
				splitTimes: plan.cuts.map((cut) => cut.timelineTime),
				pushHistory: history === "push" ? timeline.pushHistory : () => {},
				splitElement: timeline.splitElement,
			});
			createdElementIds = outcome.createdElementIds;
			const refused = new Set(outcome.skipped.map((skip) => skip.timelineTime));
			applied = plan.cuts.filter((cut) => !refused.has(cut.timelineTime));
			for (const skip of outcome.skipped) {
				const cut = plan.cuts.find(
					(item) => item.timelineTime === skip.timelineTime
				);
				skipped.push({ ...skip, sourceTime: cut?.sourceTime });
			}
		}
		const engineRan = cuts ? "manual" : detection?.engine;
		// A clip with no boundary at all is reported, not left as empty lists.
		const message =
			applied.length === 0 && skipped.length === 0
				? cuts
					? "no cut points given"
					: `${engineRan} found no shot boundary in the clip's source`
				: undefined;
		return {
			projectId,
			trackId,
			elementId,
			elementName: source.sourceElement.name,
			requestedEngine: cuts ? "manual" : engine,
			...(engineRan ? { engine: engineRan } : {}),
			...(detection?.route ? { route: detection.route } : {}),
			...(detection?.fallbacks?.length
				? { fallbacks: detection.fallbacks }
				: {}),
			...(detection?.warnings?.length ? { warnings: detection.warnings } : {}),
			dryRun,
			cuts: applied,
			skipped,
			...(message ? { message } : {}),
			createdElementIds,
			elementIds: [elementId, ...createdElementIds],
		};
	} finally {
		if (!givenSource) source.dispose();
	}
}

/** The video clips of a track in time order, for splitting a whole track. */
export function videoElementsOfTrack({
	trackId,
}: {
	trackId: string;
}): MediaElement[] {
	const track = useTimelineStore
		.getState()
		._tracks.find((item) => item.id === trackId);
	if (!track) return [];
	const mediaItems = useMediaStore.getState().mediaItems;
	return track.elements
		.filter(
			(element): element is MediaElement =>
				element.type === "media" &&
				mediaItems.find((item) => item.id === element.mediaId)?.type === "video"
		)
		.sort((left, right) => left.startTime - right.startTime);
}
