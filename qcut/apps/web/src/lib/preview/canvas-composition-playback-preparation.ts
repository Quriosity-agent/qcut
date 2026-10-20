import {
	createCanvasCompositionRenderer,
	type CanvasCompositionFrame,
	type CanvasCompositionPreviewPlan,
} from "./canvas-composition-frame";
import type { CanvasPlaybackCache } from "./canvas-composition-playback-cache";

export const CANVAS_PREPARATION_MAX_PIXEL_BYTES = 64 * 1024 * 1024;
const MAX_IN_FLIGHT_FRAMES = 2;

export interface CanvasPlaybackPreparationMetrics {
	// Stage totals overlap in a pipeline and can exceed wallMs.
	renderMs: number;
	encodeMs: number;
	writeMs: number;
	wallMs: number;
	maxInFlightFrames: number;
	// Shared output canvas plus one pixel reservation per admitted frame.
	maxReservedPixelBytes: number;
	// Encoded blobs are accounted separately from pixel reservations.
	maxPendingPngBytes: number;
}

type CaptureOutcome = { capture: CanvasCompositionFrame } | { error: unknown };

export async function prepareCanvasPlaybackFrames({
	plan,
	backgroundColor,
	frames,
	cache,
	signal,
	onProgress,
}: {
	plan: CanvasCompositionPreviewPlan;
	backgroundColor?: string;
	frames: number;
	cache: Pick<CanvasPlaybackCache, "write">;
	signal: AbortSignal;
	onProgress: (progress: {
		completed: number;
		metrics: CanvasPlaybackPreparationMetrics;
	}) => void;
}): Promise<CanvasPlaybackPreparationMetrics> {
	signal.throwIfAborted();
	const frameBytes = plan.width * plan.height * 4;
	const capacity = Math.min(
		MAX_IN_FLIGHT_FRAMES,
		Math.floor(CANVAS_PREPARATION_MAX_PIXEL_BYTES / frameBytes) - 1
	);
	if (
		!Number.isSafeInteger(frames) ||
		frames < 1 ||
		!Number.isSafeInteger(frameBytes) ||
		frameBytes < 1 ||
		capacity < 1
	)
		throw new Error("Invalid composition preparation dimensions or capacity");
	const work = new AbortController();
	const workSignal = AbortSignal.any([signal, work.signal]);
	const renderer = createCanvasCompositionRenderer({
		plan,
		backgroundColor,
		signal: workSignal,
		maxInFlightFrames: capacity,
	});
	const started = performance.now();
	const metrics: CanvasPlaybackPreparationMetrics = {
		renderMs: 0,
		encodeMs: 0,
		writeMs: 0,
		wallMs: 0,
		maxInFlightFrames: 0,
		maxReservedPixelBytes: frameBytes,
		maxPendingPngBytes: 0,
	};
	const pending = new Map<number, Promise<CaptureOutcome>>();
	let pendingPngBytes = 0;
	let next = 0;
	let failed = false;
	const stop = ({ error }: { error: unknown }) => {
		failed = true;
		work.abort(error);
	};
	const fill = () => {
		while (next < frames && pending.size < capacity && !workSignal.aborted) {
			const frame = next++;
			const capture = renderer.render({ frame }).then(
				(value): CaptureOutcome => {
					pendingPngBytes += value.blob.size;
					metrics.maxPendingPngBytes = Math.max(
						metrics.maxPendingPngBytes,
						pendingPngBytes
					);
					metrics.renderMs += value.timings.renderMs;
					metrics.encodeMs += value.timings.encodeMs;
					return { capture: value };
				},
				(error: unknown): CaptureOutcome => {
					stop({ error });
					return { error };
				}
			);
			pending.set(frame, capture);
			metrics.maxInFlightFrames = Math.max(
				metrics.maxInFlightFrames,
				pending.size
			);
			metrics.maxReservedPixelBytes = Math.max(
				metrics.maxReservedPixelBytes,
				frameBytes * (1 + pending.size)
			);
		}
	};
	try {
		fill();
		for (let frame = 0; frame < frames; frame++) {
			const outcome = await pending.get(frame);
			workSignal.throwIfAborted();
			if (!outcome) throw new Error("Missing prepared composition frame");
			if ("error" in outcome) throw outcome.error;
			const { capture } = outcome;
			const writeStarted = performance.now();
			await cache.write({ frame, blob: capture.blob, signal: workSignal });
			workSignal.throwIfAborted();
			metrics.writeMs += performance.now() - writeStarted;
			pendingPngBytes -= capture.blob.size;
			pending.delete(frame);
			metrics.wallMs = performance.now() - started;
			onProgress({ completed: frame + 1, metrics: { ...metrics } });
			fill();
		}
	} catch (error) {
		stop({ error });
	} finally {
		// Snapshots cannot be cancelled; drain them before releasing this generation.
		await Promise.all(pending.values());
		pending.clear();
		try {
			await renderer.dispose();
		} catch (error) {
			if (failed)
				console.warn("[effect-playback] Renderer cleanup failed:", error);
			else stop({ error });
		}
	}
	workSignal.throwIfAborted();
	return { ...metrics, wallMs: performance.now() - started };
}
