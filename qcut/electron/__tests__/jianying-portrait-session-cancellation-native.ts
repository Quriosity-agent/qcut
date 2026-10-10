import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
	capturePortraitAuditIdentity,
	finalizePortraitAuditAcceptance,
	fingerprintPortraitAuditFiles,
	runBoundedPortraitWorker,
} from "./jianying-portrait-session-process";

async function main() {
	assert(
		process.env.QCUT_PORTRAIT_NATIVE_LEASE,
		"Explicit parent GPU lease required"
	);
	assert.equal(
		process.argv.length,
		5,
		"<video> <fresh-private-output> <current-session-worker-bundle>"
	);
	const [source, output, bundle] = process.argv
		.slice(2)
		.map((arg) => path.resolve(arg));
	const runtime = path.resolve("electron/jianying-portrait-adjustment-runtime");
	const runtimeSources = (await readdir(runtime))
		.filter((file) => file.endsWith(".ts"))
		.map((file) => path.join(runtime, file));
	const captureIdentity = async () => ({
		base: await capturePortraitAuditIdentity({
			bundlePath: bundle,
			repoRoot: process.cwd(),
		}),
		extra: await fingerprintPortraitAuditFiles({
			paths: [
				source,
				process.argv[1],
				path.resolve(
					"electron/__tests__/jianying-portrait-session-cancellation-native.ts"
				),
				path.resolve(
					"electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.ts"
				),
				path.resolve("electron/beauty-lab/beauty-lab-rgba-metrics.ts"),
				path.resolve(
					"electron/jianying-filter-local-runtime/runtime-discovery.ts"
				),
				...runtimeSources,
			],
		}),
	});
	const identity = await captureIdentity();
	await mkdir(output, { mode: 0o700 });
	const temporary = await mkdtemp(path.join(output, "owned-tmp-"));
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.once("SIGINT", cancel);
	process.once("SIGTERM", cancel);
	let summary: Record<string, unknown> & { passed: boolean } = {
		passed: false,
		lease: process.env.QCUT_PORTRAIT_NATIVE_LEASE,
		scope:
			"isolated external worker/process-group cancellation after real native warmup; does not rerun or upgrade minute/multiface/lifecycle evidence",
		nativeAbortApi: false,
		proprietaryMediaPublic: false,
		cancellationVerified: false,
	};
	let workerPid: number | undefined;
	let groupGone = false;
	try {
		await writeFile(
			path.join(output, "provenance.json"),
			JSON.stringify({ identity, unchangedAtEnd: false }, null, 2)
		);
		await writeFile(
			path.join(output, "report.json"),
			JSON.stringify(summary, null, 2)
		);
		const result = await runBoundedPortraitWorker({
			command: process.execPath,
			args: [bundle, "--cancel-worker", source, output, "0"],
			env: {
				...process.env,
				TMPDIR: temporary,
				TMP: temporary,
				TEMP: temporary,
			},
			timeoutMs: 30_000,
			abortMarker: "QCUT_SESSION_CANCEL_QUEUED",
			signal: controller.signal,
		});
		workerPid = result.pid;
		groupGone = result.processGroupGone;
		summary.worker = result;
		assert.equal(result.reason, "abort-marker");
		assert(
			result.rootClosed && result.processGroupGone,
			"Owned worker/group cleanup unverified"
		);
		const warm = JSON.parse(
			await readFile(path.join(output, "cancel-start.json"), "utf8")
		);
		assert.equal(warm.queued, 3);
		assert(
			warm.warmActiveGroups.includes("face"),
			"Native warmup was not active"
		);
		assert.equal(
			warm.provenance.sourceSha256,
			identity.extra.find((file) => file.path === source)?.sha256
		);
		assert.equal(warm.artifact.file, "cancel-warm-native.png");
		const [png] = await fingerprintPortraitAuditFiles({
			paths: [path.join(output, warm.artifact.file)],
		});
		assert.equal(png.sha256, warm.artifact.pngSha256);
		summary.warmArtifact = png;
		summary.cancellationVerified = true;
		summary.passed = true;
	} catch (cause) {
		const error = cause as Error & { pid?: number; processGroupGone?: boolean };
		workerPid = error.pid ?? workerPid;
		groupGone = error.processGroupGone ?? groupGone;
		summary.error = String(cause);
		summary.failure = cause;
		summary.originalCause =
			error.cause instanceof Error
				? { message: String(error.cause), stack: error.cause.stack }
				: String(error.cause);
	} finally {
		process.removeListener("SIGINT", cancel);
		process.removeListener("SIGTERM", cancel);
		try {
			const rows = execFileSync(
				"ps",
				["-axo", "pid=,ppid=,pgid=,stat=,comm="],
				{ encoding: "utf8", timeout: 5000 }
			);
			summary.remainingOwnedGroup = rows.split("\n").filter((row) => {
				const fields = row.trim().split(/\s+/);
				return (
					workerPid !== undefined &&
					(Number(fields[0]) === workerPid || Number(fields[2]) === workerPid)
				);
			});
			if ((summary.remainingOwnedGroup as string[]).length)
				summary.passed = false;
		} catch (cause) {
			summary.processSnapshotError = String(cause);
			summary.passed = false;
		}
		if (groupGone) await rm(temporary, { recursive: true, force: true });
		summary.temporaryRemoved = groupGone;
		await writeFile(
			path.join(output, "report.json"),
			`${JSON.stringify(summary, null, 2)}\n`
		);
		summary = await finalizePortraitAuditAcceptance({
			output,
			identity,
			captureIdentity,
			summary,
		});
	}
	console.log(
		JSON.stringify({
			passed: summary.passed,
			report: path.join(output, "report.json"),
			error: summary.error,
		})
	);
	if (!summary.passed) process.exitCode = 1;
}

void main().catch((cause: unknown) => {
	console.error(cause);
	process.exitCode = 1;
});
