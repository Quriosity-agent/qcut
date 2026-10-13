import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIndependentSourceEvidenceReader } from "../independent-source-evidence";

const mocks = vi.hoisted(() => ({
	frames: [] as Array<{ timestamp: number; duration: number; pixel: number }>,
	options: vi.fn(),
	range: vi.fn(),
	dispose: vi.fn(),
	open: vi.fn(),
	decode: true,
	stall: false,
	contextMissing: false,
	pixel: 0,
}));

vi.mock("mediabunny", () => ({
	ALL_FORMATS: [],
	BlobSource: class {},
	UrlSource: class {},
	Input: class {
		dispose = mocks.dispose;
		async getPrimaryVideoTrack() {
			mocks.open();
			if (mocks.stall) await new Promise(() => {});
			return { canDecode: async () => mocks.decode };
		}
	},
	CanvasSink: class {
		constructor(_track: unknown, options: unknown) {
			mocks.options(options);
		}
		async *canvases(start: number, end: number) {
			mocks.range(start, end);
			for (const frame of mocks.frames)
				yield { ...frame, canvas: { pixel: frame.pixel } };
		}
	},
}));

const drawImage = vi.fn((source: unknown) => {
	mocks.pixel = (source as { pixel: number }).pixel;
});

function getContext(
	this: HTMLCanvasElement,
	contextId: "2d"
): CanvasRenderingContext2D | null;
function getContext(
	this: HTMLCanvasElement,
	contextId: "webgpu"
): GPUCanvasContext | null;
function getContext(
	this: HTMLCanvasElement,
	contextId: string
): CanvasRenderingContext2D | GPUCanvasContext | null {
	if (contextId !== "2d" || mocks.contextMissing) return null;
	return {
		clearRect: vi.fn(),
		drawImage,
		getImageData: (_x: number, _y: number, width: number, height: number) => ({
			data: Uint8ClampedArray.from(
				{ length: width * height * 4 },
				(_value, index) => (index % 4 === 3 ? 0 : mocks.pixel)
			),
		}),
	} as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.frames = [1.5, 1.8, 1.91, 2, 2.04, 2.13, 2.25].map(
		(timestamp, index) => ({ timestamp, duration: 0.04, pixel: index + 1 })
	);
	mocks.decode = true;
	mocks.stall = false;
	mocks.contextMissing = false;
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
		getContext
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

const target = { width: 2, height: 1, timestampSeconds: 2 };
const reader = () =>
	createIndependentSourceEvidenceReader({ source: new Blob(["video"]) })!;

describe("independent bidirectional source evidence", () => {
	it("uses the nearest two actual PTS on either side and preserves the target processing geometry", async () => {
		const result = await reader()(target);
		expect(result.status).toBe("available");
		if (result.status !== "available") throw new Error(result.reason);
		expect(result.targetTimestampSeconds).toBe(2);
		expect(result.frames.map((frame) => frame.timestampSeconds)).toEqual([
			1.8, 1.91, 2.04, 2.13,
		]);
		expect(result.frames.map((frame) => Array.from(frame.rgba))).toEqual(
			[2, 3, 5, 6].map((pixel) => [
				pixel,
				pixel,
				pixel,
				255,
				pixel,
				pixel,
				pixel,
				255,
			])
		);
		expect(mocks.options).toHaveBeenCalledWith({ poolSize: 1 });
		expect(drawImage).toHaveBeenCalledWith({ pixel: 6 }, 0, 0, 2, 1);
		expect(mocks.range).toHaveBeenCalledWith(1.5, 2.500001);
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});

	it("deduplicates repeated PTS without treating duplicate output frames as new source observations", async () => {
		mocks.frames.splice(3, 0, { ...mocks.frames[2] });
		mocks.frames.splice(6, 0, { ...mocks.frames[5] });
		const result = await reader()(target);
		expect(result.status).toBe("available");
		if (result.status === "available")
			expect(result.frames.map((frame) => frame.timestampSeconds)).toEqual([
				1.8, 1.91, 2.04, 2.13,
			]);
	});

	it.each([
		[1.91, 2, 2.04, 2.13],
		[1.8, 1.91, 2, 2.04],
		[1.8, 1.91, 2.04, 2.13],
		[1.4, 1.8, 2, 2.04, 2.13],
		[1.8, 1.91, 2, 2.04, 2.51],
	])("does not manufacture missing target/neighbors: %j", async (...timestamps) => {
		mocks.frames = timestamps.map((timestamp) => ({
			timestamp,
			duration: 0.04,
			pixel: 1,
		}));
		await expect(reader()(target)).resolves.toMatchObject({
			status: "unavailable",
			reason: expect.stringContaining("Two distinct"),
		});
	});

	it("rejects a seek time inside a source frame instead of pretending it is decoded PTS", async () => {
		await expect(
			reader()({ ...target, timestampSeconds: 2.01 })
		).resolves.toMatchObject({ status: "unavailable" });
	});

	it.each([
		"descending",
		"duration",
		"nonfinite",
	])("rejects malformed %s timing", async (kind) => {
		if (kind === "descending") mocks.frames[2].timestamp = 1.7;
		if (kind === "duration") mocks.frames[1].duration = 0;
		if (kind === "nonfinite") mocks.frames[1].timestamp = Number.NaN;
		await expect(reader()(target)).resolves.toMatchObject({
			status: "unavailable",
			reason: expect.stringContaining("timing"),
		});
	});

	it("does not downscale four 4K frames to fit the evidence budget", async () => {
		await expect(
			reader()({ ...target, width: 2160, height: 3840 })
		).resolves.toMatchObject({
			status: "unavailable",
			reason: expect.stringContaining("byte budget"),
		});
		expect(mocks.open).not.toHaveBeenCalled();
	});

	it.each([
		{ width: 0 },
		{ width: 4097 },
		{ timestampSeconds: -1 },
	])("rejects invalid dimensions/time before decoding: %j", async (change) => {
		await expect(reader()({ ...target, ...change })).resolves.toMatchObject({
			status: "unavailable",
		});
		expect(mocks.open).not.toHaveBeenCalled();
	});

	it.each([
		"track",
		"pixels",
	])("reports unavailable %s evidence so a single-candidate target may still render", async (failure) => {
		mocks.decode = failure !== "track";
		mocks.contextMissing = failure === "pixels";
		await expect(reader()(target)).resolves.toMatchObject({
			status: "unavailable",
		});
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});

	it.each([
		new Error(""),
		"",
	])("keeps unavailable evidence valid for an empty decoder error: %j", async (error) => {
		mocks.open.mockImplementationOnce(() => {
			throw error;
		});
		await expect(reader()(target)).resolves.toMatchObject({
			status: "unavailable",
			reason: "Source evidence decode failed",
		});
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});

	it("limits malicious or malformed streams with repeated source timestamps", async () => {
		mocks.frames = Array.from({ length: 257 }, () => ({
			timestamp: 1.8,
			duration: 0.04,
			pixel: 1,
		}));
		await expect(reader()(target)).resolves.toMatchObject({
			status: "unavailable",
			reason: expect.stringContaining("decode limit"),
		});
	});

	it("does not share frame evidence between independent requests", async () => {
		const read = reader();
		const first = await read(target);
		mocks.frames = [];
		await expect(read(target)).resolves.toMatchObject({
			status: "unavailable",
		});
		expect(first.status).toBe("available");
		expect(mocks.open).toHaveBeenCalledTimes(2);
	});

	it.each([
		"abort",
		"timeout",
	])("settles %s even when decoder disposal cannot resolve a pending read", async (kind) => {
		vi.useFakeTimers();
		mocks.stall = true;
		const controller = new AbortController();
		const pending = reader()({ ...target, signal: controller.signal });
		const check =
			kind === "abort"
				? expect(pending).rejects.toThrow("Obsolete target")
				: expect(pending).resolves.toMatchObject({
						status: "unavailable",
						reason: expect.stringContaining("timed out"),
					});
		await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
		if (kind === "abort") controller.abort(new Error("Obsolete target"));
		else await vi.advanceTimersByTimeAsync(10_000);
		await check;
		expect(mocks.dispose).toHaveBeenCalledOnce();
		mocks.stall = false;
		await expect(reader()(target)).resolves.toMatchObject({
			status: "available",
		});
	});

	it("accepts local media sources and declines arbitrary remote URLs", () => {
		expect(
			createIndependentSourceEvidenceReader({
				source: "app://local-media/source.mp4",
			})
		).toBeTypeOf("function");
		expect(
			createIndependentSourceEvidenceReader({ source: "blob:source" })
		).toBeTypeOf("function");
		expect(
			createIndependentSourceEvidenceReader({
				source: "https://example.com/source.mp4",
			})
		).toBeUndefined();
	});
});
