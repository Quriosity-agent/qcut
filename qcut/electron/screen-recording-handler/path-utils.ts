import { app } from "electron";
import * as path from "node:path";
import {
	FILE_EXTENSION,
	DEFAULT_RECORDINGS_DIR_NAME,
	DEFAULT_FILE_PREFIX,
	SCREEN_RECORDING_OUTPUT_FORMAT,
	type ScreenRecordingOutputFormat,
} from "./types.js";

export function sanitizeFilename({ filename }: { filename: string }): string {
	try {
		const trimmedFilename = filename.trim();
		if (!trimmedFilename) {
			return "recording.mp4";
		}
		return trimmedFilename.replace(/[/\\?%*:|"<>]/g, "_");
	} catch {
		return "recording.mp4";
	}
}

export function ensureExtension({
	filePath,
	extension,
}: {
	filePath: string;
	extension: string;
}): string {
	try {
		if (path.extname(filePath)) {
			return filePath;
		}
		return `${filePath}${extension}`;
	} catch {
		return `${filePath}${extension}`;
	}
}

export function getPathExtension({ filePath }: { filePath: string }): string {
	try {
		return path.extname(filePath).toLowerCase();
	} catch {
		return "";
	}
}

export function resolveOutputFormat({
	filePath,
}: {
	filePath: string;
}): ScreenRecordingOutputFormat {
	try {
		const extension = getPathExtension({ filePath });
		if (extension === FILE_EXTENSION.WEBM) {
			return SCREEN_RECORDING_OUTPUT_FORMAT.WEBM;
		}
		return SCREEN_RECORDING_OUTPUT_FORMAT.MP4;
	} catch {
		return SCREEN_RECORDING_OUTPUT_FORMAT.MP4;
	}
}

export function replaceExtension({
	filePath,
	extension,
}: {
	filePath: string;
	extension: string;
}): string {
	try {
		const parsed = path.parse(filePath);
		return path.join(parsed.dir, `${parsed.name}${extension}`);
	} catch {
		return `${filePath}${extension}`;
	}
}

function normalizeOutputPathExtension({
	filePath,
}: {
	filePath: string;
}): string {
	const extension = getPathExtension({ filePath });
	const isSupportedOutputExtension =
		extension === FILE_EXTENSION.WEBM || extension === FILE_EXTENSION.MP4;

	if (isSupportedOutputExtension) {
		return filePath;
	}

	return replaceExtension({
		filePath,
		extension: FILE_EXTENSION.MP4,
	});
}

export function getRecordingsDir(): string {
	try {
		return path.join(app.getPath("videos"), DEFAULT_RECORDINGS_DIR_NAME);
	} catch {
		return path.join(app.getPath("temp"), DEFAULT_RECORDINGS_DIR_NAME);
	}
}

function formatDateSegment({ date }: { date: Date }): string {
	const year = date.getFullYear().toString().padStart(4, "0");
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const seconds = date.getSeconds().toString().padStart(2, "0");
	return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function buildDefaultRecordingPath(): string {
	const timestamp = formatDateSegment({ date: new Date() });
	const filename = `${DEFAULT_FILE_PREFIX}-${timestamp}.mp4`;
	return path.join(getRecordingsDir(), filename);
}

function assertPathWithinAllowedDir({
	resolvedPath,
	allowedDir,
}: {
	resolvedPath: string;
	allowedDir: string;
}): void {
	const normalizedAllowed = path.resolve(allowedDir) + path.sep;
	const normalizedPath = path.resolve(resolvedPath);
	if (
		!normalizedPath.startsWith(normalizedAllowed) &&
		normalizedPath !== path.resolve(allowedDir)
	) {
		throw new Error("Output path must be within the recordings directory");
	}
}

export function resolveOutputPath({
	filePath,
	fileName,
}: {
	filePath?: string;
	fileName?: string;
}): string {
	try {
		const recordingsDir = getRecordingsDir();

		if (filePath) {
			const absolutePath = path.isAbsolute(filePath)
				? filePath
				: path.join(recordingsDir, filePath);
			const resolved = path.resolve(absolutePath);
			assertPathWithinAllowedDir({
				resolvedPath: resolved,
				allowedDir: recordingsDir,
			});
			const outputPath = ensureExtension({
				filePath: resolved,
				extension: FILE_EXTENSION.MP4,
			});
			return normalizeOutputPathExtension({ filePath: outputPath });
		}

		if (fileName) {
			const safeFilename = sanitizeFilename({ filename: fileName });
			const filenameWithExtension = ensureExtension({
				filePath: safeFilename,
				extension: FILE_EXTENSION.MP4,
			});
			const normalizedFilename = normalizeOutputPathExtension({
				filePath: filenameWithExtension,
			});
			return path.join(recordingsDir, normalizedFilename);
		}

		return buildDefaultRecordingPath();
	} catch {
		return buildDefaultRecordingPath();
	}
}
