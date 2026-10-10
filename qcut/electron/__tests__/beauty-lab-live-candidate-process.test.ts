// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	beautyLabLiveJobFailure,
	type BeautyLabLiveJobFailure,
} from "../beauty-lab/beauty-lab-live-candidate-failure.js";
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

function errorLine({ message }: { message: string }) {
	return Buffer.from(
		`QCUT_LIVE_CANDIDATE_ERROR=${JSON.stringify({ message })}\n`
	);
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
		const allowedEnv = {
			HOME: "/home/test",
			PATH: "/trusted/bin",
			TMPDIR: "/tmp/test",
			USER: "test",
			LOGNAME: "test",
			LANG: "en_US.UTF-8",
			LC_ALL: "en_US.UTF-8",
			LC_CTYPE: "en_US.UTF-8",
			QCUT_BEAUTY_LAB_SIGNING_IDENTITY: "test-signing-identity",
		};
		for (const [key, value] of Object.entries(allowedEnv)) {
			vi.stubEnv(key, value);
		}
		vi.stubEnv("PYTHONDONTWRITEBYTECODE", "0");
		vi.stubEnv("PYTHONPATH", "/injected");
		vi.stubEnv("PYTHONHOME", "/injected");
		vi.stubEnv("DYLD_INSERT_LIBRARIES", "/injected.dylib");
		vi.stubEnv("DYLD_LIBRARY_PATH", "/injected");
		vi.stubEnv("QCUT_BEAUTY_LAB_OTHER", "not-allowed");
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
		expect(options.env).toEqual({
			...allowedEnv,
			PYTHONDONTWRITEBYTECODE: "1",
		});
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

describe("bounded live candidate error protocol", () => {
	it.each([
		{ code: 1, signal: null, reason: "1" },
		{ code: 7, signal: null, reason: "7" },
		{ code: null, signal: "SIGTERM", reason: "SIGTERM" },
	])("adds detail without hiding exit status: $reason", async ({
		code,
		signal,
		reason,
	}) => {
		const pending = expect(execute()).rejects.toThrow(
			new Error(
				`Live candidate job failed (${reason}): Signing identity missing`
			)
		);
		child.stderr.write("private traceback before\n");
		child.stderr.write(errorLine({ message: "Signing identity missing" }));
		child.stderr.write("private traceback after\n");
		child.emit("close", code, signal);
		await pending;
		expect(child.kill).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("preserves split prefixes, JSON, UTF-8 characters, and CRLF", async () => {
		const message = "Missing \u7b7e\u540d \ud83d\udd11";
		const pending = expect(execute()).rejects.toThrow(
			new Error(`Live candidate job failed (1): ${message}`)
		);
		const line = errorLine({ message });
		for (const byte of line.subarray(0, -1)) {
			child.stderr.write(Buffer.from([byte]));
		}
		child.stderr.write("\r");
		child.stderr.write("\n");
		child.emit("close", 1, null);
		await pending;
	});

	it("accepts a complete final record without a newline at close", async () => {
		const pending = expect(execute()).rejects.toThrow(
			new Error("Live candidate job failed (1): Final detail")
		);
		child.emit("exit", 1, null);
		child.stderr.write(errorLine({ message: "Final detail" }).subarray(0, -1));
		child.emit("close", 1, null);
		await pending;
	});

	it.each([
		{ name: "invalid JSON", payload: "{" },
		{ name: "null", payload: "null" },
		{ name: "array", payload: '[{"message":"not an object"}]' },
		{ name: "primitive", payload: '"not an object"' },
		{ name: "missing message", payload: "{}" },
		{ name: "non-string message", payload: '{"message":42}' },
		{ name: "empty message", payload: '{"message":""}' },
		{
			name: "control-only message",
			payload: '{"message":"\\n\\u0000\\u202e"}',
		},
		{ name: "trailing text", payload: '{"message":"private"} trailing' },
	])("ignores $name without displaying raw stderr", async ({ payload }) => {
		const pending = expect(execute()).rejects.toThrow(
			new Error("Live candidate job failed (1)")
		);
		child.stderr.write(
			`private traceback\nQCUT_LIVE_CANDIDATE_ERROR=${payload}\n`
		);
		child.emit("close", 1, null);
		await pending;
	});

	it("ignores malformed UTF-8 even when the JSON shape is valid", async () => {
		const pending = expect(execute()).rejects.toThrow(
			new Error("Live candidate job failed (1)")
		);
		child.stderr.write(Buffer.from('QCUT_LIVE_CANDIDATE_ERROR={"message":"'));
		child.stderr.write(Buffer.from([0xc3]));
		child.stderr.write(Buffer.from('"}\n'));
		child.emit("close", 1, null);
		await pending;
	});

	it("only accepts the prefix at the start of a stderr line", async () => {
		const pending = expect(execute()).rejects.toThrow(
			new Error("Live candidate job failed (1)")
		);
		child.stdout.write(errorLine({ message: "stdout detail" }));
		child.stderr.write("traceback: ");
		child.stderr.write(errorLine({ message: "embedded detail" }));
		child.stderr.write(" ");
		child.stderr.write(errorLine({ message: "indented detail" }));
		child.emit("close", 1, null);
		await pending;
	});

	it("sanitizes terminal escapes, control characters, and whitespace", async () => {
		const pending = expect(execute()).rejects.toThrow(
			new Error("Live candidate job failed (1): Missing identity; retry now")
		);
		child.stderr.write(
			errorLine({
				message:
					" \u001b[31mMissing\u001b[0m\nidentity;\t\u0000\u007f\u0085\u202e retry\u2028now\r ",
			})
		);
		child.emit("close", 1, null);
		await pending;
	});

	it.each([
		{
			name: "exact limit",
			message: "x".repeat(2000),
			detail: "x".repeat(2000),
		},
		{ name: "truncated", message: "x".repeat(2001), detail: "x".repeat(2000) },
		{
			name: "surrogate boundary",
			message: `${"x".repeat(1999)}\ud83d\udd11`,
			detail: "x".repeat(1999),
		},
	])("caps sanitized detail at 2000 characters: $name", async ({
		message,
		detail,
	}) => {
		const pending = expect(execute()).rejects.toThrow(
			new Error(`Live candidate job failed (1): ${detail}`)
		);
		child.stderr.write(errorLine({ message }));
		child.emit("close", 1, null);
		await pending;
	});

	it("accepts Python ASCII-escaped Unicode within the bounded record", async () => {
		const pending = expect(execute()).rejects.toThrow(
			new Error(`Live candidate job failed (1): ${"\ud83d\udd11".repeat(1000)}`)
		);
		child.stderr.write(
			`QCUT_LIVE_CANDIDATE_ERROR={"message":"${"\\ud83d\\udd11".repeat(2000)}"}\n`
		);
		child.emit("close", 1, null);
		await pending;
	});

	it.each([
		{ extra: 0, ending: "\n", detail: ": Bounded detail" },
		{ extra: 1, ending: "\n", detail: "" },
		{ extra: 0, ending: "", detail: ": Bounded detail" },
		{ extra: 1, ending: "", detail: "" },
	])("enforces the 32 KiB line boundary: %j", async ({
		extra,
		ending,
		detail,
	}) => {
		const pending = expect(execute()).rejects.toThrow(
			new Error(`Live candidate job failed (1)${detail}`)
		);
		const line = errorLine({ message: "Bounded detail" }).subarray(0, -1);
		child.stderr.write(line);
		child.stderr.write(" ".repeat(32 * 1024 - line.length + extra));
		child.stderr.write(ending);
		child.emit("close", 1, null);
		await pending;
		expect(child.kill).not.toHaveBeenCalled();
	});

	it("discards oversized lines through newline, then recovers the first valid record", async () => {
		const pending = expect(execute()).rejects.toThrow(
			new Error("Live candidate job failed (1): First valid detail")
		);
		child.stderr.write('QCUT_LIVE_CANDIDATE_ERROR={"message":"');
		for (let index = 0; index < 8; index += 1) {
			child.stderr.write("x".repeat(8192));
		}
		child.stderr.write(errorLine({ message: "Must not recover mid-line" }));
		child.stderr.write(
			Buffer.concat([
				Buffer.from('QCUT_LIVE_CANDIDATE_ERROR={"message":false}\n'),
				errorLine({ message: "First valid detail" }),
				errorLine({ message: "Later detail" }),
			])
		);
		child.emit("close", 1, null);
		await pending;
	});

	it.each([
		{ newline: true },
		{ newline: false },
	])("does not fail zero exit with protocol output: %j", async ({
		newline,
	}) => {
		const pending = execute();
		const line = errorLine({ message: "Nonfatal detail" });
		child.stderr.write(newline ? line : line.subarray(0, -1));
		child.emit("close", 0, null);
		await expect(pending).resolves.toBeUndefined();
		expect(child.kill).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		{ extra: 0 },
		{ extra: 1 },
	])("keeps the combined byte budget exact with $extra extra bytes", async ({
		extra,
	}) => {
		const line = errorLine({ message: "\u7b7e\u540d error" });
		const expected = extra
			? "Live candidate process output exceeded budget"
			: "Live candidate job failed (1): \u7b7e\u540d error";
		const pending = expect(execute()).rejects.toThrow(new Error(expected));
		child.stderr.write(line);
		child.stdout.write(Buffer.alloc(600_000));
		child.stderr.write(
			Buffer.alloc(1024 * 1024 - 600_000 - line.length + extra)
		);
		expect(child.kill.mock.calls).toEqual(extra ? [["SIGTERM"]] : []);
		child.emit("close", 1, null);
		await pending;
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		{ failure: "cancel", expected: "Live candidate job cancelled" },
		{ failure: "timeout", expected: "Live candidate job timed out" },
		{
			failure: "cleanup",
			expected:
				"Live candidate job timed out; Python cleanup deadline exceeded",
		},
		{ failure: "spawn", expected: "ENOENT" },
	])("preserves $failure precedence over protocol detail", async ({
		failure,
		expected,
	}) => {
		const controller = new AbortController();
		const pending = expect(
			execute({ signal: controller.signal })
		).rejects.toThrow(new Error(expected));
		child.stderr.write(errorLine({ message: "Earlier protocol detail" }));
		if (failure === "cancel") controller.abort();
		if (failure === "timeout") await vi.advanceTimersByTimeAsync(300_000);
		if (failure === "cleanup") await vi.advanceTimersByTimeAsync(330_000);
		if (failure === "spawn") child.emit("error", new Error("ENOENT"));
		child.stderr.write(errorLine({ message: "Later protocol detail" }));
		child.emit("close", 0, null);
		await pending;
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("structured failure kinds for restart decisions", () => {
	async function failure({
		pending,
	}: {
		pending: Promise<void>;
	}): Promise<BeautyLabLiveJobFailure & { message: string }> {
		const error = await pending.then(
			() => {
				throw new Error("Expected the job to fail");
			},
			(reason: unknown) => reason
		);
		// The thrown value stays a plain Error so existing callers see no change.
		expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
		const classified = beautyLabLiveJobFailure({ error });
		if (!classified) throw new Error("Unclassified job failure");
		return { ...classified, message: (error as Error).message };
	}

	it("marks a cancellation before spawn as not started", async () => {
		const controller = new AbortController();
		controller.abort();
		const error = await failure({
			pending: execute({ signal: controller.signal }),
		});
		expect(error).toMatchObject({ kind: "not-started", forced: false });
		expect(mocks.spawn).not.toHaveBeenCalled();
	});
	it("keeps a cancellation unforced when Python closes within the grace period", async () => {
		const controller = new AbortController();
		const pending = execute({ signal: controller.signal });
		controller.abort();
		await vi.advanceTimersByTimeAsync(29_999);
		child.emit("close", 1, null);
		const error = await failure({ pending });
		expect(error).toMatchObject({ kind: "cancelled", forced: false });
		expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
	});
	it("marks a cancellation forced once SIGKILL replaces Python cleanup", async () => {
		const controller = new AbortController();
		const pending = execute({ signal: controller.signal });
		controller.abort();
		await vi.advanceTimersByTimeAsync(30_000);
		child.emit("close", null, "SIGKILL");
		const error = await failure({ pending });
		expect(error).toMatchObject({ kind: "cancelled", forced: true });
		expect(error.message).toMatch(/cleanup deadline exceeded/);
	});
	it.each([
		{ code: 1, signal: null, kind: "exit-code" },
		{ code: null, signal: "SIGSEGV", kind: "exit-signal" },
	])("separates a self-reported exit from a signal death: $kind", async ({
		code,
		signal,
		kind,
	}) => {
		const pending = execute();
		child.emit("close", code, signal);
		const error = await failure({ pending });
		expect(error).toMatchObject({ kind, forced: false });
	});
	it.each([
		{ trigger: "timeout", kind: "timeout" },
		{ trigger: "output", kind: "output-budget" },
		{ trigger: "spawn", kind: "process-error" },
	])("labels $trigger failures as $kind", async ({ trigger, kind }) => {
		const pending = execute();
		if (trigger === "timeout") await vi.advanceTimersByTimeAsync(300_000);
		if (trigger === "output")
			child.stdout.emit("data", Buffer.alloc(1_100_000));
		if (trigger === "spawn") child.emit("error", new Error("ENOENT"));
		child.emit("close", 1, null);
		const error = await failure({ pending });
		expect(error).toMatchObject({ kind, forced: false });
	});
});
