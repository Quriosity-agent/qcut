import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAudioMeasurementProcess } from "../ffmpeg/audio-measurement-process.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

function makeChild() {
	return Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn(() => true),
	});
}

let child: ReturnType<typeof makeChild>;

beforeEach(() => {
	vi.useFakeTimers();
	child = makeChild();
	vi.mocked(spawn).mockReset();
	vi.mocked(spawn).mockReturnValue(
		child as unknown as ReturnType<typeof spawn>
	);
});

afterEach(() => {
	vi.useRealTimers();
});

function run({ signal }: { signal?: AbortSignal } = {}) {
	return runAudioMeasurementProcess({
		command: "/meter",
		args: ["input.mp4"],
		timeout: 1000,
		signal,
	});
}

describe("audio measurement process ownership", () => {
	it("collects byte chunks without splitting multibyte output", async () => {
		const result = run();
		const bytes = Buffer.from("中文");
		child.stdout.write(bytes.subarray(0, 2));
		child.stdout.write(bytes.subarray(2));
		child.stderr.write("Summary\n");
		child.emit("close", 0, null);
		await expect(result).resolves.toEqual({
			stdout: "中文",
			stderr: "Summary\n",
		});
		expect(spawn).toHaveBeenCalledWith("/meter", ["input.mp4"], {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not spawn an already cancelled measurement", async () => {
		const controller = new AbortController();
		controller.abort(new Error("already cancelled"));
		await expect(run({ signal: controller.signal })).rejects.toThrow(
			"already cancelled"
		);
		expect(spawn).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("kills on abort and waits for close before rejecting", async () => {
		const controller = new AbortController();
		const removeListener = vi.spyOn(controller.signal, "removeEventListener");
		const settled = vi.fn();
		const result = run({ signal: controller.signal }).catch(settled);
		const reason = new Error("cancelled");
		controller.abort(reason);
		expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
		await Promise.resolve();
		expect(settled).not.toHaveBeenCalled();
		child.emit("close", null, "SIGKILL");
		await result;
		expect(settled).toHaveBeenCalledExactlyOnceWith(reason);
		expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
		expect(vi.getTimerCount()).toBe(0);
	});

	it("kills on timeout and still waits for close", async () => {
		const settled = vi.fn();
		const result = run().catch(settled);
		await vi.advanceTimersByTimeAsync(1000);
		expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
		expect(settled).not.toHaveBeenCalled();
		child.emit("close", null, "SIGKILL");
		await result;
		expect(settled).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Audio measurement timed out",
			})
		);
	});

	it.each([
		"stdout",
		"stderr",
	] as const)("bounds combined output bytes when %s exceeds the cap", async (stream) => {
		const result = run();
		const rejected = expect(result).rejects.toThrow("exceeded 128 KiB");
		child.stdout.write(Buffer.alloc(64 * 1024));
		child.stderr.write(Buffer.alloc(64 * 1024));
		expect(child.kill).not.toHaveBeenCalled();
		child[stream].write(Buffer.from("中"));
		expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
		child.emit("close", null, "SIGKILL");
		await rejected;
	});

	it("preserves spawn errors and waits for their close event", async () => {
		const error = new Error("spawn ENOENT");
		const settled = vi.fn();
		const result = run().catch(settled);
		child.emit("error", error);
		await Promise.resolve();
		expect(settled).not.toHaveBeenCalled();
		child.emit("close", -2, null);
		await result;
		expect(settled).toHaveBeenCalledExactlyOnceWith(error);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("rejects an unsuccessful meter with its diagnostic output", async () => {
		const result = run();
		const rejected = expect(result).rejects.toThrow(
			"code 1: unsupported input"
		);
		child.stderr.write("unsupported input");
		child.emit("close", 1, null);
		await rejected;
	});

	it("removes cancellation listeners when the process succeeds", async () => {
		const controller = new AbortController();
		const result = run({ signal: controller.signal });
		child.emit("close", 0, null);
		await result;
		controller.abort();
		await vi.advanceTimersByTimeAsync(1000);
		expect(child.kill).not.toHaveBeenCalled();
		expect(child.stdout.listenerCount("data")).toBe(0);
		expect(child.stderr.listenerCount("data")).toBe(0);
	});
});
