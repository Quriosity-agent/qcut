import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

interface CandidateDir {
	fullPath: string;
	mtimeMs: number;
}

interface StageTarget {
	platform: string;
	arch: string;
	key: string;
}

interface RunBinaryResult {
	exitCode: number | null;
	firstLine: string;
	stderr: string;
	error: string;
	timedOut: boolean;
	elapsedMs: number;
}

interface BinaryManifest {
	binaries?: {
		aicp?: {
			version?: string;
		};
	};
}

const DEFAULT_STAGE_TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"win32-x64",
	"linux-x64",
];
// Wall-clock budget per `--version` launch. The binary is a PyInstaller
// one-file build: each launch extracts its libraries to a fresh temp dir and
// macOS trust validation of the freshly signed files runs in syspolicyd, so
// load stretches the wait while the binary itself needs <1s of CPU. Measured
// ~15s cold / ~6s warm on an idle machine; the v2026.10.10.1 release build
// blew a 30s budget on the first launch. Only a timeout earns the second
// attempt: spawn errors, non-zero exits and wrong versions fail immediately.
export const VERSION_ATTEMPT_TIMEOUTS_MS: readonly number[] = [90_000, 60_000];
// SIGTERM lets the one-file bootloader forward the signal to its child; a
// launch that ignores it is SIGKILLed so a retry never overlaps it.
const KILL_GRACE_MS = 5_000;
// Upper bound on the whole host check; callers that wrap this script in their
// own timeout must outlast it.
export const VERSION_CHECK_DEADLINE_MS = VERSION_ATTEMPT_TIMEOUTS_MS.reduce(
	(total, timeoutMs) => total + timeoutMs + KILL_GRACE_MS,
	0
);
// click's version_option output, e.g. "aicp, version 1.0.29".
const VERSION_LINE_PATTERN = /\bversion\s+(\S+)$/;

function getErrorMessage({ error }: { error: unknown }): string {
	try {
		if (error instanceof Error) {
			return error.message;
		}
		return String(error);
	} catch {
		return "Unknown error";
	}
}

function parseTargets({ rawTargets }: { rawTargets: string }): StageTarget[] {
	try {
		const uniqueKeys = new Set(
			rawTargets
				.split(",")
				.map((target) => target.trim())
				.filter(Boolean)
		);

		if (uniqueKeys.size === 0) {
			throw new Error("No staged AICP targets configured");
		}

		return Array.from(uniqueKeys).map((key) => {
			const [platform, arch] = key.split("-");
			if (!platform || !arch) {
				throw new Error(
					`Invalid staged target "${key}". Expected format "<platform>-<arch>".`
				);
			}
			return { platform, arch, key };
		});
	} catch (error: unknown) {
		throw new Error(
			`Failed to parse staged targets: ${getErrorMessage({ error })}`
		);
	}
}

function getBinaryName({ target }: { target: StageTarget }): string {
	try {
		return target.platform === "win32" ? "aicp.exe" : "aicp";
	} catch (error: unknown) {
		throw new Error(
			`Failed to resolve binary name: ${getErrorMessage({ error })}`
		);
	}
}

function isRunnableOnHost({ target }: { target: StageTarget }): boolean {
	try {
		return target.platform === process.platform && target.arch === process.arch;
	} catch {
		return false;
	}
}

/**
 * Runs `<binary> --version` once. On timeout the launch is terminated and the
 * result resolves only after it has exited (or been SIGKILLed after
 * `killGraceMs`), so a follow-up attempt never competes with it.
 */
function runBinaryVersion({
	binaryPath,
	timeoutMs,
	killGraceMs,
}: {
	binaryPath: string;
	timeoutMs: number;
	killGraceMs: number;
}): Promise<RunBinaryResult> {
	return new Promise((resolve) => {
		const startedAt = Date.now();
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let killTimerId: ReturnType<typeof setTimeout> | undefined;

		const settle = ({
			exitCode,
			error,
			timedOut,
		}: {
			exitCode: number | null;
			error: string;
			timedOut: boolean;
		}) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			clearTimeout(killTimerId);
			resolve({
				exitCode,
				firstLine: (stdout.split(/\r?\n/)[0] ?? "").trim(),
				stderr,
				error,
				timedOut,
				elapsedMs: Date.now() - startedAt,
			});
		};
		const settleTimedOut = () =>
			settle({
				exitCode: null,
				error: `timed out after ${timeoutMs}ms`,
				timedOut: true,
			});

		try {
			const proc = spawn(binaryPath, ["--version"], {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			timeoutId = setTimeout(() => {
				if (proc.exitCode !== null || proc.signalCode !== null) {
					settleTimedOut();
					return;
				}
				proc.once("exit", settleTimedOut);
				proc.kill("SIGTERM");
				killTimerId = setTimeout(() => {
					proc.kill("SIGKILL");
					settleTimedOut();
				}, killGraceMs);
			}, timeoutMs);

			proc.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			proc.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			proc.on("close", (exitCode: number | null) => {
				settle({ exitCode, error: "", timedOut: false });
			});

			proc.on("error", (error: Error) => {
				settle({ exitCode: null, error: error.message, timedOut: false });
			});
		} catch (error: unknown) {
			settle({
				exitCode: null,
				error: getErrorMessage({ error }),
				timedOut: false,
			});
		}
	});
}

/**
 * Gives each budget in `attemptTimeoutsMs` one launch, moving to the next
 * budget only when the previous launch timed out. Any other outcome — success,
 * spawn error, non-zero exit — is returned as-is for the caller to judge.
 */
export async function runVersionWithTimeoutRetry({
	binaryPath,
	attemptTimeoutsMs = VERSION_ATTEMPT_TIMEOUTS_MS,
	killGraceMs = KILL_GRACE_MS,
	log,
}: {
	binaryPath: string;
	attemptTimeoutsMs?: readonly number[];
	killGraceMs?: number;
	log: (message: string) => void;
}): Promise<{ result: RunBinaryResult; attempt: number }> {
	for (const [index, timeoutMs] of attemptTimeoutsMs.entries()) {
		const attempt = index + 1;
		const result = await runBinaryVersion({
			binaryPath,
			timeoutMs,
			killGraceMs,
		});
		if (!result.timedOut || attempt === attemptTimeoutsMs.length) {
			return { result, attempt };
		}
		log(
			`⏳ AICP --version timed out after ${timeoutMs}ms on attempt ${attempt}/${attemptTimeoutsMs.length} (a fresh binary's first launch can stall on OS trust validation or antivirus scanning); retrying with ${attemptTimeoutsMs[attempt]}ms`
		);
	}
	throw new Error("No AICP --version attempts configured");
}

async function readPinnedAicpVersion({
	resourcesDir,
}: {
	resourcesDir: string;
}): Promise<string> {
	const manifestPath = join(resourcesDir, "bin", "manifest.json");
	try {
		const manifest = JSON.parse(
			await readFile(manifestPath, "utf8")
		) as BinaryManifest;
		const version = manifest.binaries?.aicp?.version;
		if (!version) {
			throw new Error("binaries.aicp.version is missing");
		}
		return version;
	} catch (error: unknown) {
		throw new Error(
			`Failed to read pinned AICP version from ${manifestPath}: ${getErrorMessage({ error })}`
		);
	}
}

async function resolveLatestResourcesDir({
	distDir,
}: {
	distDir: string;
}): Promise<string> {
	try {
		if (!existsSync(distDir)) {
			throw new Error(`dist-electron not found: ${distDir}`);
		}

		const entries = await readdir(distDir, { withFileTypes: true });
		const candidateGroups = await Promise.all(
			entries.map(async (entry): Promise<string[]> => {
				if (!entry.isDirectory()) {
					return [];
				}

				const entryPath = join(distDir, entry.name);
				if (entry.name.endsWith("win-unpacked")) {
					return [join(entryPath, "resources")];
				}
				if (entry.name.endsWith("linux-unpacked")) {
					return [join(entryPath, "resources")];
				}

				const macBundleCandidates = await readdir(entryPath, {
					withFileTypes: true,
				}).catch(() => []);

				return macBundleCandidates
					.filter((macEntry) => macEntry.isDirectory())
					.filter((macEntry) => macEntry.name.endsWith(".app"))
					.map((macEntry) =>
						join(entryPath, macEntry.name, "Contents", "Resources")
					);
			})
		);

		const existingCandidates = candidateGroups
			.flat()
			.filter((candidatePath) => existsSync(candidatePath));

		if (existingCandidates.length === 0) {
			throw new Error(`No packaged resources directory found in: ${distDir}`);
		}

		const candidates: CandidateDir[] = await Promise.all(
			existingCandidates.map(async (fullPath): Promise<CandidateDir> => {
				const fileStat = await stat(fullPath);
				return { fullPath, mtimeMs: fileStat.mtimeMs };
			})
		);

		const newest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
		return newest.fullPath;
	} catch (error: unknown) {
		throw new Error(
			`Failed to resolve packaged resources directory: ${getErrorMessage({ error })}`
		);
	}
}

/**
 * Verifies the newest packaged app under `distDir` carries every staged AICP
 * target and, when one matches the host, that it launches and reports the
 * version pinned in the packaged binary manifest. Resolves with the success
 * message; rejects on any failure.
 */
export async function verifyPackagedAicp({
	distDir,
	rawTargets = DEFAULT_STAGE_TARGETS.join(","),
	attemptTimeoutsMs = VERSION_ATTEMPT_TIMEOUTS_MS,
	killGraceMs = KILL_GRACE_MS,
	log = (message) => process.stdout.write(`${message}\n`),
}: {
	distDir: string;
	rawTargets?: string;
	attemptTimeoutsMs?: readonly number[];
	killGraceMs?: number;
	log?: (message: string) => void;
}): Promise<string> {
	const resourcesDir = await resolveLatestResourcesDir({ distDir });
	const stagedRoot = join(resourcesDir, "bin", "aicp");
	if (!existsSync(stagedRoot)) {
		throw new Error(`Packaged staged AICP directory not found: ${stagedRoot}`);
	}

	const targets = parseTargets({ rawTargets });

	const missingPaths: string[] = [];
	for (const target of targets) {
		const binaryPath = join(stagedRoot, target.key, getBinaryName({ target }));
		if (!existsSync(binaryPath)) {
			missingPaths.push(binaryPath);
		}
	}

	if (missingPaths.length > 0) {
		throw new Error(
			`Missing staged AICP binaries in packaged app:\n${missingPaths.join("\n")}`
		);
	}

	const runnableTarget = targets.find((target) => isRunnableOnHost({ target }));
	if (!runnableTarget) {
		return `✅ Packaged AICP verification passed (presence only). No runnable host target in: ${targets.map((target) => target.key).join(", ")}`;
	}

	const binaryPath = join(
		stagedRoot,
		runnableTarget.key,
		getBinaryName({ target: runnableTarget })
	);
	const pinnedVersion = await readPinnedAicpVersion({ resourcesDir });

	const { result, attempt } = await runVersionWithTimeoutRetry({
		binaryPath,
		attemptTimeoutsMs,
		killGraceMs,
		log,
	});
	const attemptLabel = `attempt ${attempt}/${attemptTimeoutsMs.length}`;

	if (result.error || result.exitCode !== 0) {
		throw new Error(
			`Packaged AICP binary failed host validation (${attemptLabel}): exit=${result.exitCode} error=${result.error} stderr=${result.stderr.trim()}`
		);
	}

	const reportedVersion = result.firstLine.match(VERSION_LINE_PATTERN)?.[1];
	if (reportedVersion !== pinnedVersion) {
		throw new Error(
			`Packaged AICP binary reported "${result.firstLine}" but the packaged manifest pins version ${pinnedVersion}`
		);
	}

	const elapsedSeconds = (result.elapsedMs / 1000).toFixed(1);
	return `✅ Packaged AICP verification passed: ${binaryPath}\n${result.firstLine} (${elapsedSeconds}s, ${attemptLabel})`;
}

if (import.meta.main) {
	try {
		const message = await verifyPackagedAicp({
			distDir: join(process.cwd(), "dist-electron"),
			rawTargets: process.env.AICP_STAGE_TARGETS || undefined,
		});
		process.stdout.write(`${message}\n`);
	} catch (error: unknown) {
		process.stderr.write(
			`❌ verify-packaged-aicp failed: ${getErrorMessage({ error })}\n`
		);
		process.exit(1);
	}
}
