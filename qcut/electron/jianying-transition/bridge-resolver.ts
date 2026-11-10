import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const JIANYING_TRANSITION_BRIDGE_FILE_NAME =
	"jianying-transition-bridge";
/**
 * In the usage text of a bridge that waits for the engine's own rendering
 * before it reads a transition frame back. The engine draws on a Metal
 * queue of its own; a bridge built before this read the output at once, and
 * while another job kept the GPU busy up to a third of the frames of a
 * transition were the wrong ones (an input alone, an earlier frame,
 * half-drawn). The transition
 * render must never be handed such a bridge, however it got onto the
 * machine.
 */
export const JIANYING_TRANSITION_FINISH_CAPABILITY = "transition-finish";
export const JIANYING_TRANSITION_BRIDGE_SOURCE_FILE_NAMES = [
	"probe.mm",
	"amazer-context-scope.mm",
	"amazer-context-scope.h",
	"filter-host-support.mm",
	"filter-host-support.h",
	"filter-sequence-io.cpp",
	"filter-sequence-io.h",
	"graphics-runtime.mm",
	"graphics-runtime.h",
	"graphics-probe.mm",
	"graphics-probe.h",
	"filter-face-inspect.mm",
	"filter-face-inspect.h",
	"filter-probe.mm",
	"filter-probe.h",
	"transition-probe.mm",
	"transition-probe.h",
	"text-probe.mm",
	"text-probe.h",
	"text-resource-finder.mm",
	"text-resource-finder.h",
	"video-transition-probe.mm",
	"video-transition-probe.h",
	"effect-probe.mm",
	"effect-probe.h",
	"effect-video-probe.mm",
	"effect-video-probe.h",
	"probe-utils.h",
] as const;

const pendingBridgeResolutions = new Map<string, Promise<string | null>>();
/** The usage text of each bridge binary asked so far, by path and file state. */
const bridgeUsageTexts = new Map<string, Promise<string>>();

async function isExecutable({
	filePath,
}: {
	filePath: string;
}): Promise<boolean> {
	try {
		await access(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function processResourcesPath(): string | undefined {
	return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

export function qcutPrivateRuntimeBridgePath({
	homeDirectory = os.homedir(),
}: {
	homeDirectory?: string;
} = {}): string {
	return path.join(
		homeDirectory,
		"Library",
		"Application Support",
		"QCut",
		"RuntimeBridges",
		JIANYING_TRANSITION_BRIDGE_FILE_NAME
	);
}

function uniquePaths({
	paths,
}: {
	paths: Array<string | undefined>;
}): string[] {
	return Array.from(
		new Set(paths.filter((value): value is string => Boolean(value)))
	);
}

export function findQCutProjectRoot({
	cwd = process.cwd(),
	moduleDirectory = __dirname,
}: {
	cwd?: string;
	moduleDirectory?: string;
} = {}): string | null {
	const candidates = uniquePaths({
		paths: [
			cwd,
			path.resolve(moduleDirectory, "..", ".."),
			path.resolve(moduleDirectory, "..", "..", ".."),
		],
	});
	for (const candidate of candidates) {
		const sourceDirectory = path.join(
			candidate,
			"research",
			"jianying-runtime-probe"
		);
		if (
			JIANYING_TRANSITION_BRIDGE_SOURCE_FILE_NAMES.every((name) =>
				existsSync(path.join(sourceDirectory, name))
			)
		) {
			return candidate;
		}
	}
	return null;
}

function bridgeCandidates({
	projectRoot,
}: {
	projectRoot: string | null;
}): string[] {
	const resourcesPath = processResourcesPath();
	return uniquePaths({
		paths: [
			process.env.QCUT_JIANYING_TRANSITION_BRIDGE,
			resourcesPath
				? path.join(resourcesPath, "bin", JIANYING_TRANSITION_BRIDGE_FILE_NAME)
				: undefined,
			qcutPrivateRuntimeBridgePath(),
			projectRoot
				? path.join(
						projectRoot,
						"electron",
						"resources",
						"bin",
						JIANYING_TRANSITION_BRIDGE_FILE_NAME
					)
				: undefined,
			projectRoot
				? path.join(
						projectRoot,
						"research",
						"jianying-runtime-probe",
						"build",
						"jianying-runtime-probe"
					)
				: undefined,
		],
	});
}

async function sourceFingerprint({
	sourceDirectory,
}: {
	sourceDirectory: string;
}) {
	const contents = await Promise.all(
		JIANYING_TRANSITION_BRIDGE_SOURCE_FILE_NAMES.map((name) =>
			readFile(path.join(sourceDirectory, name))
		)
	);
	const hash = createHash("sha256");
	for (const content of contents) hash.update(content);
	return hash.digest("hex").slice(0, 16);
}

export function jianyingTransitionBridgeCompilerArguments({
	sourceDirectory,
	outputPath,
}: {
	sourceDirectory: string;
	outputPath: string;
}): string[] {
	const sourcePaths = JIANYING_TRANSITION_BRIDGE_SOURCE_FILE_NAMES.filter(
		(name) => name.endsWith(".mm") || name.endsWith(".cpp")
	).map((name) => path.join(sourceDirectory, name));
	return [
		"clang++",
		"-std=c++20",
		"-fobjc-arc",
		"-Wall",
		"-Wextra",
		"-Werror",
		"-Wno-deprecated-declarations",
		...sourcePaths,
		"-framework",
		"AppKit",
		"-framework",
		"CoreVideo",
		"-framework",
		"IOSurface",
		"-framework",
		"OpenGL",
		"-o",
		outputPath,
	];
}

export async function compileJianyingTransitionBridge({
	projectRoot,
	outputPath,
}: {
	projectRoot: string;
	outputPath: string;
}): Promise<string> {
	if (process.platform !== "darwin") {
		throw new Error(
			"The Jianying transition bridge can only be built on macOS."
		);
	}
	const sourceDirectory = path.join(
		projectRoot,
		"research",
		"jianying-runtime-probe"
	);
	if (await isExecutable({ filePath: outputPath })) return outputPath;

	await mkdir(path.dirname(outputPath), { recursive: true });
	await execFileAsync(
		"xcrun",
		jianyingTransitionBridgeCompilerArguments({
			sourceDirectory,
			outputPath,
		}),
		{ maxBuffer: 16 * 1024 * 1024 }
	);
	if (!(await isExecutable({ filePath: outputPath }))) {
		throw new Error(
			"The Jianying transition bridge was not executable after build."
		);
	}
	return outputPath;
}

async function compileDevelopmentBridge({
	projectRoot,
}: {
	projectRoot: string;
}): Promise<string> {
	const sourceDirectory = path.join(
		projectRoot,
		"research",
		"jianying-runtime-probe"
	);
	const fingerprint = await sourceFingerprint({ sourceDirectory });
	return compileJianyingTransitionBridge({
		projectRoot,
		outputPath: path.join(
			os.homedir(),
			"Library",
			"Caches",
			"QCut",
			"jianying-transition-bridge",
			fingerprint,
			JIANYING_TRANSITION_BRIDGE_FILE_NAME
		),
	});
}

/** What a bridge prints when run without arguments: its modes and capabilities. */
async function readBridgeUsage({
	bridgePath,
}: {
	bridgePath: string;
}): Promise<string> {
	try {
		await execFileAsync(bridgePath, [], { timeout: 10_000 });
		return "";
	} catch (error) {
		return `${(error as { stdout?: string }).stdout ?? ""}${
			(error as { stderr?: string }).stderr ?? ""
		}`;
	}
}

/**
 * A prebuilt bridge is preferred over the fingerprinted dev build, so a
 * binary that predates a mode, or a fix, would be picked and used as it is.
 * Callers that need a mode or a capability ask for it (both are named in the
 * usage text), and a binary without it is skipped in favour of compiling one
 * that has it. A binary is asked once for as long as its file stays the same.
 */
export async function bridgeAdvertises({
	bridgePath,
	tokens,
}: {
	bridgePath: string;
	tokens: readonly string[];
}): Promise<boolean> {
	if (tokens.length === 0) return true;
	const { mtimeMs, size } = await stat(bridgePath);
	const key = `${bridgePath}\n${mtimeMs}\n${size}`;
	let usage = bridgeUsageTexts.get(key);
	if (!usage) {
		usage = readBridgeUsage({ bridgePath });
		bridgeUsageTexts.set(key, usage);
	}
	const text = await usage;
	return tokens.every((token) => text.includes(token));
}

async function resolveBridgeInternal({
	allowCompile,
	requiredTokens,
}: {
	allowCompile: boolean;
	requiredTokens: readonly string[];
}): Promise<string | null> {
	if (process.platform !== "darwin") return null;
	const projectRoot = findQCutProjectRoot();
	const candidates = bridgeCandidates({ projectRoot });
	const checks = await Promise.all(
		candidates.map(async (candidate) => ({
			candidate,
			executable: await isExecutable({ filePath: candidate }),
		}))
	);
	for (const check of checks) {
		if (!check.executable) continue;
		if (
			!(await bridgeAdvertises({
				bridgePath: check.candidate,
				tokens: requiredTokens,
			}))
		) {
			continue;
		}
		return check.candidate;
	}
	if (!allowCompile || !projectRoot) return null;
	return compileDevelopmentBridge({ projectRoot });
}

export function resolveJianyingTransitionBridge({
	allowCompile = true,
	requiredMode,
	requiredCapability,
}: {
	allowCompile?: boolean;
	requiredMode?: string;
	/** Something the bridge must do beyond having a mode, as its usage names it. */
	requiredCapability?: string;
} = {}): Promise<string | null> {
	const requiredTokens = [requiredMode, requiredCapability].filter(
		(token): token is string => Boolean(token)
	);
	// One lookup at a time for each thing asked, so two callers never compile
	// the same bridge at once, and one caller's needs never decide another's.
	const key = `${allowCompile}\n${requiredTokens.join("\n")}`;
	let pending = pendingBridgeResolutions.get(key);
	if (!pending) {
		pending = resolveBridgeInternal({ allowCompile, requiredTokens }).finally(
			() => {
				pendingBridgeResolutions.delete(key);
			}
		);
		pendingBridgeResolutions.set(key, pending);
	}
	return pending;
}
