// CPU preparation is separate from lease-gated native workers.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
	assertPortraitAuditIdentityUnchanged,
	capturePortraitAuditIdentity,
	finalizePortraitAuditAcceptance,
	fingerprintPortraitAuditFiles,
	runBoundedPortraitWorker,
} from "./jianying-portrait-session-process";
import {
	probeMinuteVideo,
	decodeMinuteVideo,
	openMinuteFrames,
	rgbaHash,
	verifyMinuteMotion,
	type MinutePlan,
} from "./jianying-portrait-acceptance-fixture";
import {
	loadAcceptanceImage,
	runMinuteAcceptance,
	runMultifaceAcceptance,
	saveAcceptancePng,
	writeAcceptanceJson,
} from "./jianying-portrait-acceptance-worker";

const OWN_SOURCES = ["fixture", "metrics", "seek", "worker", "native"].map(
	(name) =>
		path.resolve(
			"electron/__tests__",
			`jianying-portrait-acceptance-${name}.ts`
		)
);

interface Prepared {
	prepared: boolean;
	passed: false;
	source: string;
	multifaceImage: string;
	sessionBundle: string;
	plan: MinutePlan;
	identity: Awaited<ReturnType<typeof fingerprintPortraitAuditFiles>>;
}

async function prepare({
	source,
	multifaceImage,
	output,
	sessionBundle,
}: {
	source: string;
	multifaceImage: string;
	output: string;
	sessionBundle: string;
}) {
	await mkdir(output, { mode: 0o700 });
	const runtimeRoot = path.resolve(
		"electron/jianying-portrait-adjustment-runtime"
	);
	const runtimeSources = (await readdir(runtimeRoot))
		.filter((name) => name.endsWith(".ts"))
		.map((name) => path.join(runtimeRoot, name));
	const paths = [
		source,
		multifaceImage,
		sessionBundle,
		process.argv[1],
		...OWN_SOURCES,
		...runtimeSources,
		...[
			"electron/jianying-portrait-adjustment-contract.ts",
			"electron/beauty-lab/beauty-lab-rgba-metrics.ts",
			"electron/jianying-filter-local-runtime/runtime-discovery.ts",
			"electron/__tests__/jianying-portrait-session-plan.ts",
			"electron/__tests__/jianying-portrait-session-process.ts",
			"electron/__tests__/jianying-portrait-session-native.ts",
		].map((name) => path.resolve(name)),
	];
	const identity = await fingerprintPortraitAuditFiles({ paths });
	const report = {
		prepared: false,
		passed: false as const,
		nativeExecutionPerformed: false,
		source,
		multifaceImage,
		sessionBundle,
		identity,
		plan: null as MinutePlan | null,
		image: null as unknown,
		motion: null as unknown,
		scope:
			"private local CPU decoded input evidence; no native or face acceptance",
		error: null as string | null,
	};
	const raw = path.join(output, "preflight.rgba");
	try {
		const { plan } = await probeMinuteVideo({ source });
		report.plan = plan;
		const image = await loadAcceptanceImage({ source: multifaceImage });
		report.image = {
			width: image.width,
			height: image.height,
			fileSha256: image.fileSha256,
			rgbaSha256: rgbaHash({ bytes: image.rgba }),
			expectedScope:
				"static multi-face; actual detector count pending native lease",
		};
		await decodeMinuteVideo({ source, file: raw, plan });
		const reader = await openMinuteFrames({ file: raw, plan });
		try {
			await plan.frames.reduce(async (previous, frame) => {
				await previous;
				const rgba = await reader.read({ index: frame.index });
				frame.sha256 = rgbaHash({ bytes: rgba });
				if (frame.index === 0 || frame.index === plan.frames.length - 1)
					await saveAcceptancePng({
						file: path.join(output, `decoded-${frame.index}.png`),
						pixels: rgba,
						width: plan.width,
						height: plan.height,
					});
			}, Promise.resolve());
		} finally {
			await reader.close();
		}
		report.motion = verifyMinuteMotion({ frames: plan.frames });
		assertPortraitAuditIdentityUnchanged({
			before: identity,
			after: await fingerprintPortraitAuditFiles({ paths }),
		});
		report.prepared = true;
	} catch (cause) {
		report.error = String(cause);
		throw cause;
	} finally {
		await rm(raw, { force: true });
		await writeAcceptanceJson({
			file: path.join(output, "prepared.json"),
			value: report,
		});
	}
	console.log(
		JSON.stringify({
			prepared: report.prepared,
			frames: report.plan?.frames.length,
			spanSeconds: report.plan?.spanSeconds,
			motion: report.motion,
			nativeExecutionPerformed: false,
			output,
		})
	);
}

async function execute({
	preparedRoot,
	output,
}: {
	preparedRoot: string;
	output: string;
}) {
	assert(
		process.env.QCUT_PORTRAIT_NATIVE_LEASE,
		"Parent GPU/native lease required; preparation grants no lease"
	);
	const file = path.join(preparedRoot, "prepared.json");
	const prepared = JSON.parse(await readFile(file, "utf8")) as Prepared;
	assert(
		prepared.prepared === true && prepared.passed === false,
		"Completed CPU preparation required"
	);
	verifyMinuteMotion({ frames: prepared.plan.frames });
	const { plan } = await probeMinuteVideo({ source: prepared.source });
	assert.deepEqual(
		plan,
		{
			...prepared.plan,
			frames: prepared.plan.frames.map(({ index, time }) => ({ index, time })),
		},
		"Prepared timestamps no longer match decoded source"
	);
	const paths = prepared.identity.map(({ path: filePath }) => filePath);
	assertPortraitAuditIdentityUnchanged({
		before: prepared.identity,
		after: await fingerprintPortraitAuditFiles({ paths }),
	});
	await mkdir(output, { mode: 0o700 });
	const captureIdentity = async () => ({
		base: await capturePortraitAuditIdentity({
			bundlePath: process.argv[1],
			repoRoot: process.cwd(),
		}),
		acceptance: await fingerprintPortraitAuditFiles({
			paths: [...paths, file],
		}),
	});
	const identity = await captureIdentity();
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.once("SIGINT", cancel);
	process.once("SIGTERM", cancel);
	const runs: unknown[] = [];
	let summary: Record<string, unknown> & { passed: boolean } = {
		passed: false,
		runs,
		lease: process.env.QCUT_PORTRAIT_NATIVE_LEASE,
		minuteVerified: false,
		staticMultifaceVerified: false,
		dynamicMultifaceVerified: false,
		nativeAbortApi: false,
		proprietaryMediaPublic: false,
	};
	const run = async ({
		name,
		bundle,
		args,
		timeoutMs,
		abortMarker,
	}: {
		name: string;
		bundle: string;
		args: string[];
		timeoutMs: number;
		abortMarker?: string;
	}) => {
		const directory = path.join(output, name);
		await mkdir(directory, { mode: 0o700 });
		await writeAcceptanceJson({
			file: path.join(directory, "provenance.json"),
			value: { identity, unchangedAtEnd: false },
		});
		const temporary = await mkdtemp(path.join(directory, "owned-tmp-"));
		try {
			const result = await runBoundedPortraitWorker({
				command: process.execPath,
				args: [
					bundle,
					...args.map((arg) => (arg === "{output}" ? directory : arg)),
				],
				env: {
					...process.env,
					TMPDIR: temporary,
					TMP: temporary,
					TEMP: temporary,
				},
				timeoutMs,
				abortMarker,
				signal: controller.signal,
			});
			runs.push({ name, ...result });
			await writeAcceptanceJson({
				file: path.join(directory, "supervisor.json"),
				value: result,
			});
			assert(
				result.processGroupGone,
				`${name} left its owned process group alive`
			);
			assert(
				abortMarker
					? result.reason === "abort-marker"
					: result.code === 0 && !result.reason,
				`${name} failed: ${result.reason ?? result.code}; macOS Desktop permission may require human approval, never bypass it`
			);
			return abortMarker
				? null
				: (JSON.parse(
						await readFile(path.join(directory, "report.json"), "utf8")
					) as { passed: boolean });
		} finally {
			await rm(temporary, { recursive: true, force: true });
			await rm(path.join(directory, "chronological.rgba"), { force: true });
		}
	};
	try {
		const minute = await run({
			name: "minute",
			bundle: process.argv[1],
			args: ["--minute-worker", file, "{output}"],
			timeoutMs: 600_000,
		});
		summary.minuteVerified = minute?.passed === true;
		const multiface = await run({
			name: "multiface",
			bundle: process.argv[1],
			args: ["--multiface-worker", file, "{output}"],
			timeoutMs: 120_000,
		});
		summary.staticMultifaceVerified = multiface?.passed === true;
		const lifecycle = await run({
			name: "lifecycle",
			bundle: prepared.sessionBundle,
			args: ["--worker", prepared.source, "{output}", "0"],
			timeoutMs: 480_000,
		});
		summary.lifecycleVerified = lifecycle?.passed === true;
		await run({
			name: "cancellation",
			bundle: prepared.sessionBundle,
			args: ["--cancel-worker", prepared.source, "{output}", "0"],
			timeoutMs: 90_000,
			abortMarker: "QCUT_SESSION_CANCEL_QUEUED",
		});
		summary.cancellationVerified = true;
		summary.passed =
			summary.minuteVerified === true &&
			summary.staticMultifaceVerified === true &&
			summary.lifecycleVerified === true;
	} catch (cause) {
		summary.error = String(cause);
	} finally {
		process.removeListener("SIGINT", cancel);
		process.removeListener("SIGTERM", cancel);
		await writeAcceptanceJson({
			file: path.join(output, "report.json"),
			value: summary,
		});
		summary = await finalizePortraitAuditAcceptance({
			output,
			identity,
			captureIdentity,
			summary,
		});
	}
	console.log(JSON.stringify(summary));
	if (!summary.passed) process.exitCode = 1;
}

async function main() {
	const [mode, ...args] = process.argv.slice(2);
	if (mode === "--prepare") {
		assert.equal(
			args.length,
			4,
			"--prepare <video> <multi-face-image> <fresh-private-output> <session-native-bundle>"
		);
		const [source, multifaceImage, output, sessionBundle] = args.map((value) =>
			path.resolve(value)
		);
		return prepare({ source, multifaceImage, output, sessionBundle });
	}
	assert.equal(
		args.length,
		2,
		"--execute <prepared-directory> <fresh-private-output>"
	);
	if (mode === "--execute")
		return execute({
			preparedRoot: path.resolve(args[0]),
			output: path.resolve(args[1]),
		});
	assert(
		process.env.QCUT_PORTRAIT_NATIVE_LEASE,
		"Native worker requires explicit parent lease"
	);
	const prepared = JSON.parse(await readFile(args[0], "utf8")) as Prepared;
	assert(prepared.prepared === true, "CPU preparation required");
	const report =
		mode === "--minute-worker"
			? await runMinuteAcceptance({
					source: prepared.source,
					output: args[1],
					plan: prepared.plan,
				})
			: mode === "--multiface-worker"
				? await runMultifaceAcceptance({
						source: prepared.multifaceImage,
						output: args[1],
					})
				: null;
	assert(report, "Unknown acceptance mode");
	if (!report.passed) process.exitCode = 1;
}

void main().catch((cause: unknown) => {
	console.error(cause);
	process.exitCode = 1;
});
