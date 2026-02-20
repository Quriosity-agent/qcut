import { accessSync, constants, existsSync } from "node:fs";
import { join } from "node:path";

export interface SpawnDiagnosticsInput {
	shell: string;
	args: string[];
	cwd: string;
	command?: string;
	envPath?: string;
	platformName: NodeJS.Platform;
	pathExtEnv?: string;
}

export interface SpawnDiagnostics {
	shell: string;
	args: string[];
	cwd: string;
	cwdExists: boolean;
	pathPreview: string;
	commandBinary: string | null;
	resolvedCommandPath: string | null;
}

interface ResolveCommandOnPathInput {
	commandBinary: string;
	envPath?: string;
	platformName: NodeJS.Platform;
	pathExtEnv?: string;
}

function getPathDelimiter({
	platformName,
}: {
	platformName: NodeJS.Platform;
}): string {
	return platformName === "win32" ? ";" : ":";
}

function splitPathEntries({
	envPath,
	platformName,
}: {
	envPath?: string;
	platformName: NodeJS.Platform;
}): string[] {
	if (!envPath) {
		return [];
	}

	const delimiter = getPathDelimiter({ platformName });
	const entries = envPath.split(delimiter);
	return entries.filter((entry) => entry.trim().length > 0);
}

function isExecutablePath({
	filePath,
	platformName,
}: {
	filePath: string;
	platformName: NodeJS.Platform;
}): boolean {
	try {
		if (!existsSync(filePath)) {
			return false;
		}
		if (platformName === "win32") {
			return true;
		}
		accessSync(filePath, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function hasPathSeparator({ value }: { value: string }): boolean {
	return value.includes("/") || value.includes("\\");
}

export function extractCommandBinary({
	command,
}: {
	command: string;
}): string | null {
	try {
		const trimmedCommand = command.trim();
		if (trimmedCommand.length === 0) {
			return null;
		}

		const firstChar = trimmedCommand[0];
		if (firstChar === '"' || firstChar === "'") {
			const closingIndex = trimmedCommand.indexOf(firstChar, 1);
			if (closingIndex > 1) {
				return trimmedCommand.slice(1, closingIndex);
			}
			return trimmedCommand.slice(1);
		}

		const firstSpaceMatch = /\s/.exec(trimmedCommand);
		if (!firstSpaceMatch) {
			return trimmedCommand;
		}
		return trimmedCommand.slice(0, firstSpaceMatch.index);
	} catch {
		return null;
	}
}

function buildWindowsCandidates({
	baseCommand,
	pathExtEnv,
}: {
	baseCommand: string;
	pathExtEnv?: string;
}): string[] {
	const defaultExtensions = [".EXE", ".CMD", ".BAT", ".COM"];
	const extensions = pathExtEnv
		? pathExtEnv
				.split(";")
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0)
		: defaultExtensions;

	const normalizedBase = baseCommand.toUpperCase();
	const alreadyHasExtension = extensions.some((ext) =>
		normalizedBase.endsWith(ext.toUpperCase())
	);

	if (alreadyHasExtension) {
		return [baseCommand];
	}

	const candidates = [baseCommand];
	for (const extension of extensions) {
		candidates.push(`${baseCommand}${extension}`);
	}
	return candidates;
}

export function resolveCommandOnPath({
	commandBinary,
	envPath,
	platformName,
	pathExtEnv,
}: ResolveCommandOnPathInput): string | null {
	try {
		if (!commandBinary) {
			return null;
		}

		if (hasPathSeparator({ value: commandBinary })) {
			return isExecutablePath({ filePath: commandBinary, platformName })
				? commandBinary
				: null;
		}

		const pathEntries = splitPathEntries({ envPath, platformName });
		for (const entry of pathEntries) {
			if (platformName === "win32") {
				const candidates = buildWindowsCandidates({
					baseCommand: commandBinary,
					pathExtEnv,
				});
				for (const candidate of candidates) {
					const fullPath = join(entry, candidate);
					if (isExecutablePath({ filePath: fullPath, platformName })) {
						return fullPath;
					}
				}
				continue;
			}

			const fullPath = join(entry, commandBinary);
			if (isExecutablePath({ filePath: fullPath, platformName })) {
				return fullPath;
			}
		}

		return null;
	} catch {
		return null;
	}
}

function getPathPreview({
	envPath,
	platformName,
}: {
	envPath?: string;
	platformName: NodeJS.Platform;
}): string {
	try {
		const pathEntries = splitPathEntries({ envPath, platformName });
		const previewEntries = pathEntries.slice(0, 5);
		const delimiter = getPathDelimiter({ platformName });
		return previewEntries.join(delimiter);
	} catch {
		return "";
	}
}

export function createSpawnDiagnostics({
	shell,
	args,
	cwd,
	command,
	envPath,
	platformName,
	pathExtEnv,
}: SpawnDiagnosticsInput): SpawnDiagnostics {
	try {
		const commandBinary = command ? extractCommandBinary({ command }) : null;
		const resolvedCommandPath = commandBinary
			? resolveCommandOnPath({
					commandBinary,
					envPath,
					platformName,
					pathExtEnv,
				})
			: null;

		return {
			shell,
			args,
			cwd,
			cwdExists: existsSync(cwd),
			pathPreview: getPathPreview({ envPath, platformName }),
			commandBinary,
			resolvedCommandPath,
		};
	} catch {
		return {
			shell,
			args,
			cwd,
			cwdExists: false,
			pathPreview: "",
			commandBinary: null,
			resolvedCommandPath: null,
		};
	}
}
