/**
 * Which version ran last, so the first launch of a new version knows QCut
 * was updated, from what and when (N26, 2026-10-30 trailer report: an update
 * installed itself overnight and was noticed only because an export sounded
 * different). `editor:health` reports it and the CLI mentions it once.
 *
 * The record lives in the app's data folder; the version that first writes
 * it cannot name the one before it.
 *
 * @module electron/update-history
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OFFICIAL_AUTO_UPDATE_CONFIG } from "./auto-update-config.js";
import type { UpdateRecord } from "./update-notice.js";
import { toReleaseVersion } from "./update-version.js";

interface UpdateHistoryFile {
	lastRunVersion: string;
	lastUpdate?: UpdateRecord;
}

const HISTORY_FILE = "update-history.json";

/** The GitHub release page of a release version. */
export function releaseNotesUrl(version: string): string {
	const { owner, repo } = OFFICIAL_AUTO_UPDATE_CONFIG;
	return `https://github.com/${owner}/${repo}/releases/tag/v${version}`;
}

function isUpdateRecord(value: unknown): value is UpdateRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return ["from", "to", "at", "releaseNotes"].every(
		(key) => typeof record[key] === "string" && record[key] !== ""
	);
}

function readHistory(file: string): UpdateHistoryFile | undefined {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof (parsed as UpdateHistoryFile).lastRunVersion === "string"
		) {
			const { lastRunVersion, lastUpdate } = parsed as UpdateHistoryFile;
			// A last update that is not one (a hand-edited file) is dropped.
			return isUpdateRecord(lastUpdate)
				? { lastRunVersion, lastUpdate }
				: { lastRunVersion };
		}
	} catch {
		// No record yet, or one that cannot be read: start a new one.
	}
	return undefined;
}

let lastUpdate: UpdateRecord | undefined;

/**
 * Notes this launch's version and returns the last update: a new one when
 * the version differs from the last run's, else the one recorded before.
 */
export function recordLaunchVersion({
	userDataPath,
	packageVersion,
	now = new Date(),
}: {
	userDataPath: string;
	packageVersion: string;
	now?: Date;
}): UpdateRecord | undefined {
	const file = path.join(userDataPath, HISTORY_FILE);
	const previous = readHistory(file);
	const version = toReleaseVersion({ packageVersion });
	lastUpdate =
		previous && previous.lastRunVersion !== version
			? {
					from: previous.lastRunVersion,
					to: version,
					at: now.toISOString(),
					releaseNotes: releaseNotesUrl(version),
				}
			: previous?.lastUpdate;
	const record: UpdateHistoryFile = {
		lastRunVersion: version,
		...(lastUpdate ? { lastUpdate } : {}),
	};
	try {
		mkdirSync(userDataPath, { recursive: true });
		const temporary = `${file}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
		renameSync(temporary, file);
	} catch {
		// Launching matters more than the note; the next launch tries again.
	}
	return lastUpdate;
}

/** The last update this process found at launch, if any. */
export function getLastUpdate(): UpdateRecord | undefined {
	return lastUpdate;
}
