// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createIndependentKeyedQueue } from "../beauty-lab/beauty-lab-independent-keyed-queue";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, failed) => {
		resolve = done;
		reject = failed;
	});
	return { promise, resolve, reject };
}

describe("independent keyed operation queue", () => {
	it("runs distinct keys independently and preserves each same-key result", async () => {
		const queue = createIndependentKeyedQueue();
		const signal = new AbortController().signal;
		const leader = deferred<string>();
		const first = queue.run({
			key: "a",
			signal,
			operation: () => leader.promise,
		});
		const follower = vi.fn(async () => "second");
		const second = queue.run({ key: "a", signal, operation: follower });
		await expect(
			queue.run({ key: "b", signal, operation: async () => "other" })
		).resolves.toBe("other");
		expect(follower).not.toHaveBeenCalled();
		leader.resolve("first");
		await expect(Promise.all([first, second])).resolves.toEqual([
			"first",
			"second",
		]);
	});
	it("cancels a waiter immediately without letting its successor overtake the leader", async () => {
		const queue = createIndependentKeyedQueue();
		const leader = deferred<void>();
		const signal = new AbortController().signal;
		const first = queue.run({
			key: "a",
			signal,
			operation: () => leader.promise,
		});
		const controller = new AbortController();
		const cancelledOperation = vi.fn(async () => {});
		const waiting = queue.run({
			key: "a",
			signal: controller.signal,
			operation: cancelledOperation,
		});
		const rejected = expect(waiting).rejects.toThrow("cancelled waiter");
		controller.abort(new Error("cancelled waiter"));
		await rejected;
		const successor = vi.fn(async () => {});
		const third = queue.run({ key: "a", signal, operation: successor });
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(cancelledOperation).not.toHaveBeenCalled();
		expect(successor).not.toHaveBeenCalled();
		leader.resolve();
		await Promise.all([first, third]);
		expect(successor).toHaveBeenCalledOnce();
	});
	it("drains a started operation after abort before releasing the key", async () => {
		const queue = createIndependentKeyedQueue();
		const controller = new AbortController();
		const leader = deferred<void>();
		const first = queue.run({
			key: "a",
			signal: controller.signal,
			operation: () => leader.promise,
		});
		controller.abort(new Error("active cancelled"));
		const follower = vi.fn(async () => {});
		const second = queue.run({
			key: "a",
			signal: new AbortController().signal,
			operation: follower,
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(follower).not.toHaveBeenCalled();
		leader.resolve();
		await Promise.all([first, second]);
		expect(follower).toHaveBeenCalledOnce();
	});
	it("releases a failed operation without propagating its error to followers", async () => {
		const queue = createIndependentKeyedQueue();
		const signal = new AbortController().signal;
		const leader = deferred<void>();
		const first = queue.run({
			key: "a",
			signal,
			operation: () => leader.promise,
		});
		const rejected = expect(first).rejects.toThrow("failed");
		const second = queue.run({
			key: "a",
			signal,
			operation: async () => "recovered",
		});
		leader.reject(new Error("failed"));
		await rejected;
		await expect(second).resolves.toBe("recovered");
	});
	it("rejects an already aborted request without retaining the key", async () => {
		const queue = createIndependentKeyedQueue();
		const controller = new AbortController();
		controller.abort(new Error("already cancelled"));
		const operation = vi.fn(async () => "ok");
		await expect(
			queue.run({ key: "a", signal: controller.signal, operation })
		).rejects.toThrow("already cancelled");
		expect(operation).not.toHaveBeenCalled();
		await expect(
			queue.run({ key: "a", signal: new AbortController().signal, operation })
		).resolves.toBe("ok");
	});
});
