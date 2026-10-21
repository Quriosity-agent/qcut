// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPortraitSourceWindowRenderCache } from "../jianying-portrait-adjustment-runtime/source-window-render-cache.js";
import { createPortraitRenderRequests } from "../jianying-portrait-adjustment-runtime/render-requests.js";
import { createPortraitRenderDiskCache } from "../jianying-portrait-adjustment-runtime/render-disk-cache.js";
import {
	CacheLeaseUnavailableError,
	withPortraitRenderCacheLock,
} from "../jianying-portrait-adjustment-runtime/render-disk-cache-lock.js";
import type { JianyingPortraitAdjustmentRenderRequest } from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";

function deferred<Result>() {
	let resolve: (value: Result) => void = () => {};
	const promise = new Promise<Result>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function fixture() {
	const request: JianyingPortraitAdjustmentRenderRequest = {
		width: 1,
		height: 1,
		rgba: new Uint8Array([1, 2, 3, 255]),
		sourceKey: "source-window-v1:clip",
		timestampSeconds: 0,
		freshTracking: true,
		adjustments: { enabled: true, values: { body_adjust_SlimBody: 40 } },
	};
	const result = {
		provider: "jianying-local-swing-v1" as const,
		width: 1,
		height: 1,
		rgba: new Uint8Array([4, 5, 6, 255]),
		activeGroups: ["body" as const],
	};
	const cache = {
		read: vi.fn(async () => null as typeof result | null),
		write: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
	};
	const identity = { resolve: vi.fn(async () => "runtime-a"), clear: vi.fn() };
	const renderFresh = vi.fn(async () => result);
	const applyCachedResult = vi.fn(async () => {});
	const executor = createPortraitSourceWindowRenderCache({ cache, identity });
	return {
		request,
		result,
		cache,
		identity,
		renderFresh,
		applyCachedResult,
		executor,
	};
}

describe("native independent request caching and cancellation", () => {
	it("uses a fully keyed warm result without native commands", async () => {
		const f = fixture();
		f.cache.read.mockResolvedValue(f.result);
		expect(await f.executor.render(f)).toEqual({
			...f.result,
			sourceWindowCacheHit: true,
			nativeRenderCount: 0,
		});
		expect(f.renderFresh).not.toHaveBeenCalled();
		expect(f.applyCachedResult).toHaveBeenCalledOnce();
		expect(f.identity.resolve).toHaveBeenCalledTimes(2);
	});
	it("always runs continuous tracker requests through the original renderer", async () => {
		const f = fixture();
		f.request.freshTracking = false;
		f.cache.read.mockResolvedValue(f.result);
		expect(await f.executor.render(f)).toBe(f.result);
		expect(f.renderFresh).toHaveBeenCalledOnce();
		expect(f.cache.read).not.toHaveBeenCalled();
		expect(f.identity.resolve).not.toHaveBeenCalled();
	});
	it("writes a cold result only after runtime identity is unchanged", async () => {
		const f = fixture();
		expect(await f.executor.render(f)).toEqual({
			...f.result,
			sourceWindowCacheHit: false,
		});
		expect(f.renderFresh).toHaveBeenCalledOnce();
		expect(f.cache.write).toHaveBeenCalledOnce();
		const changed = fixture();
		changed.identity.resolve
			.mockResolvedValueOnce("old")
			.mockResolvedValue("new");
		await changed.executor.render(changed);
		expect(changed.cache.write).not.toHaveBeenCalled();
	});
	it("runtime changes during a cache read force the original native path", async () => {
		const f = fixture();
		f.cache.read.mockResolvedValue(f.result);
		f.identity.resolve.mockResolvedValueOnce("old").mockResolvedValue("new");
		await f.executor.render(f);
		expect(f.renderFresh).toHaveBeenCalledOnce();
		expect(f.applyCachedResult).not.toHaveBeenCalled();
		expect(f.cache.write).not.toHaveBeenCalled();
	});
	it("cancellation during a cache hit cannot return cached pixels or start native work", async () => {
		const f = fixture();
		const read = deferred<typeof f.result>();
		f.cache.read.mockReturnValue(read.promise);
		const controller = new AbortController();
		const pending = f.executor.render({ ...f, signal: controller.signal });
		await vi.waitFor(() => expect(f.cache.read).toHaveBeenCalled());
		controller.abort();
		read.resolve(f.result);
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(f.renderFresh).not.toHaveBeenCalled();
		expect(f.applyCachedResult).not.toHaveBeenCalled();
	});
	it("a cancelled started render completes its original commands and can preserve its valid result", async () => {
		const f = fixture();
		const rendered = deferred<typeof f.result>();
		f.renderFresh.mockReturnValue(rendered.promise);
		const controller = new AbortController();
		const pending = f.executor.render({ ...f, signal: controller.signal });
		await vi.waitFor(() => expect(f.renderFresh).toHaveBeenCalled());
		controller.abort();
		rendered.resolve(f.result);
		await pending;
		expect(f.cache.write).toHaveBeenCalledOnce();
	});
	it("cancellation while retiring a cached scope cannot publish the hit", async () => {
		const f = fixture();
		f.cache.read.mockResolvedValue(f.result);
		const retired = deferred<void>();
		f.applyCachedResult.mockReturnValue(retired.promise);
		const controller = new AbortController();
		const pending = f.executor.render({ ...f, signal: controller.signal });
		await vi.waitFor(() => expect(f.applyCachedResult).toHaveBeenCalled());
		controller.abort();
		retired.resolve();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(f.renderFresh).not.toHaveBeenCalled();
	});
	it("cache failure falls back once without changing the native render call", async () => {
		const f = fixture();
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		f.cache.read.mockRejectedValue(new Error("disk unavailable"));
		expect(await f.executor.render(f)).toEqual({
			...f.result,
			sourceWindowCacheHit: false,
		});
		expect(f.renderFresh).toHaveBeenCalledOnce();
		expect(f.cache.write).not.toHaveBeenCalled();
		expect(warning).toHaveBeenCalledOnce();
		warning.mockRestore();
	});
	it("closing waits for cache cleanup and clears fingerprint state", async () => {
		const f = fixture();
		const closed = deferred<void>();
		f.cache.close.mockReturnValue(closed.promise);
		const pending = f.executor.close();
		expect(f.identity.clear).not.toHaveBeenCalled();
		closed.resolve();
		await pending;
		expect(f.identity.clear).toHaveBeenCalledOnce();
	});
	it("recovers reads and writes after a real competing cache lease is released", async () => {
		const f = fixture();
		const directory = await mkdtemp(
			path.join(os.tmpdir(), "native-cache-recovery-")
		);
		const cache = createPortraitRenderDiskCache({ directory });
		const executor = createPortraitSourceWindowRenderCache({
			cache,
			identity: f.identity,
		});
		const leased = deferred<void>();
		const released = deferred<void>();
		const competing = withPortraitRenderCacheLock({
			directory,
			run: async () => {
				leased.resolve();
				await released.promise;
			},
		});
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		const originalRequest = structuredClone(f.request);
		try {
			await Promise.race([leased.promise, competing]);
			const unavailable = await executor.render(f);
			expect(unavailable.sourceWindowCacheHit).toBe(false);
			expect(f.renderFresh).toHaveBeenCalledOnce();
			expect(warning).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(CacheLeaseUnavailableError)
			);
			released.resolve();
			await competing;
			const cold = await executor.render(f);
			expect(cold.sourceWindowCacheHit).toBe(false);
			const warm = await executor.render(f);
			expect(warm).toEqual({
				...f.result,
				sourceWindowCacheHit: true,
				nativeRenderCount: 0,
			});
			expect(f.renderFresh).toHaveBeenCalledTimes(2);
			expect(f.applyCachedResult).toHaveBeenCalledOnce();
			expect(f.request).toEqual(originalRequest);
		} finally {
			released.resolve();
			await competing;
			await executor.close();
			await rm(directory, { recursive: true, force: true });
			warning.mockRestore();
		}
	});
	it("recovers a warm read after a previous cache write lost its lease", async () => {
		const f = fixture();
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		f.cache.write.mockRejectedValueOnce(new CacheLeaseUnavailableError());
		try {
			const first = await f.executor.render(f);
			expect(first.sourceWindowCacheHit).toBe(false);
			expect(first.rgba).toEqual(f.result.rgba);
			f.cache.read.mockResolvedValue(f.result);
			const second = await f.executor.render(f);
			expect(second.sourceWindowCacheHit).toBe(true);
			expect(second.nativeRenderCount).toBe(0);
			expect(f.cache.read).toHaveBeenCalledTimes(2);
			expect(f.renderFresh).toHaveBeenCalledOnce();
			expect(f.applyCachedResult).toHaveBeenCalledOnce();
		} finally {
			warning.mockRestore();
		}
	});
	it("still rejects stale runtime identity after a transient lease failure", async () => {
		const f = fixture();
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		f.cache.read.mockRejectedValueOnce(new CacheLeaseUnavailableError());
		try {
			await f.executor.render(f);
			f.cache.read.mockResolvedValue(f.result);
			f.identity.resolve
				.mockResolvedValueOnce("runtime-a")
				.mockResolvedValue("runtime-b");
			const second = await f.executor.render(f);
			expect(f.cache.read).toHaveBeenCalledTimes(2);
			expect(second.sourceWindowCacheHit).toBe(false);
			expect(f.renderFresh).toHaveBeenCalledTimes(2);
			expect(f.applyCachedResult).not.toHaveBeenCalled();
			expect(f.cache.write).not.toHaveBeenCalled();
		} finally {
			warning.mockRestore();
		}
	});
	it("returns cancellation promptly but reserves request identity until started work settles", async () => {
		const requests = createPortraitRenderRequests();
		const work = deferred<number>();
		const pending = requests.run({
			requestId: "render-1",
			enqueue: () => work.promise,
		});
		const rejected = expect(pending).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(requests.cancel({ requestId: "render-1" })).toBe(true);
		await rejected;
		await expect(
			requests.run({ requestId: "render-1", enqueue: async () => 2 })
		).rejects.toThrow("already pending");
		work.resolve(1);
		await vi.waitFor(() =>
			expect(requests.cancel({ requestId: "render-1" })).toBe(false)
		);
		expect(
			await requests.run({ requestId: "render-1", enqueue: async () => 2 })
		).toBe(2);
	});
	it("cancels queued requests before native work starts", async () => {
		const requests = createPortraitRenderRequests();
		const queue = deferred<void>();
		const render = vi.fn();
		const pending = requests.run({
			requestId: "queued",
			enqueue: (signal) =>
				queue.promise.then(() => {
					signal.throwIfAborted();
					render();
				}),
		});
		const rejected = expect(pending).rejects.toMatchObject({
			name: "AbortError",
		});
		requests.cancelAll();
		await rejected;
		queue.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(render).not.toHaveBeenCalled();
	});
});
