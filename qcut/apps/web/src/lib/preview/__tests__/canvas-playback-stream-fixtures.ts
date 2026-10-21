import { expect, vi } from "vitest";
import type { CanvasCompositionPreviewPlan } from "../canvas-composition-frame";
import type { CanvasPlaybackCache } from "../canvas-composition-playback-cache";
import {
	prepareCanvasPlaybackFrames,
	type CanvasPlaybackPreparationMetrics,
} from "../canvas-composition-playback-preparation";
import { createCanvasPlaybackStream } from "../canvas-composition-playback-stream";

type PreparationRequest = Parameters<typeof prepareCanvasPlaybackFrames>[0];

export function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<Value>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

export function streamFixture({
	frames = 20,
	maxBytes = 6 * 65_553,
}: {
	frames?: number;
	maxBytes?: number;
} = {}) {
	const plan: CanvasCompositionPreviewPlan = {
		tracks: [],
		mediaItems: [],
		renderIndex: {
			timelineStickerIds: new Set(),
			mediaItemsById: new Map(),
			clipTransitions: {
				canvasTracks: null,
				canvasTransitions: [],
				jianyingTransitions: [],
				unsupported: [],
			},
		},
		width: 2,
		height: 2,
		fps: 1,
	};
	const files = new Map<number, Blob>();
	const cacheBytes = () =>
		[...files.values()].reduce((sum, blob) => sum + blob.size, 0);
	let peakBytes = 0;
	const cache = {
		id: "test-generation",
		maxBytes,
		get bytes() {
			return cacheBytes();
		},
		get frameCount() {
			return files.size;
		},
		has: ({ frame }: { frame: number }) => files.has(frame),
		write: vi.fn(
			async ({
				frame,
				blob,
				signal,
			}: {
				frame: number;
				blob: Blob;
				signal: AbortSignal;
			}) => {
				signal.throwIfAborted();
				if (files.has(frame)) throw new Error("Frame already written");
				if (cacheBytes() + blob.size > maxBytes) throw new Error("Cache full");
				files.set(frame, blob);
				peakBytes = Math.max(peakBytes, cacheBytes());
			}
		),
		read: vi.fn(
			async ({ frame, signal }: { frame: number; signal: AbortSignal }) => {
				signal.throwIfAborted();
				const blob = files.get(frame);
				if (!blob) throw new Error("Frame not prepared");
				return blob;
			}
		),
		remove: vi.fn(
			async ({
				frames: removed,
				signal,
			}: {
				frames: readonly number[];
				signal: AbortSignal;
			}) => {
				signal.throwIfAborted();
				for (const frame of removed) files.delete(frame);
			}
		),
		dispose: vi.fn(async () => files.clear()),
	} satisfies CanvasPlaybackCache;
	const controller = new AbortController();
	const onChange = vi.fn();
	const requests: ReturnType<typeof controlledPreparation>[] = [];
	function controlledPreparation({ request }: { request: PreparationRequest }) {
		const gate = deferred<void>();
		let published = 0;
		const metrics: CanvasPlaybackPreparationMetrics = {
			renderMs: 0,
			encodeMs: 0,
			writeMs: 0,
			wallMs: 0,
			maxInFlightFrames: 2,
			maxReservedPixelBytes: 48,
			maxPendingPngBytes: 65_553,
		};
		const publish = async ({ frame }: { frame: number }) => {
			const blob = new Blob([new Uint8Array(65_553)], { type: "image/png" });
			await request.cache.write({ frame, blob, signal: request.signal });
			published++;
			metrics.renderMs = published * 10;
			metrics.encodeMs = published * 2;
			metrics.writeMs = published;
			request.onProgress({ completed: published, metrics: { ...metrics } });
			return blob;
		};
		return {
			request,
			gate,
			publish,
			async complete() {
				const start = request.startFrame ?? 0;
				await Array.from(
					{ length: request.frames },
					(_, index) => start + index
				).reduce(
					(operation, frame) => operation.then(() => publish({ frame })),
					Promise.resolve<Blob | undefined>(undefined)
				);
				gate.resolve();
			},
			metrics,
		};
	}
	vi.mocked(prepareCanvasPlaybackFrames).mockImplementation(async (request) => {
		const controlled = controlledPreparation({ request });
		requests.push(controlled);
		await controlled.gate.promise;
		request.signal.throwIfAborted();
		return controlled.metrics;
	});
	const stream = createCanvasPlaybackStream({
		plan,
		frames,
		cache,
		signal: controller.signal,
		onChange,
		backgroundColor: "#123456",
	});
	const requestAt = async ({ index }: { index: number }) => {
		await vi.waitFor(() => expect(requests.length).toBeGreaterThan(index));
		return requests[index];
	};
	const settle = async () => {
		await vi.waitFor(() =>
			expect(stream.stats.preparingSegment).toBeUndefined()
		);
	};
	return {
		plan,
		cache,
		files,
		stream,
		controller,
		onChange,
		requests,
		requestAt,
		settle,
		get peakBytes() {
			return peakBytes;
		},
		async dispose() {
			const disposal = stream.dispose();
			for (const request of requests) request.gate.resolve();
			await disposal;
		},
	};
}
