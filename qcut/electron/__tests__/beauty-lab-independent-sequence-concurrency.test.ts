// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIndependentSequenceFrameRenderer } from "../beauty-lab/beauty-lab-independent-body-video";
import type { BeautyLabIndependentResult } from "../beauty-lab/beauty-lab-independent-contract";
import { createIndependentRenderQueue } from "../beauty-lab/beauty-lab-independent-queue";

const { synchronize } = vi.hoisted(() => ({
	synchronize: vi.fn(async (_input?: { requiredFrame?: number }) => {}),
}));
vi.mock("../beauty-lab/beauty-lab-independent-coreml-history", () => ({
	createCoreMLHistoryGuard: () => ({ synchronize }),
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const pixels = new Uint8Array([10, 20, 30, 255]);
const request = {
	requestId: "first",
	width: 1,
	height: 1,
	rgba: pixels,
	adjustments: { enabled: true as const, values: { body_adjust_SlimBody: 40 } },
	sequence: { clip: "c".repeat(64), frame: 0, fps: 30, replay: false },
};
const coremlRequest = {
	...request,
	adjustments: {
		...request.adjustments,
		bodyVideoProfile: "swing-coreml-v1" as const,
	},
	sequence: { ...request.sequence, sourceTimestampSeconds: 0 },
};

function fixture() {
	synchronize.mockClear();
	const entries = new Map<string, Uint8Array>();
	const cache = {
		read: vi.fn(async ({ key }: { key: string }) => entries.get(key) ?? null),
		write: vi.fn(async ({ key, rgba }: { key: string; rgba: Uint8Array }) => {
			entries.set(key, rgba);
		}),
	};
	const provider = {
		inspect: vi.fn(),
		render: vi.fn(async ({ request: input }: { request: unknown }) => {
			const frame = input as typeof request;
			return {
				requestId: frame.requestId,
				width: frame.width,
				height: frame.height,
				rgba: frame.rgba,
				png: new Uint8Array([1]),
			} as BeautyLabIndependentResult;
		}),
		cancel: vi.fn(() => ({ cancelled: false })),
		dispose: vi.fn(async () => {}),
	};
	const queue = createIndependentRenderQueue({ provider });
	const identity = vi.fn(async () => "e".repeat(64));
	const resolveCoreML = vi.fn(async () => ({
		engineSha256: "e".repeat(64),
		identitySha256: "i".repeat(64),
		execution: { profile: "swing-coreml-v1" },
	}));
	const frames = createIndependentSequenceFrameRenderer({
		provider: queue,
		cache,
		engineSha256: identity,
		resolveCoreML,
		sessionsDirectory: path.join(os.tmpdir(), "qcut-test-sequence-concurrency"),
	});
	function holdPublication() {
		const publication = deferred<void>();
		cache.write.mockImplementationOnce(async ({ key, rgba }) => {
			await publication.promise;
			entries.set(key, rgba);
		});
		return publication;
	}
	return { frames, provider, cache, identity, resolveCoreML, holdPublication };
}

describe("sequence frame cache publication", () => {
	it("rechecks the cache after an identical request finishes publishing", async () => {
		const test = fixture();
		const publication = test.holdPublication();
		const first = test.frames.render({ request });
		await vi.waitFor(() => expect(test.cache.write).toHaveBeenCalledOnce());
		const second = test.frames.render({
			request: { ...request, requestId: "second" },
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		publication.resolve();
		const results = await Promise.all([first, second]);
		expect(test.provider.render).toHaveBeenCalledOnce();
		expect(results).toMatchObject([
			{ requestId: "first", cached: false, rgba: pixels },
			{ requestId: "second", cached: true, rgba: pixels },
		]);
		expect(test.identity).toHaveBeenCalledTimes(2);
		expect(test.cache.read).toHaveBeenCalledTimes(2);
	});

	it("cancels only a waiting caller while another caller publishes", async () => {
		const test = fixture();
		const publication = test.holdPublication();
		const first = test.frames.render({ request: coremlRequest });
		await vi.waitFor(() => expect(test.cache.write).toHaveBeenCalledOnce());
		const secondRequest = { ...coremlRequest, requestId: "cancelled" };
		const second = test.frames.render({ request: secondRequest });
		const rejected = expect(second).rejects.toThrow("cancelled");
		test.frames.cancel({ request: secondRequest });
		await rejected;
		const third = test.frames.render({
			request: { ...coremlRequest, requestId: "third" },
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(test.resolveCoreML).toHaveBeenCalledOnce();
		publication.resolve();
		await expect(first).resolves.toMatchObject({ cached: false });
		await expect(third).resolves.toMatchObject({
			requestId: "third",
			cached: true,
		});
		expect(test.provider.render).toHaveBeenCalledOnce();
		expect(test.provider.cancel).not.toHaveBeenCalledWith({
			request: { requestId: "first" },
		});
		expect(test.resolveCoreML).toHaveBeenCalledTimes(2);
		expect(synchronize).toHaveBeenCalledTimes(4);
	});

	it("runs explicit replay through the engine after an identical frame is cached", async () => {
		const test = fixture();
		const publication = test.holdPublication();
		const first = test.frames.render({ request });
		await vi.waitFor(() => expect(test.cache.write).toHaveBeenCalledOnce());
		const replay = test.frames.render({
			request: {
				...request,
				requestId: "replay",
				sequence: { ...request.sequence, replay: true },
			},
		});
		publication.resolve();
		await first;
		await expect(replay).resolves.toMatchObject({
			requestId: "replay",
			cached: false,
		});
		expect(test.cache.read).toHaveBeenCalledOnce();
		expect(test.provider.render).toHaveBeenCalledTimes(2);
	});

	it("resolves changed resources only after waiting and derives a fresh cache key", async () => {
		const test = fixture();
		const publication = test.holdPublication();
		const first = test.frames.render({ request: coremlRequest });
		await vi.waitFor(() => expect(test.cache.write).toHaveBeenCalledOnce());
		const second = test.frames.render({
			request: { ...coremlRequest, requestId: "second" },
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(test.resolveCoreML).toHaveBeenCalledOnce();
		test.resolveCoreML.mockResolvedValue({
			engineSha256: "f".repeat(64),
			identitySha256: "j".repeat(64),
			execution: { profile: "swing-coreml-v1" },
		});
		publication.resolve();
		await first;
		await expect(second).resolves.toMatchObject({ cached: false });
		expect(test.provider.render).toHaveBeenCalledTimes(2);
		expect(test.cache.read.mock.calls[0]).not.toEqual(
			test.cache.read.mock.calls[1]
		);
		expect(test.resolveCoreML).toHaveBeenCalledTimes(2);
	});

	it("rejects changed resource integrity before a waiting caller can read published pixels", async () => {
		const test = fixture();
		const publication = test.holdPublication();
		const first = test.frames.render({ request: coremlRequest });
		await vi.waitFor(() => expect(test.cache.write).toHaveBeenCalledOnce());
		const second = test.frames.render({
			request: { ...coremlRequest, requestId: "second" },
		});
		const rejected = expect(second).rejects.toThrow("model integrity");
		test.resolveCoreML.mockRejectedValue(new Error("model integrity"));
		publication.resolve();
		await first;
		await rejected;
		expect(test.cache.read).toHaveBeenCalledOnce();
		expect(test.provider.render).toHaveBeenCalledOnce();
	});

	it.each([
		"pixels",
		"controls",
		"PTS",
	])("keeps concurrent %s changes in separate full cache identities", async (change) => {
		const test = fixture();
		const edited = structuredClone(coremlRequest);
		edited.requestId = "second";
		if (change === "pixels") edited.rgba[0] = 99;
		if (change === "controls")
			edited.adjustments.values.body_adjust_SlimBody = 60;
		if (change === "PTS") edited.sequence.sourceTimestampSeconds = 1 / 30;
		const results = await Promise.all([
			test.frames.render({ request: coremlRequest }),
			test.frames.render({ request: edited }),
		]);
		expect(test.provider.render).toHaveBeenCalledTimes(2);
		expect(test.cache.read.mock.calls[0]).not.toEqual(
			test.cache.read.mock.calls[1]
		);
		expect(
			results.map((result) => result.status === "rendered" && result.cached)
		).toEqual([false, false]);
	});

	it("lets a cancelled warm leader finish caching before the follower reads", async () => {
		const test = fixture();
		const execution = deferred<void>();
		const render = test.provider.render.getMockImplementation()!;
		test.provider.render.mockImplementationOnce(async (input) => {
			await execution.promise;
			return render(input);
		});
		const first = test.frames.render({ request });
		await vi.waitFor(() => expect(test.provider.render).toHaveBeenCalledOnce());
		const second = test.frames.render({
			request: { ...request, requestId: "second" },
		});
		test.frames.cancel({ request });
		execution.resolve();
		await expect(first).resolves.toMatchObject({ cached: false });
		await expect(second).resolves.toMatchObject({ cached: true });
		expect(test.provider.render).toHaveBeenCalledOnce();
	});

	it("drains a cancelled CoreML leader and lets the follower recover independently", async () => {
		const test = fixture();
		const execution = deferred<void>();
		const render = test.provider.render.getMockImplementation()!;
		test.provider.render.mockImplementationOnce(async (input) => {
			await execution.promise;
			return render(input);
		});
		const first = test.frames.render({ request: coremlRequest });
		const rejected = expect(first).rejects.toThrow("cancelled");
		await vi.waitFor(() => expect(test.provider.render).toHaveBeenCalledOnce());
		const second = test.frames.render({
			request: { ...coremlRequest, requestId: "second" },
		});
		test.frames.cancel({ request });
		expect(test.provider.render).toHaveBeenCalledOnce();
		execution.resolve();
		await rejected;
		await expect(second).resolves.toMatchObject({
			requestId: "second",
			cached: false,
		});
		expect(test.provider.render).toHaveBeenCalledTimes(2);
		expect(test.cache.write).toHaveBeenCalledOnce();
	});
});
