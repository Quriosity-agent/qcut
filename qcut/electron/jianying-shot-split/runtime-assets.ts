/**
 * Verification of the private 剪映 11.3.0 shot-split runtime snapshot written by
 * `research/jianying-shot-split-probe/snapshot-private-runtime.sh`. Every file is
 * pinned by SHA-256 so a re-snapshot from another app version fails closed.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
	inspectRuntimeFiles,
	privateRuntimeBase,
	trackingRuntimeFilesFingerprint,
} from "../jianying-motion-tracking/runtime-assets.js";

export const EXPECTED_JIANYING_BUNDLE_ID = "com.lemon.lvpro";
export const EXPECTED_JIANYING_VERSION = "11.3.0";
export const EXPECTED_SHOT_SPLIT_CORE_UUID =
	"100726E3-FCB0-31BC-98EE-1B196A1714A3";
export const EXPECTED_SHOT_SPLIT_CORE_SHA256 =
	"b09c395d934169cb20ec865dd1d4032ca68023b287a7264e1b06ff4d71fd1be4";
export const EXPECTED_SHOT_SPLIT_FILESET_SHA256 =
	"d8fae7279a18c3c85aa6105139157acb5ea4721c0fdc7eb05ac40831017f71cb";
export const EXPECTED_SHOT_SPLIT_RUNTIME_FILE_COUNT = 29;
export const EXPECTED_SHOT_SPLIT_RUNTIME_BYTES = 305_591_695;
export const SHOT_SPLIT_MANIFEST_PURPOSE = "jianying-shot-split-research";
export const SHOT_SPLIT_CORE_RELATIVE_PATH = "Frameworks/libcccreator.dylib";
export const SHOT_SPLIT_GRAPH_RELATIVE_PATH =
	"Resources/SceneEditDetection/config.json";
export const SHOT_SPLIT_MODEL_RELATIVE_PATHS = [
	"Resources/models/jy_compressShotDetectBackbone_new_v1.0_size0.bytenn",
	"Resources/models/jy_compressShotDetectPredHead_new_v1.0_size0.bytenn",
] as const;

export interface ShotSplitRuntimeManifestFile {
	bytes: number;
	path: string;
	sha256: string;
}

export interface ShotSplitRuntimeManifest {
	app: { bundleId: string; version: string };
	architecture: "arm64";
	cloudUpload: false;
	core: { arm64Uuid: string; library: string };
	createdAt: string;
	files: ShotSplitRuntimeManifestFile[];
	localOnly: true;
	purpose: typeof SHOT_SPLIT_MANIFEST_PURPOSE;
	schemaVersion: 1;
	totalBytes: number;
}

export function defaultShotSplitRuntimeRoot() {
	return path.join(privateRuntimeBase(), "JianyingShotSplit", "current");
}

export function shotSplitRuntimePaths({
	runtimeRoot,
}: {
	runtimeRoot: string;
}) {
	return {
		corePath: path.join(runtimeRoot, SHOT_SPLIT_CORE_RELATIVE_PATH),
		frameworksPath: path.join(runtimeRoot, "Frameworks"),
		graphPath: path.join(runtimeRoot, SHOT_SPLIT_GRAPH_RELATIVE_PATH),
	};
}

function recordValue(value: unknown): Record<string, unknown> | null {
	return Boolean(value) && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function isSafeRelativePath({ value }: { value: string }) {
	if (!value || path.isAbsolute(value)) return false;
	const normalized = path.normalize(value);
	return (
		normalized === value &&
		normalized !== ".." &&
		!normalized.startsWith(`..${path.sep}`)
	);
}

function isManifestFile(value: unknown): value is ShotSplitRuntimeManifestFile {
	const file = recordValue(value);
	return (
		file !== null &&
		typeof file.path === "string" &&
		isSafeRelativePath({ value: file.path }) &&
		Number.isSafeInteger(file.bytes) &&
		(file.bytes as number) >= 0 &&
		typeof file.sha256 === "string" &&
		/^[a-f0-9]{64}$/.test(file.sha256)
	);
}

/**
 * Validates a snapshot manifest and pins it to the verified 剪映 11.3.0 file
 * set. Throws a message naming the first mismatch.
 */
export function parseShotSplitRuntimeManifest({
	value,
}: {
	value: unknown;
}): ShotSplitRuntimeManifest {
	const manifest = recordValue(value);
	if (
		!manifest ||
		manifest.schemaVersion !== 1 ||
		manifest.purpose !== SHOT_SPLIT_MANIFEST_PURPOSE
	) {
		throw new Error("私有镜头分割 runtime 清单格式不受支持");
	}
	if (
		manifest.localOnly !== true ||
		manifest.cloudUpload !== false ||
		manifest.architecture !== "arm64"
	) {
		throw new Error("私有镜头分割 runtime 清单必须是本机 arm64 快照");
	}
	const app = recordValue(manifest.app);
	if (
		app?.bundleId !== EXPECTED_JIANYING_BUNDLE_ID ||
		app.version !== EXPECTED_JIANYING_VERSION
	) {
		throw new Error(
			`私有镜头分割 runtime 需要剪映 ${EXPECTED_JIANYING_VERSION} 的快照`
		);
	}
	const core = recordValue(manifest.core);
	if (
		core?.library !== SHOT_SPLIT_CORE_RELATIVE_PATH ||
		core.arm64Uuid !== EXPECTED_SHOT_SPLIT_CORE_UUID
	) {
		throw new Error(
			"私有镜头分割 runtime 的 libcccreator UUID 与已验证版本不符"
		);
	}
	if (
		typeof manifest.createdAt !== "string" ||
		!Array.isArray(manifest.files) ||
		!manifest.files.every(isManifestFile)
	) {
		throw new Error("私有镜头分割 runtime 清单文件列表无效");
	}
	const files = manifest.files as ShotSplitRuntimeManifestFile[];
	const paths = files.map((file) => file.path);
	const required = [
		SHOT_SPLIT_CORE_RELATIVE_PATH,
		SHOT_SPLIT_GRAPH_RELATIVE_PATH,
		...SHOT_SPLIT_MODEL_RELATIVE_PATHS,
	];
	for (const relativePath of required) {
		if (!paths.includes(relativePath)) {
			throw new Error(`私有镜头分割 runtime 缺少 ${relativePath}`);
		}
	}
	const core_file = files.find(
		(file) => file.path === SHOT_SPLIT_CORE_RELATIVE_PATH
	);
	if (core_file?.sha256 !== EXPECTED_SHOT_SPLIT_CORE_SHA256) {
		throw new Error("私有镜头分割 runtime 的 libcccreator 与已验证版本不符");
	}
	if (
		new Set(paths).size !== paths.length ||
		files.length !== EXPECTED_SHOT_SPLIT_RUNTIME_FILE_COUNT ||
		manifest.totalBytes !== EXPECTED_SHOT_SPLIT_RUNTIME_BYTES ||
		trackingRuntimeFilesFingerprint({ files }) !==
			EXPECTED_SHOT_SPLIT_FILESET_SHA256
	) {
		throw new Error("私有镜头分割 runtime 文件集与已验证快照不符");
	}
	return manifest as unknown as ShotSplitRuntimeManifest;
}

async function listFiles({
	baseDirectory,
	directory = baseDirectory,
}: {
	baseDirectory: string;
	directory?: string;
}): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				return listFiles({ baseDirectory, directory: entryPath });
			}
			return entry.isFile() ? [path.relative(baseDirectory, entryPath)] : [];
		})
	);
	return nested.flat().sort();
}

/** Reads, validates and checksums the snapshot; resolves to its manifest. */
export async function verifyShotSplitRuntimeSnapshot({
	snapshotPath,
}: {
	snapshotPath: string;
}): Promise<ShotSplitRuntimeManifest> {
	let manifestText: string;
	try {
		manifestText = await readFile(
			path.join(snapshotPath, "manifest.json"),
			"utf8"
		);
	} catch {
		throw new Error(
			`没有找到私有镜头分割 runtime 快照 (${snapshotPath})；先运行 research/jianying-shot-split-probe/snapshot-private-runtime.sh`
		);
	}
	const manifest = parseShotSplitRuntimeManifest({
		value: JSON.parse(manifestText) as unknown,
	});
	const expectedPaths = manifest.files.map((file) => file.path).sort();
	const actualPaths = (await listFiles({ baseDirectory: snapshotPath })).filter(
		(relativePath) => relativePath !== "manifest.json"
	);
	if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
		throw new Error("私有镜头分割 runtime 的文件列表与清单不符");
	}
	const expectedByPath = new Map(
		manifest.files.map((file) => [file.path, file])
	);
	const inspected = await inspectRuntimeFiles({
		relativePaths: expectedPaths,
		runtimeRoot: snapshotPath,
	});
	for (const actual of inspected) {
		const expected = expectedByPath.get(actual.path);
		if (
			!expected ||
			expected.bytes !== actual.bytes ||
			expected.sha256 !== actual.sha256
		) {
			throw new Error(`私有镜头分割 runtime 校验失败: ${actual.path}`);
		}
	}
	return manifest;
}
