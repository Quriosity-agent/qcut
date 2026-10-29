/**
 * Storage IPC handlers.
 * @module electron/main-ipc/storage-handlers
 */

import { ipcMain, app, type IpcMainInvokeEvent } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { MainIpcDeps } from "./types.js";
import {
	readStorageJson,
	removeStorageJson,
	writeStorageJson,
} from "./storage-json.js";

export function registerStorageHandlers(deps: MainIpcDeps): void {
	const { logger } = deps;

	ipcMain.handle(
		"storage:save",
		async (
			_event: IpcMainInvokeEvent,
			key: string,
			data: unknown
		): Promise<void> => {
			try {
				const safeKey = path.basename(key);
				const userDataPath = app.getPath("userData");
				const filePath = path.join(userDataPath, "projects", `${safeKey}.json`);
				await writeStorageJson({ filePath, data });
			} catch (error: unknown) {
				logger.error(`[Storage] Failed to save key "${key}":`, error);
				throw error;
			}
		}
	);

	ipcMain.handle(
		"storage:load",
		async (_event: IpcMainInvokeEvent, key: string): Promise<any> => {
			const safeKey = path.basename(key);
			const userDataPath = app.getPath("userData");
			const filePath = path.join(userDataPath, "projects", `${safeKey}.json`);
			try {
				const stored = await readStorageJson({ filePath });
				if (stored?.strayTail) {
					logger.warn(
						`[Storage] "${key}" has ${stored.strayTail.characters} stray character(s) after its JSON; read the JSON before them. ${filePath} is unchanged until the next save; a copy as it was: ${stored.strayTail.backupPath}`
					);
				}
				return stored ? stored.value : null;
			} catch (error: unknown) {
				if (error instanceof SyntaxError) {
					logger.error(
						`[Storage] Corrupted JSON file for key "${key}" (${filePath}), left as it is:`,
						error.message
					);
					return null;
				}
				throw error;
			}
		}
	);

	ipcMain.handle(
		"storage:remove",
		async (_event: IpcMainInvokeEvent, key: string): Promise<void> => {
			const safeKey = path.basename(key);
			const userDataPath = app.getPath("userData");
			const filePath = path.join(userDataPath, "projects", `${safeKey}.json`);
			// Queued behind any pending save for this project, so the deletion wins.
			await removeStorageJson({ filePath });
		}
	);

	ipcMain.handle(
		"storage:project-file-path",
		(_event: IpcMainInvokeEvent, key: string): string => {
			const safeKey = path.basename(key);
			const userDataPath = app.getPath("userData");
			return path.join(userDataPath, "projects", `${safeKey}.json`);
		}
	);

	ipcMain.handle("storage:list", async (): Promise<string[]> => {
		try {
			const userDataPath = app.getPath("userData");
			const projectsDir = path.join(userDataPath, "projects");
			const files = await fs.promises.readdir(projectsDir);
			return files
				.filter((f) => f.endsWith(".json"))
				.map((f) => f.replace(/\.json$/, ""));
		} catch (error: any) {
			if (error.code === "ENOENT") return [];
			throw error;
		}
	});

	ipcMain.handle("storage:clear", async (): Promise<void> => {
		try {
			const userDataPath = app.getPath("userData");
			const projectsDir = path.join(userDataPath, "projects");
			const files = await fs.promises.readdir(projectsDir);
			await Promise.all(
				files
					.filter((f) => f.endsWith(".json"))
					.map((f) =>
						removeStorageJson({ filePath: path.join(projectsDir, f) })
					)
			);
		} catch (error: any) {
			if (error.code !== "ENOENT") throw error;
		}
	});
}
