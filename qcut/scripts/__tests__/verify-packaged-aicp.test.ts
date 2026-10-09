// @vitest-environment node
import { existsSync } from "node:fs";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	VERSION_ATTEMPT_TIMEOUTS_MS,
	VERSION_CHECK_DEADLINE_MS,
	verifyPackagedAicp,
} from "../verify-packaged-aicp.js";

const HOST_TARGET = `${process.platform}-${process.arch}`;
const PINNED_VERSION = "1.0.29";
// Short budgets keep the suite fast; the stalled launch sleeps far past them.
const FAST_ATTEMPT_TIMEOUTS_MS = [300, 3000];
const FAST_KILL_GRACE_MS = 1000;
const temporaryDirectories: string[] = [];

/**
 * Builds dist-electron/mac-arm64/<app>/Contents/Resources with a fake host
 * `aicp` script and the packaged binary manifest. Each launch appends a line
 * to `launchLogPath`, so tests can count attempts.
 */
async function createFixture({ scriptBody }: { scriptBody: string }) {
	const projectRoot = await mkdtemp(path.join(tmpdir(), "qcut-packaged-aicp-"));
	temporaryDirectories.push(projectRoot);
	const distDir = path.join(projectRoot, "dist-electron");
	const binRoot = path.join(
		distDir,
		"mac-arm64",
		"QCut AI Video Editor.app",
		"Contents",
		"Resources",
		"bin"
	);
	const binaryPath = path.join(binRoot, "aicp", HOST_TARGET, "aicp");
	const launchLogPath = path.join(projectRoot, "launches.log");
	await mkdir(path.dirname(binaryPath), { recursive: true });
	await writeFile(
		path.join(binRoot, "manifest.json"),
		JSON.stringify({ binaries: { aicp: { version: PINNED_VERSION } } })
	);
	await writeFile(
		binaryPath,
		`#!/bin/sh\necho launch >> "${launchLogPath}"\n${scriptBody}\n`
	);
	await chmod(binaryPath, 0o755);
	return { distDir, binaryPath, launchLogPath };
}

async function countLaunches({ launchLogPath }: { launchLogPath: string }) {
	if (!existsSync(launchLogPath)) return 0;
	const contents = await readFile(launchLogPath, "utf8");
	return contents.trim().split("\n").length;
}

function verifyFixture({ distDir }: { distDir: string }) {
	const logs: string[] = [];
	const promise = verifyPackagedAicp({
		distDir,
		rawTargets: HOST_TARGET,
		attemptTimeoutsMs: FAST_ATTEMPT_TIMEOUTS_MS,
		killGraceMs: FAST_KILL_GRACE_MS,
		log: (message) => logs.push(message),
	});
	return { promise, logs };
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe("packaged AICP verification budget", () => {
	it("gives a slow first launch well over the 30s that failed v2026.10.10.1", () => {
		expect(VERSION_ATTEMPT_TIMEOUTS_MS[0]).toBeGreaterThanOrEqual(90_000);
		expect(VERSION_ATTEMPT_TIMEOUTS_MS).toHaveLength(2);
		const attemptTotal = VERSION_ATTEMPT_TIMEOUTS_MS.reduce(
			(total, timeoutMs) => total + timeoutMs,
			0
		);
		expect(VERSION_CHECK_DEADLINE_MS).toBeGreaterThan(attemptTotal);
	});
});

describe.skipIf(process.platform === "win32")(
	"packaged AICP host verification",
	() => {
		it("passes when the binary reports the manifest-pinned version", async () => {
			const fixture = await createFixture({
				scriptBody: `echo "aicp, version ${PINNED_VERSION}"`,
			});
			const { promise, logs } = verifyFixture(fixture);

			await expect(promise).resolves.toContain(
				`aicp, version ${PINNED_VERSION} (`
			);
			await expect(promise).resolves.toContain("attempt 1/2");
			expect(logs).toEqual([]);
			expect(await countLaunches(fixture)).toBe(1);
		});

		it("retries once after a first-launch timeout and passes", async () => {
			const fixture = await createFixture({
				scriptBody: [
					`if [ ! -f "$0.warm" ]; then touch "$0.warm"; exec sleep 30; fi`,
					`echo "aicp, version ${PINNED_VERSION}"`,
				].join("\n"),
			});
			const { promise, logs } = verifyFixture(fixture);

			await expect(promise).resolves.toContain("attempt 2/2");
			expect(logs).toHaveLength(1);
			expect(logs[0]).toContain("timed out after 300ms on attempt 1/2");
			expect(await countLaunches(fixture)).toBe(2);
		});

		it("fails when the retry also times out", async () => {
			const fixture = await createFixture({ scriptBody: "exec sleep 30" });
			const { promise } = verifyFixture(fixture);

			await expect(promise).rejects.toThrow(
				/attempt 2\/2\): exit=null error=timed out after 3000ms/
			);
			expect(await countLaunches(fixture)).toBe(2);
		});

		it("fails a non-zero exit immediately without retrying", async () => {
			const fixture = await createFixture({
				scriptBody: 'echo "boom" >&2\nexit 3',
			});
			const { promise, logs } = verifyFixture(fixture);

			await expect(promise).rejects.toThrow(
				/attempt 1\/2\): exit=3 error= stderr=boom/
			);
			expect(logs).toEqual([]);
			expect(await countLaunches(fixture)).toBe(1);
		});

		it.each([
			["an older version", 'echo "aicp, version 1.0.28"'],
			["unrecognised output", 'echo "Traceback (most recent call last):"'],
			["no output", "true"],
		])("fails %s without retrying", async (_label, scriptBody) => {
			const fixture = await createFixture({ scriptBody });
			const { promise } = verifyFixture(fixture);

			await expect(promise).rejects.toThrow(
				`but the packaged manifest pins version ${PINNED_VERSION}`
			);
			expect(await countLaunches(fixture)).toBe(1);
		});
	}
);
