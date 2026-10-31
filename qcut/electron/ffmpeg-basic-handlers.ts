/**
 * FFmpeg Basic IPC Handlers
 *
 * Simple, stateless handlers for FFmpeg path, health, session management,
 * frame saving, and file operations.
 *
 * Location: electron/ffmpeg-basic-handlers.ts
 */

import { ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import path from "path";
import fs from "fs";
import type { TempManager } from "./temp-manager.js";

import type {
	FrameData,
	OpenFolderResult,
	FFmpegHealthResult,
} from "./ffmpeg/types.js";
import type { ExportSession } from "./temp-manager.js";

import { getFFmpegPath } from "./ffmpeg/utils.js";
import {
	assFamilyCoversCjk,
	assFontFamilyInstalled,
	assFontMetrics,
} from "./claude/handlers/claude-export-handler/ass-font-metrics.js";
import type {
	AssFontMetricsReply,
	AssFontMetricsRequest,
} from "./ffmpeg/types.js";

/**
 * Registers basic FFmpeg IPC handlers.
 *
 * Handles: ffmpeg-path, ffmpeg-health, create-export-session,
 * save-frame, read-output-file, cleanup-export-session, open-frames-folder
 */
/** Faces one `ffmpeg-ass-font-metrics` call may ask about. */
const MAX_ASS_FONT_METRICS_REQUESTS = 512;

/**
 * One well-formed entry of a metrics request.
 *
 * The array crosses IPC from the renderer, so nothing about its shape is
 * guaranteed: a null entry would throw on `request.family`, and a non-boolean
 * `bold` would silently pick the wrong face.
 */
function assFontMetricsRequestOf(value: unknown): AssFontMetricsRequest | null {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value as Partial<AssFontMetricsRequest>;
	if (typeof candidate.family !== "string" || !candidate.family.trim()) {
		return null;
	}
	if (candidate.bold !== undefined && typeof candidate.bold !== "boolean") {
		return null;
	}
	if (candidate.italic !== undefined && typeof candidate.italic !== "boolean") {
		return null;
	}
	return {
		family: candidate.family,
		bold: candidate.bold ?? false,
		italic: candidate.italic ?? false,
	};
}

export function setupBasicHandlers(
	tempManager: TempManager,
	getFFmpegHealth: () => Promise<FFmpegHealthResult>
): void {
	// Handle ffmpeg-path request
	ipcMain.handle("ffmpeg-path", async (): Promise<string> => {
		return getFFmpegPath();
	});

	// Handle ffmpeg health check request
	ipcMain.handle("ffmpeg-health", (): Promise<FFmpegHealthResult> => {
		return getFFmpegHealth();
	});

	// libass sizes a face so its Windows ascent + descent equals the ASS
	// Fontsize, while the editor sizes by the em square; the renderer builds
	// ASS for the export dialog but cannot read font files, so it asks here
	// (N31).
	ipcMain.handle(
		"ffmpeg-ass-font-metrics",
		(
			_event: IpcMainInvokeEvent,
			requests: AssFontMetricsRequest[]
		): AssFontMetricsReply[] => {
			if (!Array.isArray(requests)) return [];
			// Each miss walks the system font index on the main thread, so the
			// batch is bounded: the real caller sends four faces per family.
			return requests
				.slice(0, MAX_ASS_FONT_METRICS_REQUESTS)
				.flatMap((entry) => {
					const request = assFontMetricsRequestOf(entry);
					if (!request) return [];
					// An uninstalled family would measure a neutral 1.0, which the
					// renderer cannot tell from a real measurement: it would then
					// shift the caption by the leading while leaving its size
					// uncorrected. Omit it so the unmeasured path applies.
					if (!assFontFamilyInstalled({ family: request.family })) return [];
					const { sizeFactor, lineHeightEm } = assFontMetrics(request);
					return [
						{
							...request,
							bold: request.bold ?? false,
							italic: request.italic ?? false,
							sizeFactor,
							lineHeightEm,
							coversCjk: assFamilyCoversCjk({ family: request.family }),
						},
					];
				});
		}
	);

	// Create export session
	ipcMain.handle("create-export-session", async (): Promise<ExportSession> => {
		return tempManager.createExportSession();
	});

	// Save frame to disk
	ipcMain.handle(
		"save-frame",
		async (
			event: IpcMainInvokeEvent,
			{ sessionId, frameName, data }: FrameData
		): Promise<string> => {
			// Sanitize frameName to prevent path traversal
			const safeFrameName = path.basename(frameName);
			const frameDir: string = tempManager.getFrameDir(sessionId);
			const framePath: string = path.join(frameDir, safeFrameName);

			// Verify resolved path stays within frame directory
			const resolvedPath = path.resolve(framePath);
			if (!resolvedPath.startsWith(path.resolve(frameDir))) {
				throw new Error("Invalid frame path: path traversal detected");
			}

			const buffer: Buffer = Buffer.from(data, "base64");

			// Validate buffer
			if (!buffer || buffer.length < 100) {
				throw new Error(`Invalid PNG buffer: ${buffer.length} bytes`);
			}

			// Check PNG signature (first 8 bytes should be PNG signature)
			const pngSignature: Buffer = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
			]);
			if (!buffer.subarray(0, 8).equals(pngSignature)) {
				console.warn(
					`[FFmpeg] Warning: Invalid PNG signature for frame ${safeFrameName}`
				);
			}

			fs.writeFileSync(framePath, buffer);

			return framePath;
		}
	);

	// Read output file
	ipcMain.handle(
		"read-output-file",
		async (event: IpcMainInvokeEvent, outputPath: string): Promise<Buffer> => {
			// Validate outputPath is within the temp export directory
			const resolvedOutput = path.resolve(outputPath);
			const tempDir = path.resolve(tempManager.getTempDir());
			if (!resolvedOutput.startsWith(tempDir)) {
				throw new Error("Invalid output path: must be within export directory");
			}
			return fs.readFileSync(outputPath);
		}
	);

	// Cleanup export session
	ipcMain.handle(
		"cleanup-export-session",
		async (event: IpcMainInvokeEvent, sessionId: string): Promise<void> => {
			tempManager.cleanup(sessionId);
		}
	);

	// Open frames folder in file explorer
	ipcMain.handle(
		"open-frames-folder",
		async (
			event: IpcMainInvokeEvent,
			sessionId: string
		): Promise<OpenFolderResult> => {
			const frameDir: string = tempManager.getFrameDir(sessionId);
			const errorMessage = await shell.openPath(frameDir);
			if (errorMessage) {
				throw new Error(`Failed to open frames folder: ${errorMessage}`);
			}
			return { success: true, path: frameDir };
		}
	);
}
