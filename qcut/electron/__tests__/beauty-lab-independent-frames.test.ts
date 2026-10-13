// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeautyLabIndependentResult } from "../beauty-lab/beauty-lab-independent-contract";
import {
	createIndependentFrameCache,
	independentFrameCacheKey,
} from "../beauty-lab/beauty-lab-independent-frame-cache";
import { createIndependentRenderQueue } from "../beauty-lab/beauty-lab-independent-queue";
import {
	createIndependentFrameRenderer,
	independentEngineSha256,
	INDEPENDENT_TIMELINE_SOURCE_KEY,
} from "../beauty-lab/beauty-lab-independent-frames";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "independent-frames-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

function png({ rgba, width }: { rgba: Uint8Array; width: number }) {
	const height = rgba.length / 4 / width;
	const canvas = createCanvas(width, height);
	canvas
		.getContext("2d")
		.putImageData(
			new ImageData(new Uint8ClampedArray(rgba), width, height),
			0,
			0
		);
	return new Uint8Array(canvas.toBuffer("image/png"));
}

const input = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
const output = new Uint8Array([90, 80, 70, 255, 60, 50, 40, 255]);
const request = {
	requestId: "frame-1",
	width: 2,
	height: 1,
	rgba: input,
	adjustments: {
		enabled: true as const,
		values: { face_adjust_Whiten: 40 },
		makeup: { lip: { cardId: "lip-coral-nude", intensity: 40 } },
	},
};

function engine() {
	return {
		render: vi.fn(
			async ({ request: sent }: { request: unknown }) =>
				({
					requestId: (sent as { requestId: string }).requestId,
					width: 2,
					height: 1,
					rgba: output,
					png: png({ rgba: output, width: 2 }),
				}) as BeautyLabIndependentResult
		),
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

describe("independent frame cache key", () => {
	const base = {
		engineSha256: "a".repeat(64),
		width: 2,
		height: 1,
		values: { face_adjust_Whiten: 40, face_adjust_Nose: 10 },
		makeup: {},
		rgba: input,
	};
	it("ignores adjustment key order", () => {
		expect(independentFrameCacheKey(base)).toBe(
			independentFrameCacheKey({
				...base,
				values: { face_adjust_Nose: 10, face_adjust_Whiten: 40 },
			})
		);
	});
	it("separates temporal evidence from a still-frame key", () => {
		const key = independentFrameCacheKey(base);
		expect(
			independentFrameCacheKey({
				...base,
				sourceEvidenceSha256: "a".repeat(64),
			})
		).not.toBe(key);
		expect(
			independentFrameCacheKey({
				...base,
				sourceEvidenceSha256: "a".repeat(64),
			})
		).not.toBe(
			independentFrameCacheKey({
				...base,
				sourceEvidenceSha256: "b".repeat(64),
			})
		);
	});
	it("changes with the engine, the edit and the pixels", () => {
		const key = independentFrameCacheKey(base);
		expect(
			independentFrameCacheKey({ ...base, engineSha256: "b".repeat(64) })
		).not.toBe(key);
		expect(
			independentFrameCacheKey({
				...base,
				values: { ...base.values, face_adjust_Whiten: 41 },
			})
		).not.toBe(key);
		expect(
			independentFrameCacheKey({
				...base,
				rgba: new Uint8Array([11, 20, 30, 255, 40, 50, 60, 255]),
			})
		).not.toBe(key);
	});
});

describe("independent source evidence cache isolation", () => {
	function evidence() {
		return {
			policy: "single-face-bidirectional-v1" as const,
			status: "available" as const,
			targetTimestampSeconds: 1,
			frames: [0.92, 0.96, 1.04, 1.08].map((timestampSeconds) => ({
				timestampSeconds,
				rgba: input.slice(),
			})),
		};
	}
	it("reuses identical neighbors but never an absent or changed history", async () => {
		const provider = engine();
		const renderer = createIndependentFrameRenderer({
			provider,
			cache: createIndependentFrameCache({ directory }),
			engineSha256: async () => "engine",
		});
		const first = await renderer.render({ request });
		const sourceEvidence = evidence();
		const withHistory = await renderer.render({
			request: { ...request, sourceEvidence },
		});
		const repeated = await renderer.render({
			request: { ...request, sourceEvidence: structuredClone(sourceEvidence) },
		});
		sourceEvidence.frames[0].rgba[0] = 80;
		const changed = await renderer.render({
			request: { ...request, sourceEvidence },
		});
		const unavailable = await renderer.render({
			request: {
				...request,
				sourceEvidence: {
					policy: "single-face-bidirectional-v1",
					status: "unavailable",
					reason: "insufficient-neighbors",
				},
			},
		});
		expect([
			first.cached,
			withHistory.cached,
			repeated.cached,
			changed.cached,
			unavailable.cached,
		]).toEqual([false, false, true, false, false]);
		expect(provider.render).toHaveBeenCalledTimes(4);
	});
	it("snapshots history pixels before waiting for engine identity", async () => {
		const identity = deferred<string>();
		const provider = engine();
		const renderer = createIndependentFrameRenderer({
			provider,
			cache: createIndependentFrameCache({ directory }),
			engineSha256: () => identity.promise,
		});
		const sourceEvidence = evidence();
		const pending = renderer.render({
			request: { ...request, sourceEvidence },
		});
		sourceEvidence.frames[0].rgba[0] = 99;
		identity.resolve("engine");
		await pending;
		expect(provider.render.mock.calls[0][0].request).toMatchObject({
			sourceEvidence: {
				frames: [
					{ timestampSeconds: 0.92, rgba: input },
					...evidence().frames.slice(1),
				],
			},
		});
	});
	it("copies only visible pixels and snapshots edits before waiting", async () => {
		const pixels = () => {
			const backing = new Uint8Array(1024 * 1024);
			const view = backing.subarray(128, 128 + input.length);
			view.set(input);
			return view;
		};
		const identity = deferred<string>();
		const provider = engine();
		const renderer = createIndependentFrameRenderer({
			provider,
			cache: createIndependentFrameCache({ directory }),
			engineSha256: () => identity.promise,
		});
		const sourceEvidence = evidence();
		for (const frame of sourceEvidence.frames) frame.rgba = pixels();
		const submitted = {
			...request,
			rgba: pixels(),
			adjustments: structuredClone(request.adjustments),
			sourceEvidence,
		};
		const pending = renderer.render({ request: submitted });
		submitted.rgba.fill(99);
		submitted.sourceEvidence.frames[0].rgba.fill(99);
		submitted.adjustments.values.face_adjust_Whiten = 99;
		submitted.adjustments.makeup.lip.intensity = 99;
		identity.resolve("engine");
		await pending;
		const sent = provider.render.mock.calls[0][0].request as typeof submitted;
		expect(sent.rgba).toEqual(input);
		expect(sent.rgba.buffer.byteLength).toBe(input.length);
		expect(sent.adjustments).toEqual(request.adjustments);
		for (const frame of sent.sourceEvidence.frames) {
			expect(frame.rgba).toEqual(input);
			expect(frame.rgba.buffer.byteLength).toBe(input.length);
		}
	});
	it.each([
		"target",
		"neighbor",
		"shared target",
		"shared neighbor",
		"budget",
	])("rejects invalid %s payloads before snapshotting", async (kind) => {
		const submitted = {
			...request,
			rgba: input.slice(),
			sourceEvidence: evidence(),
		};
		if (kind === "target") submitted.rgba = new Uint8Array(1024 * 1024);
		if (kind === "neighbor")
			submitted.sourceEvidence.frames[0].rgba = new Uint8Array(1024 * 1024);
		if (kind === "shared target")
			submitted.rgba = new Uint8Array(new SharedArrayBuffer(input.length));
		if (kind === "shared neighbor")
			submitted.sourceEvidence.frames[0].rgba = new Uint8Array(
				new SharedArrayBuffer(input.length)
			);
		if (kind === "budget") {
			submitted.width = 4096;
			submitted.height = 1025;
			submitted.rgba = new Uint8Array(submitted.width * submitted.height * 4);
		}
		const provider = engine();
		const engineSha256 = vi.fn(async () => "engine");
		const renderer = createIndependentFrameRenderer({
			provider,
			cache: createIndependentFrameCache({ directory }),
			engineSha256,
		});
		const snapshot = vi.spyOn(globalThis, "structuredClone");
		try {
			await expect(renderer.render({ request: submitted })).rejects.toThrow();
			expect(snapshot.mock.calls.length).toBe(0);
			expect(engineSha256).not.toHaveBeenCalled();
			expect(provider.render).not.toHaveBeenCalled();
		} finally {
			snapshot.mockRestore();
		}
	});
});

describe("independent frame renderer", () => {
	it("settles cancellation promptly while the shared queue drains cleanup before the latest seek", async () => {
		const stopped = deferred<void>();
		const cleanup = deferred<void>();
		const rendered = engine();
		const provider = {
			inspect: vi.fn(),
			render: vi.fn(async ({ request: sent }: { request: unknown }) => {
				if ((sent as { requestId: string }).requestId === request.requestId) {
					await stopped.promise;
					await cleanup.promise;
					throw new Error("Independent beauty cancelled");
				}
				return rendered.render({ request: sent });
			}),
			cancel: vi.fn(() => {
				stopped.resolve();
				return { cancelled: true };
			}),
			dispose: vi.fn(async () => {}),
		};
		const queue = createIndependentRenderQueue({ provider });
		const cache = {
			read: vi.fn(async () => null),
			write: vi.fn(async () => {}),
		};
		const renderer = createIndependentFrameRenderer({
			provider: queue,
			cache,
			engineSha256: async () => "a".repeat(64),
		});
		const first = expect(renderer.render({ request })).rejects.toThrow(
			"cancelled"
		);
		await vi.waitFor(() => expect(provider.render).toHaveBeenCalledOnce());
		renderer.cancel({ request: { requestId: request.requestId } });
		queue.cancel({ request: { requestId: request.requestId } });
		await first;

		const intermediateRequest = { ...request, requestId: "intermediate-seek" };
		const intermediate = expect(
			renderer.render({ request: intermediateRequest })
		).rejects.toThrow("cancelled");
		await vi.waitFor(() => expect(cache.read).toHaveBeenCalledTimes(2));
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(provider.render).toHaveBeenCalledOnce();
		renderer.cancel({ request: { requestId: intermediateRequest.requestId } });
		queue.cancel({ request: { requestId: intermediateRequest.requestId } });
		await intermediate;

		const latest = renderer.render({
			request: { ...request, requestId: "latest-seek" },
		});
		await vi.waitFor(() => expect(cache.read).toHaveBeenCalledTimes(3));
		expect(provider.render).toHaveBeenCalledOnce();
		cleanup.resolve();
		await expect(latest).resolves.toMatchObject({
			requestId: "latest-seek",
			cached: false,
		});
		expect(provider.render).toHaveBeenCalledTimes(2);
		expect(provider.cancel).toHaveBeenCalledOnce();
		expect(cache.write).toHaveBeenCalledOnce();
		await queue.dispose();
	});

	it.each([
		{ name: "miss", cached: null },
		{ name: "hit", cached: output },
	])("cancels a delayed cache $name before rendering or publishing", async ({
		cached,
	}) => {
		const provider = engine();
		const lookup = deferred<Uint8Array | null>();
		const cache = {
			read: vi.fn(() => lookup.promise),
			write: vi.fn(async () => {}),
		};
		const renderer = createIndependentFrameRenderer({
			provider,
			cache,
			engineSha256: async () => "a".repeat(64),
		});
		const rejected = expect(renderer.render({ request })).rejects.toThrow(
			"cancelled"
		);
		await vi.waitFor(() => expect(cache.read).toHaveBeenCalledOnce());
		expect(
			renderer.cancel({ request: { requestId: request.requestId } })
		).toEqual({ cancelled: true });
		await rejected;
		lookup.resolve(cached);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(provider.render).not.toHaveBeenCalled();
		expect(cache.write).not.toHaveBeenCalled();
		cache.read.mockResolvedValue(null);
		await expect(
			renderer.render({ request: { ...request, requestId: "after-cancel" } })
		).resolves.toMatchObject({ cached: false });
		expect(provider.render).toHaveBeenCalledOnce();
	});

	it("cancels during engine identity lookup without starting cache or render work", async () => {
		const identity = deferred<string>();
		const provider = engine();
		const cache = {
			read: vi.fn(async () => null),
			write: vi.fn(async () => {}),
		};
		const renderer = createIndependentFrameRenderer({
			provider,
			cache,
			engineSha256: () => identity.promise,
		});
		const rejected = expect(renderer.render({ request })).rejects.toThrow(
			"cancelled"
		);
		renderer.cancel({ request: { requestId: request.requestId } });
		await rejected;
		identity.resolve("a".repeat(64));
		expect(cache.read).not.toHaveBeenCalled();
		expect(provider.render).not.toHaveBeenCalled();
	});

	it("discards a late engine result without starting a cache write", async () => {
		const result = deferred<BeautyLabIndependentResult>();
		const provider = { render: vi.fn(() => result.promise) };
		const cache = {
			read: vi.fn(async () => null),
			write: vi.fn(async () => {}),
		};
		const renderer = createIndependentFrameRenderer({
			provider,
			cache,
			engineSha256: async () => "a".repeat(64),
		});
		const rejected = expect(renderer.render({ request })).rejects.toThrow(
			"cancelled"
		);
		await vi.waitFor(() => expect(provider.render).toHaveBeenCalledOnce());
		renderer.cancel({ request: { requestId: request.requestId } });
		await rejected;
		result.resolve(await engine().render({ request }));
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(cache.write).not.toHaveBeenCalled();
	});

	it("invalidates pending cache hits before disposal and rejects later work", async () => {
		const lookup = deferred<Uint8Array | null>();
		const provider = engine();
		const cache = {
			read: vi.fn(() => lookup.promise),
			write: vi.fn(async () => {}),
		};
		const renderer = createIndependentFrameRenderer({
			provider,
			cache,
			engineSha256: async () => "a".repeat(64),
		});
		const rejected = expect(renderer.render({ request })).rejects.toThrow(
			"disposed"
		);
		await vi.waitFor(() => expect(cache.read).toHaveBeenCalledOnce());
		renderer.dispose();
		await rejected;
		lookup.resolve(output);
		await expect(renderer.render({ request })).rejects.toThrow("disposed");
		expect(provider.render).not.toHaveBeenCalled();
	});

	it("rejects duplicate pending ids while preserving the first request", async () => {
		const lookup = deferred<Uint8Array | null>();
		const renderer = createIndependentFrameRenderer({
			provider: engine(),
			cache: { read: () => lookup.promise, write: async () => {} },
			engineSha256: async () => "a".repeat(64),
		});
		const first = renderer.render({ request });
		await expect(renderer.render({ request })).rejects.toThrow("Duplicate");
		expect(renderer.cancel({ request: { requestId: "unknown" } })).toEqual({
			cancelled: false,
		});
		lookup.resolve(output);
		await expect(first).resolves.toMatchObject({ cached: true });
	});

	it("runs the engine once, then serves the same frame from disk", async () => {
		const provider = engine();
		const renderer = createIndependentFrameRenderer({
			provider,
			cache: createIndependentFrameCache({ directory }),
			engineSha256: async () => "a".repeat(64),
		});
		const first = await renderer.render({ request });
		expect(first).toEqual({
			requestId: "frame-1",
			width: 2,
			height: 1,
			rgba: output,
			cached: false,
		});
		expect(provider.render).toHaveBeenCalledWith({
			request: { ...request, sourceKey: INDEPENDENT_TIMELINE_SOURCE_KEY },
		});
		// A fresh cache instance stands in for the next export session.
		const reopened = createIndependentFrameRenderer({
			provider,
			cache: createIndependentFrameCache({ directory }),
			engineSha256: async () => "a".repeat(64),
		});
		const second = await reopened.render({
			request: { ...request, requestId: "frame-2" },
		});
		expect(second).toEqual({
			requestId: "frame-2",
			width: 2,
			height: 1,
			rgba: output,
			cached: true,
		});
		expect(provider.render).toHaveBeenCalledOnce();
	});

	it("reprocesses after an engine update", async () => {
		const provider = engine();
		const cache = createIndependentFrameCache({ directory });
		let build = "a".repeat(64);
		const renderer = createIndependentFrameRenderer({
			provider,
			cache,
			engineSha256: async () => build,
		});
		await renderer.render({ request });
		build = "b".repeat(64);
		expect(await renderer.render({ request })).toMatchObject({
			cached: false,
		});
		expect(provider.render).toHaveBeenCalledTimes(2);
	});

	it("treats a damaged cache entry as a miss", async () => {
		const provider = engine();
		const renderer = createIndependentFrameRenderer({
			provider,
			cache: createIndependentFrameCache({ directory }),
			engineSha256: async () => "a".repeat(64),
		});
		await renderer.render({ request });
		const [stored] = (await readdir(directory)).filter((name) =>
			name.endsWith(".png")
		);
		const bytes = await readFile(path.join(directory, stored));
		bytes[bytes.length - 20] ^= 0xff;
		await writeFile(path.join(directory, stored), bytes);
		const reopened = createIndependentFrameRenderer({
			provider,
			cache: createIndependentFrameCache({ directory }),
			engineSha256: async () => "a".repeat(64),
		});
		expect(await reopened.render({ request })).toMatchObject({
			cached: false,
			rgba: output,
		});
		expect(provider.render).toHaveBeenCalledTimes(2);
	});

	it("rejects malformed frames before reaching the engine", async () => {
		const provider = engine();
		const renderer = createIndependentFrameRenderer({
			provider,
			cache: createIndependentFrameCache({ directory }),
			engineSha256: async () => "a".repeat(64),
		});
		await expect(
			renderer.render({ request: { ...request, width: 1281 } })
		).rejects.toThrow();
		await expect(
			renderer.render({
				request: { ...request, rgba: new Uint8Array(4) },
			})
		).rejects.toThrow("RGBA");
		await expect(
			renderer.render({
				request: {
					...request,
					adjustments: { ...request.adjustments, faces: [] },
				},
			})
		).rejects.toThrow();
		expect(provider.render).not.toHaveBeenCalled();
	});

	it("still returns the frame when the cache cannot be written", async () => {
		const provider = engine();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const renderer = createIndependentFrameRenderer({
			provider,
			cache: {
				read: async () => null,
				write: async () => {
					throw new Error("disk full");
				},
			},
			engineSha256: async () => "a".repeat(64),
		});
		expect(await renderer.render({ request })).toMatchObject({
			cached: false,
			rgba: output,
		});
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe("independent frame cache", () => {
	it("evicts the least recently used frames past its budget", async () => {
		let clock = 1_000;
		const entries = ["1", "2"].map((digit) => ({
			key: digit.repeat(64),
			width: 2,
			height: 1,
			png: png({ rgba: output, width: 2 }),
			rgba: output,
		}));
		const budget = createIndependentFrameCache({
			directory,
			now: () => clock,
			// Room for exactly one entry: the PNG plus its JSON record.
			maxBytes: entries[0].png.byteLength + 400,
		});
		await budget.write(entries[0]);
		clock += 1;
		await budget.write(entries[1]);
		expect(
			await budget.read({ key: entries[0].key, width: 2, height: 1 })
		).toBeNull();
		expect(
			await budget.read({ key: entries[1].key, width: 2, height: 1 })
		).toEqual(output);
		expect(
			(await readdir(directory)).filter((name) => name.includes(".partial-"))
		).toEqual([]);
	});
});

describe("independent engine identity", () => {
	it("follows both the source manifest and the runtime profile", async () => {
		await writeFile(path.join(directory, "source-manifest.json"), "{}");
		const first = await independentEngineSha256({
			engineRoot: directory,
			profile: { files: [1] },
		});
		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(
			await independentEngineSha256({
				engineRoot: directory,
				profile: { files: [2] },
			})
		).not.toBe(first);
		await writeFile(path.join(directory, "source-manifest.json"), "{ }");
		expect(
			await independentEngineSha256({
				engineRoot: directory,
				profile: { files: [1] },
			})
		).not.toBe(first);
	});
});
