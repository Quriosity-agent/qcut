import { app } from "electron";
import * as path from "node:path";
import {
	FILE_EXTENSION,
	DEFAULT_RECORDINGS_DIR_NAME,
	DEFAULT_FILE_PREFIX,
	SCREEN_RECORDING_OUTPUT_FORMAT,
	type ScreenRecordingOutputFormat,
} from "./types.js";

/** Strip unsafe characters from a filename, falling back to "recording.mp4". */
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

/** Append the given extension if the file path has none. */
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

/** Return the lowercase file extension (e.g. ".mp4") of the given path. */
export function getPathExtension({ filePath }: { filePath: string }): string {
	try {
		return path.extname(filePath).toLowerCase();
	} catch {
		return "";
	}
}

/** Resolve the output format for a recording — always MP4. */
export function resolveOutputFormat({
	filePath,
}: {
	filePath: string;
}): ScreenRecordingOutputFormat {
	// Always default to MP4 — WebM cannot be opened on most platforms.
	// The capture is always WebM internally; MP4 triggers FFmpeg transcoding.
	return SCREEN_RECORDING_OUTPUT_FORMAT.MP4;
}

/** Replace the file extension of the given path. */
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

/** Normalize any recording path extension to .mp4. */
function normalizeOutputPathExtension({
	filePath,
}: {
	filePath: string;
}): string {
	const extension = getPathExtension({ filePath });

	// Always use MP4 output — convert .webm extensions to .mp4
	if (extension === FILE_EXTENSION.MP4) {
		return filePath;
	}

	return replaceExtension({
		filePath,
		extension: FILE_EXTENSION.MP4,
	});
}

/** Return the directory for saved recordings (~/Movies/QCut Recordings). */
export function getRecordingsDir(): string {
	try {
		return path.join(app.getPath("videos"), DEFAULT_RECORDINGS_DIR_NAME);
	} catch {
		return path.join(app.getPath("temp"), DEFAULT_RECORDINGS_DIR_NAME);
	}
}

/** Format a Date as a compact `YYYYMMDD-HHmmss` segment for recording filenames. */
function formatDateSegment({ date }: { date: Date }): string {
	const year = date.getFullYear().toString().padStart(4, "0");
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const seconds = date.getSeconds().toString().padStart(2, "0");
	return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/** Build a timestamped default recording file path. */
function buildDefaultRecordingPath(): string {
	const timestamp = formatDateSegment({ date: new Date() });
	const filename = `${DEFAULT_FILE_PREFIX}-${timestamp}.mp4`;
	return path.join(getRecordingsDir(), filename);
}

/** Throw if the resolved path escapes the allowed recordings directory. */
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

/** Resolve the final output path from an optional filePath or fileName, defaulting to a timestamped recording. */
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
