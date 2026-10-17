import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import { createFrameRenderQueue } from "../export-render-queue";

const mediabunnyMocks = vi.hoisted(() => ({
	openCalls: 0,
	iteratorStarts: [] as number[],
	nextCalls: 0,
	disposed: 0,
	canDecode: true,
	canBeTransparent: false,
	sinkOptions: [] as unknown[],
	frameDuration: 1 / 30,
	totalFrames: 90,
}));

vi.mock("mediabunny", () => {
	class BlobSource {
		constructor(public blob: Blob) {}
	}
	class Input {
		constructor(_options: unknown) {
			mediabunnyMocks.openCalls += 1;
		}
		async getPrimaryVideoTrack() {
			return {
				canDecode: async () => mediabunnyMocks.canDecode,
				canBeTransparent: async () => mediabunnyMocks.canBeTransparent,
			};
		}
		dispose() {
			mediabunnyMocks.disposed += 1;
		}
	}
	class CanvasSink {
		constructor(_track: unknown, options: unknown) {
			mediabunnyMocks.sinkOptions.push(options);
		}
		canvases(startTimestamp = 0) {
			mediabunnyMocks.iteratorStarts.push(startTimestamp);
			const d = mediabunnyMocks.frameDuration;
			let frame = Math.max(0, Math.floor(startTimestamp / d + 1e-6));
			return {
				async next() {
					mediabunnyMocks.nextCalls += 1;
					if (frame >= mediabunnyMocks.totalFrames) {
						return { done: true, value: undefined };
					}
					const timestamp = frame * d;
					frame += 1;
					const canvas = { width: 320, height: 180, __frame: frame - 1 };
					return { done: false, value: { canvas, timestamp, duration: d } };
				},
				async return() {
					return { done: true, value: undefined };
				},
			};
		}
	}
	return { ALL_FORMATS: [], BlobSource, CanvasSink, Input };
});

vi.mock("@/lib/debug/debug-config", () => ({
	debugWarn: vi.fn(),
}));

// Static import pre-registers the mock so the module under test's dynamic
// `import("mediabunny")` calls resolve the mock even when issued concurrently.
import "mediabunny";
import {
	SequentialVideoFrameSource,
	SequentialVideoRegistry,
	setSequentialDecodeDisabled,
} from "../export-sequential-video-source";
import { getExportFrameSampleTime } from "../export-video-frame-seek";

function frameIndex(frame: { canvas: unknown } | null): number | null {
	return frame ? (frame.canvas as { __frame: number }).__frame : null;
}

describe("SequentialVideoFrameSource", () => {
	beforeEach(() => {
		mediabunnyMocks.openCalls = 0;
		mediabunnyMocks.iteratorStarts = [];
		mediabunnyMocks.nextCalls = 0;
		mediabunnyMocks.disposed = 0;
		mediabunnyMocks.canDecode = true;
		mediabunnyMocks.canBeTransparent = false;
		mediabunnyMocks.sinkOptions = [];
		mediabunnyMocks.frameDuration = 1 / 30;
		setSequentialDecodeDisabled(false);
	});

	it("keeps a transparent video's alpha instead of decoding it onto black", async () => {
		mediabunnyMocks.canBeTransparent = true;
		await SequentialVideoFrameSource.open({ blob: new Blob(["x"]) });
		mediabunnyMocks.canBeTransparent = false;
		await SequentialVideoFrameSource.open({ blob: new Blob(["x"]) });
		expect(mediabunnyMocks.sinkOptions).toEqual([
			expect.objectContaining({ alpha: true }),
			expect.objectContaining({ alpha: false }),
		]);
	});

	it("advances monotonically with exactly one decode per frame", async () => {
		const source = await SequentialVideoFrameSource.open({
			blob: new Blob(["x"]),
		});
		expect(source).not.toBeNull();
		const d = 1 / 30;
		for (let i = 0; i < 30; i++) {
			const frame = await source!.frameAt(i * d + d / 2);
			expect(frameIndex(frame)).toBe(i);
		}
		// One iterator, started once at ~0 — no per-frame restarts.
		expect(mediabunnyMocks.iteratorStarts).toHaveLength(1);
		// next() pulls: first frame + one lookahead per advance ≈ frames + 1.
		expect(mediabunnyMocks.nextCalls).toBeLessThanOrEqual(31);
	});

	it("restarts on a backwards jump and a large forward gap", async () => {
		const source = await SequentialVideoFrameSource.open({
			blob: new Blob(["x"]),
		});
		const d = 1 / 30;
		await source!.frameAt(1.0);
		expect(mediabunnyMocks.iteratorStarts).toHaveLength(1);

		// Backwards: must reposition, not scan from the current point.
		const back = await source!.frameAt(0.2 + d / 2);
		expect(mediabunnyMocks.iteratorStarts).toHaveLength(2);
		expect(frameIndex(back)).toBe(Math.floor(0.2 / d + 0.5));

		// A forward jump beyond the restart gap seeks instead of decoding through.
		await source!.frameAt(2.5);
		expect(mediabunnyMocks.iteratorStarts).toHaveLength(3);
	});

	it("resolves an exact frame boundary to the frame that starts there", async () => {
		// A 2x clip with a frame-aligned trim samples exactly on source frame
		// boundaries every frame. An HTMLVideoElement seek displays the frame
		// whose [pts, pts+duration) interval contains the time — the newer
		// frame — so the sequential source must not hold the previous one.
		const source = await SequentialVideoFrameSource.open({
			blob: new Blob(["x"]),
		});
		const d = 1 / 30;
		for (let k = 0; k < 10; k++) {
			const boundary = (2 * k + 1) * d;
			const frame = await source!.frameAt(boundary);
			expect(frameIndex(frame), `boundary ${2 * k + 1}`).toBe(2 * k + 1);
		}
		// Still sequential: one iterator, no restarts.
		expect(mediabunnyMocks.iteratorStarts).toHaveLength(1);
	});

	it("holds the previous frame half a millisecond before a boundary", async () => {
		const source = await SequentialVideoFrameSource.open({
			blob: new Blob(["x"]),
		});
		const d = 1 / 30;
		// Sub-millisecond offsets occur between real source and output cadences;
		// they are presentation time, not floating-point noise.
		const frame = await source!.frameAt(6 * d - 0.0005);
		expect(frameIndex(frame)).toBe(5);
		// Mid-frame requests are untouched by the boundary bias.
		const mid = await source!.frameAt(6 * d + d / 2);
		expect(frameIndex(mid)).toBe(6);
	});

	it.each([
		{ outputFrame: 7, speed: 1, sourceTime: 0.25, expectedFrame: 5 },
		{ outputFrame: 7, speed: 2, sourceTime: 0.5, expectedFrame: 11 },
		{ outputFrame: 22, speed: 1, sourceTime: 0.75, expectedFrame: 17 },
	])("keeps 23.976fps frame $expectedFrame at source time $sourceTime in a 30fps export", async ({
		outputFrame,
		speed,
		sourceTime,
		expectedFrame,
	}) => {
		mediabunnyMocks.frameDuration = 1001 / 24_000;
		const source = await SequentialVideoFrameSource.open({
			blob: new Blob(["x"]),
		});
		await source!.frameAt(0);
		const sampleTime =
			getExportFrameSampleTime({
				frameRate: 30,
				frameStartTime: outputFrame / 30,
			}) * speed;
		expect(sampleTime).toBeCloseTo(sourceTime, 12);
		const frame = await source!.frameAt(sampleTime);
		expect(frameIndex(frame)).toBe(expectedFrame);
		expect(frame!.timestamp).toBeLessThanOrEqual(sampleTime);
		expect(frame!.timestamp + frame!.duration).toBeGreaterThan(sampleTime);
		expect(mediabunnyMocks.iteratorStarts).toHaveLength(1);
	});

	it("keeps 2x frame boundaries stable with floating-point arithmetic noise", async () => {
		mediabunnyMocks.frameDuration = 1001 / 24_000;
		const source = await SequentialVideoFrameSource.open({
			blob: new Blob(["x"]),
		});
		await source!.frameAt(0);
		for (const index of [0, 1, 2, 3, 4]) {
			const sampleTime =
				getExportFrameSampleTime({
					frameRate: 24_000 / 1001,
					frameStartTime: (index * 1001) / 24_000,
				}) * 2;
			const frame = await source!.frameAt(sampleTime - Number.EPSILON);
			expect(frameIndex(frame)).toBe(2 * index + 1);
		}
		expect(mediabunnyMocks.iteratorStarts).toHaveLength(1);
	});

	it("holds the final frame past the end of the stream", async () => {
		const source = await SequentialVideoFrameSource.open({
			blob: new Blob(["x"]),
		});
		const d = 1 / 30;
		const lastTimestamp = (mediabunnyMocks.totalFrames - 1) * d;
		const last = await source!.frameAt(lastTimestamp + d / 2);
		expect(frameIndex(last)).toBe(mediabunnyMocks.totalFrames - 1);
		const beyond = await source!.frameAt(lastTimestamp + 0.5);
		expect(frameIndex(beyond)).toBe(mediabunnyMocks.totalFrames - 1);
	});

	it("reports null for undecodable sources", async () => {
		mediabunnyMocks.canDecode = false;
		const source = await SequentialVideoFrameSource.open({
			blob: new Blob(["x"]),
		});
		expect(source).toBeNull();
	});

	it("disposes the underlying input", async () => {
		const source = await SequentialVideoFrameSource.open({
			blob: new Blob(["x"]),
		});
		await source!.frameAt(0.1);
		await source!.dispose();
		expect(mediabunnyMocks.disposed).toBe(1);
	});
});

describe("SequentialVideoRegistry", () => {
	beforeEach(() => {
		mediabunnyMocks.openCalls = 0;
		mediabunnyMocks.canDecode = true;
		setSequentialDecodeDisabled(false);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function mediaItem(id: string) {
		return { id, file: new Blob(["media"]) } as never;
	}

	it("opens one source per media item and caches it", async () => {
		const registry = new SequentialVideoRegistry();
		// Sequential awaits: vitest's dynamic-import mock resolution races when
		// two first-time `import("mediabunny")` calls overlap in one tick.
		const a = await registry.getOrOpen(mediaItem("m1"));
		const b = await registry.getOrOpen(mediaItem("m2"));
		const again = await registry.getOrOpen(mediaItem("m1"));
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		expect(again).toBe(a);
		expect(mediabunnyMocks.openCalls).toBe(2);
		const disposedBefore = mediabunnyMocks.disposed;
		await registry.disposeAll();
		expect(mediabunnyMocks.disposed).toBe(disposedBefore + 2);
	});

	it.each([
		{ bytes: "", fetchExpected: true },
		{ bytes: "local video bytes", fetchExpected: false },
	])("fetches the playable URL only for an empty placeholder file ($fetchExpected)", async ({
		bytes,
		fetchExpected,
	}) => {
		const registry = new SequentialVideoRegistry();
		const file = new File([bytes], "video.mp4", { type: "video/mp4" });
		const downloaded = new Blob(["downloaded video"]);
		const fetchMedia = vi.fn(async () => ({
			ok: true,
			blob: async () => downloaded,
		}));
		vi.stubGlobal("fetch", fetchMedia);
		const open = vi.spyOn(SequentialVideoFrameSource, "open");
		try {
			const source = await registry.getOrOpen({
				id: "url-backed",
				url: "app://local-media/video",
				file,
			} as MediaItem);
			expect(source).not.toBeNull();
			expect(fetchMedia).toHaveBeenCalledTimes(fetchExpected ? 1 : 0);
			expect(open).toHaveBeenCalledWith({
				blob: fetchExpected ? downloaded : file,
			});
		} finally {
			open.mockRestore();
			await registry.disposeAll();
		}
	});

	it("keeps one decoder per lane so overlapping clips never share", async () => {
		// Two elements cut from the same file read far-apart source times in
		// the same exported frame; separate lanes keep both monotonic instead
		// of restarting a shared decoder every alternating read.
		const registry = new SequentialVideoRegistry();
		const item = mediaItem("m1");
		const laneA = await registry.getOrOpen(item, "element-a");
		const laneB = await registry.getOrOpen(item, "element-b");
		expect(laneA).not.toBeNull();
		expect(laneB).not.toBeNull();
		expect(laneB).not.toBe(laneA);
		expect(await registry.getOrOpen(item, "element-a")).toBe(laneA);
		expect(mediabunnyMocks.openCalls).toBe(2);
		await registry.disposeAll();
	});

	it("evicts the least recently used lane beyond the open-decoder cap", async () => {
		mediabunnyMocks.disposed = 0;
		const registry = new SequentialVideoRegistry();
		const opened: unknown[] = [];
		for (let index = 0; index < 8; index++) {
			opened.push(await registry.getOrOpen(mediaItem(`m${index}`), "e"));
		}
		expect(mediabunnyMocks.disposed).toBe(0);
		// Touch lane 0 so lane 1 becomes the least recently used.
		await registry.getOrOpen(mediaItem("m0"), "e");
		await registry.getOrOpen(mediaItem("m8"), "e");
		await vi.waitFor(() => expect(mediabunnyMocks.disposed).toBe(1));
		// The touched lane survived; the evicted one reopens as a new source.
		expect(await registry.getOrOpen(mediaItem("m0"), "e")).toBe(opened[0]);
		const reopened = await registry.getOrOpen(mediaItem("m1"), "e");
		expect(reopened).not.toBe(opened[1]);
		await registry.disposeAll();
	});

	it("returns null for every item while the debug disable flag is set", async () => {
		setSequentialDecodeDisabled(true);
		const registry = new SequentialVideoRegistry();
		expect(await registry.getOrOpen(mediaItem("m1"))).toBeNull();
		expect(mediabunnyMocks.openCalls).toBe(0);
		setSequentialDecodeDisabled(false);
		expect(await registry.getOrOpen(mediaItem("m1"))).not.toBeNull();
	});

	it.each([
		"headers",
		"body",
	] as const)("cancels a stalled fetch at %s and releases the frame queue for the next render", async (phase) => {
		const registry = new SequentialVideoRegistry();
		const enqueue = createFrameRenderQueue();
		const controller = new AbortController();
		const cancelled = new Error("Preview replaced during media load");
		let stopNetwork: (error: Error) => void = () => {};
		const network = new Promise<Blob>((_resolve, reject) => {
			stopNetwork = reject;
		});
		const fetchMedia = vi.fn(async (_url: string, options?: RequestInit) => {
			options?.signal?.addEventListener("abort", () => {
				stopNetwork(cancelled);
			});
			if (phase === "headers") await network;
			return { ok: true, blob: () => network };
		});
		vi.stubGlobal("fetch", fetchMedia);
		const first = enqueue({
			signal: controller.signal,
			render: async () => {
				await registry.getOrOpen(
					{ id: "remote", url: "https://media.test/stalled.mp4" } as MediaItem,
					"clip",
					{ signal: controller.signal }
				);
			},
		}).catch((error: unknown) => error);
		const nextRender = vi.fn(async () => {
			const source = await registry.getOrOpen(mediaItem("remote"), "clip");
			expect(frameIndex(await source!.frameAt(0))).toBe(0);
		});
		const next = enqueue({ render: nextRender });
		try {
			await vi.waitFor(() => expect(fetchMedia).toHaveBeenCalledOnce());
			controller.abort(cancelled);
			await vi.waitFor(() => expect(nextRender).toHaveBeenCalledOnce(), {
				timeout: 1000,
			});
			expect(await first).toBe(cancelled);
			expect(fetchMedia).toHaveBeenCalledWith(
				"https://media.test/stalled.mp4",
				{ signal: controller.signal }
			);
			await next;
			expect(mediabunnyMocks.openCalls).toBe(1);
		} finally {
			stopNetwork(cancelled);
			await Promise.all([first, next, registry.disposeAll()]);
		}
	});

	it("does not fetch or reuse an open decoder for an already cancelled request", async () => {
		const registry = new SequentialVideoRegistry();
		const controller = new AbortController();
		const cancelled = new Error("Cancelled before loading");
		const fetchMedia = vi.fn();
		vi.stubGlobal("fetch", fetchMedia);
		await registry.getOrOpen(mediaItem("m1"));
		controller.abort(cancelled);
		await expect(
			registry.getOrOpen(mediaItem("m1"), undefined, {
				signal: controller.signal,
			})
		).rejects.toBe(cancelled);
		expect(fetchMedia).not.toHaveBeenCalled();
		expect(mediabunnyMocks.openCalls).toBe(1);
		await registry.disposeAll();
	});

	it("disposes a decoder opened after cancellation instead of publishing it", async () => {
		const registry = new SequentialVideoRegistry();
		const controller = new AbortController();
		const cancelled = new Error("Cancelled while decoder opened");
		const source = await SequentialVideoFrameSource.open({ blob: new Blob() });
		const open = vi
			.spyOn(SequentialVideoFrameSource, "open")
			.mockImplementationOnce(async () => {
				controller.abort(cancelled);
				return source;
			});
		const disposedBefore = mediabunnyMocks.disposed;
		try {
			await expect(
				registry.getOrOpen(mediaItem("m1"), "clip", {
					signal: controller.signal,
				})
			).rejects.toBe(cancelled);
			expect(mediabunnyMocks.disposed).toBe(disposedBefore + 1);
			await registry.disposeAll();
			expect(mediabunnyMocks.disposed).toBe(disposedBefore + 1);
		} finally {
			open.mockRestore();
		}
	});
});
