/**
 * Claude Navigator API Handler
 *
 * Provides project listing and editor navigation for Claude Code CLI.
 * Follows the request-response IPC pattern from claude-timeline-handler.ts.
 *
 * @module electron/claude/handlers/claude-navigator-handler
 */

import { ipcMain, BrowserWindow, IpcMainEvent } from "electron";
import { generateId } from "../utils/helpers.js";
import { claudeLog } from "../utils/logger.js";

const HANDLER_NAME = "Navigator";
const REQUEST_TIMEOUT_MS = 5000;
/**
 * The renderer answers an open request only once the project has loaded, and
 * gives up itself after 20 s; this leaves room for that answer to arrive.
 */
export const NAVIGATION_TIMEOUT_MS = 25_000;

export interface NavigateToProjectResult {
	navigated: boolean;
	projectId: string;
	/** Why the editor did not open the project, when `navigated` is false. */
	error?: string;
}

export interface NavigatorProject {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
}

export interface NavigatorProjectsResponse {
	projects: NavigatorProject[];
	activeProjectId: string | null;
}

/**
 * Request project list from renderer process.
 */
export async function requestProjectsFromRenderer(
	win: BrowserWindow
): Promise<NavigatorProjectsResponse> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("req");

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener("claude:navigator:projects:response", handler);
			reject(new Error("Timeout waiting for project list"));
		}, REQUEST_TIMEOUT_MS);

		const handler = (
			_event: IpcMainEvent,
			data: { requestId: string; result: NavigatorProjectsResponse }
		) => {
			if (data.requestId !== requestId || resolved) return;
			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener("claude:navigator:projects:response", handler);
			resolve(data.result);
		};

		ipcMain.on("claude:navigator:projects:response", handler);
		win.webContents.send("claude:navigator:projects:request", {
			requestId,
		});
	});
}

/**
 * Request navigation to a specific project's editor view.
 */
export async function requestNavigateToProject(
	win: BrowserWindow,
	projectId: string
): Promise<NavigateToProjectResult> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("req");

		// Outlasts the HTTP route's own 504 so callers get that answer.
		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener("claude:navigator:open:response", handler);
			reject(new Error("Timeout waiting for navigation confirmation"));
		}, NAVIGATION_TIMEOUT_MS + 1000);

		const handler = (
			_event: IpcMainEvent,
			data: {
				requestId: string;
				result: NavigateToProjectResult;
			}
		) => {
			if (data.requestId !== requestId || resolved) return;
			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener("claude:navigator:open:response", handler);
			resolve(data.result);
		};

		ipcMain.on("claude:navigator:open:response", handler);
		win.webContents.send("claude:navigator:open:request", {
			requestId,
			projectId,
		});
	});
}

/** Register Claude navigator IPC handlers. */
export function setupClaudeNavigatorIPC(): void {
	claudeLog.info(HANDLER_NAME, "Setting up Navigator IPC handlers...");
	claudeLog.info(HANDLER_NAME, "Navigator IPC handlers registered");
}
