import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasCompositionPreviewPlan } from "@/lib/preview/canvas-composition-frame";
import {
	prepareCanvasPlaybackFrames,
	type CanvasPlaybackPreparationMetrics,
} from "@/lib/preview/canvas-composition-playback-preparation";
export type { CanvasPlaybackPreparationMetrics } from "@/lib/preview/canvas-composition-playback-preparation";
import {
	createCanvasPlaybackCache,
	type CanvasPlaybackCache,
} from "@/lib/preview/canvas-composition-playback-cache";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import { useEffectsStore } from "@/stores/ai/effects-store";
import { useStickersOverlayStore } from "@/stores/stickers-overlay-store";
import { useScreenRecordingEnhancementStore } from "@/stores/screen-recording-store";
import { useWebcamOverlayStore } from "@/stores/webcam-overlay-store";
import { useFigureAnnotationsStore } from "@/stores/figure-annotations-store";

export interface CanvasPlaybackSession {
	cache: CanvasPlaybackCache;
	plan: CanvasCompositionPreviewPlan;
	frames: number;
	generation: string;
}

interface PreparationRequest {
	plan: CanvasCompositionPreviewPlan;
	frames: number;
	backgroundColor?: string;
	revision: number;
}

interface PreparationResult {
	request: PreparationRequest;
	status: "preparing" | "ready" | "error";
	completed: number;
	generation: string;
	session?: CanvasPlaybackSession;
	error?: string;
	warning?: string;
	metrics?: CanvasPlaybackPreparationMetrics;
}

async function disposePlaybackCache({
	cache,
}: {
	cache?: CanvasPlaybackCache;
}) {
	try {
		await cache?.dispose();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn("[effect-playback] Cache cleanup failed:", error);
		return message;
	}
}

function playbackCacheWarning({
	cache,
	cleanupWarning,
}: {
	cache?: CanvasPlaybackCache;
	cleanupWarning?: string;
}) {
	const warnings = [...(cache?.cleanupWarnings ?? [])];
	if (cleanupWarning) warnings.push(cleanupWarning);
	return warnings.length ? warnings.join("; ") : undefined;
}

function subscribeRenderChanges<State>({
	subscribe,
	keys,
	invalidate,
}: {
	subscribe: (listener: (state: State, previous: State) => void) => () => void;
	keys: ReadonlyArray<keyof State>;
	invalidate: () => void;
}) {
	return subscribe((state, previous) => {
		if (keys.some((key) => state[key] !== previous[key])) invalidate();
	});
}

export function useCanvasPlaybackPreview({
	enabled,
	plan,
	projectId,
	totalDuration,
	backgroundColor,
	suspended = false,
}: {
	enabled: boolean;
	plan: CanvasCompositionPreviewPlan | null;
	projectId?: string;
	totalDuration: number;
	backgroundColor?: string;
	suspended?: boolean;
}) {
	const [revision, setRevision] = useState(0);
	const request = useMemo<PreparationRequest | null>(() => {
		if (!enabled || !plan || !projectId || !Number.isFinite(totalDuration))
			return null;
		const frames = Math.ceil(totalDuration * plan.fps - 1e-6);
		if (frames < 1) return null;
		return { plan, frames, backgroundColor, revision };
	}, [enabled, plan, projectId, totalDuration, backgroundColor, revision]);
	const latestRequest = useRef(request);
	latestRequest.current = request;
	const controllerRef = useRef<AbortController | null>(null);
	const tail = useRef<Promise<void>>(Promise.resolve());
	const cacheRef = useRef<CanvasPlaybackCache | null>(null);
	const [result, setResult] = useState<PreparationResult | null>(null);
	const cancel = useCallback(() => {
		if (controllerRef.current && usePlaybackStore.getState().isPlaying)
			usePlaybackStore.getState().pause();
		controllerRef.current?.abort();
		controllerRef.current = null;
		setResult(null);
		const cache = cacheRef.current;
		cacheRef.current = null;
		if (cache) void disposePlaybackCache({ cache });
	}, []);
	useEffect(() => {
		// These stores are consulted by the export compositor outside its track snapshot.
		const invalidate = () => {
			controllerRef.current?.abort();
			setRevision((value) => value + 1);
		};
		// Store edit actions replace these maps/configs, including nested effect edits.
		const unsubscribe = [
			subscribeRenderChanges({
				subscribe: useEffectsStore.subscribe,
				keys: ["activeEffects", "effectChains"],
				invalidate,
			}),
			subscribeRenderChanges({
				subscribe: useStickersOverlayStore.subscribe,
				keys: ["overlayStickers"],
				invalidate,
			}),
			subscribeRenderChanges({
				subscribe: useScreenRecordingEnhancementStore.subscribe,
				keys: [
					"background",
					"cursorConfig",
					"cursorTelemetry",
					"showCursorOverlay",
					"zoomRegions",
					"speedRegions",
					"cursorLoopMode",
					"zoomMotionBlur",
				],
				invalidate,
			}),
			subscribeRenderChanges({
				subscribe: useWebcamOverlayStore.subscribe,
				keys: ["config"],
				invalidate,
			}),
			subscribeRenderChanges({
				subscribe: useFigureAnnotationsStore.subscribe,
				keys: ["annotations"],
				invalidate,
			}),
		];
		return () => {
			for (const stop of unsubscribe) stop();
		};
	}, []);
	useEffect(() => {
		if (!request) return;
		return () => {
			if (controllerRef.current && usePlaybackStore.getState().isPlaying)
				usePlaybackStore.getState().pause();
			controllerRef.current?.abort();
			controllerRef.current = null;
			const cache = cacheRef.current;
			cacheRef.current = null;
			if (cache) void disposePlaybackCache({ cache });
		};
	}, [request]);
	const prepare = useCallback(() => {
		if (!request) return;
		cancel();
		usePlaybackStore.getState().pause();
		const controller = new AbortController();
		controllerRef.current = controller;
		const generation = crypto.randomUUID();
		const update = (
			state: Omit<PreparationResult, "request" | "generation">
		) => {
			if (controller.signal.aborted || latestRequest.current !== request)
				return;
			setResult({ request, generation, ...state });
		};
		update({ status: "preparing", completed: 0 });
		tail.current = tail.current
			.catch(() => {})
			.then(async () => {
				const started = performance.now();
				let cache: CanvasPlaybackCache | undefined;
				try {
					controller.signal.throwIfAborted();
					cache = await createCanvasPlaybackCache();
					controller.signal.throwIfAborted();
					cacheRef.current = cache;
					const metrics = await prepareCanvasPlaybackFrames({
						plan: request.plan,
						backgroundColor: request.backgroundColor,
						frames: request.frames,
						cache,
						signal: controller.signal,
						onProgress: ({ completed, metrics }) => {
							update({
								status: "preparing",
								completed,
								metrics: {
									...metrics,
									wallMs: performance.now() - started,
								},
								warning: playbackCacheWarning({ cache }),
							});
						},
					});
					controller.signal.throwIfAborted();
					update({
						status: "ready",
						completed: request.frames,
						metrics: { ...metrics, wallMs: performance.now() - started },
						warning: playbackCacheWarning({ cache }),
						session: {
							cache,
							plan: request.plan,
							frames: request.frames,
							generation,
						},
					});
				} catch (error) {
					if (cacheRef.current === cache) cacheRef.current = null;
					const cleanupWarning = await disposePlaybackCache({ cache });
					update({
						status: "error",
						completed: 0,
						error: error instanceof Error ? error.message : String(error),
						warning: playbackCacheWarning({ cache, cleanupWarning }),
					});
				}
			});
	}, [request, cancel]);
	const current = result?.request === request ? result : null;
	useEffect(() => {
		if (suspended && current?.status === "preparing") cancel();
	}, [suspended, current?.status, cancel]);
	useEffect(() => {
		if (current?.status !== "preparing") return;
		const stopUnpreparedPlayback = () => {
			queueMicrotask(() => {
				if (
					latestRequest.current === request &&
					controllerRef.current &&
					usePlaybackStore.getState().isPlaying
				)
					usePlaybackStore.getState().pause();
			});
		};
		window.addEventListener("playback-play", stopUnpreparedPlayback);
		return () =>
			window.removeEventListener("playback-play", stopUnpreparedPlayback);
	}, [current?.status, request]);
	return {
		available: Boolean(request),
		status: current?.status ?? ("idle" as const),
		completed: current?.completed ?? 0,
		total: request?.frames ?? 0,
		generation: current?.generation ?? "",
		session: current?.session,
		error: current?.error,
		warning: current?.warning,
		metrics: current?.metrics,
		prepare: suspended ? () => {} : prepare,
		cancel,
	};
}
