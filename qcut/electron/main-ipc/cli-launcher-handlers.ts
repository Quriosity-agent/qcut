/**
 * IPC for the `qcut` launcher: the renderer's About & updates panel reads
 * its state and installs it, pointing at this very app.
 * @module electron/main-ipc/cli-launcher-handlers
 */

import { join } from "node:path";
import { app, ipcMain } from "electron";
import {
	type CliLauncherInstallResult,
	type CliLauncherState,
	type CliLauncherTarget,
	CliLauncherError,
	cliLauncherPath,
	installCliLauncher,
	readCliLauncherState,
	refreshCliLauncher,
} from "../cli-launcher.js";
import type { Logger } from "./types.js";

export type CliLauncherInstallOutcome =
	| { success: true; state: CliLauncherInstallResult }
	| { success: false; reason: "foreign-file" | "write-failed"; error: string };

/** This app's executable and its bundled command-line tool. */
export function currentAppCliTarget(): CliLauncherTarget {
	const appPath = app.getAppPath();
	const cliScriptPath = app.isPackaged
		? join(appPath, "electron", "native-pipeline", "cli", "cli.js")
		: join(appPath, "dist", "electron", "native-pipeline", "cli", "cli.js");
	return { executablePath: process.execPath, cliScriptPath };
}

export function installCliLauncherForThisApp({
	replaceForeign = false,
}: {
	replaceForeign?: boolean;
} = {}): CliLauncherInstallOutcome {
	try {
		return {
			success: true,
			state: installCliLauncher({
				target: currentAppCliTarget(),
				launcherPath: cliLauncherPath(),
				replaceForeign,
			}),
		};
	} catch (error) {
		if (error instanceof CliLauncherError) {
			return { success: false, reason: "foreign-file", error: error.message };
		}
		return {
			success: false,
			reason: "write-failed",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function registerCliLauncherHandlers(): void {
	ipcMain.handle(
		"get-cli-launcher-state",
		(): CliLauncherState =>
			readCliLauncherState({ launcherPath: cliLauncherPath() })
	);
	ipcMain.handle(
		"install-cli-launcher",
		(
			_event,
			options?: { replaceForeign?: boolean }
		): CliLauncherInstallOutcome =>
			installCliLauncherForThisApp({
				replaceForeign: options?.replaceForeign === true,
			})
	);
}

/**
 * Keeps an installed launcher pointing at this app after the app moved. Runs
 * at startup in packaged builds only; a dev checkout never rewrites it.
 */
export function refreshInstalledCliLauncher({
	logger,
}: {
	logger: Logger;
}): void {
	if (!app.isPackaged) return;
	try {
		const result = refreshCliLauncher({
			target: currentAppCliTarget(),
			launcherPath: cliLauncherPath(),
		});
		if (result.refreshed) {
			logger.log(
				`qcut launcher at ${result.state.path} now points at this app`
			);
		}
	} catch (error) {
		logger.warn(
			`Could not refresh the qcut launcher: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
