/**
 * Update IPC handlers.
 * @module electron/main-ipc/update-handlers
 */

import { ipcMain, app } from "electron";
import type { MainIpcDeps } from "./types.js";

export function registerUpdateHandlers(deps: MainIpcDeps): void {
	const { logger, autoUpdater } = deps;

	ipcMain.handle("check-for-updates", async (): Promise<any> => {
		if (!app.isPackaged) {
			return {
				available: false,
				message: "Updates only available in production builds",
			};
		}

		if (!autoUpdater) {
			return { available: false, message: "Auto-updater not available" };
		}

		try {
			const result = await autoUpdater.checkForUpdatesAndNotify();
			return {
				available: true,
				version: (result as any)?.updateInfo?.version || "unknown",
				message: "Checking for updates...",
			};
		} catch (error: any) {
			logger.error("Error checking for updates:", error);
			return {
				available: false,
				error: error.message,
				message: "Failed to check for updates",
			};
		}
	});

	ipcMain.handle("install-update", async (): Promise<any> => {
		if (!app.isPackaged) {
			return {
				success: false,
				message: "Updates only available in production builds",
			};
		}

		if (!autoUpdater) {
			return { success: false, message: "Auto-updater not available" };
		}

		try {
			autoUpdater.quitAndInstall();
			return { success: true, message: "Installing update..." };
		} catch (error: any) {
			logger.error("Error installing update:", error);
			return { success: false, error: error.message };
		}
	});
}
