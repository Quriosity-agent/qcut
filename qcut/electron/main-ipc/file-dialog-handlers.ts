/**
 * File dialog IPC handlers.
 * @module electron/main-ipc/file-dialog-handlers
 */

import { ipcMain, dialog, type IpcMainInvokeEvent } from "electron";
import type { MainIpcDeps } from "./types.js";

export function registerFileDialogHandlers(deps: MainIpcDeps): void {
	const { getMainWindow } = deps;

	ipcMain.handle(
		"open-file-dialog",
		async (): Promise<Electron.OpenDialogReturnValue> => {
			const mainWindow = getMainWindow();
			if (!mainWindow) {
				throw new Error("Main window not available");
			}
			const result = await dialog.showOpenDialog(mainWindow, {
				properties: ["openFile"],
				filters: [
					{
						name: "Video Files",
						extensions: [
							"mp4",
							"webm",
							"mov",
							"avi",
							"mkv",
							"wmv",
							"flv",
							"3gp",
							"m4v",
						],
					},
					{
						name: "Audio Files",
						extensions: ["mp3", "wav", "aac", "ogg", "flac", "m4a", "wma"],
					},
					{
						name: "Image Files",
						extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"],
					},
					{ name: "All Files", extensions: ["*"] },
				],
			});
			return result;
		}
	);

	ipcMain.handle(
		"open-multiple-files-dialog",
		async (): Promise<Electron.OpenDialogReturnValue> => {
			const mainWindow = getMainWindow();
			if (!mainWindow) {
				throw new Error("Main window not available");
			}
			const result = await dialog.showOpenDialog(mainWindow, {
				properties: ["openFile", "multiSelections"],
				filters: [
					{
						name: "Media Files",
						extensions: [
							"mp4",
							"webm",
							"mov",
							"avi",
							"mkv",
							"mp3",
							"wav",
							"jpg",
							"jpeg",
							"png",
							"gif",
						],
					},
					{ name: "All Files", extensions: ["*"] },
				],
			});
			return result;
		}
	);

	ipcMain.handle(
		"save-file-dialog",
		async (
			_event: IpcMainInvokeEvent,
			defaultFilename?: string,
			filters?: Electron.FileFilter[]
		): Promise<Electron.SaveDialogReturnValue> => {
			const mainWindow = getMainWindow();
			if (!mainWindow) {
				throw new Error("Main window not available");
			}
			const result = await dialog.showSaveDialog(mainWindow, {
				defaultPath: defaultFilename,
				filters: filters || [
					{ name: "Video Files", extensions: ["mp4"] },
					{ name: "All Files", extensions: ["*"] },
				],
			});
			return result;
		}
	);
}
