import { describe, expect, it, vi } from "vitest";
import {
	createCanvasPlaybackReader,
	PLAYBACK_BITMAP_DECODE_CONCURRENCY,
} from "../canvas-composition-playback-reader";

function pending<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<Value>((accept, fail) => {
		resolve = accept;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function bitmap() {
	return { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap;
}

function fixture({ capacity = 6 }: { capacity?: number } = {}) {
	const sources = new WeakMap<Blob, number>();
	const decodes: Array<{
		frame: number;
		completion: ReturnType<typeof pending<ImageBitmap>>;
	}> = [];
	const read = vi.fn(
		async ({ frame }: { frame: number; signal: AbortSignal }) => {
			const blob = new Blob([String(frame)], { type: "image/png" });
			sources.set(blob, frame);
			return blob;
		}
	);
	const decode = vi.fn((blob: Blob) => {
		const completion = pending<ImageBitmap>();
		decodes.push({ frame: sources.get(blob)!, completion });
		return completion.promise;
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
	function finish({ index }: { index: number }) {
		const image = bitmap();
		decodes[index].completion.resolve(image);
		return image;
	}
	function dispose() {
		reader.dispose();
		for (const item of decodes) item.completion.resolve(bitmap());
	}
	return { reader, read, decode, decodes, finish, dispose };
}

describe("parallel playback read and decode reservations", () => {
	it("starts two lanes and fills lookahead while the target decode is delayed", async () => {
		const { reader, decode, decodes, finish, dispose } = fixture();
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
		expect(PLAYBACK_BITMAP_DECODE_CONCURRENCY).toBe(2);
		expect(decodes.map(({ frame }) => frame)).toEqual([0, 1]);
		expect(reader.stats).toMatchObject({ frames: 2, inFlightFrames: 2 });
		const second = finish({ index: 1 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(3));
		expect(reader.get({ frame: 0 })).toBeUndefined();
		expect(reader.get({ frame: 1 })).toBe(second);
		expect(decodes[2].frame).toBe(2);
		expect(reader.stats).toMatchObject({ frames: 3, inFlightFrames: 2 });
		finish({ index: 0 });
		finish({ index: 2 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(5));
		expect(reader.stats.frames).toBeLessThanOrEqual(6);
		expect(reader.stats.inFlightFrames).toBe(2);
		dispose();
	});

	it("reserves capacity before disk reads, including reads that have not decoded yet", async () => {
		const reads = [pending<Blob>(), pending<Blob>()];
		const read = vi.fn(({ frame }: { frame: number; signal: AbortSignal }) => {
			return reads[frame].promise;
		});
		const decode = vi.fn(async () => bitmap());
		const reader = createCanvasPlaybackReader({
			cache: { read },
			width: 2,
			height: 2,
			frames: 20,
			maxFrames: 6,
			maxBytes: 32,
			decode,
		});
		reader.setTarget({ frame: 0 });
		expect(read).toHaveBeenCalledTimes(2);
		expect(decode).not.toHaveBeenCalled();
		expect(reader.stats).toMatchObject({
			frames: 2,
			bytes: 32,
			inFlightFrames: 2,
		});
		reader.setTarget({ frame: 10 });
		expect(read).toHaveBeenCalledTimes(2);
		reader.dispose();
		for (const item of reads) item.resolve(new Blob(["stale"]));
		await vi.waitFor(() => expect(reader.stats.frames).toBe(0));
		expect(decode).not.toHaveBeenCalled();
	});

	it("does not release obsolete decode reservations early when repeated seeks race", async () => {
		const { reader, decode, read, decodes, finish, dispose } = fixture({
			capacity: 2,
		});
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
		reader.setTarget({ frame: 10 });
		reader.setTarget({ frame: 10 });
		expect(read).toHaveBeenCalledTimes(2);
		const oldFirst = finish({ index: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(3));
		expect(decodes[2].frame).toBe(10);
		expect(reader.stats).toMatchObject({ frames: 2, bytes: 32 });
		reader.setTarget({ frame: 11 });
		const oldSecond = finish({ index: 1 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(4));
		expect(decodes[3].frame).toBe(11);
		const obsoleteSeek = finish({ index: 2 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(5));
		expect(decodes[4].frame).toBe(12);
		expect(reader.stats.frames).toBe(2);
		const current = finish({ index: 3 });
		finish({ index: 4 });
		await vi.waitFor(() => expect(reader.get({ frame: 11 })).toBe(current));
		for (const old of [oldFirst, oldSecond, obsoleteSeek])
			expect(old.close).toHaveBeenCalledOnce();
		expect(reader.get({ frame: 10 })).toBeUndefined();
		expect(read.mock.calls.map(([request]) => request.frame)).toEqual([
			0, 1, 10, 11, 12,
		]);
		dispose();
	});

	it("keeps a replacement reservation when a publication listener seeks away and back", async () => {
		const { reader, decode, read, decodes, finish, dispose } = fixture({
			capacity: 2,
		});
		let changed = false;
		reader.subscribe({
			onChange: () => {
				if (changed || !reader.get({ frame: 0 })) return;
				changed = true;
				reader.setTarget({ frame: 19 });
				reader.setTarget({ frame: 0 });
			},
		});
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
		finish({ index: 1 });
		await vi.waitFor(() => expect(reader.get({ frame: 1 })).toBeDefined());
		finish({ index: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(4));
		expect(decodes.map(({ frame }) => frame)).toEqual([0, 1, 0, 1]);
		expect(read.mock.calls.map(([request]) => request.frame)).toEqual([
			0, 1, 19, 0, 1,
		]);
		expect(reader.stats).toMatchObject({ frames: 2, inFlightFrames: 2 });
		dispose();
	});

	it("aborts peer reads on failure and closes a peer decode that completes late", async () => {
		const { reader, decode, read, decodes, finish, dispose } = fixture();
		const changed = vi.fn();
		reader.subscribe({ onChange: changed });
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
		decodes[0].completion.reject(new Error("PNG decode failed"));
		await vi.waitFor(() =>
			expect(reader.error?.message).toBe("PNG decode failed")
		);
		expect(reader.stats.inFlightFrames).toBe(1);
		expect(read.mock.calls.every(([request]) => request.signal.aborted)).toBe(
			true
		);
		const late = finish({ index: 1 });
		await vi.waitFor(() => expect(late.close).toHaveBeenCalledOnce());
		expect(reader.stats.frames).toBe(0);
		expect(reader.get({ frame: 1 })).toBeUndefined();
		expect(changed).toHaveBeenCalledOnce();
		reader.setTarget({ frame: 5 });
		expect(read).toHaveBeenCalledTimes(2);
		dispose();
	});

	it("closes both late decodes after disposal without publishing or replacing their reservations", async () => {
		const { reader, decode, finish } = fixture();
		const changed = vi.fn();
		reader.subscribe({ onChange: changed });
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
		reader.dispose();
		reader.dispose();
		expect(reader.stats.frames).toBe(2);
		const images = [finish({ index: 1 }), finish({ index: 0 })];
		await vi.waitFor(() => expect(reader.stats.frames).toBe(0));
		for (const image of images) expect(image.close).toHaveBeenCalledOnce();
		expect(changed).not.toHaveBeenCalled();
	});

	it("uses one lane when only one decoded frame fits the byte budget", async () => {
		const { reader, decode, finish, dispose } = fixture({ capacity: 1 });
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
		expect(reader.stats.frames).toBe(1);
		finish({ index: 0 });
		await vi.waitFor(() => expect(reader.get({ frame: 0 })).toBeDefined());
		expect(decode).toHaveBeenCalledOnce();
		reader.setTarget({ frame: 1 });
		await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
		expect(reader.stats.frames).toBe(1);
		dispose();
	});
});
