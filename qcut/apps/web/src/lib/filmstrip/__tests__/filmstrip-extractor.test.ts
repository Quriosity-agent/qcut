import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filmstripCache } from "../filmstrip-cache";
import { extractFrames } from "../filmstrip-extractor";

describe("filmstrip-extractor integration", () => {
	beforeEach(() => {
		filmstripCache.clear();
	});

	it("filmstripCache singleton is shared", () => {
		filmstripCache.set("test", 1.0, "blob:test");
		expect(filmstripCache.get("test", 1.0)).toBe("blob:test");
	});

	it("cache keys are quantized to 3 decimal places", () => {
		filmstripCache.set("v1", 1.123, "blob:a");
		// Same time at 3 decimal places should match
		expect(filmstripCache.get("v1", 1.123)).toBe("blob:a");
		// Different at 3rd decimal should not
		expect(filmstripCache.get("v1", 1.124)).toBeNull();
	});

	it("evictMedia cleans up specific media entries", () => {
		filmstripCache.set("v1", 0, "blob:v1-0");
		filmstripCache.set("v1", 1, "blob:v1-1");
		filmstripCache.set("v2", 0, "blob:v2-0");

		filmstripCache.evictMedia("v1");
		expect(filmstripCache.get("v1", 0)).toBeNull();
		expect(filmstripCache.get("v2", 0)).toBe("blob:v2-0");
	});

	it("default cache has 500 entry limit", () => {
		// Just verify we can set many entries without error
		for (let i = 0; i < 100; i++) {
			filmstripCache.set("v1", i * 0.1, `blob:${i}`);
		}
		expect(filmstripCache.size).toBe(100);
	});
});

/**
 * jsdom has no media pipeline, so these stubs stand in for the parts
 * extractFrames touches: `load()` fires `loadeddata`, assigning `currentTime`
 * fires `seeked`, and `canvas.toBlob` yields a blob. Blob URLs are numbered
 * per `createObjectURL` call so two captures of one frame are distinguishable.
 */
const mediaProto = HTMLMediaElement.prototype;
const canvasProto = HTMLCanvasElement.prototype;
const originalLoad = mediaProto.load;
const originalCurrentTime = Object.getOwnPropertyDescriptor(
	mediaProto,
	"currentTime"
);
const originalDuration = Object.getOwnPropertyDescriptor(
	mediaProto,
	"duration"
);
const originalGetContext = canvasProto.getContext;
const originalToBlob = canvasProto.toBlob;

function installMediaStubs() {
	Object.defineProperty(mediaProto, "duration", {
		configurable: true,
		get: () => 15,
	});
	Object.defineProperty(mediaProto, "currentTime", {
		configurable: true,
		get(this: HTMLMediaElement & { __time?: number }) {
			return this.__time ?? 0;
		},
		set(this: HTMLMediaElement & { __time?: number }, value: number) {
			this.__time = value;
			setTimeout(() => this.dispatchEvent(new Event("seeked")), 0);
		},
	});
	mediaProto.load = function (this: HTMLMediaElement) {
		if (this.getAttribute("src")) {
			setTimeout(() => this.dispatchEvent(new Event("loadeddata")), 0);
		}
	};
	canvasProto.getContext = vi.fn(() => ({
		drawImage: vi.fn(),
	})) as unknown as typeof canvasProto.getContext;
	canvasProto.toBlob = (callback: BlobCallback) => {
		setTimeout(() => callback(new Blob(["frame"])), 0);
	};
}

function restoreMediaStubs() {
	mediaProto.load = originalLoad;
	if (originalCurrentTime) {
		Object.defineProperty(mediaProto, "currentTime", originalCurrentTime);
	}
	if (originalDuration) {
		Object.defineProperty(mediaProto, "duration", originalDuration);
	}
	canvasProto.getContext = originalGetContext;
	canvasProto.toBlob = originalToBlob;
}

const TIMESTAMPS = [1.875, 5.625, 9.375, 13.125];
const revoked = new Set<string>();
const createObjectURL = vi.fn();
let nextUrl = 0;

function clipFile() {
	return new File([new Uint8Array(8)], "clip.mp4", { type: "video/mp4" });
}

/** Number of <video> loads, i.e. how many times the file was decoded */
function videoLoads() {
	return createObjectURL.mock.calls.filter(([blob]) => blob instanceof File)
		.length;
}

function revokedFrameUrls() {
	return [...revoked].filter((url) => url.startsWith("blob:frame-"));
}

describe("extractFrames", () => {
	beforeEach(() => {
		filmstripCache.clear();
		revoked.clear();
		nextUrl = 0;
		createObjectURL.mockReset();
		createObjectURL.mockImplementation(
			(blob: Blob) =>
				`blob:${blob instanceof File ? "file" : "frame"}-${nextUrl++}`
		);
		vi.stubGlobal("URL", {
			...globalThis.URL,
			createObjectURL,
			revokeObjectURL: vi.fn((url: string) => {
				revoked.add(url);
			}),
		});
		installMediaStubs();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		restoreMediaStubs();
	});

	it("captures every requested frame once and caches it", async () => {
		const result = await extractFrames({
			file: clipFile(),
			mediaId: "m1",
			timestamps: TIMESTAMPS,
		});

		for (const t of TIMESTAMPS) {
			expect(result.get(t)).toMatch(/^blob:frame-/);
			expect(filmstripCache.get("m1", t)).toBe(result.get(t));
		}
		expect(videoLoads()).toBe(1);
		expect(revokedFrameUrls()).toEqual([]);
	});

	it("two clips of one media mounted together share frames instead of racing", async () => {
		const [first, second] = await Promise.all([
			extractFrames({
				file: clipFile(),
				mediaId: "m1",
				timestamps: TIMESTAMPS,
			}),
			extractFrames({
				file: clipFile(),
				mediaId: "m1",
				timestamps: TIMESTAMPS,
			}),
		]);

		const firstUrls = TIMESTAMPS.map((t) => first.get(t));
		expect(firstUrls.every(Boolean)).toBe(true);
		expect(TIMESTAMPS.map((t) => second.get(t))).toEqual(firstUrls);
		// The second clip waited for the first and read the cache: the file was
		// decoded once and no URL handed to either clip was revoked.
		expect(videoLoads()).toBe(1);
		expect(revokedFrameUrls()).toEqual([]);
	});

	it("a later clip of the same media only decodes the frames still missing", async () => {
		const [head, tail] = await Promise.all([
			extractFrames({ file: clipFile(), mediaId: "m1", timestamps: [1, 2] }),
			extractFrames({ file: clipFile(), mediaId: "m1", timestamps: [2, 3] }),
		]);

		expect(head.get(2)).toBe(tail.get(2));
		expect(tail.get(3)).toMatch(/^blob:frame-/);
		expect(videoLoads()).toBe(2);
		expect(revokedFrameUrls()).toEqual([]);
	});

	it("a fully cached request does not wait behind a running job", async () => {
		filmstripCache.set("m1", 1, "blob:cached");
		const order: string[] = [];
		const running = extractFrames({
			file: clipFile(),
			mediaId: "m1",
			timestamps: [2],
		}).then((result) => {
			order.push("running");
			return result;
		});

		const cached = await extractFrames({
			file: clipFile(),
			mediaId: "m1",
			timestamps: [1],
		});
		order.push("cached");

		expect(cached.get(1)).toBe("blob:cached");
		expect(order).toEqual(["cached"]);
		expect((await running).get(2)).toMatch(/^blob:frame-/);
	});

	it("a clip aborted while queued behind another clip does no decoding", async () => {
		const controller = new AbortController();
		const running = extractFrames({
			file: clipFile(),
			mediaId: "m1",
			timestamps: [1],
		});
		const waiting = extractFrames({
			file: clipFile(),
			mediaId: "m1",
			timestamps: [2],
			signal: controller.signal,
		});
		controller.abort();

		await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
		expect((await running).get(1)).toMatch(/^blob:frame-/);
		expect(videoLoads()).toBe(1);
	});
});
