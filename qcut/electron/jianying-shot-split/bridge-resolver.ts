/**
 * Locates or compiles the native shot-split bridge
 * (`research/jianying-shot-split-probe/shot-split-bridge.mm`) for the verified
 * private runtime. The binary is cached per source/runtime fingerprint under
 * `~/Library/Caches/QCut/JianyingShotSplitBridge`.
 */

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withAtomicPublishLock } from "../jianying-person-cutout/atomic-publish-lock.js";

const execFileAsync = promisify(execFile);
const MINIMUM_BRIDGE_BYTES = 4096;
const NATIVE_SOURCE_RELATIVE_PATH = path.join(
	"research",
	"jianying-shot-split-probe",
	"shot-split-bridge.mm"
);
const MACH_O_MAGICS = [
	Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
	Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
	Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
	Buffer.from([0xca, 0xfe, 0xba, 0xbf]),
] as const;
/** The Bach factory the bridge resolves with dlsym plus the result keys it reads. */
export const JIANYING_SHOT_SPLIT_BRIDGE_REQUIRED_MARKERS = [
	"_ZN4Bach20BachAlgorithmFactory21CreateAlgorithmSystemEv",
	"predict_result",
	"frame_received",
	"M5a fed",
] as const;

export const JIANYING_SHOT_SPLIT_BRIDGE_FILE_NAME =
	"qcut-jianying-shot-split-bridge";

async function isExecutable({ filePath }: { filePath: string }) {
	try {
		await access(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function isValidJianyingShotSplitBridge({
	filePath,
}: {
	filePath: string;
}) {
	if (!(await isExecutable({ filePath }))) return false;
	try {
		const image = await readFile(filePath);
		return (
			image.length >= MINIMUM_BRIDGE_BYTES &&
			MACH_O_MAGICS.some((magic) =>
				image.subarray(0, magic.length).equals(magic)
			) &&
			JIANYING_SHOT_SPLIT_BRIDGE_REQUIRED_MARKERS.every((marker) =>
				image.includes(marker)
			)
		);
	} catch {
		return false;
	}
}

export function findShotSplitProjectRoot() {
	const candidates = [
		process.cwd(),
		path.resolve(__dirname, "..", ".."),
		path.resolve(__dirname, "..", "..", ".."),
	];
	return (
		candidates.find((candidate) =>
			existsSync(path.join(candidate, NATIVE_SOURCE_RELATIVE_PATH))
		) ?? null
	);
}

async function bridgeFingerprint({
	projectRoot,
	runtimeRoot,
	runtimeSha256,
}: {
	projectRoot: string;
	runtimeRoot: string;
	runtimeSha256: string;
}) {
	const source = await readFile(
		path.join(projectRoot, NATIVE_SOURCE_RELATIVE_PATH)
	);
	return createHash("sha256")
		.update(source)
		.update(process.arch)
		.update(runtimeRoot)
		.update(runtimeSha256)
		.digest("hex")
		.slice(0, 20);
}

/**
 * Resolves a usable bridge binary, compiling it on demand. Returns null on
 * unsupported platforms or when the research source is not available.
 */
export async function resolveJianyingShotSplitBridge({
	runtimeRoot,
	runtimeSha256,
}: {
	runtimeRoot: string;
	runtimeSha256: string;
}) {
	if (process.platform !== "darwin" || process.arch !== "arm64") return null;
	const configuredBridge = process.env.QCUT_JIANYING_SHOT_SPLIT_BRIDGE;
	if (
		configuredBridge &&
		(await isValidJianyingShotSplitBridge({ filePath: configuredBridge }))
	) {
		return configuredBridge;
	}
	const projectRoot = findShotSplitProjectRoot();
	if (!projectRoot) return null;
	const fingerprint = await bridgeFingerprint({
		projectRoot,
		runtimeRoot,
		runtimeSha256,
	});
	const outputPath = path.join(
		os.homedir(),
		"Library",
		"Caches",
		"QCut",
		"JianyingShotSplitBridge",
		fingerprint,
		JIANYING_SHOT_SPLIT_BRIDGE_FILE_NAME
	);
	if (await isValidJianyingShotSplitBridge({ filePath: outputPath })) {
		return outputPath;
	}
	return compileJianyingShotSplitBridge({
		outputPath,
		projectRoot,
		runtimeRoot,
	});
}

export async function compileJianyingShotSplitBridge({
	outputPath,
	projectRoot,
	runtimeRoot,
}: {
	outputPath: string;
	projectRoot: string;
	runtimeRoot: string;
}) {
	if (await isValidJianyingShotSplitBridge({ filePath: outputPath })) {
		return outputPath;
	}
	await mkdir(path.dirname(outputPath), { mode: 0o700, recursive: true });
	const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await execFileAsync(
			"xcrun",
			[
				"clang++",
				"-std=c++17",
				"-ObjC++",
				"-O1",
				"-fobjc-arc",
				"-Wall",
				"-Wextra",
				"-framework",
				"Foundation",
				`-Wl,-rpath,${path.join(runtimeRoot, "Frameworks")}`,
				path.join(projectRoot, NATIVE_SOURCE_RELATIVE_PATH),
				"-o",
				temporaryPath,
			],
			{
				killSignal: "SIGKILL",
				maxBuffer: 16 * 1024 * 1024,
				timeout: 120_000,
			}
		);
		if (!(await isValidJianyingShotSplitBridge({ filePath: temporaryPath }))) {
			throw new Error("本机镜头分割桥构建产物无效");
		}
		return await withAtomicPublishLock({
			lockPath: `${outputPath}.publish-lock`,
			action: async () => {
				if (await isValidJianyingShotSplitBridge({ filePath: outputPath })) {
					return outputPath;
				}
				await rm(outputPath, { force: true });
				await rename(temporaryPath, outputPath);
				if (!(await isValidJianyingShotSplitBridge({ filePath: outputPath }))) {
					await rm(outputPath, { force: true });
					throw new Error("本机镜头分割桥发布校验失败");
				}
				return outputPath;
			},
		});
	} finally {
		await rm(temporaryPath, { force: true });
	}
}
