/**
 * Claude Export IPC handler registration.
 * @module electron/claude/handlers/claude-export-handler/ipc
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { claudeLog } from "../../utils/logger.js";
import { HANDLER_NAME, type ProgressEventPayload } from "./types.js";
import {
	getExportPresets,
	getExportRecommendation,
	applyProgressEvent,
} from "./public-api.js";

/** Register Claude export IPC handlers for presets and recommendations. */
export function setupClaudeExportIPC(): void {
	claudeLog.info(HANDLER_NAME, "Setting up Export IPC handlers...");

	ipcMain.handle("claude:export:getPresets", async () => getExportPresets());

	ipcMain.handle(
		"claude:export:recommend",
		async (_event: IpcMainInvokeEvent, _projectId: string, target: string) =>
			getExportRecommendation(target)
	);

	ipcMain.on("ffmpeg-progress", (_event, data: ProgressEventPayload) => {
		applyProgressEvent(data);
	});

	claudeLog.info(HANDLER_NAME, "Export IPC handlers registered");
}
