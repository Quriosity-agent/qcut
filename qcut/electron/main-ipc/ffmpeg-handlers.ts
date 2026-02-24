/**
 * FFmpeg resource IPC handlers.
 * @module electron/main-ipc/ffmpeg-handlers
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { MainIpcDeps } from "./types.js";

export function registerFfmpegHandlers(_deps: MainIpcDeps): void {
	ipcMain.handle(
		"get-ffmpeg-resource-path",
		(_event: IpcMainInvokeEvent, filename: string): string => {
			// Sanitize filename to prevent path traversal
			const safeFilename = path.basename(filename);
			const resourcesPath = path.join(
				__dirname,
				"resources",
				"ffmpeg",
				safeFilename
			);
			if (fs.existsSync(resourcesPath)) {
				return resourcesPath;
			}

			const distPath = path.join(
				__dirname,
				"../../apps/web/dist/ffmpeg",
				safeFilename
			);
			return distPath;
		}
	);

	ipcMain.handle(
		"check-ffmpeg-resource",
		(_event: IpcMainInvokeEvent, filename: string): boolean => {
			// Sanitize filename to prevent path traversal
			const safeFilename = path.basename(filename);
			const resourcesPath = path.join(
				__dirname,
				"resources",
				"ffmpeg",
				safeFilename
			);
			if (fs.existsSync(resourcesPath)) {
				return true;
			}

			const distPath = path.join(
				__dirname,
				"../../apps/web/dist/ffmpeg",
				safeFilename
			);
			return fs.existsSync(distPath);
		}
	);
}
