// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { BeautyLabIndependentResult } from "../beauty-lab/beauty-lab-independent-contract";
import { createIndependentRenderQueue } from "../beauty-lab/beauty-lab-independent-queue";

function deferred() {
	let resolve!: (result: BeautyLabIndependentResult) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<BeautyLabIndependentResult>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const result = ({ requestId }: { requestId: string }) =>
	({ requestId }) as BeautyLabIndependentResult;

/** A provider that, like the real engine, refuses a second concurrent job. */
function fakeProvider() {
	const jobs = new Map<string, ReturnType<typeof deferred>>();
	let active: string | undefined;
	const provider = {
		inspect: vi.fn(),
		render: vi.fn(async ({ request }: { request: unknown }) => {
			const { requestId } = request as { requestId: string };
			if (active) throw new Error("Independent engine busy or disposed");
			active = requestId;
			const job = deferred();
			jobs.set(requestId, job);
			try {
				return await job.promise;
			} finally {
				active = undefined;
			}
		}),
		cancel: vi.fn(({ request }: { request: { requestId: string } }) => {
			const job = jobs.get(request.requestId);
			if (!job || active !== request.requestId) return { cancelled: false };
			job.reject(new Error("Independent beauty cancelled"));
			return { cancelled: true };
		}),
		dispose: vi.fn(async () => {}),
	};
	return { provider, jobs };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("independent render queue", () => {
	it("runs concurrent callers one after another instead of failing as busy", async () => {
		const { provider, jobs } = fakeProvider();
		const queue = createIndependentRenderQueue({ provider });
		const first = queue.render({ request: { requestId: "lab" } });
		const second = queue.render({ request: { requestId: "frame" } });
		await settle();
		expect(provider.render).toHaveBeenCalledOnce();
		jobs.get("lab")?.resolve(result({ requestId: "lab" }));
		await expect(first).resolves.toEqual({ requestId: "lab" });
		await settle();
		expect(provider.render).toHaveBeenCalledTimes(2);
		jobs.get("frame")?.resolve(result({ requestId: "frame" }));
		await expect(second).resolves.toEqual({ requestId: "frame" });
	});

	it("cancels a waiting request without touching the running one", async () => {
		const { provider, jobs } = fakeProvider();
		const queue = createIndependentRenderQueue({ provider });
		const running = queue.render({ request: { requestId: "running" } });
		const waiting = queue.render({ request: { requestId: "waiting" } });
		await settle();
		expect(queue.cancel({ request: { requestId: "waiting" } })).toEqual({
			cancelled: true,
		});
		await expect(waiting).rejects.toThrow("cancelled");
		expect(provider.cancel).not.toHaveBeenCalled();
		jobs.get("running")?.resolve(result({ requestId: "running" }));
		await expect(running).resolves.toEqual({ requestId: "running" });
		await settle();
		expect(provider.render).toHaveBeenCalledOnce();
	});

	it("cancels the running request through the engine and moves on", async () => {
		const { provider, jobs } = fakeProvider();
		const queue = createIndependentRenderQueue({ provider });
		const running = queue.render({ request: { requestId: "running" } });
		const next = queue.render({ request: { requestId: "next" } });
		await settle();
		expect(queue.cancel({ request: { requestId: "running" } })).toEqual({
			cancelled: true,
		});
		await expect(running).rejects.toThrow("cancelled");
		await settle();
		jobs.get("next")?.resolve(result({ requestId: "next" }));
		await expect(next).resolves.toEqual({ requestId: "next" });
	});

	it("rejects duplicate ids, which would make cancellation ambiguous", async () => {
		const { provider, jobs } = fakeProvider();
		const queue = createIndependentRenderQueue({ provider });
		const first = queue.render({ request: { requestId: "same" } });
		await expect(
			queue.render({ request: { requestId: "same" } })
		).rejects.toThrow("Duplicate");
		await expect(queue.render({ request: {} })).rejects.toThrow("request id");
		await settle();
		jobs.get("same")?.resolve(result({ requestId: "same" }));
		await expect(first).resolves.toEqual({ requestId: "same" });
	});

	it("rejects waiting requests on dispose and disposes the engine", async () => {
		const { provider } = fakeProvider();
		const queue = createIndependentRenderQueue({ provider });
		void queue.render({ request: { requestId: "running" } }).catch(() => {});
		const waiting = queue.render({ request: { requestId: "waiting" } });
		await settle();
		await queue.dispose();
		await expect(waiting).rejects.toThrow("disposed");
		expect(provider.dispose).toHaveBeenCalledOnce();
		await expect(
			queue.render({ request: { requestId: "late" } })
		).rejects.toThrow("disposed");
	});
});
