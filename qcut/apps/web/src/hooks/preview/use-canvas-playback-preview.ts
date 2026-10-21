import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasCompositionPreviewPlan } from "@/lib/preview/canvas-composition-frame";
import type { CanvasPlaybackPreparationMetrics } from "@/lib/preview/canvas-composition-playback-preparation";
import {
	createCanvasPlaybackStream,
	type CanvasPlaybackStream,
	type CanvasPlaybackStreamStats,
} from "@/lib/preview/canvas-composition-playback-stream";
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
	stream?: CanvasPlaybackStream;
}

interface PreparationRequest {
	projectId: string;
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
	window?: CanvasPlaybackStreamStats;
}

const cacheCleanup = new WeakMap<
	CanvasPlaybackCache,
	Promise<string | undefined>
>();

function disposePlaybackCache({ cache }: { cache?: CanvasPlaybackCache }) {
	if (!cache) return Promise.resolve(undefined);
	const existing = cacheCleanup.get(cache);
	if (existing) return existing;
	const operation = cache.dispose().then(
		() => undefined,
		(error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			console.warn("[effect-playback] Cache cleanup failed:", error);
			return message;
		}
	);
	cacheCleanup.set(cache, operation);
	return operation;
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
		return { projectId, plan, frames, backgroundColor, revision };
	}, [enabled, plan, projectId, totalDuration, backgroundColor, revision]);
	const latestRequest = useRef(request);
	latestRequest.current = request;
	const controllerRef = useRef<AbortController | null>(null);
	const tail = useRef<Promise<void>>(Promise.resolve());
	const cacheRef = useRef<CanvasPlaybackCache | null>(null);
	const streamRef = useRef<CanvasPlaybackStream | null>(null);
	const activeProject = useRef<string | null>(null);
	const targetRef = useRef<{
		request: PreparationRequest;
		time: number;
	} | null>(null);
	const [result, setResult] = useState<PreparationResult | null>(null);
	const stop = useCallback(() => {
		if (controllerRef.current && usePlaybackStore.getState().isPlaying)
			usePlaybackStore.getState().pause();
		controllerRef.current?.abort();
		controllerRef.current = null;
		const cache = cacheRef.current;
		const stream = streamRef.current;
		cacheRef.current = null;
		streamRef.current = null;
		tail.current = tail.current
			.catch(() => {})
			.then(async () => {
				await stream?.dispose();
				await disposePlaybackCache({ cache: cache ?? undefined });
			});
	}, []);
	const cancel = useCallback(() => {
		activeProject.current = null;
		stop();
		setResult(null);
	}, [stop]);
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
		return stop;
	}, [request, stop]);
	const beginPreparation = useCallback(
		({ preserveSeek }: { preserveSeek: boolean }) => {
			if (!request || suspended) return;
			if (!preserveSeek || targetRef.current?.request !== request) {
				const playback = usePlaybackStore.getState();
				targetRef.current = {
					request,
					time: playback.previewScrubTime ?? playback.currentTime,
				};
			}
			stop();
			activeProject.current = request.projectId;
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
					let cache: CanvasPlaybackCache | undefined;
					let stream: CanvasPlaybackStream | undefined;
					let session: CanvasPlaybackSession | undefined;
					const publish = () => {
						if (!stream || controller.signal.aborted) return;
						if (stream.error) {
							if (!session) return;
							update({
								status: "error",
								completed: 0,
								error: stream.error.message,
							});
							activeProject.current = null;
							controller.abort();
							void stream.dispose().then(() => disposePlaybackCache({ cache }));
							return;
						}
						update({
							status: session ? "ready" : "preparing",
							completed: stream.stats.residentFrames,
							session,
							metrics: stream.metrics,
							window: stream.stats,
							warning: playbackCacheWarning({ cache }),
						});
					};
					try {
						controller.signal.throwIfAborted();
						cache = await createCanvasPlaybackCache();
						controller.signal.throwIfAborted();
						cacheRef.current = cache;
						stream = createCanvasPlaybackStream({
							plan: request.plan,
							backgroundColor: request.backgroundColor,
							frames: request.frames,
							cache,
							signal: controller.signal,
							onChange: publish,
						});
						streamRef.current = stream;
						const currentTime =
							targetRef.current?.request === request
								? targetRef.current.time
								: usePlaybackStore.getState().currentTime;
						stream.setTarget({
							frame: Math.max(
								0,
								Math.min(
									request.frames - 1,
									Math.round(currentTime * request.plan.fps)
								)
							),
						});
						await stream.waitForTarget();
						controller.signal.throwIfAborted();
						session = {
							cache,
							stream,
							plan: request.plan,
							frames: request.frames,
							generation,
						};
						publish();
					} catch (error) {
						if (!controller.signal.aborted && latestRequest.current === request)
							activeProject.current = null;
						if (cacheRef.current === cache) cacheRef.current = null;
						if (streamRef.current === stream) streamRef.current = null;
						await stream?.dispose();
						const cleanupWarning = await disposePlaybackCache({ cache });
						update({
							status: "error",
							completed: 0,
							error: error instanceof Error ? error.message : String(error),
							warning: playbackCacheWarning({ cache, cleanupWarning }),
						});
					}
				});
		},
		[request, suspended, stop]
	);
	const prepare = useCallback(
		() => beginPreparation({ preserveSeek: false }),
		[beginPreparation]
	);
	useEffect(() => {
		if (!request || activeProject.current !== request.projectId) {
			activeProject.current = null;
			return;
		}
		if (suspended || controllerRef.current) return;
		const timer = window.setTimeout(() => {
			if (
				activeProject.current === request.projectId &&
				latestRequest.current === request &&
				!controllerRef.current
			)
				beginPreparation({ preserveSeek: true });
		}, 150);
		return () => window.clearTimeout(timer);
	}, [request, suspended, beginPreparation]);
	useEffect(() => {
		const updateTarget = (event: Event) => {
			const current = latestRequest.current;
			const stream = streamRef.current;
			if (!current) return;
			const seekTime = (event as CustomEvent<{ time?: number }>).detail?.time;
			const time =
				typeof seekTime === "number" && Number.isFinite(seekTime)
					? seekTime
					: usePlaybackStore.getState().currentTime;
			targetRef.current = { request: current, time };
			if (!stream || stream.error || controllerRef.current?.signal.aborted)
				return;
			stream.setTarget({
				frame: Math.max(
					0,
					Math.min(current.frames - 1, Math.round(time * current.plan.fps))
				),
			});
		};
		window.addEventListener("playback-seek", updateTarget);
		return () => window.removeEventListener("playback-seek", updateTarget);
	}, []);
	const current = result?.request === request ? result : null;
	const status =
		current?.status ??
		(request && activeProject.current === request.projectId && !suspended
			? ("preparing" as const)
			: ("idle" as const));
	useEffect(() => {
		if (
			suspended &&
			(current?.status === "preparing" ||
				(!current && activeProject.current === request?.projectId))
		)
			cancel();
		else streamRef.current?.setSuspended({ value: suspended });
	}, [suspended, current, request?.projectId, cancel]);
	useEffect(() => {
		if (status !== "preparing") return;
		const stopUnpreparedPlayback = () => {
			queueMicrotask(() => {
				if (
					latestRequest.current === request &&
					activeProject.current === request?.projectId &&
					usePlaybackStore.getState().isPlaying
				)
					usePlaybackStore.getState().pause();
			});
		};
		window.addEventListener("playback-play", stopUnpreparedPlayback);
		return () =>
			window.removeEventListener("playback-play", stopUnpreparedPlayback);
	}, [status, request]);
	return {
		available: Boolean(request),
		status,
		completed: current?.completed ?? 0,
		total: request?.frames ?? 0,
		generation: current?.generation ?? "",
		session: current?.session,
		error: current?.error,
		warning: current?.warning,
		metrics: current?.metrics,
		window: current?.window,
		prepare: suspended ? () => {} : prepare,
		cancel,
	};
}
