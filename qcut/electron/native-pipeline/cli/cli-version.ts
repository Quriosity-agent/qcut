/**
 * Which `qcut` command is running: the QCut version it was built from and
 * where it lives. `editor health` and `qcut update` compare it with the app,
 * because a command from another QCut install controls the app with the
 * wrong set of commands.
 *
 * @module electron/native-pipeline/cli/cli-version
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toReleaseVersion } from "../../update-version.js";

export interface CliInstallInfo {
	/** Release-style version ("2026.10.16.1"), or the package version as written. */
	version: string;
	/** The qcut package the command runs from, when one was found. */
	packageDir?: string;
	/** The running cli.js. */
	scriptPath: string;
	/** True when cli.js runs from inside an installed app (its asar). */
	bundledInApp: boolean;
}

const PACKAGE_NAME = "qcut";
const MAX_PARENT_DIRS = 6;

/** The nearest enclosing `qcut` package: `dist/electron/...` in a checkout, the asar root in an app. */
export function findCliPackage({
	startDir,
}: {
	startDir: string;
}): { dir: string; version: string } | undefined {
	let dir = startDir;
	for (let depth = 0; depth <= MAX_PARENT_DIRS; depth += 1) {
		const packageJsonPath = join(dir, "package.json");
		if (existsSync(packageJsonPath)) {
			try {
				const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
					name?: string;
					version?: string;
				};
				if (
					parsed.name === PACKAGE_NAME &&
					typeof parsed.version === "string"
				) {
					return { dir, version: parsed.version };
				}
			} catch {
				// Not a readable package manifest; keep looking upwards.
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

export function describeCliInstall({
	scriptPath = process.argv[1] ?? __filename,
	moduleDir = __dirname,
}: {
	scriptPath?: string;
	moduleDir?: string;
} = {}): CliInstallInfo {
	const found = findCliPackage({ startDir: moduleDir });
	return {
		version: found
			? toReleaseVersion({ packageVersion: found.version })
			: "unknown",
		packageDir: found?.dir,
		scriptPath,
		bundledInApp: /[\\/]app\.asar[\\/]/.test(moduleDir),
	};
}

/**
 * The warning for a command that does not match the app it talks to, or
 * undefined when they agree (or either version is unknown).
 */
export function describeVersionMismatch({
	cliVersion,
	appVersion,
	cliPath,
}: {
	cliVersion: string;
	appVersion: string | undefined;
	cliPath: string;
}): string | undefined {
	if (!appVersion || cliVersion === "unknown") return undefined;
	const normalizedApp = toReleaseVersion({ packageVersion: appVersion });
	if (normalizedApp === cliVersion) return undefined;
	return `This qcut command (${cliVersion}, ${cliPath}) does not match QCut ${normalizedApp}; commands may be missing or behave differently. Run \`qcut cli install\` to use the command bundled with the app, or QCut > About & updates > command line tool.`;
}
