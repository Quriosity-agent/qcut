// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIndependentBeautyWorker } from "../beauty-lab/beauty-lab-independent-worker";

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
