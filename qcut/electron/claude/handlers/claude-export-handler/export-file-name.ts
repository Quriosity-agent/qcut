/**
 * The file name an export gets when the caller names only a folder, or
 * nothing: the project's name and the time it started, so a folder of
 * exports says which project each one is (Q4 of the 2026-11-08 report:
 * `export-2026-11-08T12-47-29.mp4` named none).
 *
 * Free of Electron, so the editor's main process and the CLI name files
 * alike.
 *
 * @module electron/claude/handlers/claude-export-handler/export-file-name
 */

import path from "node:path";

/** What no file name may hold on macOS or Windows, control characters too. */
const UNSAFE_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** Long enough for a descriptive project name, short of path limits. */
const MAX_NAME_CHARACTERS = 80;

/**
 * A project name as a file name: characters a file name cannot hold become
 * "-", runs of white space one space, and no leading dot (a hidden file) or
 * trailing dot or space (which Windows drops). Letters of any script stay.
 */
export function projectFileName(name: string): string {
	const cleaned = name
		.replace(/\s+/g, " ")
		.replace(UNSAFE_CHARACTERS, "-")
		.replace(/^[\s.-]+|[\s.-]+$/g, "");
	return Array.from(cleaned)
		.slice(0, MAX_NAME_CHARACTERS)
		.join("")
		.replace(/[\s.-]+$/, "");
}

/** `YYYY-MM-DD-HHMMSS`, local time. */
export function exportTimestamp(now: Date): string {
	const two = (value: number) => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

/** How many numbered names are tried before a random one is used. */
const MAX_NUMBERED_NAMES = 999;

/**
 * `<directory>/<stem>.<extension>`, with `-2`, `-3`… after the stem while a
 * file of that name is already there: two exports of a project within one
 * second (a script's loop) must not write over each other. Past `-999` it
 * takes a random suffix instead of searching on, so an `exists` that says
 * yes to everything cannot keep it looping. The extension is added here, so
 * a dot in a project name is never taken for one.
 */
export function freeExportPath({
	directory,
	stem,
	extension,
	exists,
}: {
	directory: string;
	stem: string;
	extension: string;
	exists: (filePath: string) => boolean;
}): string {
	const candidate = (suffix: string) =>
		path.join(directory, `${stem}${suffix}.${extension}`);
	for (let count = 1; count <= MAX_NUMBERED_NAMES; count++) {
		const filePath = candidate(count === 1 ? "" : `-${count}`);
		if (!exists(filePath)) return filePath;
	}
	return candidate(`-${Math.random().toString(36).slice(2, 10)}`);
}

/**
 * `<project name>-<YYYY-MM-DD-HHMMSS>`, without an extension. The project id
 * stands in for a name that leaves nothing usable.
 */
export function defaultExportFileStem({
	projectName,
	projectId,
	now = new Date(),
}: {
	projectName?: string;
	projectId: string;
	now?: Date;
}): string {
	const name =
		(projectName ? projectFileName(projectName) : "") ||
		projectFileName(projectId) ||
		"export";
	return `${name}-${exportTimestamp(now)}`;
}
