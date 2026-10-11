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

describe("independent frame renderer", () => {
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
