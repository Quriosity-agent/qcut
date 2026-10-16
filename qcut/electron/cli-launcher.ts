/**
 * The `qcut` launcher: a small script on the user's PATH that runs the
 * command-line tool bundled inside the installed QCut app, so the command
 * always matches the app's version. The app writes it (About & updates →
 * command line tool) and so does `qcut cli install`; the app refreshes it at
 * startup when it has moved.
 *
 * @module electron/cli-launcher
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, win32 } from "node:path";

export const CLI_LAUNCHER_MARKER = "QCut CLI launcher";

export interface CliLauncherTarget {
	/** The installed app's own executable, run as Node. */
	executablePath: string;
	/** The command-line tool bundled inside that app. */
	cliScriptPath: string;
}

export interface CliLauncherState {
	path: string;
	installed: boolean;
	/** True when the file at `path` was written by QCut. */
	managed: boolean;
	target?: CliLauncherTarget;
	/** Whether the launcher's directory is on PATH. */
	onPath: boolean;
	/** Other `qcut` commands that PATH resolves before this launcher. */
	shadowedBy: string[];
}

export interface CliLauncherInstallResult extends CliLauncherState {
	/** The target the file pointed at before this install, when it had one. */
	previousTarget?: CliLauncherTarget;
}

export class CliLauncherError extends Error {
	constructor(
		readonly reason: "foreign-file" | "unsupported",
		message: string
	) {
		super(message);
		this.name = "CliLauncherError";
	}
}

interface PlatformContext {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	home?: string;
}

const WINDOWS_COMMAND_NAMES = ["qcut.cmd", "qcut.exe", "qcut.bat", "qcut"];

/** Where the launcher lives: `~/.local/bin/qcut`, or a QCut folder on Windows. */
export function cliLauncherPath({
	platform = process.platform,
	env = process.env,
	home = homedir(),
}: PlatformContext = {}): string {
	if (platform === "win32") {
		const localAppData =
			env.LOCALAPPDATA ?? win32.join(home, "AppData", "Local");
		return win32.join(localAppData, "QCut", "bin", "qcut.cmd");
	}
	return join(home, ".local", "bin", "qcut");
}

/** The bundled command-line tool inside an installed app, by install layout. */
export function bundledCliScriptPath({
	appPath,
	kind,
}: {
	appPath: string;
	kind: "mac-zip" | "windows-nsis" | "linux-deb" | "linux-appimage";
}): string | undefined {
	const inner = ["electron", "native-pipeline", "cli", "cli.js"];
	switch (kind) {
		case "mac-zip":
			return join(appPath, "Contents", "Resources", "app.asar", ...inner);
		case "windows-nsis":
			return win32.join(appPath, "resources", "app.asar", ...inner);
		case "linux-deb":
			return join(appPath, "resources", "app.asar", ...inner);
		default:
			return undefined;
	}
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellUnquote(value: string): string {
	return value.slice(1, -1).replace(/'\\''/g, "'");
}

/** The launcher's text for one platform. */
export function buildCliLauncherScript({
	target,
	platform = process.platform,
}: {
	target: CliLauncherTarget;
	platform?: NodeJS.Platform;
}): string {
	if (platform === "win32") {
		return [
			"@echo off",
			`rem ${CLI_LAUNCHER_MARKER} (managed by QCut; reinstall from QCut > About & updates, or run: qcut cli install)`,
			`set "QCUT_APP_EXECUTABLE=${target.executablePath}"`,
			`set "QCUT_CLI_SCRIPT=${target.cliScriptPath}"`,
			'if not exist "%QCUT_APP_EXECUTABLE%" (',
			'  echo qcut: QCut is no longer at "%QCUT_APP_EXECUTABLE%"; reinstall the command line tool from QCut ^> About ^& updates 1>&2',
			"  exit /b 127",
			")",
			"set ELECTRON_RUN_AS_NODE=1",
			'"%QCUT_APP_EXECUTABLE%" "%QCUT_CLI_SCRIPT%" %*',
			"",
		].join("\r\n");
	}
	return [
		"#!/bin/sh",
		`# ${CLI_LAUNCHER_MARKER} (managed by QCut; reinstall from QCut > About & updates, or run: qcut cli install)`,
		`QCUT_APP_EXECUTABLE=${shellQuote(target.executablePath)}`,
		`QCUT_CLI_SCRIPT=${shellQuote(target.cliScriptPath)}`,
		'if [ ! -x "$QCUT_APP_EXECUTABLE" ]; then',
		'  echo "qcut: QCut is no longer at $QCUT_APP_EXECUTABLE; reinstall the command line tool from QCut > About & updates" >&2',
		"  exit 127",
		"fi",
		"export ELECTRON_RUN_AS_NODE=1",
		'exec "$QCUT_APP_EXECUTABLE" "$QCUT_CLI_SCRIPT" "$@"',
		"",
	].join("\n");
}

/** The target a launcher written by QCut points at, or undefined for any other file. */
export function parseCliLauncher({
	content,
}: {
	content: string;
}): CliLauncherTarget | undefined {
	if (!content.includes(CLI_LAUNCHER_MARKER)) return undefined;
	const posixExecutable = /^QCUT_APP_EXECUTABLE=('.*')$/m.exec(content);
	const posixScript = /^QCUT_CLI_SCRIPT=('.*')$/m.exec(content);
	if (posixExecutable && posixScript) {
		return {
			executablePath: shellUnquote(posixExecutable[1]),
			cliScriptPath: shellUnquote(posixScript[1]),
		};
	}
	const windowsExecutable = /^set "QCUT_APP_EXECUTABLE=(.*)"\r?$/m.exec(
		content
	);
	const windowsScript = /^set "QCUT_CLI_SCRIPT=(.*)"\r?$/m.exec(content);
	if (windowsExecutable && windowsScript) {
		return {
			executablePath: windowsExecutable[1],
			cliScriptPath: windowsScript[1],
		};
	}
	return undefined;
}

function pathEntries({
	env,
	platform,
}: {
	env: NodeJS.ProcessEnv;
	platform: NodeJS.Platform;
}): string[] {
	const raw = env.PATH ?? env.Path ?? "";
	const separator = platform === "win32" ? ";" : delimiter;
	return raw
		.split(separator)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function samePath({
	a,
	b,
	platform,
}: {
	a: string;
	b: string;
	platform: NodeJS.Platform;
}): boolean {
	const normalize = (value: string) =>
		platform === "win32"
			? win32
					.normalize(value)
					.replace(/[\\/]+$/, "")
					.toLowerCase()
			: value.replace(/\/+$/, "");
	return normalize(a) === normalize(b);
}

/**
 * Every `qcut` command on PATH, in PATH order, except the launcher itself.
 * The ones listed before the launcher's directory (or all of them when that
 * directory is not on PATH) win over the launcher in a terminal.
 */
export function findQcutOnPath({
	launcherPath,
	platform = process.platform,
	env = process.env,
}: {
	launcherPath: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
}): { onPath: boolean; shadowedBy: string[] } {
	const launcherDir = dirname(launcherPath);
	const names = platform === "win32" ? WINDOWS_COMMAND_NAMES : ["qcut"];
	const shadowedBy: string[] = [];
	let onPath = false;
	for (const entry of pathEntries({ env, platform })) {
		if (samePath({ a: entry, b: launcherDir, platform })) {
			onPath = true;
			break;
		}
		let listing: string[];
		try {
			listing = readdirSync(entry);
		} catch {
			continue;
		}
		for (const name of names) {
			const match = listing.find((file) =>
				platform === "win32" ? file.toLowerCase() === name : file === name
			);
			if (!match) continue;
			const candidate = join(entry, match);
			try {
				if (statSync(candidate).isFile()) shadowedBy.push(candidate);
			} catch {
				// A dangling link is not a command.
			}
		}
	}
	return { onPath, shadowedBy };
}

/** What is at the launcher path now, and whether a terminal would run it. */
export function readCliLauncherState({
	launcherPath = cliLauncherPath(),
	platform = process.platform,
	env = process.env,
}: {
	launcherPath?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
} = {}): CliLauncherState {
	const installed = existsSync(launcherPath);
	let target: CliLauncherTarget | undefined;
	if (installed) {
		try {
			target = parseCliLauncher({
				content: readFileSync(launcherPath, "utf8"),
			});
		} catch {
			target = undefined;
		}
	}
	const { onPath, shadowedBy } = findQcutOnPath({
		launcherPath,
		platform,
		env,
	});
	return {
		path: launcherPath,
		installed,
		managed: target !== undefined,
		target,
		onPath,
		shadowedBy,
	};
}

/**
 * Writes the launcher. A file QCut did not write is left alone unless
 * `replaceForeign` is set, so a user's own script is never overwritten
 * silently.
 */
export function installCliLauncher({
	target,
	launcherPath = cliLauncherPath(),
	platform = process.platform,
	env = process.env,
	replaceForeign = false,
}: {
	target: CliLauncherTarget;
	launcherPath?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	replaceForeign?: boolean;
}): CliLauncherInstallResult {
	const before = readCliLauncherState({ launcherPath, platform, env });
	if (before.installed && !before.managed && !replaceForeign) {
		throw new CliLauncherError(
			"foreign-file",
			`${launcherPath} already exists and was not written by QCut; remove it or install with --yes to replace it`
		);
	}
	mkdirSync(dirname(launcherPath), { recursive: true });
	writeFileSync(launcherPath, buildCliLauncherScript({ target, platform }), {
		encoding: "utf8",
	});
	if (platform !== "win32") chmodSync(launcherPath, 0o755);
	return {
		...readCliLauncherState({ launcherPath, platform, env }),
		previousTarget: before.target,
	};
}

/**
 * Points an installed, QCut-written launcher at `target` when it points
 * elsewhere (the app moved). Files QCut did not write and missing files are
 * left as they are.
 */
export function refreshCliLauncher({
	target,
	launcherPath = cliLauncherPath(),
	platform = process.platform,
	env = process.env,
}: {
	target: CliLauncherTarget;
	launcherPath?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
}): { refreshed: boolean; state: CliLauncherState } {
	const state = readCliLauncherState({ launcherPath, platform, env });
	if (!state.installed || !state.managed || !state.target) {
		return { refreshed: false, state };
	}
	const same =
		state.target.executablePath === target.executablePath &&
		state.target.cliScriptPath === target.cliScriptPath;
	if (same) return { refreshed: false, state };
	return {
		refreshed: true,
		state: installCliLauncher({ target, launcherPath, platform, env }),
	};
}
