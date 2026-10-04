// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBeautyLabLiveCandidateJob } from "../beauty-lab-live-candidate-process.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
let child: EventEmitter & {
	stdout: PassThrough;
	stderr: PassThrough;
	kill: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn(),
	});
	mocks.spawn.mockReturnValue(child);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});
function execute({ signal }: { signal?: AbortSignal } = {}) {
	return runBeautyLabLiveCandidateJob({
		python: "/trusted/venv/bin/python",
		args: ["-B", "/trusted/job.py", "--request", "/fresh/request.json"],
		cwd: "/trusted",
		signal,
	});
}

describe("static candidate process ownership (no real processes)", () => {
	it("does not spawn an already-cancelled job", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(execute({ signal: controller.signal })).rejects.toThrow(
			/cancelled/
		);
		expect(mocks.spawn).not.toHaveBeenCalled();
	});
	it("aborts with SIGTERM but stays pending until the child closes", async () => {
		const controller = new AbortController();
		const pending = execute({ signal: controller.signal });
		let settled = false;
		const rejected = expect(pending).rejects.toThrow(/cancelled/);
		void pending.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			}
		);
		controller.abort();
		await Promise.resolve();
		expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
		expect(settled).toBe(false);
		child.emit("exit", 0, null);
		await Promise.resolve();
		expect(settled).toBe(false);
		child.emit("close", 0, null);
		await rejected;
		expect(settled).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("removes cancellation listeners after successful close", async () => {
		const controller = new AbortController();
		const pending = execute({ signal: controller.signal });
		child.emit("close", 0, null);
		await pending;
		controller.abort();
		expect(child.kill).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("spawns argv without a shell or injected Python/native search paths", async () => {
		vi.stubEnv("PYTHONPATH", "/injected");
		vi.stubEnv("DYLD_INSERT_LIBRARIES", "/injected.dylib");
		const pending = execute();
		expect(mocks.spawn).toHaveBeenCalledWith(
			"/trusted/venv/bin/python",
			expect.any(Array),
			expect.objectContaining({
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			})
		);
		const options = mocks.spawn.mock.calls[0][2];
		expect(options.env).not.toHaveProperty("PYTHONPATH");
		expect(options.env).not.toHaveProperty("DYLD_INSERT_LIBRARIES");
		child.emit("close", 0, null);
		await pending;
		expect(vi.getTimerCount()).toBe(0);
	});
	it("waits for SIGTERM cleanup and rejects even if Python then exits zero", async () => {
		const pending = expect(execute()).rejects.toThrow(/timed out/);
		await vi.advanceTimersByTimeAsync(300_000);
		expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
		child.emit("close", 0, null);
		await pending;
		expect(vi.getTimerCount()).toBe(0);
	});
	it("bounds failed cleanup with SIGKILL, reaps, and never returns pixels", async () => {
		const pending = expect(execute()).rejects.toThrow(
			/cleanup deadline exceeded/
		);
		await vi.advanceTimersByTimeAsync(330_000);
		expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
		child.emit("close", null, "SIGKILL");
		await pending;
		expect(vi.getTimerCount()).toBe(0);
	});
	it("bounds combined stdout/stderr without retaining logs in memory", async () => {
		const pending = expect(execute()).rejects.toThrow(/output exceeded/);
		child.stdout.emit("data", Buffer.alloc(600_000));
		child.stderr.emit("data", Buffer.alloc(600_000));
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		child.emit("close", 1, null);
		await pending;
		expect(vi.getTimerCount()).toBe(0);
	});
	it.each([
		{ code: 1, signal: null },
		{ code: null, signal: "SIGTERM" },
	])("rejects failed process: %j", async ({ code, signal }) => {
		const pending = expect(execute()).rejects.toThrow(/job failed/);
		child.emit("close", code, signal);
		await pending;
	});
	it("clears watchdogs on spawn error", async () => {
		const pending = expect(execute()).rejects.toThrow("ENOENT");
		child.emit("error", new Error("ENOENT"));
		child.emit("close", -2, null);
		await pending;
		expect(vi.getTimerCount()).toBe(0);
	});
});
