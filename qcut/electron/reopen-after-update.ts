/**
 * The project open when QCut quit, opened again on the first launch after an
 * update (N26, 2026-10-30 trailer report: QCut updated itself overnight and
 * came back with no project open, so the next editor command failed until
 * the project was opened by hand). Other launches open nothing by
 * themselves, as before.
 *
 * The editor window notes the project it shows as it closes, which also
 * covers an install that closes the windows before quitting.
 *
 * @module electron/reopen-after-update
 */

import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

const RECORD_FILE = "reopen-after-update.json";

interface OpenProjectRecord {
	projectId: string;
	/** The package version that wrote the record. */
	version: string;
}

/** The project an editor URL shows (`…#/editor/<id>`), if it shows one. */
export function projectIdFromEditorUrl(url: string): string | undefined {
	const match = /#\/editor\/([^/?#]+)/.exec(url);
	if (!match) return undefined;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return undefined;
	}
}

/** Notes the project the editor shows; showing none forgets the last one. */
export function rememberOpenProject({
	userDataPath,
	url,
	packageVersion,
}: {
	userDataPath: string;
	url: string;
	packageVersion: string;
}): void {
	const file = path.join(userDataPath, RECORD_FILE);
	const projectId = projectIdFromEditorUrl(url);
	try {
		if (!projectId) {
			rmSync(file, { force: true });
			return;
		}
		const record: OpenProjectRecord = { projectId, version: packageVersion };
		mkdirSync(userDataPath, { recursive: true });
		const temporary = `${file}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(record)}\n`);
		renameSync(temporary, file);
	} catch {
		// Quitting matters more than the note.
	}
}

/**
 * The project to open on this launch: the one an earlier version left open,
 * when this launch runs a different version. Reading it forgets it, so it
 * opens once.
 */
export function takeProjectToReopen({
	userDataPath,
	packageVersion,
}: {
	userDataPath: string;
	packageVersion: string;
}): string | undefined {
	const file = path.join(userDataPath, RECORD_FILE);
	let record: Partial<OpenProjectRecord>;
	try {
		record = JSON.parse(
			readFileSync(file, "utf8")
		) as Partial<OpenProjectRecord>;
	} catch {
		return undefined;
	}
	rmSync(file, { force: true });
	if (typeof record.projectId !== "string" || !record.projectId)
		return undefined;
	return record.version !== packageVersion ? record.projectId : undefined;
}

/** On the first launch after an update, opens the project left open before it. */
export async function reopenProjectAfterUpdate({
	userDataPath,
	packageVersion,
	open,
	logger,
}: {
	userDataPath: string;
	packageVersion: string;
	/** Opens a project in the editor once it can take requests. */
	open: (projectId: string) => Promise<{ navigated?: boolean; error?: string }>;
	logger: {
		log(message?: unknown, ...optionalParams: unknown[]): void;
		warn(message?: unknown, ...optionalParams: unknown[]): void;
	};
}): Promise<void> {
	const projectId = takeProjectToReopen({ userDataPath, packageVersion });
	if (!projectId) return;
	try {
		const result = await open(projectId);
		if (result.navigated === false) {
			logger.warn(
				`[UpdateHistory] Could not reopen project ${projectId} after the update: ${result.error ?? "the editor did not open it"}`
			);
			return;
		}
		logger.log(
			`[UpdateHistory] Reopened project ${projectId} after the update`
		);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn(
			`[UpdateHistory] Could not reopen project ${projectId} after the update: ${message}`
		);
	}
}

/** Notes the project `win` shows each time it closes. */
export function trackOpenProject({
	win,
	userDataPath,
	packageVersion,
}: {
	win: {
		on(event: "close", listener: () => void): unknown;
		webContents: { getURL(): string };
	};
	userDataPath: string;
	packageVersion: string;
}): void {
	win.on("close", () =>
		rememberOpenProject({
			userDataPath,
			url: win.webContents.getURL(),
			packageVersion,
		})
	);
}
