/**
 * Audio & Video temp save IPC handlers.
 * @module electron/main-ipc/audio-video-handlers
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { MainIpcDeps } from "./types.js";

export function registerAudioVideoHandlers(deps: MainIpcDeps): void {
	const { logger } = deps;

	ipcMain.handle(
		"audio:save-temp",
		async (
			_event: IpcMainInvokeEvent,
			audioData: Uint8Array,
			filename: string
		): Promise<string> => {
			const { saveAudioToTemp } = require("../audio-temp-handler.js");
			try {
				const filePath = await saveAudioToTemp(audioData, filename);
				return filePath;
			} catch (error: any) {
				logger.error("Failed to save audio to temp:", error);
				throw new Error(`Failed to save audio: ${error.message}`);
			}
		}
	);

	ipcMain.handle(
		"save-audio-for-export",
		async (
			_event: IpcMainInvokeEvent,
			{ audioData, filename }: { audioData: any; filename: string }
		) => {
			try {
				const { saveAudioToTemp } = require("../audio-temp-handler.js");
				const filePath = await saveAudioToTemp(audioData, filename);
				return { success: true, path: filePath };
			} catch (error: any) {
				logger.error("Failed to save audio file:", error);
				return { success: false, error: error.message };
			}
		}
	);

	ipcMain.handle(
		"video:save-temp",
		async (
			_event: IpcMainInvokeEvent,
			videoData: Uint8Array,
			filename: string,
			sessionId?: string
		): Promise<string> => {
			const { saveVideoToTemp } = require("../video-temp-handler.js");
			try {
				const filePath = await saveVideoToTemp(videoData, filename, sessionId);
				logger.log(`[Video Temp] Saved video to: ${filePath}`);
				return filePath;
			} catch (error: any) {
				logger.error("[Video Temp] Failed to save video:", error);
				throw new Error(`Failed to save video: ${error.message}`);
			}
		}
	);
}
