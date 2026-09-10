import { create } from "zustand";
import { resolveMediaFile } from "@/lib/stabilization/media-file";
import { analyzeMotion } from "@/lib/stabilization/motion-analyzer";
import {
	IndexedDbMotionAnalysisStorage,
	type MotionAnalysisStorage,
	motionAnalysisKey,
} from "@/lib/stabilization/stabilization-analysis-storage";
import {
	type StabilizationPlan,
	buildStabilizationPlan,
} from "@/lib/stabilization/stabilization-plan";
import {
	type MotionAnalysis,
	STABILIZATION_ANALYSIS_VERSION,
} from "@/lib/stabilization/stabilization-protocol";
import { sha256Blob } from "@/lib/tracking/planar-tracking-analyzer";
import { stabilizationProfileForValue } from "@/lib/video/stabilization-levels";
import type { MediaItem } from "./media/media-store-types";

/**
 * Motion analyses for the in-house stabilizer, keyed by media item id.
 *
 * An analysis depends only on the source bytes, so it is cached by content
 * hash in IndexedDB and shared by every clip that uses the same media. Plans
 * (analysis × level) are cheap and memoised here so preview and export read
 * the same per-frame transforms.
 */

export type StabilizationStatus =
	| "idle"
	| "hashing"
	| "analyzing"
	| "ready"
	| "error";

export interface StabilizationEntry {
	status: StabilizationStatus;
	progress: number;
	analysis: MotionAnalysis | null;
	error: string | null;
}

type AnalyzableMediaItem = Pick<MediaItem, "id" | "file" | "url" | "name">;

interface StabilizationState {
	entries: Record<string, StabilizationEntry>;
	/** Resolves the analysis, running or reusing an in-flight one. */
	ensureAnalysis: ({
		mediaItem,
	}: {
		mediaItem: AnalyzableMediaItem;
	}) => Promise<MotionAnalysis>;
	/** Per-frame plan for a stored 0–100 value; null while the analysis is missing. */
	getPlan: ({
		mediaId,
		stabilization,
	}: {
		mediaId: string;
		stabilization: number;
	}) => StabilizationPlan | null;
	forget: ({ mediaId }: { mediaId: string }) => void;
}

const IDLE_ENTRY: StabilizationEntry = {
	status: "idle",
	progress: 0,
	analysis: null,
	error: null,
};

const inFlight = new Map<string, Promise<MotionAnalysis>>();
const planCache = new Map<
	string,
	{ analysis: MotionAnalysis; stabilization: number; plan: StabilizationPlan }
>();
let storage: MotionAnalysisStorage = new IndexedDbMotionAnalysisStorage();

/** Test seam: replaces the content-hash cache. */
export function setMotionAnalysisStorage({
	next,
}: {
	next: MotionAnalysisStorage;
}): void {
	storage = next;
}

export const useStabilizationStore = create<StabilizationState>((set, get) => {
	const patch = ({
		mediaId,
		entry,
	}: {
		mediaId: string;
		entry: Partial<StabilizationEntry>;
	}) =>
		set((state) => ({
			entries: {
				...state.entries,
				[mediaId]: { ...(state.entries[mediaId] ?? IDLE_ENTRY), ...entry },
			},
		}));

	return {
		entries: {},
		ensureAnalysis: ({ mediaItem }) => {
			const existing = get().entries[mediaItem.id]?.analysis;
			if (existing) return Promise.resolve(existing);
			const pending = inFlight.get(mediaItem.id);
			if (pending) return pending;
			const task = (async () => {
				patch({
					mediaId: mediaItem.id,
					entry: { status: "hashing", progress: 0, error: null },
				});
				const file = await resolveMediaFile({ mediaItem });
				const contentSha256 = await sha256Blob({
					blob: file,
					onProgress: (progress) =>
						patch({
							mediaId: mediaItem.id,
							entry: { status: "hashing", progress: progress * 0.08 },
						}),
				});
				const key = motionAnalysisKey({
					version: STABILIZATION_ANALYSIS_VERSION,
					contentSha256,
				});
				let analysis = await storage.get({ key });
				if (!analysis) {
					analysis = await analyzeMotion({
						file,
						contentSha256,
						onProgress: ({ progress }) =>
							patch({
								mediaId: mediaItem.id,
								entry: { status: "analyzing", progress },
							}),
					});
					await storage.put({ key, analysis });
				}
				patch({
					mediaId: mediaItem.id,
					entry: { status: "ready", progress: 1, analysis, error: null },
				});
				return analysis;
			})();
			inFlight.set(mediaItem.id, task);
			task
				.catch((cause: unknown) => {
					patch({
						mediaId: mediaItem.id,
						entry: {
							status: "error",
							error: cause instanceof Error ? cause.message : String(cause),
						},
					});
				})
				.finally(() => {
					if (inFlight.get(mediaItem.id) === task)
						inFlight.delete(mediaItem.id);
				});
			return task;
		},
		getPlan: ({ mediaId, stabilization }) => {
			const analysis = get().entries[mediaId]?.analysis;
			const profile = stabilizationProfileForValue(stabilization);
			if (!analysis || !profile) return null;
			const cached = planCache.get(mediaId);
			if (
				cached &&
				cached.analysis === analysis &&
				cached.stabilization === stabilization
			) {
				return cached.plan;
			}
			const plan = buildStabilizationPlan({ analysis, profile });
			planCache.set(mediaId, { analysis, stabilization, plan });
			return plan;
		},
		forget: ({ mediaId }) => {
			planCache.delete(mediaId);
			set((state) => {
				const { [mediaId]: _removed, ...entries } = state.entries;
				return { entries };
			});
		},
	};
});

/** True when a media element asks for stabilization the in-house path renders. */
export function stabilizationRequested({
	stabilization,
}: {
	stabilization: number | undefined;
}): boolean {
	return (stabilization ?? 0) > 0;
}
