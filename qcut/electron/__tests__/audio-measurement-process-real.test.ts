import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runAudioMeasurementProcess } from "../ffmpeg/audio-measurement-process.js";

const isWindows = process.platform === "win32";
const startupTimeoutMs = isWindows ? 10_000 : 5000;
const measurementTimeoutMs = isWindows ? 15_000 : 3000;
const cancellationTimeoutMs = isWindows ? 20_000 : 10_000;
const testTimeoutMs = isWindows ? 30_000 : 15_000;

it.each(["abort", "timeout"] as const)(
	"reaps a real child ignoring SIGTERM before %s settles",
	async (termination) => {
		const directory = await mkdtemp(join(tmpdir(), "qcut-meter-cancel-"));
		const readyPath = join(directory, "ready.pid");
		const controller = new AbortController();
		let pid: number | undefined;
		let reaped = false;
		const result = runAudioMeasurementProcess({
			command: process.execPath,
			args: [
				"-e",
				'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);',
				readyPath,
			],
			signal: controller.signal,
			timeout:
				termination === "timeout"
					? measurementTimeoutMs
					: cancellationTimeoutMs,
		}).catch((error: unknown) => error);
		try {
			await vi.waitFor(
				async () => {
					pid = Number(await readFile(readyPath, "utf8"));
					expect(pid).toBeGreaterThan(0);
				},
				{ interval: 10, timeout: startupTimeoutMs }
			);
			const reason = new Error("cancel real meter");
			if (termination === "abort") {
				controller.abort(reason);
				expect(await result).toBe(reason);
			} else {
				expect(await result).toEqual(new Error("Audio measurement timed out"));
			}
			expect(() => process.kill(pid as number, 0)).toThrow(
				expect.objectContaining({ code: "ESRCH" })
			);
			reaped = true;
		} finally {
			controller.abort();
			if (pid !== undefined && !reaped) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {}
			}
			await result;
			await rm(directory, { recursive: true, force: true });
		}
	},
	testTimeoutMs
);

it("rejects a real failed spawn without waiting for the timeout", async () => {
	const directory = await mkdtemp(join(tmpdir(), "qcut-meter-missing-"));
	try {
		await expect(
			runAudioMeasurementProcess({
				command: join(directory, "missing-meter"),
				args: [],
				timeout: 10_000,
			})
		).rejects.toThrow(expect.objectContaining({ code: "ENOENT" }));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
