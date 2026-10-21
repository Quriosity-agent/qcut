import { describe, expect, it, vi } from "vitest";
import { createCanvasPlaybackReader } from "../canvas-composition-playback-reader";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function bitmap({ width = 2, height = 2 } = {}) {
	return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function fixture({ capacity = 2 }: { capacity?: number } = {}) {
	const decoded: ImageBitmap[] = [];
	const read = vi.fn(
		async (_request: { frame: number; signal: AbortSignal }) =>
			new Blob(["png"], { type: "image/png" })
	);
	const decode = vi.fn(async (_blob: Blob) => {
		const image = bitmap();
		decoded.push(image);
		return image;
	});
	const reader = createCanvasPlaybackReader({
		cache: { read },
		width: 2,
		height: 2,
		frames: 20,
		decode,
		maxFrames: 6,
		maxBytes: capacity * 16,
	});
	return { reader, read, decode, decoded };
}

describe("composition playback bitmap reader", () => {
	it("bounds decoded frames by bytes and closes frames left behind", async () => {
		const { reader, read, decoded } = fixture();
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(reader.get({ frame: 1 })).toBeDefined());
		expect(read.mock.calls.map(([request]) => request.frame)).toEqual([0, 1]);
		expect(reader.stats).toMatchObject({ frames: 2, bytes: 32, maxFrames: 2 });
		reader.setTarget({ frame: 1 });
		await vi.waitFor(() => expect(reader.get({ frame: 2 })).toBeDefined());
		expect(decoded[0].close).toHaveBeenCalledOnce();
		expect(reader.get({ frame: 0 })).toBeUndefined();
		expect(reader.stats.bytes).toBe(32);
		reader.dispose();
		expect(
			decoded.every((image) => vi.mocked(image.close).mock.calls.length === 1)
		).toBe(true);
	});

	it("closes an obsolete decode before filling a new seek window", async () => {
		const { reader, decode, read } = fixture({ capacity: 1 });
		const pending = deferred<ImageBitmap>();
		decode.mockReturnValueOnce(pending.promise);
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
		expect(reader.stats.frames).toBe(1);
		reader.setTarget({ frame: 12 });
		expect(decode).toHaveBeenCalledOnce();
		const stale = bitmap();
		pending.resolve(stale);
		await vi.waitFor(() => expect(reader.get({ frame: 12 })).toBeDefined());
		expect(stale.close).toHaveBeenCalledOnce();
		expect(reader.get({ frame: 0 })).toBeUndefined();
		expect(read.mock.calls.map(([request]) => request.frame)).toEqual([0, 12]);
		expect(reader.stats.bytes).toBeLessThanOrEqual(16);
		reader.dispose();
	});

	it("skips decoding an obsolete disk read and respects the final clip frame", async () => {
		const { reader, decode, read } = fixture({ capacity: 1 });
		const pending = deferred<Blob>();
		read.mockReturnValueOnce(pending.promise);
		reader.setTarget({ frame: 0 });
		reader.setTarget({ frame: 99 });
		pending.resolve(new Blob(["stale"]));
		await vi.waitFor(() => expect(reader.get({ frame: 19 })).toBeDefined());
		expect(decode).toHaveBeenCalledOnce();
		expect(read.mock.calls.map(([request]) => request.frame)).toEqual([0, 19]);
		expect(reader.stats.frames).toBe(1);
		reader.dispose();
	});

	it("cancels reads waiting for an old segment and admits the new seek after they settle", async () => {
		const { reader, read, decode } = fixture();
		read.mockImplementation(({ frame, signal }) => {
			if (frame >= 10) return Promise.resolve(new Blob([String(frame)]));
			return new Promise<Blob>((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			});
		});
		reader.setTarget({ frame: 0 });
		expect(reader.stats.inFlightFrames).toBe(2);
		reader.setTarget({ frame: 10 });
		expect(read.mock.calls.map(([request]) => request.frame)).toEqual([0, 1]);
		expect(read.mock.calls.every(([request]) => request.signal.aborted)).toBe(
			true
		);
		expect(reader.stats.inFlightFrames).toBe(2);
		await vi.waitFor(() => expect(reader.get({ frame: 11 })).toBeDefined());
		expect(read.mock.calls.map(([request]) => request.frame)).toEqual([
			0, 1, 10, 11,
		]);
		expect(
			read.mock.calls.slice(2).every(([request]) => !request.signal.aborted)
		).toBe(true);
		expect(decode).toHaveBeenCalledTimes(2);
		expect(reader.stats).toMatchObject({ frames: 2, bytes: 32 });
		expect(reader.error).toBeUndefined();
		reader.dispose();
	});

	it("discards a cancelled decode even if another seek wants its frame again", async () => {
		const { reader, decode, read } = fixture({ capacity: 1 });
		const pending = deferred<ImageBitmap>();
		decode.mockReturnValueOnce(pending.promise);
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
		reader.setTarget({ frame: 10 });
		reader.setTarget({ frame: 0 });
		expect(read).toHaveBeenCalledOnce();
		expect(reader.stats).toMatchObject({ frames: 1, inFlightFrames: 1 });
		const stale = bitmap();
		pending.resolve(stale);
		await vi.waitFor(() => expect(reader.get({ frame: 0 })).toBeDefined());
		expect(stale.close).toHaveBeenCalledOnce();
		expect(reader.get({ frame: 0 })).not.toBe(stale);
		expect(read.mock.calls.map(([request]) => request.frame)).toEqual([0, 0]);
		expect(reader.error).toBeUndefined();
		reader.dispose();
	});

	it("does not turn a cancelled segment's late error into a reader failure", async () => {
		const { reader, read } = fixture({ capacity: 1 });
		const pending = deferred<Blob>();
		read.mockReturnValueOnce(pending.promise);
		reader.setTarget({ frame: 0 });
		reader.setTarget({ frame: 10 });
		pending.reject(new Error("Old segment was removed"));
		await vi.waitFor(() => expect(reader.get({ frame: 10 })).toBeDefined());
		expect(reader.error).toBeUndefined();
		reader.dispose();
	});

	it("closes published bitmaps and stops on a current segment read error", async () => {
		const { reader, read, decoded } = fixture();
		const pending = deferred<Blob>();
		read.mockResolvedValueOnce(new Blob(["first"]));
		read.mockReturnValueOnce(pending.promise);
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(reader.get({ frame: 0 })).toBeDefined());
		const failure = new Error("Current cache read failed");
		pending.reject(failure);
		await vi.waitFor(() => expect(reader.error).toBe(failure));
		expect(decoded[0].close).toHaveBeenCalledOnce();
		expect(reader.stats.frames).toBe(0);
		reader.setTarget({ frame: 10 });
		expect(read).toHaveBeenCalledTimes(2);
		reader.dispose();
	});

	it("aborts a pending read and never decodes or notifies after disposal", async () => {
		const { reader, read, decode } = fixture({ capacity: 1 });
		const pending = deferred<Blob>();
		const changed = vi.fn();
		read.mockReturnValueOnce(pending.promise);
		reader.subscribe({ onChange: changed });
		reader.setTarget({ frame: 0 });
		reader.dispose();
		expect(read.mock.calls[0][0].signal.aborted).toBe(true);
		pending.resolve(new Blob(["late"]));
		await Promise.resolve();
		await Promise.resolve();
		expect(decode).not.toHaveBeenCalled();
		expect(changed).not.toHaveBeenCalled();
		expect(reader.error).toBeUndefined();
		reader.setTarget({ frame: 10 });
		expect(read).toHaveBeenCalledOnce();
	});

	it("closes a decode completing after disposal exactly once", async () => {
		const { reader, decode } = fixture({ capacity: 1 });
		const pending = deferred<ImageBitmap>();
		decode.mockReturnValueOnce(pending.promise);
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
		reader.dispose();
		reader.dispose();
		const late = bitmap();
		pending.resolve(late);
		await vi.waitFor(() => expect(late.close).toHaveBeenCalledOnce());
		expect(reader.stats.frames).toBe(0);
		expect(reader.get({ frame: 0 })).toBeUndefined();
	});

	it("closes wrong-sized pixels and exposes the failure without retrying forever", async () => {
		const { reader, decode } = fixture({ capacity: 1 });
		const wrong = bitmap({ width: 3 });
		decode.mockResolvedValueOnce(wrong);
		const changed = vi.fn();
		reader.subscribe({ onChange: changed });
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(reader.error).toBeInstanceOf(Error));
		expect(wrong.close).toHaveBeenCalledOnce();
		expect(changed).toHaveBeenCalledOnce();
		reader.setTarget({ frame: 5 });
		expect(decode).toHaveBeenCalledOnce();
		expect(reader.stats.frames).toBe(0);
		reader.dispose();
	});

	it("counts the in-flight bitmap toward its memory budget", async () => {
		const { reader, decode } = fixture();
		const pending = deferred<ImageBitmap>();
		decode.mockImplementationOnce(async () => bitmap());
		decode.mockReturnValueOnce(pending.promise);
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
		expect(reader.stats).toMatchObject({ frames: 2, bytes: 32 });
		expect(reader.get({ frame: 0 })).toBeDefined();
		const image = bitmap();
		pending.resolve(image);
		await vi.waitFor(() => expect(reader.get({ frame: 1 })).toBe(image));
		expect(decode).toHaveBeenCalledTimes(2);
		reader.dispose();
	});

	it("refuses a budget smaller than one frame", () => {
		expect(() => fixture({ capacity: 0.5 })).toThrow("缓存容量");
	});
	it.each([
		{ width: 0 },
		{ width: Number.NaN },
		{ height: 1.5 },
		{ frames: 0 },
		{ frames: Number.POSITIVE_INFINITY },
		{ maxFrames: -1 },
		{ maxFrames: 1.2 },
		{ maxBytes: Number.NaN },
	])("rejects invalid dimensions or capacity %j", (change) => {
		expect(() =>
			createCanvasPlaybackReader({
				cache: { read: vi.fn() },
				width: 2,
				height: 2,
				frames: 20,
				...change,
			})
		).toThrow("Invalid playback cache");
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		-1,
		0.5,
	])("rejects invalid target %s without a disk read", (frame) => {
		const { reader, read } = fixture();
		expect(() => reader.setTarget({ frame })).toThrow("Invalid playback frame");
		expect(read).not.toHaveBeenCalled();
		reader.dispose();
	});
});
