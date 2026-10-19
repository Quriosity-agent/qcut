// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createIndependentBeautyWorker,
	IndependentWorkerExitedError,
} from "../beauty-lab/beauty-lab-independent-worker";

vi.mock("node:child_process", async (original) => {
	const actual = await original<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: vi.fn((_python, _args, options) =>
			actual.spawn(process.execPath, ["-e", fixture], options)
		),
	};
});

const fixture = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  fs.writeFileSync(request.report, String(process.pid));
  if (request.image === 'hang-with-child' || request.image === 'exit-with-child') {
    const code =
      "require('node:fs').writeFileSync(process.argv[1], String(process.pid));" +
      "process.send('ready'); setTimeout(() => {}, 10000);";
    const child = spawn(process.execPath, ['-e', code, request.report + '.child'], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });
    child.on('message', () => { if (request.image === 'exit-with-child') process.exit(7); });
    return;
  }
  if (request.image === 'hang') return;
  if (request.image === 'crash') process.exit(7);
  if (request.image === 'malformed') return process.stdout.write('not json\\n');
  if (request.image === 'oversized') return process.stdout.write('x'.repeat(70000));
  if (request.image === 'wrong-id') return process.stdout.write(JSON.stringify({id:'wrong',ok:true})+'\\n');
  if (request.image === 'fail') return process.stdout.write(JSON.stringify({id:request.id,ok:false,error:'bad frame'})+'\\n');
  if (request.image === 'gap') return process.stdout.write(JSON.stringify({id:request.id,ok:false,error:'SequenceGap: resumes at 3',gap:{restartFrom:3}})+'\\n');
  if (request.image === 'sequence') {
    fs.writeFileSync(request.output, JSON.stringify(request.sequence));
    return process.stdout.write(JSON.stringify({id:request.id,ok:true,sequence:{nextFrame:request.sequence.frame+1,resumed:'continued'}})+'\\n');
  }
  fs.writeFileSync(request.output, request.image);
  process.stdout.write(JSON.stringify({id:request.id,ok:true})+'\\n');
});
`;

let directory: string;
let worker: ReturnType<typeof createIndependentBeautyWorker>;
let counter = 0;
beforeEach(async () => {
	vi.mocked(spawn).mockClear();
	directory = await mkdtemp(path.join(os.tmpdir(), "beauty-resident-test-"));
	worker = createIndependentBeautyWorker({
		python: process.execPath,
		engineRoot: directory,
		runtimeRoot: directory,
	});
});
afterEach(async () => {
	await worker.dispose();
	await rm(directory, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 100,
	});
});

function job({
	image = "pixels",
	signal = new AbortController().signal,
	sourceIdentity = "engine-1",
	timeoutMs = 5000,
}: {
	image?: string;
	signal?: AbortSignal;
	sourceIdentity?: string;
	timeoutMs?: number;
} = {}) {
	const prefix = path.join(directory, `job-${++counter}`);
	const request = {
		image,
		request: `${prefix}.request`,
		output: `${prefix}.png`,
		report: `${prefix}.json`,
	};
	return {
		request,
		sourceIdentity,
		environment: process.env,
		signal,
		timeoutMs,
	};
}

function controlledChild() {
	return Object.assign(new EventEmitter(), {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		exitCode: null,
		signalCode: null,
		kill: vi.fn(),
	}) as unknown as ChildProcessWithoutNullStreams;
}

function pipeError({ code }: { code: string }) {
	return Object.assign(new Error(`write ${code}`), { code });
}

describe("resident worker transport failures", () => {
	it.each(
		["EPIPE", "ERR_STREAM_DESTROYED"].flatMap((code) =>
			["error-first", "exit-first"].map((order) => ({ code, order }))
		)
	)("recognizes $code with $order after a completed frame", async ({
		code,
		order,
	}) => {
		const child = controlledChild();
		vi.mocked(spawn).mockReturnValueOnce(child);
		const first = worker.run(job());
		const { id } = JSON.parse(String(child.stdin.read()));
		child.stdout.emit(
			"data",
			Buffer.from(`${JSON.stringify({ id, ok: true })}\n`)
		);
		await expect(first).resolves.toEqual({});
		const pending = worker.run(job());
		const rejected = expect(pending).rejects.toBeInstanceOf(
			IndependentWorkerExitedError
		);
		if (order === "exit-first") child.emit("exit", 7, null);
		child.stdin.emit("error", pipeError({ code }));
		if (order === "error-first") child.emit("exit", 7, null);
		child.emit("close", 7, null);
		await rejected;
		await expect(worker.run(job())).resolves.toEqual({});
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it.each([
		"EPIPE",
		"ERR_STREAM_DESTROYED",
	])("settles %s when the child closes without an exit event", async (code) => {
		const child = controlledChild();
		vi.mocked(spawn).mockReturnValueOnce(child);
		const rejected = expect(worker.run(job())).rejects.toBeInstanceOf(
			IndependentWorkerExitedError
		);
		child.stdin.emit("error", pipeError({ code }));
		child.emit("close", null, null);
		await rejected;
	});

	it.each([
		{ stop: "cancel", message: "cancelled" },
		{ stop: "response", message: "identity mismatch" },
		{ stop: "timeout", message: "timed out" },
	])("keeps $stop failures nonretryable after a pipe error", async ({
		stop,
		message,
	}) => {
		vi.useFakeTimers();
		try {
			const child = controlledChild();
			vi.mocked(spawn).mockReturnValueOnce(child);
			const controller = new AbortController();
			const pending = worker.run(
				job({ signal: controller.signal, timeoutMs: 100 })
			);
			const failed = pending.catch((error: unknown) => error);
			if (stop === "cancel") controller.abort();
			if (stop === "response")
				child.stdout.emit("data", Buffer.from('{"id":"wrong","ok":true}\n'));
			if (stop === "timeout") await vi.advanceTimersByTimeAsync(100);
			child.stdin.emit("error", pipeError({ code: "EPIPE" }));
			child.emit("exit", null, "SIGKILL");
			child.emit("close", null, "SIGKILL");
			const error = await failed;
			expect(error).toBeInstanceOf(Error);
			expect(error).not.toBeInstanceOf(IndependentWorkerExitedError);
			expect(error).toHaveProperty("message", expect.stringContaining(message));
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not classify an arbitrary stream failure as a worker exit", async () => {
		const child = controlledChild();
		vi.mocked(spawn).mockReturnValueOnce(child);
		const original = pipeError({ code: "EIO" });
		const rejected = expect(worker.run(job())).rejects.toBe(original);
		child.stdin.emit("error", original);
		child.emit("close", null, null);
		await rejected;
	});
});

describe("resident beauty process lifetime", () => {
	it("reuses a real process for successive frames and recycles on source changes", async () => {
		const first = job();
		const second = job({ image: "different pixels" });
		await worker.run(first);
		await worker.run(second);
		expect(await readFile(first.request.report, "utf8")).toBe(
			await readFile(second.request.report, "utf8")
		);
		expect(await readFile(second.request.output, "utf8")).toBe(
			"different pixels"
		);
		await worker.run(job({ sourceIdentity: "engine-2" }));
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it.each([
		"crash",
		"malformed",
		"oversized",
		"wrong-id",
		"fail",
	])("recovers after %s without publishing a success", async (image) => {
		await expect(worker.run(job({ image }))).rejects.toThrow();
		await expect(worker.run(job())).resolves.toEqual({});
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it("cancels an active process and accepts the next frame on a new process", async () => {
		const controller = new AbortController();
		const input = job({ image: "hang", signal: controller.signal });
		const pending = worker.run(input);
		const rejected = expect(pending).rejects.toThrow("cancelled");
		await vi.waitFor(async () =>
			expect(await readFile(input.request.report, "utf8")).toMatch(/^\d+$/)
		);
		const pid = Number(await readFile(input.request.report, "utf8"));
		controller.abort();
		await rejected;
		expect(() => process.kill(pid, 0)).toThrow();
		await worker.run(job());
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it("names a death under a request so a body-video session can resubmit", async () => {
		// A crash (or an outside SIGKILL) is not a stop() with a reason: the
		// pending request must learn the process is gone, not just that it failed.
		const failure = worker.run(job({ image: "crash" }));
		await expect(failure).rejects.toBeInstanceOf(IndependentWorkerExitedError);
		await expect(failure).rejects.toMatchObject({ exitCode: 7, signal: null });
		await expect(worker.run(job())).resolves.toEqual({});
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it("answers a body-video history gap without losing the process", async () => {
		const first = job({ image: "gap" });
		await expect(worker.run(first)).resolves.toEqual({
			gap: { restartFrom: 3 },
		});
		const sequence = {
			session: "s".repeat(64),
			frame: 4,
			timestamp: 1 / 6,
			checkpoints: directory,
		};
		const second = job({ image: "sequence" });
		await expect(
			worker.run({ ...second, request: { ...second.request, sequence } })
		).resolves.toEqual({});
		expect(JSON.parse(await readFile(second.request.output, "utf8"))).toEqual(
			sequence
		);
		expect(await readFile(first.request.report, "utf8")).toBe(
			await readFile(second.request.report, "utf8")
		);
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("times out a hung job and recovers", async () => {
		await expect(
			worker.run(job({ image: "hang", timeoutMs: 100 }))
		).rejects.toThrow("timed out");
		await expect(worker.run(job())).resolves.toEqual({});
	});

	it("rejects an already aborted request without starting a process", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			worker.run(job({ signal: controller.signal }))
		).rejects.toThrow();
		expect(spawn).not.toHaveBeenCalled();
	});

	it("rejects oversized requests before spawning or disabling idle cleanup", async () => {
		await expect(
			worker.run(job({ image: "x".repeat(70_000) }))
		).rejects.toThrow("request budget exceeded");
		expect(spawn).not.toHaveBeenCalled();
		await worker.dispose();
		worker = createIndependentBeautyWorker({
			python: process.execPath,
			engineRoot: directory,
			runtimeRoot: directory,
			idleMs: 50,
		});
		const input = job();
		await worker.run(input);
		const pid = Number(await readFile(input.request.report, "utf8"));
		await expect(
			worker.run(job({ image: "x".repeat(70_000) }))
		).rejects.toThrow("request budget exceeded");
		await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
	});

	it
		.skipIf(process.platform === "win32")
		.each(["hang-with-child", "exit-with-child"])(
		"kills descendants holding output pipes after %s",
		async (image) => {
			const controller = new AbortController();
			const input = job({ image, signal: controller.signal });
			const rejected = expect(worker.run(input)).rejects.toThrow();
			await vi.waitFor(async () =>
				expect(await readFile(`${input.request.report}.child`, "utf8")).toMatch(
					/^\d+$/
				)
			);
			const descendant = Number(
				await readFile(`${input.request.report}.child`, "utf8")
			);
			try {
				if (image === "hang-with-child") controller.abort();
				await rejected;
				await vi.waitFor(() =>
					expect(() => process.kill(descendant, 0)).toThrow()
				);
				await expect(worker.run(job())).resolves.toEqual({});
			} finally {
				try {
					process.kill(descendant, "SIGKILL");
				} catch {}
			}
		}
	);

	it("disposal waits for the process to exit and rejects further work", async () => {
		const input = job();
		await worker.run(input);
		const pid = Number(await readFile(input.request.report, "utf8"));
		await worker.dispose();
		expect(() => process.kill(pid, 0)).toThrow();
		await expect(worker.run(job())).rejects.toThrow("disposed");
	});
});
