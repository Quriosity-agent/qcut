import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareCanvasPlaybackFrames } from "../canvas-composition-playback-preparation";
import { deferred, streamFixture } from "./canvas-playback-stream-fixtures";

vi.mock("../canvas-composition-playback-preparation", () => ({
	prepareCanvasPlaybackFrames: vi.fn(),
}));

const fixtures: ReturnType<typeof streamFixture>[] = [];
function fixture({
	frames,
	maxBytes,
}: {
	frames?: number;
	maxBytes?: number;
} = {}) {
	const value = streamFixture({ frames, maxBytes });
	fixtures.push(value);
	return value;
}

beforeEach(() => vi.resetAllMocks());
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((value) => value.dispose()));
});

describe("rolling composition playback preparation", () => {
	it("publishes the current segment before filling the two initial lookahead slots", async () => {
		const { stream, requestAt, requests, cache, plan, settle } = fixture();
		expect(prepareCanvasPlaybackFrames).not.toHaveBeenCalled();
		stream.setTarget({ frame: 0 });
		const ready = vi.fn();
		const waiting = stream.waitForTarget().then(ready);
		const first = await requestAt({ index: 0 });
		expect(first.request).toMatchObject({
			plan,
			startFrame: 0,
			frames: 2,
			backgroundColor: "#123456",
		});
		const firstBlob = await first.publish({ frame: 0 });
		expect(stream.stats.targetReady).toBe(false);
		expect(ready).not.toHaveBeenCalled();
		expect(
			await stream.read({ frame: 0, signal: new AbortController().signal })
		).toBe(firstBlob);
		await first.publish({ frame: 1 });
		first.gate.resolve();
		await waiting;
		expect(stream.stats.targetReady).toBe(true);
		const next = await requestAt({ index: 1 });
		expect(next.request).toMatchObject({ startFrame: 2, frames: 2 });
		await next.complete();
		const third = await requestAt({ index: 2 });
		expect(third.request).toMatchObject({ startFrame: 4, frames: 2 });
		expect(stream.stats.targetReady).toBe(true);
		await third.complete();
		await settle();
		expect(requests).toHaveLength(3);
		expect(cache.frameCount).toBe(6);
		expect(stream.stats).toMatchObject({
			segmentFrames: 2,
			preparedTotal: 6,
			residentFrames: 6,
			evictedTotal: 0,
			windowStart: 0,
			windowEnd: 6,
		});
		expect(stream.metrics).toMatchObject({
			renderMs: 60,
			encodeMs: 12,
			writeMs: 6,
			maxInFlightFrames: 2,
			maxReservedPixelBytes: 48,
			maxPendingPngBytes: 65_553,
		});
	});

	it("rolls a long clip within its byte budget and recomputes evicted frames on a backward seek", async () => {
		const value = fixture({ frames: 3600 });
		const { stream, requestAt, requests, cache, files, settle } = value;
		stream.setTarget({ frame: 0 });
		await (await requestAt({ index: 0 })).complete();
		await (await requestAt({ index: 1 })).complete();
		await (await requestAt({ index: 2 })).complete();
		await settle();
		stream.setTarget({ frame: 2 });
		await settle();
		expect(requests).toHaveLength(3);
		expect([...files.keys()]).toEqual([0, 1, 2, 3, 4, 5]);
		stream.setTarget({ frame: 4 });
		const forward = await requestAt({ index: 3 });
		expect(forward.request).toMatchObject({ startFrame: 6, frames: 2 });
		expect(cache.remove).toHaveBeenCalledWith({
			frames: [0, 1],
			signal: expect.any(AbortSignal),
		});
		await forward.complete();
		await settle();
		expect([...files.keys()]).toEqual([2, 3, 4, 5, 6, 7]);
		expect(value.peakBytes).toBeLessThanOrEqual(cache.maxBytes);
		stream.setTarget({ frame: 0 });
		const backward = await requestAt({ index: 4 });
		expect(backward.request).toMatchObject({ startFrame: 0, frames: 2 });
		expect([...files.keys()]).toEqual([2, 3, 4, 5]);
		await backward.complete();
		await stream.waitForTarget();
		await settle();
		expect(requests).toHaveLength(5);
		expect([...files.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(stream.stats).toMatchObject({
			residentFrames: 6,
			preparedTotal: 10,
			evictedTotal: 4,
		});
		expect(value.peakBytes).toBeLessThanOrEqual(cache.maxBytes);
	});

	it("retains the third segment when a fully prepared short clip returns to its start", async () => {
		const { stream, requestAt, requests, cache, files, settle } = fixture({
			frames: 6,
		});
		stream.setTarget({ frame: 0 });
		await (await requestAt({ index: 0 })).complete();
		await (await requestAt({ index: 1 })).complete();
		await (await requestAt({ index: 2 })).complete();
		await settle();
		const third = files.get(4);
		stream.setTarget({ frame: 4 });
		await settle();
		expect(cache.has({ frame: 0 })).toBe(false);
		stream.setTarget({ frame: 0 });
		const start = await requestAt({ index: 3 });
		expect(start.request).toMatchObject({ startFrame: 0, frames: 2 });
		await start.complete();
		await settle();
		expect(files.get(4)).toBe(third);
		stream.setTarget({ frame: 2 });
		await settle();
		stream.setTarget({ frame: 4 });
		await settle();
		expect(requests).toHaveLength(4);
		expect(
			cache.write.mock.calls.filter(([{ frame }]) => frame === 4)
		).toHaveLength(1);
		expect(stream.error).toBeUndefined();
	});

	it("aborts an obsolete segment and drains it before starting a distant target", async () => {
		const { stream, requestAt, requests, files, settle } = fixture({
			frames: 100,
		});
		stream.setTarget({ frame: 0 });
		const obsolete = await requestAt({ index: 0 });
		await obsolete.publish({ frame: 0 });
		stream.setTarget({ frame: 80 });
		expect(obsolete.request.signal.aborted).toBe(true);
		await Promise.resolve();
		expect(requests).toHaveLength(1);
		obsolete.gate.resolve();
		const target = await requestAt({ index: 1 });
		expect(target.request).toMatchObject({ startFrame: 80, frames: 2 });
		expect(files.size).toBe(0);
		await target.complete();
		await stream.waitForTarget();
		const next = await requestAt({ index: 2 });
		expect(next.request).toMatchObject({ startFrame: 82, frames: 2 });
		await next.complete();
		await settle();
		expect([...files.keys()]).toEqual([80, 81, 82, 83]);
		expect(stream.error).toBeUndefined();
	});

	it("stops obsolete prefetch when seeking back to an already prepared segment", async () => {
		const { stream, requestAt, requests, files, settle } = fixture();
		stream.setTarget({ frame: 2 });
		await (await requestAt({ index: 0 })).complete();
		await (await requestAt({ index: 1 })).complete();
		await settle();
		stream.setTarget({ frame: 4 });
		const obsolete = await requestAt({ index: 2 });
		await obsolete.publish({ frame: 6 });
		stream.setTarget({ frame: 2 });
		expect(stream.stats.targetReady).toBe(true);
		expect(obsolete.request.signal.aborted).toBe(true);
		obsolete.gate.resolve();
		await settle();
		expect(requests).toHaveLength(3);
		expect([...files.keys()]).toEqual([2, 3, 4, 5]);
		expect(stream.stats.evictedTotal).toBe(1);
		expect(stream.error).toBeUndefined();
	});

	it("fills a cancelled eviction hole without rewriting the surviving segment suffix", async () => {
		const { stream, requestAt, cache, files, settle } = fixture();
		stream.setTarget({ frame: 0 });
		await (await requestAt({ index: 0 })).complete();
		await (await requestAt({ index: 1 })).complete();
		await (await requestAt({ index: 2 })).complete();
		await settle();
		const retainedSuffix = files.get(1);
		const removal = deferred<void>();
		cache.remove.mockImplementationOnce(async ({ frames, signal }) => {
			files.delete(frames[0]);
			await removal.promise;
			signal.throwIfAborted();
		});
		stream.setTarget({ frame: 10 });
		await vi.waitFor(() => expect(cache.remove).toHaveBeenCalledOnce());
		expect(files.has(0)).toBe(false);
		expect(files.has(1)).toBe(true);
		stream.setTarget({ frame: 0 });
		removal.resolve();
		const repaired = await requestAt({ index: 3 });
		expect(repaired.request).toMatchObject({ startFrame: 0, frames: 2 });
		await repaired.complete();
		await stream.waitForTarget();
		await settle();
		expect(files.get(1)).toBe(retainedSuffix);
		expect(cache.write.mock.calls.map(([{ frame }]) => frame)).toEqual([
			0, 1, 2, 3, 4, 5, 0,
		]);
		expect(stream.stats).toMatchObject({
			preparedTotal: 7,
			evictedTotal: 1,
			residentFrames: 6,
			targetReady: true,
		});
		expect(stream.error).toBeUndefined();
	});

	it("cancels a waiting read without aborting preparation for other readers", async () => {
		const { stream, requestAt, cache, files } = fixture();
		stream.setTarget({ frame: 0 });
		const pending = await requestAt({ index: 0 });
		const reader = new AbortController();
		const rejected = expect(
			stream.read({ frame: 1, signal: reader.signal })
		).rejects.toMatchObject({ name: "AbortError" });
		reader.abort();
		await rejected;
		expect(pending.request.signal.aborted).toBe(false);
		expect(cache.read).not.toHaveBeenCalled();
		const other = stream.read({
			frame: 1,
			signal: new AbortController().signal,
		});
		await pending.complete();
		expect(await other).toBe(files.get(1));
		expect(stream.error).toBeUndefined();
	});

	it("suspends preparation for export, drains work, and resumes at the first missing absolute frame", async () => {
		const { stream, requestAt, requests, settle } = fixture();
		stream.setTarget({ frame: 4 });
		const first = await requestAt({ index: 0 });
		await first.publish({ frame: 4 });
		stream.setSuspended({ value: true });
		expect(first.request.signal.aborted).toBe(true);
		first.gate.resolve();
		await settle();
		expect(requests).toHaveLength(1);
		expect(stream.stats.targetReady).toBe(false);
		stream.setSuspended({ value: false });
		const resumed = await requestAt({ index: 1 });
		expect(resumed.request).toMatchObject({ startFrame: 5, frames: 1 });
		await resumed.complete();
		await stream.waitForTarget();
		const next = await requestAt({ index: 2 });
		expect(next.request).toMatchObject({ startFrame: 6, frames: 2 });
		await next.complete();
		await settle();
		expect(stream.stats.preparedTotal).toBe(4);
		expect(stream.error).toBeUndefined();
	});

	it("exposes preparation failure to all waiters and does not retry in a loop", async () => {
		const { stream, requestAt, requests, cache, settle } = fixture();
		stream.setTarget({ frame: 0 });
		const waiting = expect(stream.waitForTarget()).rejects.toThrow(
			"Native renderer unavailable"
		);
		const read = expect(
			stream.read({ frame: 1, signal: new AbortController().signal })
		).rejects.toThrow("Native renderer unavailable");
		const current = await requestAt({ index: 0 });
		await current.publish({ frame: 0 });
		const failure = new Error("Native renderer unavailable");
		current.gate.reject(failure);
		await Promise.all([waiting, read, settle()]);
		expect(stream.error).toBe(failure);
		expect(cache.frameCount).toBe(1);
		stream.setSuspended({ value: false });
		expect(() => stream.setTarget({ frame: 8 })).toThrow(failure);
		await Promise.resolve();
		expect(requests).toHaveLength(1);
	});

	it("stops on eviction failure without claiming the undeleted bytes were released", async () => {
		const { stream, requestAt, requests, cache, settle } = fixture();
		stream.setTarget({ frame: 0 });
		await (await requestAt({ index: 0 })).complete();
		await (await requestAt({ index: 1 })).complete();
		await (await requestAt({ index: 2 })).complete();
		await settle();
		const retainedBytes = cache.bytes;
		cache.remove.mockRejectedValueOnce(new Error("OPFS removal failed"));
		stream.setTarget({ frame: 10 });
		await expect(stream.waitForTarget()).rejects.toThrow("OPFS removal failed");
		await settle();
		expect(stream.stats.cacheBytes).toBe(retainedBytes);
		expect(stream.stats.evictedTotal).toBe(0);
		expect(requests).toHaveLength(3);
	});

	it("reports bytes actually reclaimed when a batch eviction fails midway", async () => {
		const { stream, requestAt, cache, files, settle } = fixture();
		stream.setTarget({ frame: 0 });
		await (await requestAt({ index: 0 })).complete();
		await (await requestAt({ index: 1 })).complete();
		await (await requestAt({ index: 2 })).complete();
		await settle();
		cache.remove.mockImplementationOnce(async ({ frames }) => {
			files.delete(frames[0]);
			throw new Error("Second deletion failed");
		});
		stream.setTarget({ frame: 10 });
		await expect(stream.waitForTarget()).rejects.toThrow(
			"Second deletion failed"
		);
		await settle();
		expect(stream.stats).toMatchObject({
			cacheBytes: 5 * 65_553,
			residentFrames: 5,
			evictedTotal: 1,
		});
	});

	it("clips the final segment to the timeline and never prepares past its end", async () => {
		const { stream, requestAt, requests, settle, files } = fixture({
			frames: 5,
		});
		stream.setTarget({ frame: 4 });
		const final = await requestAt({ index: 0 });
		expect(final.request).toMatchObject({ startFrame: 4, frames: 1 });
		await final.complete();
		await stream.waitForTarget();
		await settle();
		expect(requests).toHaveLength(1);
		expect([...files.keys()]).toEqual([4]);
		expect(stream.stats.windowEnd).toBe(5);
	});

	it("rejects pending waits on disposal and waits for uncancellable work to drain", async () => {
		const { stream, requestAt } = fixture();
		stream.setTarget({ frame: 0 });
		const target = expect(stream.waitForTarget()).rejects.toMatchObject({
			name: "AbortError",
		});
		const read = expect(
			stream.read({ frame: 0, signal: new AbortController().signal })
		).rejects.toMatchObject({ name: "AbortError" });
		const pending = await requestAt({ index: 0 });
		const disposed = vi.fn();
		const disposal = stream.dispose().then(disposed);
		await Promise.all([target, read]);
		expect(pending.request.signal.aborted).toBe(true);
		expect(disposed).not.toHaveBeenCalled();
		pending.gate.resolve();
		await disposal;
		expect(disposed).toHaveBeenCalledOnce();
	});
});
