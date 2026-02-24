/**
 * Claude Project CRUD Handler
 *
 * Proxies project create/delete/rename/duplicate through the renderer
 * where the Zustand store and storage service live.
 *
 * @module electron/claude/handlers/claude-project-crud-handler
 */

import { ipcMain, BrowserWindow, type IpcMainEvent } from "electron";
import { generateId } from "../utils/helpers.js";

const REQUEST_TIMEOUT_MS = 10_000;

export interface CreateProjectResponse {
	projectId: string;
	name: string;
}

export interface DeleteProjectResponse {
	deleted: boolean;
	projectId: string;
}

export interface RenameProjectResponse {
	renamed: boolean;
	projectId: string;
	name: string;
}

export interface DuplicateProjectResponse {
	projectId: string;
	name: string;
	sourceProjectId: string;
}

function requestFromRenderer<T>(
	win: BrowserWindow,
	channel: string,
	payload: Record<string, unknown>,
	timeoutMs = REQUEST_TIMEOUT_MS
): Promise<T> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("req");
		const responseChannel = `${channel}:response`;

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener(responseChannel, handler);
			reject(new Error(`Timeout waiting for ${channel}`));
		}, timeoutMs);

		const handler = (
			_event: IpcMainEvent,
			data: { requestId: string; result?: T; error?: string }
		) => {
			if (data.requestId !== requestId || resolved) return;
			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener(responseChannel, handler);
			if (data.error) {
				reject(new Error(data.error));
			} else {
				resolve(data.result!);
			}
		};

		ipcMain.on(responseChannel, handler);
		win.webContents.send(`${channel}:request`, { requestId, ...payload });
	});
}

export function requestCreateProject(
	win: BrowserWindow,
	name: string
): Promise<CreateProjectResponse> {
	return requestFromRenderer(win, "claude:project:create", { name });
}

export function requestDeleteProject(
	win: BrowserWindow,
	projectId: string
): Promise<DeleteProjectResponse> {
	return requestFromRenderer(win, "claude:project:delete", { projectId });
}

export function requestRenameProject(
	win: BrowserWindow,
	projectId: string,
	name: string
): Promise<RenameProjectResponse> {
	return requestFromRenderer(win, "claude:project:rename", {
		projectId,
		name,
	});
}

export function requestDuplicateProject(
	win: BrowserWindow,
	projectId: string
): Promise<DuplicateProjectResponse> {
	return requestFromRenderer(win, "claude:project:duplicate", { projectId });
}
