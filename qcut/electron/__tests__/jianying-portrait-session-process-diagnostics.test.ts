// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
	portraitProcessGroupExists,
	runBoundedPortraitWorker,
} from "./jianying-portrait-session-process";

function denied({
	message,
	code = "EPERM",
}: {
	message: string;
	code?: string;
}) {
	return Object.assign(new Error(message), { code, errno: -1 });
}

describe.skipIf(process.platform === "win32")(
	"process-control diagnostics",
	() => {
		it.each([
			0,
			1,
			-1,
			Number.NaN,
			2.5,
		])("never signals invalid group %s", (pid) => {
			const kill = vi.spyOn(process, "kill");
			try {
				expect(() => portraitProcessGroupExists({ pid })).toThrow(
					"Invalid owned"
				);
				expect(kill).not.toHaveBeenCalled();
			} finally {
				kill.mockRestore();
			}
		});

		it("preserves the original probe error when final cleanup fails differently", async () => {
			const first = denied({ message: "original probe denied" });
			const cleanup = denied({ message: "cleanup denied", code: "EACCES" });
			const kill = vi
				.spyOn(process, "kill")
				.mockImplementation((_pid, signal) => {
					throw signal === 0 ? first : cleanup;
				});
			try {
				const error = await runBoundedPortraitWorker({
					command: process.execPath,
					args: ["-e", "console.log('finished'); process.exit(0)"],
					timeoutMs: 2000,
					graceMs: 30,
				}).catch((cause: unknown) => cause);
				expect(error).toMatchObject({
					cause: first,
					cleanupErrors: [cleanup],
					rootClosed: true,
					processGroupGone: false,
					stdout: "finished\n",
				});
				const result = error as Error & { pid: number; diagnostics: unknown[] };
				expect(result.diagnostics).toEqual([
					{
						pid: result.pid,
						pgid: result.pid,
						targetPid: -result.pid,
						action: "post-close-probe",
						signal: 0,
						outcome: "error",
						code: "EPERM",
						errno: -1,
						message: String(first),
					},
					{
						pid: result.pid,
						pgid: result.pid,
						targetPid: -result.pid,
						action: "final-cleanup-kill",
						signal: "SIGKILL",
						outcome: "error",
						code: "EACCES",
						errno: -1,
						message: String(cleanup),
					},
					{
						pid: result.pid,
						pgid: result.pid,
						targetPid: -result.pid,
						action: "final-cleanup-probe",
						signal: 0,
						outcome: "error",
						code: "EPERM",
						errno: -1,
						message: String(first),
					},
				]);
				expect(String(error)).toContain("original probe denied");
				expect(String(error)).toContain("cleanup denied");
				expect(JSON.stringify(error)).toContain('"errno":-1');
				expect(kill.mock.calls.every(([pid]) => pid === -result.pid)).toBe(
					true
				);
			} finally {
				kill.mockRestore();
			}
		});

		it("contains marker callback errors and remains failed after successful cleanup", async () => {
			const realKill = process.kill.bind(process);
			const first = denied({ message: "marker TERM denied" });
			const kill = vi
				.spyOn(process, "kill")
				.mockImplementation((pid, signal) => {
					if (signal === "SIGTERM") throw first;
					return realKill(pid, signal);
				});
			try {
				const error = await runBoundedPortraitWorker({
					command: process.execPath,
					args: [
						"-e",
						"console.log('READY'); setTimeout(()=>process.exit(0),300)",
					],
					abortMarker: "READY",
					timeoutMs: 2000,
					graceMs: 30,
				}).catch((cause: unknown) => cause);
				expect(error).toMatchObject({
					cause: first,
					reason: "abort-marker",
					rootClosed: true,
					processGroupGone: true,
				});
				expect(error).toHaveProperty(
					"diagnostics",
					expect.arrayContaining([
						expect.objectContaining({
							action: "abort-marker-term",
							signal: "SIGTERM",
							code: "EPERM",
							errno: -1,
						}),
						expect.objectContaining({
							action: "final-cleanup-kill",
							signal: "SIGKILL",
							outcome: "ok",
						}),
					])
				);
			} finally {
				kill.mockRestore();
			}
		});

		it("contains grace-timer errors and records eventual independent root exit", async () => {
			const realKill = process.kill.bind(process);
			const first = denied({ message: "timer KILL denied" });
			const kill = vi
				.spyOn(process, "kill")
				.mockImplementation((pid, signal) => {
					if (signal === "SIGKILL") throw first;
					return realKill(pid, signal);
				});
			try {
				const error = await runBoundedPortraitWorker({
					command: process.execPath,
					args: [
						"-e",
						"process.on('SIGTERM',()=>{}); console.log('READY'); setTimeout(()=>process.exit(0),150)",
					],
					abortMarker: "READY",
					timeoutMs: 2000,
					graceMs: 100,
				}).catch((cause: unknown) => cause);
				expect(error).toMatchObject({
					cause: first,
					reason: "abort-marker",
					rootClosed: true,
					processGroupGone: true,
				});
				expect(error).toHaveProperty(
					"diagnostics",
					expect.arrayContaining([
						expect.objectContaining({
							action: "abort-marker-kill",
							signal: "SIGKILL",
							code: "EPERM",
						}),
					])
				);
			} finally {
				kill.mockRestore();
			}
		});
	}
);
