import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { qcutStandaloneUserDataRoot } from "../../jianying-effect/user-data-paths.js";
import { resolveDefaultLocalReferenceRoot } from "./local-reference-catalog/index.js";
import { resolveRegularDirectory } from "./local-reference-catalog/filesystem.js";

const CONFIG_FILE_NAME = "sticker-lab-root.json";
const MAX_CONFIG_BYTES = 16 * 1024;

export interface StickerLabRootOptions {
	root?: string;
	environment?: NodeJS.ProcessEnv;
	userDataPath?: string;
	homeDirectory?: string;
	platform?: NodeJS.Platform;
	videosDirectory?: string;
}

export interface StickerLabRootResolution {
	rootPath: string;
	source: "explicit" | "environment" | "persisted" | "default";
	configPath: string;
}

function validateRootPath({
	rootPath,
	allowRelative = false,
}: {
	rootPath: string;
	allowRelative?: boolean;
}): string {
	const trimmed = rootPath.trim();
	if (
		!trimmed ||
		(!allowRelative && !path.isAbsolute(trimmed)) ||
		trimmed.includes("\0") ||
		trimmed.split(/[\\/]/).some((part) => part === "." || part === "..")
	) {
		throw new Error(
			"Sticker Lab root must be an absolute path without dot segments"
		);
	}
	return allowRelative ? path.resolve(trimmed) : trimmed;
}

export function stickerLabRootConfigPath({
	environment = process.env,
	userDataPath,
	homeDirectory,
	platform,
}: StickerLabRootOptions = {}): string {
	return path.join(
		userDataPath ??
			qcutStandaloneUserDataRoot({ environment, homeDirectory, platform }),
		CONFIG_FILE_NAME
	);
}

function readSavedRoot({
	configPath,
}: {
	configPath: string;
}): string | undefined {
	let stats: fs.Stats;
	try {
		stats = fs.lstatSync(configPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	if (
		!stats.isFile() ||
		stats.isSymbolicLink() ||
		stats.size > MAX_CONFIG_BYTES
	) {
		throw new Error(`Invalid Sticker Lab configuration file: ${configPath}`);
	}
	const descriptor = fs.openSync(
		configPath,
		fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
	);
	try {
		const opened = fs.fstatSync(descriptor);
		if (
			!opened.isFile() ||
			opened.dev !== stats.dev ||
			opened.ino !== stats.ino
		) {
			throw new Error("Sticker Lab configuration changed while opening");
		}
		const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
		let byteCount = 0;
		while (byteCount < bytes.byteLength) {
			const read = fs.readSync(
				descriptor,
				bytes,
				byteCount,
				bytes.byteLength - byteCount,
				byteCount
			);
			if (read === 0) break;
			byteCount += read;
		}
		if (byteCount > MAX_CONFIG_BYTES) {
			throw new Error("Sticker Lab configuration exceeds the size limit");
		}
		const parsed: unknown = JSON.parse(
			bytes.subarray(0, byteCount).toString("utf8")
		);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed) ||
			Object.keys(parsed).some(
				(key) => key !== "version" && key !== "rootPath"
			) ||
			Reflect.get(parsed, "version") !== 1 ||
			typeof Reflect.get(parsed, "rootPath") !== "string"
		) {
			throw new Error("Unsupported or invalid Sticker Lab root configuration");
		}
		return validateRootPath({ rootPath: Reflect.get(parsed, "rootPath") });
	} finally {
		fs.closeSync(descriptor);
	}
}

export function resolveStickerLabRoot(
	options: StickerLabRootOptions = {}
): StickerLabRootResolution {
	const configPath = stickerLabRootConfigPath(options);
	const explicit = options.root?.trim();
	if (explicit) {
		return {
			rootPath: validateRootPath({ rootPath: explicit, allowRelative: true }),
			source: "explicit",
			configPath,
		};
	}
	const environment = options.environment ?? process.env;
	const override = environment.QCUT_STICKER_LAB_ROOT?.trim();
	if (override) {
		return {
			rootPath: validateRootPath({ rootPath: override, allowRelative: true }),
			source: "environment",
			configPath,
		};
	}
	const savedRoot = readSavedRoot({ configPath });
	if (savedRoot)
		return { rootPath: savedRoot, source: "persisted", configPath };
	return {
		rootPath: options.videosDirectory
			? path.resolve(options.videosDirectory, "QCut Sticker Lab")
			: resolveDefaultLocalReferenceRoot(options),
		source: "default",
		configPath,
	};
}

export async function writeStickerLabRootConfig({
	rootPath,
	...options
}: StickerLabRootOptions & { rootPath: string }): Promise<string> {
	const canonicalRoot = await resolveRegularDirectory({
		directoryPath: validateRootPath({ rootPath }),
		label: "Sticker Lab root",
	});
	const configPath = stickerLabRootConfigPath(options);
	const temporaryPath = `${configPath}.tmp-${randomUUID()}`;
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	try {
		fs.writeFileSync(
			temporaryPath,
			`${JSON.stringify({ version: 1, rootPath: canonicalRoot }, null, 2)}\n`,
			{ mode: 0o600, flag: "wx" }
		);
		fs.renameSync(temporaryPath, configPath);
	} catch (error) {
		try {
			fs.rmSync(temporaryPath, { force: true });
		} catch {
			// Preserve the configuration write error if temporary cleanup also fails.
		}
		throw error;
	}
	return canonicalRoot;
}

export function resetStickerLabRootConfig(
	options: StickerLabRootOptions = {}
): void {
	try {
		fs.unlinkSync(stickerLabRootConfigPath(options));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}
