import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isRateLimitError, retryOperation, withRetry } from "../retry";
import {
	delay,
	rateLimitedBatch,
	createRateLimitedFn,
	batchProcess,
} from "../rate-limiter";
import { runStaggered } from "../concurrency";
import {
	parseApiKeys,
	maskApiKey,
	classifyModelByName,
	ApiKeyManager,
} from "../api-key-manager";

// ==================== retry.ts ====================

describe("isRateLimitError", () => {
	it("returns true for status 429", () => {
		expect(isRateLimitError({ status: 429 })).toBe(true);
	});

	it("returns true for code 429", () => {
		expect(isRateLimitError({ code: 429 })).toBe(true);
	});

	it("returns true for message containing '429'", () => {
		expect(isRateLimitError({ message: "Error 429 occurred" })).toBe(true);
	});

	it("returns true for message containing 'rate'", () => {
		expect(isRateLimitError({ message: "Rate limit exceeded" })).toBe(true);
	});

	it("returns true for message containing 'too many requests'", () => {
		expect(isRateLimitError({ message: "Too Many Requests, slow down" })).toBe(
			true
		);
	});

	it("returns true for message containing 'quota'", () => {
		expect(isRateLimitError({ message: "Quota exceeded for model" })).toBe(
			true
		);
	});

	it("returns true for message containing 'resource_exhausted'", () => {
		expect(isRateLimitError({ message: "RESOURCE_EXHAUSTED" })).toBe(true);
	});

	it("returns false for non-rate-limit errors", () => {
		expect(isRateLimitError({ status: 500, message: "Server error" })).toBe(
			false
		);
	});

	it("returns false for status 404", () => {
		expect(isRateLimitError({ status: 404, message: "Not found" })).toBe(false);
	});

	it("returns false for null/undefined", () => {
		expect(isRateLimitError(null)).toBe(false);
		expect(isRateLimitError(undefined)).toBe(false);
	});

	it("returns false for empty object", () => {
		expect(isRateLimitError({})).toBe(false);
	});
});

describe("retryOperation", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns result on first successful call", async () => {
		const operation = vi.fn().mockResolvedValue("success");
		const promise = retryOperation(operation);

		const result = await promise;
		expect(result).toBe("success");
		expect(operation).toHaveBeenCalledTimes(1);
	});

	it("retries on rate limit errors and eventually succeeds", async () => {
		const rateLimitError = Object.assign(new Error("Rate limit"), {
			status: 429,
		});
		const operation = vi
			.fn()
			.mockRejectedValueOnce(rateLimitError)
			.mockRejectedValueOnce(rateLimitError)
			.mockResolvedValue("recovered");

		const onRetry = vi.fn();
		const promise = retryOperation(operation, {
			maxRetries: 3,
			baseDelay: 1000,
			onRetry,
		});

		// First retry delay: 1000ms * 2^0 = 1000ms
		await vi.advanceTimersByTimeAsync(1000);
		// Second retry delay: 1000ms * 2^1 = 2000ms
		await vi.advanceTimersByTimeAsync(2000);

		const result = await promise;
		expect(result).toBe("recovered");
		expect(operation).toHaveBeenCalledTimes(3);
		expect(onRetry).toHaveBeenCalledTimes(2);
		expect(onRetry).toHaveBeenCalledWith(1, 1000, rateLimitError);
		expect(onRetry).toHaveBeenCalledWith(2, 2000, rateLimitError);
	});

	it("throws after exhausting all retries", async () => {
		vi.useRealTimers();

		const rateLimitError = Object.assign(new Error("Rate limit"), {
			status: 429,
		});
		const operation = vi.fn().mockRejectedValue(rateLimitError);
		const onRetry = vi.fn();

		await expect(
			retryOperation(operation, {
				maxRetries: 2,
				baseDelay: 1,
				onRetry,
			})
		).rejects.toThrow("Rate limit");
		expect(operation).toHaveBeenCalledTimes(2);
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("throws immediately for non-rate-limit errors without retrying", async () => {
		const serverError = new Error("Internal server error");
		const operation = vi.fn().mockRejectedValue(serverError);

		await expect(retryOperation(operation, { maxRetries: 3 })).rejects.toThrow(
			"Internal server error"
		);
		expect(operation).toHaveBeenCalledTimes(1);
	});

	it("retries silently when no onRetry callback is provided", async () => {
		const rateLimitError = Object.assign(new Error("Rate limit"), {
			status: 429,
		});
		const operation = vi
			.fn()
			.mockRejectedValueOnce(rateLimitError)
			.mockResolvedValue("ok");

		const promise = retryOperation(operation, {
			maxRetries: 2,
			baseDelay: 1000,
		});

		await vi.advanceTimersByTimeAsync(1000);
		const result = await promise;

		expect(result).toBe("ok");
		expect(operation).toHaveBeenCalledTimes(2);
	});
});

describe("withRetry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("wraps a function with retry logic", async () => {
		const rateLimitError = Object.assign(new Error("429"), { status: 429 });
		const fn = vi
			.fn()
			.mockRejectedValueOnce(rateLimitError)
			.mockResolvedValue("done");

		const wrapped = withRetry(fn, { maxRetries: 3, baseDelay: 500 });
		const promise = wrapped("arg1", "arg2");

		await vi.advanceTimersByTimeAsync(500);
		const result = await promise;

		expect(result).toBe("done");
		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenCalledWith("arg1", "arg2");
	});
});

// ==================== rate-limiter.ts ====================

describe("delay", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves after specified milliseconds", async () => {
		let resolved = false;
		const promise = delay(1000).then(() => {
			resolved = true;
		});

		expect(resolved).toBe(false);

		await vi.advanceTimersByTimeAsync(999);
		expect(resolved).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		await promise;
		expect(resolved).toBe(true);
	});

	it("resolves immediately for 0ms delay", async () => {
		let resolved = false;
		const promise = delay(0).then(() => {
			resolved = true;
		});

		await vi.advanceTimersByTimeAsync(0);
		await promise;
		expect(resolved).toBe(true);
	});
});

describe("rateLimitedBatch", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("processes all items and returns results in order", async () => {
		const items = ["a", "b", "c"];
		const operation = vi.fn((item: string) =>
			Promise.resolve(item.toUpperCase())
		);

		const promise = rateLimitedBatch(items, operation, { delayMs: 100 });

		// No delay before first item, then 100ms between each
		await vi.advanceTimersByTimeAsync(100); // delay before item 2
		await vi.advanceTimersByTimeAsync(100); // delay before item 3

		const results = await promise;
		expect(results).toEqual(["A", "B", "C"]);
		expect(operation).toHaveBeenCalledTimes(3);
	});

	it("calls onProgress callback for each item", async () => {
		const items = [1, 2];
		const operation = vi.fn((n: number) => Promise.resolve(n * 2));
		const onProgress = vi.fn();

		const promise = rateLimitedBatch(
			items,
			operation,
			{ delayMs: 50 },
			onProgress
		);

		await vi.advanceTimersByTimeAsync(50);
		await promise;

		expect(onProgress).toHaveBeenCalledTimes(2);
		expect(onProgress).toHaveBeenCalledWith({
			current: 1,
			total: 2,
			message: "Processing 1 of 2",
		});
		expect(onProgress).toHaveBeenCalledWith({
			current: 2,
			total: 2,
			message: "Processing 2 of 2",
		});
	});

	it("adds delay before first item when delayFirst is true", async () => {
		const operation = vi.fn(() => Promise.resolve("ok"));

		const promise = rateLimitedBatch(["a"], operation, {
			delayMs: 200,
			delayFirst: true,
		});

		// Operation should not have been called yet
		expect(operation).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(200);
		await promise;

		expect(operation).toHaveBeenCalledTimes(1);
	});

	it("returns empty array for empty input", async () => {
		const operation = vi.fn(() => Promise.resolve("ok"));
		const results = await rateLimitedBatch([], operation);
		expect(results).toEqual([]);
		expect(operation).not.toHaveBeenCalled();
	});
});

describe("createRateLimitedFn", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("enforces minimum interval between calls", async () => {
		const fn = vi.fn((..._args: unknown[]) => Promise.resolve("result"));
		const limited = createRateLimitedFn(fn, 1000);

		// First call should execute immediately
		const p1 = limited();
		await vi.advanceTimersByTimeAsync(0);
		await p1;
		expect(fn).toHaveBeenCalledTimes(1);

		// Second call 500ms later should wait the remaining 500ms
		vi.advanceTimersByTime(500);
		const p2 = limited();
		await vi.advanceTimersByTimeAsync(500);
		await p2;
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("does not delay if enough time has passed", async () => {
		const fn = vi.fn((..._args: unknown[]) => Promise.resolve("result"));
		const limited = createRateLimitedFn(fn, 100);

		await limited();
		vi.advanceTimersByTime(200);
		await limited();
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe("batchProcess", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("processes items in batches with inter-batch delays", async () => {
		const items = [1, 2, 3, 4];
		const operation = vi.fn((n: number) => Promise.resolve(n * 10));
		const onBatchProgress = vi.fn();

		const promise = batchProcess(items, operation, {
			batchSize: 2,
			batchDelayMs: 500,
			onBatchProgress,
		});

		// First batch processes immediately (no delay before first batch)
		await vi.advanceTimersByTimeAsync(0);
		// Inter-batch delay of 500ms before second batch
		await vi.advanceTimersByTimeAsync(500);

		const results = await promise;
		expect(results).toEqual([10, 20, 30, 40]);
		expect(onBatchProgress).toHaveBeenCalledWith(1, 2);
		expect(onBatchProgress).toHaveBeenCalledWith(2, 2);
	});

	it("uses itemDelayMs for sequential processing within batch", async () => {
		const items = ["a", "b", "c"];
		const operation = vi.fn((item: string) => Promise.resolve(item));
		const onItemProgress = vi.fn();

		const promise = batchProcess(items, operation, {
			batchSize: 3,
			itemDelayMs: 100,
			onItemProgress,
		});

		// item 0 runs immediately, then 100ms delay, item 1, 100ms delay, item 2
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);

		const results = await promise;
		expect(results).toEqual(["a", "b", "c"]);
		expect(onItemProgress).toHaveBeenCalledTimes(3);
		expect(onItemProgress).toHaveBeenCalledWith({
			current: 1,
			total: 3,
		});
		expect(onItemProgress).toHaveBeenCalledWith({
			current: 3,
			total: 3,
		});
	});

	it("processes batch items concurrently when itemDelayMs is 0", async () => {
		const items = [1, 2, 3];
		const callOrder: number[] = [];
		const operation = vi.fn((n: number) => {
			callOrder.push(n);
			return Promise.resolve(n);
		});

		const promise = batchProcess(items, operation, {
			batchSize: 3,
			itemDelayMs: 0,
		});

		const results = await promise;
		expect(results).toEqual([1, 2, 3]);
		// All called in one batch
		expect(callOrder).toEqual([1, 2, 3]);
	});

	it("returns empty array for empty input", async () => {
		const operation = vi.fn((n: number) => Promise.resolve(n));
		const results = await batchProcess([], operation);
		expect(results).toEqual([]);
		expect(operation).not.toHaveBeenCalled();
	});
});

// ==================== concurrency.ts ====================

describe("runStaggered", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns empty array for empty task list", async () => {
		const results = await runStaggered([], 3);
		expect(results).toEqual([]);
	});

	it("runs tasks and returns PromiseSettledResult array", async () => {
		const tasks = [() => Promise.resolve("a"), () => Promise.resolve("b")];

		const promise = runStaggered(tasks, 2, 100);

		// Task 0 starts immediately, task 1 at 100ms
		await vi.advanceTimersByTimeAsync(100);

		const results = await promise;
		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({ status: "fulfilled", value: "a" });
		expect(results[1]).toEqual({ status: "fulfilled", value: "b" });
	});

	it("handles task failures gracefully without crashing", async () => {
		const tasks = [
			() => Promise.resolve("ok"),
			() => Promise.reject(new Error("fail")),
			() => Promise.resolve("also ok"),
		];

		const promise = runStaggered(tasks, 3, 50);

		await vi.advanceTimersByTimeAsync(100); // enough for all staggers

		const results = await promise;
		expect(results).toHaveLength(3);
		expect(results[0]).toEqual({ status: "fulfilled", value: "ok" });
		expect(results[1].status).toBe("rejected");
		expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
		expect(results[2]).toEqual({ status: "fulfilled", value: "also ok" });
	});

	it("respects maxConcurrent limit", async () => {
		let activeTasks = 0;
		let maxObservedConcurrency = 0;

		const createTask = (duration: number) => async () => {
			activeTasks++;
			maxObservedConcurrency = Math.max(maxObservedConcurrency, activeTasks);
			await new Promise<void>((r) => setTimeout(r, duration));
			activeTasks--;
			return duration;
		};

		// 4 tasks with maxConcurrent=2, stagger=100ms, each takes 500ms
		const tasks = [
			createTask(500),
			createTask(500),
			createTask(500),
			createTask(500),
		];

		const promise = runStaggered(tasks, 2, 100);

		// Advance enough to start first two tasks and let them complete
		// t=0: task 0 starts
		// t=100: task 1 starts (concurrent=2, at limit)
		// t=200: task 2 stagger expires, but blocked by concurrency
		// t=300: task 3 stagger expires, but blocked by concurrency
		// t=500: task 0 finishes -> task 2 starts
		// t=600: task 1 finishes -> task 3 starts
		// t=1000: task 2 finishes
		// t=1100: task 3 finishes
		await vi.advanceTimersByTimeAsync(1200);

		const results = await promise;
		expect(results).toHaveLength(4);
		expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
	});

	it("staggers task start times", async () => {
		const startTimes: number[] = [];

		const tasks = [0, 1, 2].map(() => async () => {
			startTimes.push(Date.now());
			return "done";
		});

		const promise = runStaggered(tasks, 5, 200);

		// t=0: task 0 starts
		// t=200: task 1 starts
		// t=400: task 2 starts
		await vi.advanceTimersByTimeAsync(400);

		await promise;

		expect(startTimes).toHaveLength(3);
		// Each successive task starts ~200ms after the first
		expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(200);
		expect(startTimes[2] - startTimes[0]).toBeGreaterThanOrEqual(400);
	});
});

// ==================== api-key-manager.ts ====================

describe("parseApiKeys", () => {
	it("parses a single key", () => {
		expect(parseApiKeys("sk-abc123")).toEqual(["sk-abc123"]);
	});

	it("parses comma-separated keys", () => {
		expect(parseApiKeys("key1,key2,key3")).toEqual(["key1", "key2", "key3"]);
	});

	it("parses newline-separated keys", () => {
		expect(parseApiKeys("key1\nkey2\nkey3")).toEqual(["key1", "key2", "key3"]);
	});

	it("trims whitespace from keys", () => {
		expect(parseApiKeys("  key1 , key2 , key3  ")).toEqual([
			"key1",
			"key2",
			"key3",
		]);
	});

	it("filters out empty strings", () => {
		expect(parseApiKeys("key1,,key2,")).toEqual(["key1", "key2"]);
	});

	it("returns empty array for empty string", () => {
		expect(parseApiKeys("")).toEqual([]);
	});
});

describe("maskApiKey", () => {
	it("masks a long key showing first 8 and last 4 chars", () => {
		expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-12345...cdef");
	});

	it("masks a short key (<=10 chars) showing first 4 chars", () => {
		expect(maskApiKey("abcdefgh")).toBe("abcd***");
	});

	it("returns '(not set)' for empty string", () => {
		expect(maskApiKey("")).toBe("(not set)");
	});

	it("handles exactly 10 characters", () => {
		expect(maskApiKey("1234567890")).toBe("1234***");
	});

	it("handles exactly 11 characters", () => {
		expect(maskApiKey("12345678901")).toBe("12345678...8901");
	});
});

describe("classifyModelByName", () => {
	it("classifies video generation models", () => {
		expect(classifyModelByName("veo-2")).toEqual(["video_generation"]);
		expect(classifyModelByName("sora-turbo")).toEqual(["video_generation"]);
		expect(classifyModelByName("kling-pro")).toEqual(["video_generation"]);
		expect(classifyModelByName("wan-2.1")).toEqual(["video_generation"]);
		expect(classifyModelByName("runway-gen3")).toEqual(["video_generation"]);
		expect(classifyModelByName("luma-dream-machine")).toEqual([
			"video_generation",
		]);
		expect(classifyModelByName("grok-video-1")).toEqual(["video_generation"]);
	});

	it("classifies image generation models", () => {
		expect(classifyModelByName("dall-e-3")).toEqual(["image_generation"]);
		expect(classifyModelByName("flux-pro")).toEqual(["image_generation"]);
		expect(classifyModelByName("gpt-image-1")).toEqual(["image_generation"]);
		expect(classifyModelByName("stable-diffusion-xl")).toEqual([
			"image_generation",
		]);
		expect(classifyModelByName("ideogram-v2")).toEqual(["image_generation"]);
		expect(classifyModelByName("sdxl-turbo")).toEqual(["image_generation"]);
		expect(classifyModelByName("image-preview-test")).toEqual([
			"image_generation",
		]);
	});

	it("classifies imagen as video_generation due to gen-3 pattern overlap", () => {
		// Note: "imagen-3" contains "gen-3" which matches video patterns first
		expect(classifyModelByName("imagen-3")).toEqual(["video_generation"]);
	});

	it("classifies vision models", () => {
		expect(classifyModelByName("gpt-4-vision")).toEqual(["text", "vision"]);
	});

	it("classifies embedding models", () => {
		expect(classifyModelByName("text-embedding-3-large")).toEqual([
			"embedding",
		]);
	});

	it("classifies reasoning models", () => {
		expect(classifyModelByName("o1-preview")).toEqual(["text", "reasoning"]);
		expect(classifyModelByName("deepseek-r1")).toEqual(["text", "reasoning"]);
		expect(classifyModelByName("model-thinking")).toEqual([
			"text",
			"reasoning",
		]);
	});

	it("defaults to text for unknown models", () => {
		expect(classifyModelByName("gpt-4o")).toEqual(["text"]);
		expect(classifyModelByName("claude-3-opus")).toEqual(["text"]);
		expect(classifyModelByName("gemini-2.0-flash")).toEqual(["text"]);
	});
});

describe("ApiKeyManager", () => {
	beforeEach(() => {
		vi.spyOn(Math, "random").mockReturnValue(0);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("constructs with parsed keys", () => {
		const manager = new ApiKeyManager("key1,key2,key3");
		expect(manager.getTotalKeyCount()).toBe(3);
		expect(manager.hasKeys()).toBe(true);
	});

	it("handles empty key string", () => {
		const manager = new ApiKeyManager("");
		expect(manager.getTotalKeyCount()).toBe(0);
		expect(manager.hasKeys()).toBe(false);
		expect(manager.getCurrentKey()).toBeNull();
	});

	it("returns current key via getCurrentKey()", () => {
		const manager = new ApiKeyManager("key1,key2,key3");
		// Math.random mocked to 0, so currentIndex = floor(0 * 3) = 0
		expect(manager.getCurrentKey()).toBe("key1");
	});

	it("rotates keys with rotateKey()", () => {
		const manager = new ApiKeyManager("key1,key2,key3");
		expect(manager.getCurrentKey()).toBe("key1");

		const next = manager.rotateKey();
		expect(next).toBe("key2");

		const next2 = manager.rotateKey();
		expect(next2).toBe("key3");

		// Wraps around
		const next3 = manager.rotateKey();
		expect(next3).toBe("key1");
	});

	it("skips blacklisted keys during rotation", () => {
		vi.useFakeTimers();
		const manager = new ApiKeyManager("key1,key2,key3");

		// Blacklist key1 by marking it failed
		manager.markCurrentKeyFailed();

		// After marking failed, it rotates. key1 is blacklisted, so getCurrentKey should skip it.
		const current = manager.getCurrentKey();
		expect(current).not.toBe("key1");
		expect(current === "key2" || current === "key3").toBe(true);

		vi.useRealTimers();
	});

	it("handleError blacklists and rotates on 429", () => {
		vi.useFakeTimers();
		const manager = new ApiKeyManager("key1,key2");

		expect(manager.getCurrentKey()).toBe("key1");
		const rotated = manager.handleError(429);
		expect(rotated).toBe(true);
		expect(manager.getCurrentKey()).toBe("key2");

		vi.useRealTimers();
	});

	it("handleError blacklists and rotates on 401", () => {
		vi.useFakeTimers();
		const manager = new ApiKeyManager("key1,key2");

		const rotated = manager.handleError(401);
		expect(rotated).toBe(true);
		expect(manager.getCurrentKey()).toBe("key2");

		vi.useRealTimers();
	});

	it("handleError blacklists and rotates on 503", () => {
		vi.useFakeTimers();
		const manager = new ApiKeyManager("key1,key2");

		const rotated = manager.handleError(503);
		expect(rotated).toBe(true);
		expect(manager.getCurrentKey()).toBe("key2");

		vi.useRealTimers();
	});

	it("handleError does not rotate on 500", () => {
		const manager = new ApiKeyManager("key1,key2");

		const rotated = manager.handleError(500);
		expect(rotated).toBe(false);
		expect(manager.getCurrentKey()).toBe("key1");
	});

	it("recovers blacklisted keys after 90 seconds", () => {
		vi.useFakeTimers();
		const manager = new ApiKeyManager("key1,key2");

		// Blacklist key1
		manager.handleError(429);
		expect(manager.getAvailableKeyCount()).toBe(1);

		// Advance 90 seconds
		vi.advanceTimersByTime(90_000);

		// Key should be recovered
		expect(manager.getAvailableKeyCount()).toBe(2);

		vi.useRealTimers();
	});

	it("returns first key when all keys are blacklisted", () => {
		vi.useFakeTimers();
		const manager = new ApiKeyManager("key1,key2");

		manager.handleError(429); // blacklists key1, rotates to key2
		manager.handleError(429); // blacklists key2

		// All blacklisted, should fall back to first key
		const key = manager.getCurrentKey();
		expect(key).toBe("key1");

		vi.useRealTimers();
	});

	it("getAvailableKeyCount returns non-blacklisted count", () => {
		vi.useFakeTimers();
		const manager = new ApiKeyManager("key1,key2,key3");
		expect(manager.getAvailableKeyCount()).toBe(3);

		manager.handleError(429);
		expect(manager.getAvailableKeyCount()).toBe(2);

		vi.useRealTimers();
	});

	it("reset clears keys and blacklist", () => {
		vi.useFakeTimers();
		const manager = new ApiKeyManager("key1,key2");
		manager.handleError(429);
		expect(manager.getAvailableKeyCount()).toBe(1);

		manager.reset("newkey1,newkey2,newkey3");
		expect(manager.getTotalKeyCount()).toBe(3);
		expect(manager.getAvailableKeyCount()).toBe(3);

		vi.useRealTimers();
	});

	it("rotateKey returns getCurrentKey for single-key manager", () => {
		const manager = new ApiKeyManager("only-key");
		expect(manager.rotateKey()).toBe("only-key");
		expect(manager.rotateKey()).toBe("only-key");
	});
});
