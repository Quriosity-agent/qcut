import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";

export async function fingerprintPortraitAuditFiles({
	paths,
}: {
	paths: string[];
}) {
	return Promise.all(
		[...new Set(paths)].sort().map(async (file) => {
			const resolvedPath = await realpath(file);
			const before = await stat(file);
			if (!before.isFile() || before.size > 512 * 1024 * 1024)
				throw new Error(`Unbounded audit file: ${file}`);
			const hash = createHash("sha256");
			await pipeline(createReadStream(file), hash);
			const after = await stat(file);
			if (
				before.size !== after.size ||
				before.mtimeMs !== after.mtimeMs ||
				before.ino !== after.ino ||
				resolvedPath !== (await realpath(file))
			)
				throw new Error(`Audit file changed while hashing: ${file}`);
			return {
				path: file,
				resolvedPath,
				bytes: before.size,
				sha256: hash.digest("hex"),
			};
		})
	);
}

export function assertPortraitAuditIdentityUnchanged({
	before,
	after,
}: {
	before: unknown;
	after: unknown;
}) {
	if (!isDeepStrictEqual(before, after))
		throw new Error("Portrait audit execution identity changed during the run");
}

export async function finalizePortraitAuditAcceptance({
	output,
	identity,
	captureIdentity,
	summary,
}: {
	output: string;
	identity: unknown;
	captureIdentity: () => Promise<unknown>;
	summary: Record<string, unknown> & { passed: boolean };
}) {
	let provenanceUnchangedAtEnd = false;
	let provenanceError: string | null = null;
	try {
		assertPortraitAuditIdentityUnchanged({
			before: identity,
			after: await captureIdentity(),
		});
		provenanceUnchangedAtEnd = true;
	} catch (cause) {
		provenanceError = String(cause);
	}
	const reportPath = path.join(output, "report.json");
	let report: Record<string, unknown> | undefined;
	try {
		report = JSON.parse(await readFile(reportPath, "utf8"));
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
	}
	const final = {
		...summary,
		passed:
			summary.passed && report?.passed === true && provenanceUnchangedAtEnd,
		provenanceUnchangedAtEnd,
		provenanceError,
	};
	if (report)
		await writeFile(
			reportPath,
			`${JSON.stringify({ ...report, passed: final.passed, provenanceUnchangedAtEnd, provenanceError }, null, 2)}\n`
		);
	await writeFile(
		path.join(output, "provenance.json"),
		`${JSON.stringify({ identity, unchangedAtEnd: provenanceUnchangedAtEnd, error: provenanceError }, null, 2)}\n`
	);
	await writeFile(
		path.join(output, "supervisor.json"),
		`${JSON.stringify(final, null, 2)}\n`
	);
	return final;
}

export async function capturePortraitAuditIdentity({
	bundlePath,
	repoRoot,
}: {
	bundlePath: string;
	repoRoot: string;
}) {
	const { inspectJianyingFilterLocalRuntime } = await import(
		"../jianying-filter-local-runtime/runtime-discovery"
	);
	const { resolveJianyingPortraitAdjustmentHost } = await import(
		"../jianying-portrait-adjustment-runtime/bridge-resolver"
	);
	const { resolveJianyingPortraitPackage } = await import(
		"../jianying-portrait-adjustment-runtime/package-resolver"
	);
	const { resolveJianyingPortraitMakeupCards } = await import(
		"../jianying-portrait-adjustment-runtime/makeup-resolver"
	);
	const { JIANYING_PORTRAIT_SKIN_TONES } = await import(
		"../jianying-portrait-adjustment-runtime/skin-tone-catalog"
	);
	const runtime = await inspectJianyingFilterLocalRuntime({ refresh: true });
	const hostPath = await resolveJianyingPortraitAdjustmentHost();
	if (
		!hostPath ||
		!runtime.frameworkDirectory ||
		!runtime.modelDirectory ||
		!runtime.effectLibraryPath
	)
		throw new Error("Missing audit runtime identity");
	const packages = await Promise.all([
		resolveJianyingPortraitPackage({ runtimePackage: "face" }),
		resolveJianyingPortraitPackage({ runtimePackage: "smooth" }),
		...JIANYING_PORTRAIT_SKIN_TONES.map(({ resourceId }) =>
			resolveJianyingPortraitPackage({
				runtimePackage: "skin-tone",
				skinToneResourceId: resourceId,
			})
		),
	]);
	const lip = (await resolveJianyingPortraitMakeupCards()).find(
		({ card }) => card.id === "lip-soft-pink"
	);
	if (!lip?.packagePath || packages.some(({ packagePath }) => !packagePath))
		throw new Error("Missing selected audit package");
	const selected = [
		...packages.map(
			({ runtimePackage, skinToneResourceId, packagePath, source }) => ({
				id: skinToneResourceId ?? runtimePackage,
				path: packagePath as string,
				source,
			})
		),
		{ id: lip.card.id, path: lip.packagePath, source: lip.source },
	];
	const directories = await Promise.all(
		[
			runtime.frameworkDirectory,
			runtime.modelDirectory,
			...selected.map(({ path }) => path),
		].map(async (directory) => ({
			path: directory,
			resolvedPath: await realpath(directory),
		}))
	);
	const packageFiles = (
		await Promise.all(
			selected.map(async ({ path: root }) => {
				const entries = await readdir(root, {
					recursive: true,
					withFileTypes: true,
				});
				if (
					entries.length > 2000 ||
					entries.some((entry) => entry.isSymbolicLink())
				)
					throw new Error(`Unbounded or symlinked package: ${root}`);
				return entries
					.filter((entry) => entry.isFile())
					.map((entry) => path.join(entry.parentPath, entry.name));
			})
		)
	).flat();
	const sourcePaths = [
		"provider.ts",
		"tracking-scope-pool.ts",
		"tracking-session.ts",
		"fitting-frame-state.ts",
		"render-readiness.ts",
		"stages.ts",
		"catalog.ts",
		"skin-tone-catalog.ts",
		"host-process.ts",
		"request.ts",
		"package-resolver.ts",
		"makeup-resolver.ts",
		"bridge-resolver.ts",
	].map((file) =>
		path.join(repoRoot, "electron/jianying-portrait-adjustment-runtime", file)
	);
	const harnessPaths = ["plan.ts", "process.ts", "native.ts"].map((file) =>
		path.join(
			repoRoot,
			"electron/__tests__",
			`jianying-portrait-session-${file}`
		)
	);
	const files = await fingerprintPortraitAuditFiles({
		paths: [
			path.resolve(bundlePath),
			hostPath,
			runtime.effectLibraryPath,
			...sourcePaths,
			...harnessPaths,
			...packageFiles,
		],
	});
	return {
		bundlePath: path.resolve(bundlePath),
		directories,
		selected,
		files,
		runtimeSource: runtime.status.runtimeSource,
		modelSource: runtime.status.modelSource,
		scope:
			"invoked bundle, working-tree scope/feature sources, host, libcccreator and all regular files in eight selected packages; model files and other framework dependencies not hashed",
	};
}

interface ProcessControlDiagnostic {
	pid: number;
	pgid: number;
	targetPid: number;
	action: string;
	signal: NodeJS.Signals | 0;
	outcome: "ok" | "absent" | "error";
	code?: string;
	errno?: number;
	message?: string;
}

function controlProcessGroup({
	pid,
	signal,
	action,
	diagnostics = [],
}: {
	pid: number;
	signal: NodeJS.Signals | 0;
	action: string;
	diagnostics?: ProcessControlDiagnostic[];
}) {
	if (!Number.isSafeInteger(pid) || pid <= 1)
		throw new Error("Invalid owned process group PID");
	const operation = { pid, pgid: pid, targetPid: -pid, action, signal };
	try {
		process.kill(-pid, signal);
		diagnostics.push({ ...operation, outcome: "ok" });
		return true;
	} catch (cause) {
		const error = cause as NodeJS.ErrnoException;
		diagnostics.push({
			...operation,
			outcome: error.code === "ESRCH" ? "absent" : "error",
			code: error.code,
			errno: error.errno,
			message: String(cause),
		});
		if (error.code === "ESRCH") return false;
		throw cause;
	}
}

export function portraitProcessGroupExists({ pid }: { pid: number }) {
	return controlProcessGroup({ pid, signal: 0, action: "probe" });
}

export async function runBoundedPortraitWorker({
	command,
	args,
	env = process.env,
	timeoutMs,
	graceMs = 1000,
	abortMarker,
	signal,
}: {
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
	timeoutMs: number;
	graceMs?: number;
	abortMarker?: string;
	signal?: AbortSignal;
}) {
	if (process.platform === "win32")
		throw new Error("Process-group audit requires POSIX");
	if (
		!Number.isFinite(timeoutMs) ||
		timeoutMs <= 0 ||
		timeoutMs > 600_000 ||
		!Number.isFinite(graceMs) ||
		graceMs < 1 ||
		graceMs > 5000
	)
		throw new Error("Invalid worker deadline");
	if (signal?.aborted) throw new Error("Cancelled before worker launch");
	const child = spawn(command, args, {
		detached: true,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const pid = child.pid;
	if (!pid) {
		await new Promise<void>((_resolve, reject) => child.once("error", reject));
		throw new Error("Worker started without a pid");
	}
	let stdout = "";
	let stderr = "";
	let reason: "timeout" | "cancelled" | "abort-marker" | null = null;
	const started = Date.now();
	const diagnostics: ProcessControlDiagnostic[] = [];
	const failures: unknown[] = [];
	let rootClosed = false;
	let exit: { code: number | null; signal: NodeJS.Signals | null } = {
		code: null,
		signal: null,
	};
	const closed = new Promise<typeof exit>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, exitSignal) => {
			rootClosed = true;
			exit = { code, signal: exitSignal };
			resolve(exit);
		});
	});
	let rejectControl: (cause: unknown) => void = () => {};
	const controlFailure = new Promise<never>((_resolve, reject) => {
		rejectControl = reject;
	});
	const recordFailure = (cause: unknown) => {
		if (!failures.includes(cause)) failures.push(cause);
	};
	const action = ({
		signal: groupSignal,
		action: name,
	}: {
		signal: NodeJS.Signals | 0;
		action: string;
	}) =>
		controlProcessGroup({
			pid,
			signal: groupSignal,
			action: name,
			diagnostics,
		});
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	const signalFromCallback = ({
		signal: groupSignal,
		action: name,
	}: {
		signal: NodeJS.Signals;
		action: string;
	}) => {
		try {
			action({ signal: groupSignal, action: name });
		} catch (cause) {
			recordFailure(cause);
			rejectControl(cause);
		}
	};
	const stop = ({ cause }: { cause: NonNullable<typeof reason> }) => {
		if (reason) return;
		reason = cause;
		signalFromCallback({ signal: "SIGTERM", action: `${cause}-term` });
		killTimer = setTimeout(
			() => signalFromCallback({ signal: "SIGKILL", action: `${cause}-kill` }),
			graceMs
		);
		closeTimer = setTimeout(
			() =>
				rejectControl(
					new Error("Owned worker did not close after cancellation")
				),
			graceMs + 1000
		);
	};
	const cancel = () => stop({ cause: "cancelled" });
	signal?.addEventListener("abort", cancel, { once: true });
	child.stdout.on("data", (chunk: Buffer) => {
		stdout = (stdout + chunk.toString()).slice(-65_536);
		if (abortMarker && stdout.includes(abortMarker))
			stop({ cause: "abort-marker" });
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = (stderr + chunk.toString()).slice(-65_536);
	});
	const deadline = setTimeout(() => stop({ cause: "timeout" }), timeoutMs);
	let processGroupGone = false;
	try {
		await Promise.race([closed, controlFailure]);
		// The worker can exit before its native grandchildren. Only its new group is owned here.
		if (action({ signal: 0, action: "post-close-probe" })) {
			action({ signal: "SIGTERM", action: "post-close-term" });
			await new Promise((resolve) => setTimeout(resolve, graceMs));
			action({ signal: "SIGKILL", action: "post-close-kill" });
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		processGroupGone = !action({ signal: 0, action: "verify-gone" });
	} catch (cause) {
		recordFailure(cause);
	} finally {
		clearTimeout(deadline);
		if (killTimer) clearTimeout(killTimer);
		if (closeTimer) clearTimeout(closeTimer);
		signal?.removeEventListener("abort", cancel);
		if (!processGroupGone) {
			try {
				action({ signal: "SIGKILL", action: "final-cleanup-kill" });
			} catch (cause) {
				recordFailure(cause);
			}
			let reapTimer: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				closed.catch(recordFailure),
				new Promise((resolve) => {
					reapTimer = setTimeout(resolve, graceMs + 100);
				}),
			]);
			if (reapTimer) clearTimeout(reapTimer);
			try {
				processGroupGone = !action({
					signal: 0,
					action: "final-cleanup-probe",
				});
			} catch (cause) {
				recordFailure(cause);
			}
		}
	}
	const result = {
		pid,
		...exit,
		reason,
		elapsedMs: Date.now() - started,
		stdout,
		stderr,
		rootClosed,
		processGroupGone,
		diagnostics,
	};
	if (failures.length) {
		const errors = failures.map((cause) => ({
			message: String(cause),
			stack: cause instanceof Error ? cause.stack : null,
		}));
		throw Object.assign(
			new Error(
				`Portrait worker process control failed: ${JSON.stringify({ pid, reason, diagnostics, errors })}`,
				{ cause: failures[0] }
			),
			{ ...result, errors, cleanupErrors: failures.slice(1) }
		);
	}
	return result;
}
