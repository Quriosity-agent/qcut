/**
 * Release notes IPC handlers.
 * @module electron/main-ipc/release-notes-handlers
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import * as fs from "fs";
import * as path from "path";
import {
	parseReleaseNote,
	readReleaseNotesFromDir,
} from "../release-notes-utils.js";
import type { MainIpcDeps, ReleaseNote } from "./types.js";

export function registerReleaseNotesHandlers(deps: MainIpcDeps): void {
	const { logger, getReleasesDir, readChangelogFallback } = deps;

	ipcMain.handle(
		"get-release-notes",
		async (
			_: IpcMainInvokeEvent,
			version?: string
		): Promise<ReleaseNote | null> => {
			try {
				const releasesDir = getReleasesDir();
				const filename = version ? `v${version}.md` : "latest.md";
				const filePath = path.join(releasesDir, filename);

				if (!fs.existsSync(filePath)) {
					return null;
				}

				const raw = fs.readFileSync(filePath, "utf-8");
				return parseReleaseNote(raw);
			} catch (error: any) {
				logger.error("Error reading release notes:", error);
				return null;
			}
		}
	);

	ipcMain.handle("get-changelog", async (): Promise<ReleaseNote[]> => {
		try {
			const releasesDir = getReleasesDir();
			const notes = readReleaseNotesFromDir(releasesDir);

			if (notes.length === 0) {
				return readChangelogFallback();
			}

			return notes;
		} catch (error: any) {
			logger.error("Error reading changelog:", error);
			return readChangelogFallback();
		}
	});
}
