// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIndependentSequenceFrameRenderer } from "../beauty-lab/beauty-lab-independent-body-video";
import type { BeautyLabIndependentResult } from "../beauty-lab/beauty-lab-independent-contract";
import { createIndependentRenderQueue } from "../beauty-lab/beauty-lab-independent-queue";
import { IndependentWorkerExitedError } from "../beauty-lab/beauty-lab-independent-worker";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const pixels = new Uint8Array([10, 20, 30, 255]);
const request = {
	requestId: "body-frame",
	width: 1,
	height: 1,
	rgba: pixels,
	adjustments: { enabled: true as const, values: { body_adjust_SlimBody: 40 } },
	sequence: { clip: "c".repeat(64), frame: 0, fps: 30, replay: false },
};
const result: BeautyLabIndependentResult = {
	provider: "qcut-independent-photo-v1",
	requestId: request.requestId,
	sourceKey: "timeline",
	width: 1,
	height: 1,
	rgba: pixels,
	png: new Uint8Array([1]),
	inputSha256: "i",
	outputSha256: "o",
	report: {},
};

function fixture() {
	const cache = {
		read: vi.fn(async (): Promise<Uint8Array | null> => null),
		write: vi.fn(async () => {}),
	};
	const provider = {
		render: vi.fn(async (_input: { request: unknown }) => result),
	};
	const identity = vi.fn(async () => "e".repeat(64));
	const frames = createIndependentSequenceFrameRenderer({
		provider,
		cache,
		engineSha256: identity,
		sessionsDirectory: path.join(os.tmpdir(), "qcut-test-sequence-cancel"),
	});
	return { cache, provider, identity, frames };
}

describe("body sequence request cancellation", () => {
	it("cancels engine identity lookup before any cache or worker work", async () => {
		const { frames, identity, cache, provider } = fixture();
		const hash = deferred<string>();
		identity.mockReturnValueOnce(hash.promise);
		const rendering = frames.render({ request });
		const rejected = expect(rendering).rejects.toThrow("cancelled");
		await vi.waitFor(() => expect(identity).toHaveBeenCalledOnce());
		expect(frames.cancel({ request })).toEqual({ cancelled: true });
		await rejected;
		hash.resolve("e".repeat(64));
		await Promise.resolve();
		expect(cache.read).not.toHaveBeenCalled();
		expect(provider.render).not.toHaveBeenCalled();
		expect(frames.cancel({ request })).toEqual({ cancelled: false });
	});

	it.each([
		{ name: "hit", cached: pixels },
		{ name: "miss", cached: null },
	])("cancels a pending cache $name without starting the worker", async ({
		cached,
	}) => {
		const { frames, cache, provider } = fixture();
		const lookup = deferred<Uint8Array | null>();
		cache.read.mockReturnValueOnce(lookup.promise);
		const rendering = frames.render({ request });
		const rejected = expect(rendering).rejects.toThrow("cancelled");
		await vi.waitFor(() => expect(cache.read).toHaveBeenCalledOnce());
		frames.cancel({ request });
		await rejected;
		lookup.resolve(cached);
		await Promise.resolve();
		expect(provider.render).not.toHaveBeenCalled();
		expect(cache.write).not.toHaveBeenCalled();
		await expect(frames.render({ request })).resolves.toMatchObject({
			status: "rendered",
			cached: false,
		});
	});

	it("keeps a started frame alive and caches its pixels after cancellation", async () => {
		const { frames, cache, provider } = fixture();
		const execution = deferred<BeautyLabIndependentResult>();
		provider.render.mockReturnValueOnce(execution.promise);
		const rendering = frames.render({ request });
		await vi.waitFor(() => expect(provider.render).toHaveBeenCalledOnce());
		expect(frames.cancel({ request })).toEqual({ cancelled: true });
		let settled = false;
		void rendering.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		execution.resolve(result);
		await expect(rendering).resolves.toMatchObject({
			status: "rendered",
			rgba: pixels,
			cached: false,
		});
		expect(cache.write).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ rgba: pixels })
		);
		expect(frames.cancel({ request })).toEqual({ cancelled: false });
	});

	it("does not restart a dead worker for an abandoned frame", async () => {
		const { frames, provider, cache } = fixture();
		const execution = deferred<BeautyLabIndependentResult>();
		provider.render.mockReturnValueOnce(execution.promise);
		const rendering = frames.render({ request });
		const rejected = expect(rendering).rejects.toThrow("cancelled");
		await vi.waitFor(() => expect(provider.render).toHaveBeenCalledOnce());
		frames.cancel({ request });
		execution.reject(
			new IndependentWorkerExitedError({ code: null, signal: "SIGKILL" })
		);
		await rejected;
		expect(provider.render).toHaveBeenCalledOnce();
		expect(cache.write).not.toHaveBeenCalled();
	});

	it("removes a queued body frame while another provider request is running", async () => {
		const { cache, identity } = fixture();
		const first = deferred<BeautyLabIndependentResult>();
		const provider = {
			inspect: vi.fn(),
			render: vi.fn(async (_input: { request: unknown }) => first.promise),
			cancel: vi.fn(() => ({ cancelled: false })),
			dispose: vi.fn(async () => {}),
		};
		const queue = createIndependentRenderQueue({ provider });
		const submitting = vi.fn(queue.render);
		const frames = createIndependentSequenceFrameRenderer({
			provider: { render: submitting },
			cache,
			engineSha256: identity,
			sessionsDirectory: path.join(os.tmpdir(), "qcut-test-sequence-cancel"),
		});
		const running = queue.render({ request: { requestId: "unrelated" } });
		const rendering = frames.render({ request });
		const rejected = expect(rendering).rejects.toThrow("cancelled");
		await vi.waitFor(() => expect(submitting).toHaveBeenCalledOnce());
		frames.cancel({ request });
		expect(queue.cancel({ request })).toEqual({ cancelled: true });
		await rejected;
		first.resolve(result);
		await running;
		expect(provider.render).toHaveBeenCalledOnce();
		expect(provider.cancel).not.toHaveBeenCalled();
		expect(cache.write).not.toHaveBeenCalled();
	});

	it("rejects duplicate request ids until the original settles", async () => {
		const { frames, cache } = fixture();
		const lookup = deferred<Uint8Array | null>();
		cache.read.mockReturnValueOnce(lookup.promise);
		const rendering = frames.render({ request });
		const rejected = expect(rendering).rejects.toThrow("cancelled");
		await expect(frames.render({ request })).rejects.toThrow("Duplicate");
		frames.cancel({ request });
		await rejected;
		lookup.resolve(null);
		await expect(frames.render({ request })).resolves.toMatchObject({
			status: "rendered",
		});
	});

	it("disposal rejects a pending cache hit and prevents later worker submission", async () => {
		const { frames, cache, provider } = fixture();
		const lookup = deferred<Uint8Array | null>();
		cache.read.mockReturnValueOnce(lookup.promise);
		const rendering = frames.render({ request });
		const rejected = expect(rendering).rejects.toThrow("disposed");
		await vi.waitFor(() => expect(cache.read).toHaveBeenCalledOnce());
		frames.dispose();
		await rejected;
		lookup.resolve(pixels);
		await Promise.resolve();
		await expect(frames.render({ request })).rejects.toThrow("disposed");
		expect(provider.render).not.toHaveBeenCalled();
		expect(cache.write).not.toHaveBeenCalled();
	});
});
