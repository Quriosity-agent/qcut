/**
 * FFmpeg resource IPC handlers.
 * @module electron/main-ipc/ffmpeg-handlers
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { MainIpcDeps } from "./types.js";

export function registerFfmpegHandlers(deps: MainIpcDeps): void {
	const { logger } = deps;

	ipcMain.handle(
		"get-ffmpeg-resource-path",
		(_event: IpcMainInvokeEvent, filename: string): string => {
			try {
				// Sanitize filename to prevent path traversal
				const safeFilename = basename(filename);
				const resourcesPath = join(
					__dirname,
					"resources",
					"ffmpeg",
					safeFilename
				);
				if (existsSync(resourcesPath)) {
					return resourcesPath;
				}

				return join(__dirname, "../../apps/web/dist/ffmpeg", safeFilename);
			} catch (error: unknown) {
				logger.error("Failed to get FFmpeg resource path:", error);
				return "";
			}
		}
	);

	ipcMain.handle(
		"check-ffmpeg-resource",
		(_event: IpcMainInvokeEvent, filename: string): boolean => {
			try {
				// Sanitize filename to prevent path traversal
				const safeFilename = basename(filename);
				const resourcesPath = join(
					__dirname,
					"resources",
					"ffmpeg",
					safeFilename
				);
				if (existsSync(resourcesPath)) {
					return true;
				}

				const distPath = join(
					__dirname,
					"../../apps/web/dist/ffmpeg",
					safeFilename
				);
				return existsSync(distPath);
			} catch (error: unknown) {
				logger.error("Failed to check FFmpeg resource:", error);
				return false;
			}
		}
	);
}
