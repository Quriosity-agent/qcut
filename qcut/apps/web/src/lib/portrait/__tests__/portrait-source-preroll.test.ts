import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPortraitSourcePreRollReader } from "../portrait-source-preroll";

const mocks = vi.hoisted(() => ({
	dispose: vi.fn(),
	options: vi.fn(),
	url: vi.fn<(url: string, options: { getRetryDelay: () => null }) => void>(),
	blob: vi.fn(),
	frames: [] as { timestamp: number; duration: number; pixel: number }[],
	decode: true,
	missingTrack: false,
	missingContext: false,
	decodeDelay: 0,
	waitForTrack: false,
	rejectTrack: null as ((error: Error) => void) | null,
}));
vi.mock("mediabunny", () => ({
	ALL_FORMATS: [],
	BlobSource: class {
		constructor(blob: Blob) {
			mocks.blob(blob);
		}
	},
	UrlSource: class {
		constructor(url: string, options: { getRetryDelay: () => null }) {
			mocks.url(url, options);
		}
	},
	Input: class {
		dispose = mocks.dispose;
		async getPrimaryVideoTrack() {
			if (mocks.waitForTrack)
				await new Promise((_resolve, reject) => {
					mocks.rejectTrack = reject;
				});
			return mocks.missingTrack
				? null
				: { canDecode: async () => mocks.decode };
		}
	},
	CanvasSink: class {
		constructor(_track: unknown, options: unknown) {
			mocks.options(options);
		}
		async *canvases() {
			if (mocks.decodeDelay)
				await new Promise((resolve) => setTimeout(resolve, mocks.decodeDelay));
			for (const frame of mocks.frames)
				yield {
					...frame,
					canvas: {
						getContext: () =>
							mocks.missingContext
								? null
								: {
										getImageData: () => ({
											data: new Uint8ClampedArray([frame.pixel, 0, 0, 255]),
										}),
									},
					},
				};
		}
	},
}));
beforeEach(() => {
	vi.clearAllMocks();
	mocks.frames = [
		{ timestamp: 1.8, duration: 0.1, pixel: 18 },
		{ timestamp: 1.9, duration: 0.1, pixel: 19 },
		{ timestamp: 2, duration: 0.1, pixel: 20 },
	];
	mocks.decode = true;
	mocks.missingTrack = false;
	mocks.missingContext = false;
	mocks.decodeDelay = 0;
	mocks.waitForTrack = false;
	mocks.rejectTrack = null;
	mocks.dispose.mockImplementation(() => {
		mocks.rejectTrack?.(new Error("input disposed"));
	});
});
afterEach(() => vi.useRealTimers());
const target = {
	width: 1,
	height: 1,
	timestampSeconds: 2.05,
	sourceKey: "video:A",
};

describe("portrait local causal decoder", () => {
	it("uses real PTS and excludes the frame containing currentTime", async () => {
		const reader = createPortraitSourcePreRollReader({
			source: "blob:video-A",
			fit: "contain",
		})!;
		const result = await reader(target);
		expect(
			result?.frames.map(({ timestampSeconds }) => timestampSeconds)
		).toEqual([1.8, 1.9]);
		expect(result?.frames.map(({ rgba }) => rgba[0])).toEqual([18, 19]);
		expect(result?.sourceKey).toBe("video:A");
		expect(mocks.url.mock.calls[0][0]).toBe("blob:video-A");
		expect(mocks.url.mock.calls[0][1].getRetryDelay()).toBeNull();
		expect(mocks.options).toHaveBeenCalledWith({
			width: 1,
			height: 1,
			fit: "contain",
			alpha: true,
			poolSize: 1,
		});
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});
	it("retains only the last bounded contiguous frames, without inventing samples", async () => {
		mocks.frames = Array.from({ length: 20 }, (_, index) => ({
			timestamp: 1.8 + index / 100,
			duration: 0.01,
			pixel: index,
		}));
		const result = await createPortraitSourcePreRollReader({
			source: "blob:video",
		})!(target);
		expect(result?.frames).toHaveLength(16);
		expect(result?.frames[0].rgba[0]).toBe(4);
		expect(result?.frames.at(-1)?.rgba[0]).toBe(19);
	});
	it("bounds retained frames by bytes at 1080p", async () => {
		mocks.frames = Array.from({ length: 12 }, (_, index) => ({
			timestamp: 1.8 + index / 100,
			duration: 0.01,
			pixel: index,
		}));
		const result = await createPortraitSourcePreRollReader({
			source: "blob:video",
		})!({ ...target, width: 1920, height: 1080 });
		expect(result?.frames).toHaveLength(8);
	});
	it("does not access remote media or guess a source for still frames", () => {
		expect(
			createPortraitSourcePreRollReader({
				source: "https://example.com/video.mp4",
			})
		).toBeUndefined();
		expect(
			createPortraitSourcePreRollReader({ source: "image.png" })
		).toBeUndefined();
		expect(mocks.url).not.toHaveBeenCalled();
	});
	it("closes unsupported decoders", async () => {
		mocks.decode = false;
		expect(
			await createPortraitSourcePreRollReader({
				source: "app://local-media/video",
			})!(target)
		).toBeUndefined();
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});
	it.each([
		{ timestampSeconds: 0 },
		{ timestampSeconds: -1 },
		{ width: 10_000, height: 10_000 },
	])("does not open an input without a usable history budget: %j", async (change) => {
		const result = await createPortraitSourcePreRollReader({
			source: "blob:video",
		})!({ ...target, ...change });
		expect(result).toBeUndefined();
		expect(mocks.url).not.toHaveBeenCalled();
		expect(mocks.dispose).not.toHaveBeenCalled();
	});
	it("reads a local Blob without creating a URL source", async () => {
		const blob = new Blob(["synthetic video"], { type: "video/mp4" });
		const result = await createPortraitSourcePreRollReader({ source: blob })!(
			target
		);
		expect(result?.frames).toHaveLength(2);
		expect(mocks.blob).toHaveBeenCalledWith(blob);
		expect(mocks.url).not.toHaveBeenCalled();
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});
	it("closes an input without a primary video track", async () => {
		mocks.missingTrack = true;
		expect(
			await createPortraitSourcePreRollReader({ source: "blob:video" })!(target)
		).toBeUndefined();
		expect(mocks.options).not.toHaveBeenCalled();
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});
	it("rejects unreadable canvas pixels and releases the input", async () => {
		mocks.missingContext = true;
		await expect(
			createPortraitSourcePreRollReader({ source: "blob:video" })!(target)
		).rejects.toThrow("Unable to read portrait source pre-roll pixels");
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});
	it.each([
		0,
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("does not retain frames with invalid duration %s", async (duration) => {
		mocks.frames = [{ timestamp: 1.9, duration, pixel: 19 }];
		expect(
			await createPortraitSourcePreRollReader({ source: "blob:video" })!(target)
		).toBeUndefined();
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});
	it.each([
		true,
		false,
	])("rejects a late decoder result with frames=%s", async (hasFrames) => {
		vi.useFakeTimers();
		mocks.decodeDelay = 10_001;
		if (!hasFrames) mocks.frames = [];
		const operation = createPortraitSourcePreRollReader({
			source: "blob:video",
		})!(target);
		const rejected = expect(operation).rejects.toThrow("decode timed out");
		await vi.waitFor(() => expect(mocks.options).toHaveBeenCalledOnce());
		await vi.advanceTimersByTimeAsync(10_001);
		await rejected;
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});
	it("does not open a decoder after cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			createPortraitSourcePreRollReader({ source: "blob:video" })!({
				...target,
				signal: controller.signal,
			})
		).rejects.toThrow();
		expect(mocks.url).not.toHaveBeenCalled();
	});
	it("fails closed on excessive frame counts and still releases the decoder", async () => {
		mocks.frames = Array.from({ length: 257 }, (_, index) => ({
			timestamp: 1.8 + index / 1000,
			duration: 0.001,
			pixel: index,
		}));
		await expect(
			createPortraitSourcePreRollReader({ source: "blob:video" })!(target)
		).rejects.toThrow("decode limit");
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});
	it.each([
		"abort",
		"deadline",
	])("closes a stalled decoder on %s", async (reason) => {
		vi.useFakeTimers();
		mocks.waitForTrack = true;
		const controller = new AbortController();
		const operation = createPortraitSourcePreRollReader({
			source: "blob:video",
		})!({ ...target, signal: controller.signal });
		const rejected = expect(operation).rejects.toThrow("input disposed");
		await vi.waitFor(() => expect(mocks.rejectTrack).not.toBeNull());
		if (reason === "abort") controller.abort();
		else await vi.advanceTimersByTimeAsync(10_000);
		await rejected;
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});
});
