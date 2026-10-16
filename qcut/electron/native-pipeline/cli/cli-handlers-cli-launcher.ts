/**
 * `qcut cli install` / `qcut cli status`: put the command bundled with the
 * installed QCut app on PATH, and say which qcut command a terminal runs.
 *
 * @module electron/native-pipeline/cli/cli-handlers-cli-launcher
 */

import { existsSync } from "node:fs";
import { discoverInstalledQCutApp } from "../../app-update-discovery.js";
import {
	bundledCliScriptPath,
	CliLauncherError,
	type CliLauncherState,
	type CliLauncherTarget,
	cliLauncherPath,
	installCliLauncher,
	readCliLauncherState,
} from "../../cli-launcher.js";
import { describeCliInstall } from "./cli-version.js";
import type { CLIResult, CLIRunOptions } from "./cli-runner/types.js";

/** The bundled command of the installed app, or why there is none to point at. */
export function resolveBundledCliTarget(): {
	target?: CliLauncherTarget;
	appVersion?: string;
	appPath: string;
	error?: string;
} {
	const app = discoverInstalledQCutApp();
	if (!app.installed || !app.executablePath) {
		return {
			appPath: app.path,
			error: `No installed QCut app found (looked at ${app.path}); install QCut first, or set QCUT_APP_PATH`,
		};
	}
	const cliScriptPath = bundledCliScriptPath({
		appPath: app.path,
		kind: app.kind,
	});
	if (!cliScriptPath) {
		return {
			appPath: app.path,
			appVersion: app.version,
			error: `The ${app.kind} install at ${app.path} has no reachable bundled command line tool`,
		};
	}
	return {
		target: { executablePath: app.executablePath, cliScriptPath },
		appVersion: app.version,
		appPath: app.path,
	};
}

/** Follow-up advice for a launcher state, so the result says what to do next. */
export function launcherHints({
	state,
}: {
	state: CliLauncherState;
}): string[] {
	const hints: string[] = [];
	if (!state.onPath) {
		hints.push(
			`${state.path} is not on PATH; add its folder to PATH (for example: export PATH="${state.path.replace(/[\\/][^\\/]+$/, "")}:$PATH")`
		);
	}
	if (state.shadowedBy.length > 0) {
		hints.push(
			`PATH resolves ${state.shadowedBy.join(", ")} before this launcher; remove it or move the launcher's folder earlier in PATH`
		);
	}
	return hints;
}

export async function handleCliInstall(
	options: CLIRunOptions
): Promise<CLIResult> {
	const resolved = resolveBundledCliTarget();
	if (!resolved.target) {
		return { success: false, error: resolved.error };
	}
	if (!existsSync(resolved.target.cliScriptPath)) {
		return {
			success: false,
			error: `${resolved.target.cliScriptPath} does not exist; this QCut build has no bundled command line tool`,
		};
	}
	try {
		const state = installCliLauncher({
			target: resolved.target,
			launcherPath: cliLauncherPath(),
			replaceForeign: options.yes === true,
		});
		return {
			success: true,
			data: {
				installed: true,
				path: state.path,
				target: state.target,
				appPath: resolved.appPath,
				appVersion: resolved.appVersion,
				onPath: state.onPath,
				shadowedBy: state.shadowedBy,
				previousTarget: state.previousTarget,
				hints: launcherHints({ state }),
			},
		};
	} catch (error) {
		if (error instanceof CliLauncherError) {
			return { success: false, error: error.message };
		}
		return {
			success: false,
			error: `Could not write the qcut launcher: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export async function handleCliStatus(): Promise<CLIResult> {
	const running = describeCliInstall();
	const state = readCliLauncherState({ launcherPath: cliLauncherPath() });
	const resolved = resolveBundledCliTarget();
	const launcherPointsAtApp =
		state.target !== undefined &&
		resolved.target !== undefined &&
		state.target.cliScriptPath === resolved.target.cliScriptPath;
	return {
		success: true,
		data: {
			running,
			launcher: state,
			app: {
				installed: resolved.target !== undefined,
				path: resolved.appPath,
				version: resolved.appVersion,
				bundledCli: resolved.target?.cliScriptPath,
			},
			launcherPointsAtApp,
			hints: [
				...(state.installed
					? []
					: ["No launcher installed; run `qcut cli install`"]),
				...(state.installed && state.managed && !launcherPointsAtApp
					? [
							"The launcher points at another QCut install; run `qcut cli install` to refresh it",
						]
					: []),
				...launcherHints({ state }),
			],
		},
	};
}
