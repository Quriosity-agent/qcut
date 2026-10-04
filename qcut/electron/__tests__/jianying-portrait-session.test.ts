// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
	mkdtemp,
	readFile,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JianyingPortraitAdjustmentRenderRequest } from "../jianying-portrait-adjustment-contract";
import {
	buildPortraitSessionPlan,
	runPortraitSessionPlan,
	type PortraitSessionProvider,
	type PortraitSessionSample,
} from "./jianying-portrait-session-plan";
import {
	portraitProcessGroupExists,
	runBoundedPortraitWorker,
	fingerprintPortraitAuditFiles,
	assertPortraitAuditIdentityUnchanged,
	finalizePortraitAuditAcceptance,
} from "./jianying-portrait-session-process";

const times = Array.from({ length: 10 }, (_value, index) => 2 + index / 30);
const frames = times.map(
	(_time, index) => new Uint8Array([100 + index, 80, 90, 255])
);

function fixtureProvider({ increment = 1 }: { increment?: number } = {}) {
	const requests: JianyingPortraitAdjustmentRenderRequest[] = [];
	const clear = vi.fn(async () => undefined);
	const render = vi.fn(
		async (request: JianyingPortraitAdjustmentRenderRequest) => {
			requests.push(request);
			const rgba = new Uint8Array(request.rgba);
			const active =
				request.adjustments.enabled &&
				request.adjustments.skinToneResourceId !== null &&
				Object.values(request.adjustments.values).some((value) => value !== 0);
			if (active) rgba[0] += increment;
			return {
				width: request.width,
				height: request.height,
				rgba,
				provider: "jianying-local-swing-v1" as const,
				activeGroups: active ? ["face" as const] : [],
			};
		}
	);
	return { requests, clear, render };
}

describe("portrait session regression plan", () => {
	it("includes rolling, uncached/cached seeks, LRU revisit, palette and combined transitions", () => {
		const plan = buildPortraitSessionPlan({ times });
		expect(plan.map(({ id }) => id)).toEqual(
			expect.arrayContaining([
				"rolling-9",
				"backward-seek",
				"cached-forward-seek",
				"backward-after-cache-hit",
				"forward-gap",
				"fresh-source-B",
				"revisit-live-A",
				"revisit-evicted-A",
				"none-stale-warmth",
				"after-none",
				"after-disabled",
				"clear-reset",
			])
		);
		expect(new Set(plan.map(({ id }) => id)).size).toBe(plan.length);
		expect(plan.filter(({ id }) => id.startsWith("resource-740"))).toHaveLength(
			5
		);
		expect(
			plan.filter(({ id }) => id.startsWith("scope-pressure"))
		).toHaveLength(4);
		expect(
			plan
				.find(({ id }) => id === "revisit-live-A")
				?.baseline.map(({ frame }) => frame)
		).toEqual([6, 7, 8]);
		expect(plan.find(({ id }) => id === "forward-gap")?.time).toBeGreaterThan(
			times[9] + 1
		);
		expect(
			plan.find(({ id }) => id === "none-stale-warmth")?.adjustments
		).toMatchObject({
			skinToneResourceId: null,
			values: { face_adjust_skin_Intensity: 60, face_adjust_skin_ColdWarm: 25 },
		});
		expect(
			plan.find(({ id }) => id === "combined-0")?.adjustments.makeup?.lip
				?.cardId
		).toBe("lip-soft-pink");
	});

	it.each(
		[
			[],
			times.slice(1),
			times.map(() => 0),
			times.map((time, index) => (index === 4 ? Number.NaN : time)),
			times.map((time, index) => (index === 9 ? time + 2 : time)),
		].map((invalid) => ({ invalid }))
	)("rejects incomplete or non-contiguous timestamps: $invalid", ({
		invalid,
	}) => {
		expect(() => buildPortraitSessionPlan({ times: invalid })).toThrow(
			"ten increasing adjacent"
		);
	});

	it("runs serially with distinct isolated providers, persists every result, and clears all providers", async () => {
		const providers: ReturnType<typeof fixtureProvider>[] = [];
		const onSample = vi.fn(async () => undefined);
		const steps = buildPortraitSessionPlan({ times });
		const samples = await runPortraitSessionPlan({
			steps,
			frames,
			width: 1,
			height: 1,
			createProvider: () => {
				const provider = fixtureProvider();
				providers.push(provider);
				return provider;
			},
			onSample,
		});
		expect(samples).toHaveLength(steps.length);
		expect(samples.every(({ passed }) => passed)).toBe(true);
		expect(onSample).toHaveBeenCalledTimes(steps.length);
		expect(providers[0].requests).toHaveLength(steps.length);
		expect(
			providers
				.slice(1)
				.every(({ requests }) =>
					requests.every(({ sourceKey }) => sourceKey?.startsWith("isolated:"))
				)
		).toBe(true);
		expect(providers.every(({ clear }) => clear.mock.calls.length > 0)).toBe(
			true
		);
		expect(providers[0].clear).toHaveBeenCalledTimes(3);
	});

	it("does not promote cold-vs-rolling differences to failures, but exact-reset differences fail", async () => {
		let count = 0;
		const steps = buildPortraitSessionPlan({ times }).slice(0, 2);
		const samples = await runPortraitSessionPlan({
			steps,
			frames,
			width: 1,
			height: 1,
			createProvider: () =>
				fixtureProvider({ increment: ++count === 1 ? 2 : 1 }),
			onSample: async () => undefined,
		});
		expect(samples[0].violations).toEqual(["baseline-mismatch"]);
		expect(samples[1].difference.changedPixels).toBe(1);
		expect(samples[1].passed).toBe(true);
	});

	it("fails temporal replay mismatches independently of diagnostic baseline differences", async () => {
		const steps = buildPortraitSessionPlan({ times }).filter(({ id }) =>
			["rolling-0", "replay-0"].includes(id)
		);
		let count = 0;
		const samples = await runPortraitSessionPlan({
			steps,
			frames,
			width: 1,
			height: 1,
			createProvider: () => {
				const provider = fixtureProvider();
				if (++count !== 1) return provider;
				let calls = 0;
				return {
					clear: provider.clear,
					render: async (request) => {
						const result = await provider.render(request);
						result.rgba[0] += calls++;
						return result;
					},
				};
			},
			onSample: async () => undefined,
		});
		expect(samples[1].violations).toEqual(["repeat-mismatch"]);
	});

	it("fails effect no-ops and alpha changes rather than accepting equal broken baselines", async () => {
		const steps = buildPortraitSessionPlan({ times }).slice(0, 1);
		const run = ({
			createProvider,
		}: {
			createProvider: () => PortraitSessionProvider;
		}) =>
			runPortraitSessionPlan({
				steps,
				frames,
				width: 1,
				height: 1,
				createProvider,
				onSample: async () => undefined,
			});
		expect(
			(
				await run({ createProvider: () => fixtureProvider({ increment: 0 }) })
			)[0].violations
		).toContain("effect-no-op");
		const samples = await run({
			createProvider: () => {
				const provider = fixtureProvider();
				return {
					clear: provider.clear,
					render: async (request) => {
						const result = await provider.render(request);
						result.rgba[3] = 0;
						return result;
					},
				};
			},
		});
		expect(samples[0].violations).toContain("alpha-changed");
	});

	it.each([
		"render",
		"baseline",
		"artifact",
	])("cleans up when %s throws", async (failure) => {
		const providers: ReturnType<typeof fixtureProvider>[] = [];
		await expect(
			runPortraitSessionPlan({
				steps: buildPortraitSessionPlan({ times }).slice(0, 1),
				frames,
				width: 1,
				height: 1,
				createProvider: () => {
					const provider = fixtureProvider();
					providers.push(provider);
					if (
						(failure === "render" && providers.length === 1) ||
						(failure === "baseline" && providers.length === 2)
					)
						provider.render.mockRejectedValue(new Error("injected"));
					return provider;
				},
				onSample: async () => {
					if (failure === "artifact") throw new Error("injected");
				},
			})
		).rejects.toThrow("injected");
		expect(providers.every(({ clear }) => clear.mock.calls.length > 0)).toBe(
			true
		);
	});

	it("continues collecting evidence after pixel failures and rejects malformed input before launch", async () => {
		const observed: PortraitSessionSample[] = [];
		await runPortraitSessionPlan({
			steps: buildPortraitSessionPlan({ times }).slice(0, 2),
			frames,
			width: 1,
			height: 1,
			createProvider: () => fixtureProvider({ increment: 0 }),
			onSample: async ({ sample }) => {
				observed.push(sample);
			},
		});
		expect(observed).toHaveLength(2);
		expect(observed.every(({ passed }) => !passed)).toBe(true);
		const createProvider = vi.fn();
		await expect(
			runPortraitSessionPlan({
				steps: buildPortraitSessionPlan({ times }),
				frames: frames.slice(0, 9),
				width: 1,
				height: 1,
				createProvider,
				onSample: async () => undefined,
			})
		).rejects.toThrow("Invalid bounded");
		expect(createProvider).not.toHaveBeenCalled();
	});
});

describe.skipIf(process.platform === "win32")(
	"bounded portrait worker (CPU only)",
	() => {
		it("does not signal a process group after confirming it is gone", async () => {
			const kill = vi.spyOn(process, "kill").mockImplementation(() => {
				throw Object.assign(new Error("No such process"), { code: "ESRCH" });
			});
			try {
				const result = await runBoundedPortraitWorker({
					command: process.execPath,
					args: ["-e", "process.exit(0)"],
					timeoutMs: 2000,
				});
				expect(result.processGroupGone).toBe(true);
				expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
			} finally {
				kill.mockRestore();
			}
		});
		it("collects output and confirms normal process cleanup", async () => {
			const result = await runBoundedPortraitWorker({
				command: process.execPath,
				args: ["-e", "console.log('ok')"],
				timeoutMs: 2000,
				graceMs: 30,
			});
			expect(result).toMatchObject({
				code: 0,
				reason: null,
				processGroupGone: true,
			});
			expect(result.stdout).toContain("ok");
		});
		it("times out and SIGKILLs a worker that ignores SIGTERM", async () => {
			const result = await runBoundedPortraitWorker({
				command: process.execPath,
				args: ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],
				timeoutMs: 200,
				graceMs: 30,
			});
			expect(result).toMatchObject({
				reason: "timeout",
				processGroupGone: true,
			});
			expect(result.elapsedMs).toBeLessThan(2000);
		});
		it("kills owned grandchildren even when the worker exits normally", async () => {
			const code =
				"const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); c.unref(); console.log(c.pid)";
			const result = await runBoundedPortraitWorker({
				command: process.execPath,
				args: ["-e", code],
				timeoutMs: 2000,
				graceMs: 30,
			});
			expect(result).toMatchObject({ code: 0, processGroupGone: true });
			expect(portraitProcessGroupExists({ pid: result.pid })).toBe(false);
		});
		it("cancels after a marker split across chunks and does not wait for the deadline", async () => {
			const result = await runBoundedPortraitWorker({
				command: process.execPath,
				args: [
					"-e",
					"process.stdout.write('REA'); setTimeout(()=>console.log('DY'),20); setInterval(()=>{},1000)",
				],
				timeoutMs: 2000,
				graceMs: 30,
				abortMarker: "READY",
			});
			expect(result).toMatchObject({
				reason: "abort-marker",
				processGroupGone: true,
			});
			expect(result.elapsedMs).toBeLessThan(1500);
		});
		it("supports caller cancellation and rejects pre-cancelled launches", async () => {
			const controller = new AbortController();
			const promise = runBoundedPortraitWorker({
				command: process.execPath,
				args: ["-e", "setInterval(()=>{},1000)"],
				timeoutMs: 2000,
				graceMs: 30,
				signal: controller.signal,
			});
			controller.abort();
			expect(await promise).toMatchObject({
				reason: "cancelled",
				processGroupGone: true,
			});
			await expect(
				runBoundedPortraitWorker({
					command: process.execPath,
					args: [],
					timeoutMs: 2000,
					signal: controller.signal,
				})
			).rejects.toThrow("Cancelled before");
		});
		it("rejects invalid bounds and spawn failures without leaving timers", async () => {
			await expect(
				runBoundedPortraitWorker({
					command: process.execPath,
					args: [],
					timeoutMs: Number.NaN,
				})
			).rejects.toThrow("Invalid worker deadline");
			await expect(
				runBoundedPortraitWorker({
					command: "/nonexistent/qcut-session-worker",
					args: [],
					timeoutMs: 2000,
				})
			).rejects.toThrow();
		});
	}
);

describe("immutable portrait audit identity", () => {
	it.each([
		"unchanged",
		"changed",
		"unreadable",
		"failed-run",
		"failed-report",
		"missing-report",
	])("final acceptance is fail-closed for %s without changing frame diagnostics", async (mode) => {
		const directory = await mkdtemp(
			path.join(os.tmpdir(), "portrait-acceptance-")
		);
		try {
			const report = {
				passed: mode !== "failed-report",
				samples: [
					{ id: "frame", passed: true, difference: { changedPixels: 0 } },
				],
				error: null,
			};
			if (mode !== "missing-report")
				await writeFile(
					path.join(directory, "report.json"),
					JSON.stringify(report)
				);
			const result = await finalizePortraitAuditAcceptance({
				output: directory,
				identity: { hash: "before" },
				summary: { passed: mode !== "failed-run" },
				captureIdentity: async () => {
					if (mode === "unreadable") throw new Error("source disappeared");
					return { hash: mode === "changed" ? "after" : "before" };
				},
			});
			expect(result.passed).toBe(mode === "unchanged");
			expect(
				JSON.parse(
					await readFile(path.join(directory, "supervisor.json"), "utf8")
				)
			).toEqual(result);
			const provenance = JSON.parse(
				await readFile(path.join(directory, "provenance.json"), "utf8")
			);
			expect(provenance.unchangedAtEnd).toBe(
				!["changed", "unreadable"].includes(mode)
			);
			if (mode !== "missing-report") {
				const saved = JSON.parse(
					await readFile(path.join(directory, "report.json"), "utf8")
				);
				expect(saved.passed).toBe(result.passed);
				expect(saved.samples).toEqual(report.samples);
				expect(saved.error).toBe(report.error);
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("hashes exact content deterministically and rejects source/bundle mutation", async () => {
		const directory = await mkdtemp(
			path.join(os.tmpdir(), "portrait-identity-")
		);
		try {
			const file = path.join(directory, "source.ts");
			await writeFile(file, "abc");
			const before = await fingerprintPortraitAuditFiles({
				paths: [file, file],
			});
			expect(before).toHaveLength(1);
			expect(before[0].sha256).toBe(
				"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
			);
			assertPortraitAuditIdentityUnchanged({
				before,
				after: await fingerprintPortraitAuditFiles({ paths: [file] }),
			});
			await writeFile(file, "abd");
			const after = await fingerprintPortraitAuditFiles({ paths: [file] });
			expect(() =>
				assertPortraitAuditIdentityUnchanged({ before, after })
			).toThrow("identity changed");
			await unlink(file);
			await expect(
				fingerprintPortraitAuditFiles({ paths: [file] })
			).rejects.toThrow();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("rejects symlink retargeting even when file bytes are identical", async () => {
		const directory = await mkdtemp(
			path.join(os.tmpdir(), "portrait-identity-")
		);
		try {
			const first = path.join(directory, "first");
			const second = path.join(directory, "second");
			const link = path.join(directory, "current");
			await writeFile(first, "same");
			await writeFile(second, "same");
			await symlink(first, link);
			const before = await fingerprintPortraitAuditFiles({ paths: [link] });
			await unlink(link);
			await symlink(second, link);
			const after = await fingerprintPortraitAuditFiles({ paths: [link] });
			expect(before[0].sha256).toBe(after[0].sha256);
			expect(() =>
				assertPortraitAuditIdentityUnchanged({ before, after })
			).toThrow("identity changed");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
