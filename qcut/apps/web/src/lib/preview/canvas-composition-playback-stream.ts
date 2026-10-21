import type { CanvasCompositionPreviewPlan } from "./canvas-composition-frame";
import type { CanvasPlaybackCache } from "./canvas-composition-playback-cache";
import {
	prepareCanvasPlaybackFrames,
	type CanvasPlaybackPreparationMetrics,
} from "./canvas-composition-playback-preparation";
import { createCanvasPlaybackWindow } from "./canvas-playback-window";

export interface CanvasPlaybackStreamStats {
	segmentFrames: number;
	targetFrame: number;
	windowStart: number;
	windowEnd: number;
	cacheBytes: number;
	cacheBudgetBytes: number;
	residentFrames: number;
	preparedTotal: number;
	evictedTotal: number;
	preparingSegment?: number;
	targetReady: boolean;
}

export type CanvasPlaybackStream = ReturnType<
	typeof createCanvasPlaybackStream
>;

export function createCanvasPlaybackStream({
	plan,
	frames,
	cache,
	signal,
	onChange,
	backgroundColor,
}: {
	plan: CanvasCompositionPreviewPlan;
	frames: number;
	cache: CanvasPlaybackCache;
	signal: AbortSignal;
	onChange: () => void;
	backgroundColor?: string;
}) {
	const window = createCanvasPlaybackWindow({
		...plan,
		frames,
		maxBytes: cache.maxBytes,
	});
	const resident = new Set<number>();
	const completed = new Set<number>();
	const listeners = new Set<() => void>();
	const lifetime = new AbortController();
	const workSignal = AbortSignal.any([signal, lifetime.signal]);
	const started = performance.now();
	let target = 0;
	let startedPreparing = false;
	let suspended = false;
	let running: Promise<void> | undefined;
	let active: { index: number; controller: AbortController } | undefined;
	let failure: Error | undefined;
	let preparedTotal = 0;
	let evictedTotal = 0;
	let metrics: CanvasPlaybackPreparationMetrics = {
		renderMs: 0,
		encodeMs: 0,
		writeMs: 0,
		wallMs: 0,
		maxInFlightFrames: 0,
		maxReservedPixelBytes: 0,
		maxPendingPngBytes: 0,
	};
	const notify = () => {
		onChange();
		for (const listener of listeners) listener();
	};
	const isComplete = ({ index }: { index: number }) => completed.has(index);
	const nextSegment = () =>
		window
			.at({ frame: target })
			.segments.find((index) => !isComplete({ index }));
	const needsTrim = () => {
		const keep = window.at({ frame: target });
		return [...resident].some(
			(frame) => frame < keep.start || frame >= keep.end
		);
	};
	const assertActive = () => {
		workSignal.throwIfAborted();
		if (failure) throw failure;
	};
	function reconcileRemoval({ removed }: { removed: number[] }) {
		for (const frame of removed) {
			if (cache.has({ frame })) continue;
			resident.delete(frame);
			completed.delete(window.segment({ frame }));
			evictedTotal++;
		}
	}
	async function trimWindow({ signal }: { signal: AbortSignal }) {
		const keep = window.at({ frame: target });
		const removed = [...resident].filter(
			(frame) => frame < keep.start || frame >= keep.end
		);
		if (!removed.length) return;
		try {
			await cache.remove({ frames: removed, signal });
		} finally {
			reconcileRemoval({ removed });
			notify();
		}
	}
	function accumulate({
		baseline,
		current,
	}: {
		baseline: CanvasPlaybackPreparationMetrics;
		current: CanvasPlaybackPreparationMetrics;
	}) {
		metrics = {
			renderMs: baseline.renderMs + current.renderMs,
			encodeMs: baseline.encodeMs + current.encodeMs,
			writeMs: baseline.writeMs + current.writeMs,
			wallMs: performance.now() - started,
			maxInFlightFrames: Math.max(
				baseline.maxInFlightFrames,
				current.maxInFlightFrames
			),
			maxReservedPixelBytes: Math.max(
				baseline.maxReservedPixelBytes,
				current.maxReservedPixelBytes
			),
			maxPendingPngBytes: Math.max(
				baseline.maxPendingPngBytes,
				current.maxPendingPngBytes
			),
		};
	}
	async function prepareSegment({
		index,
		controller,
	}: {
		index: number;
		controller: AbortController;
	}) {
		const segmentSignal = AbortSignal.any([workSignal, controller.signal]);
		await trimWindow({ signal: segmentSignal });
		segmentSignal.throwIfAborted();
		const range = window.range({ index });
		let startFrame = range.start;
		while (startFrame < range.end && cache.has({ frame: startFrame }))
			startFrame++;
		if (startFrame < range.end) {
			const baseline = { ...metrics };
			await prepareCanvasPlaybackFrames({
				plan,
				backgroundColor,
				startFrame,
				frames: range.end - startFrame,
				signal: segmentSignal,
				cache: {
					write: async (request) => {
						request.signal.throwIfAborted();
						// A cancelled eviction can leave a suffix of this same generation.
						if (cache.has({ frame: request.frame })) return;
						await cache.write(request);
						resident.add(request.frame);
						preparedTotal++;
						notify();
					},
				},
				onProgress: ({ metrics: current }) => {
					accumulate({ baseline, current });
					notify();
				},
			});
		}
		segmentSignal.throwIfAborted();
		completed.add(index);
	}
	function pump() {
		if (
			running ||
			!startedPreparing ||
			suspended ||
			failure ||
			workSignal.aborted
		)
			return;
		const index = nextSegment();
		if (index === undefined && !needsTrim()) return;
		// Trim even when a seek lands in an already prepared segment.
		const controller = new AbortController();
		active = index === undefined ? undefined : { index, controller };
		running = (
			index === undefined
				? trimWindow({ signal: workSignal })
				: prepareSegment({ index, controller })
		)
			.catch((error: unknown) => {
				if (!controller.signal.aborted && !workSignal.aborted)
					failure = error instanceof Error ? error : new Error(String(error));
			})
			.finally(() => {
				active = undefined;
				running = undefined;
				notify();
				if (nextSegment() !== undefined || needsTrim()) pump();
			});
		notify();
	}
	function waitFor({
		ready,
		signal,
	}: {
		ready: () => boolean;
		signal: AbortSignal;
	}) {
		return new Promise<void>((resolve, reject) => {
			const finish = ({ error }: { error?: unknown } = {}) => {
				listeners.delete(check);
				signal.removeEventListener("abort", check);
				if (error) reject(error);
				else resolve();
			};
			const check = () => {
				try {
					signal.throwIfAborted();
					assertActive();
					if (ready()) finish();
				} catch (error) {
					finish({ error });
				}
			};
			listeners.add(check);
			signal.addEventListener("abort", check, { once: true });
			check();
		});
	}
	const onAbort = () => {
		active?.controller.abort();
		notify();
	};
	async function read({
		frame,
		signal,
	}: {
		frame: number;
		signal: AbortSignal;
	}): Promise<Blob> {
		if (!Number.isInteger(frame) || frame < 0 || frame >= frames)
			throw new Error("Invalid rolling playback read");
		await waitFor({ ready: () => cache.has({ frame }), signal });
		try {
			return await cache.read({ frame, signal });
		} catch (error) {
			signal.throwIfAborted();
			assertActive();
			if (cache.has({ frame })) throw error;
			// A queued removal may finish between the availability check and read.
			pump();
			return read({ frame, signal });
		}
	}
	workSignal.addEventListener("abort", onAbort, { once: true });
	return {
		setTarget({ frame }: { frame: number }) {
			assertActive();
			if (!Number.isInteger(frame) || frame < 0 || frame >= frames)
				throw new Error("Invalid rolling playback target");
			const changedSegment =
				window.segment({ frame }) !== window.segment({ frame: target });
			const firstTarget = !startedPreparing;
			target = frame;
			startedPreparing = true;
			const priority = window.segment({ frame: target });
			const wantedSegments = window.at({ frame: target }).segments;
			if (
				changedSegment &&
				active &&
				(!wantedSegments.includes(active.index) ||
					(active.index !== priority && !isComplete({ index: priority })))
			)
				active.controller.abort();
			if (changedSegment || firstTarget) {
				pump();
				notify();
			}
		},
		waitForTarget() {
			return waitFor({
				ready: () => isComplete({ index: window.segment({ frame: target }) }),
				signal: workSignal,
			});
		},
		read,
		setSuspended({ value }: { value: boolean }) {
			suspended = value;
			if (value) active?.controller.abort();
			else pump();
		},
		get stats(): CanvasPlaybackStreamStats {
			const range = window.at({ frame: target });
			return {
				segmentFrames: window.segmentFrames,
				targetFrame: target,
				windowStart: range.start,
				windowEnd: range.end,
				cacheBytes: cache.bytes,
				cacheBudgetBytes: cache.maxBytes,
				residentFrames: cache.frameCount,
				preparedTotal,
				evictedTotal,
				preparingSegment: active?.index,
				targetReady: isComplete({ index: window.segment({ frame: target }) }),
			};
		},
		get metrics() {
			return metrics;
		},
		get error() {
			return failure;
		},
		get aborted() {
			return workSignal.aborted;
		},
		async dispose() {
			lifetime.abort();
			await running;
			workSignal.removeEventListener("abort", onAbort);
			listeners.clear();
		},
	};
}
