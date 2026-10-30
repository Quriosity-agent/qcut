/**
 * Says once that QCut was updated (N26, 2026-10-30 trailer report: an
 * update installed itself overnight and an agent found out only when an
 * export sounded different). The first editor API answer after an update
 * names both versions and the release notes, on stderr so `--json` output
 * stays clean; `~/.qcut/update-notice.json` remembers it was said.
 *
 * @module electron/native-pipeline/editor/editor-update-notice
 */

import fs from "node:fs";
import path from "node:path";
import { parseLastUpdateHeader } from "../../update-notice.js";
import { credentialHome } from "../infra/credential-home.js";

let noticed = false;

function noticeFile(): string {
	return path.join(credentialHome(), ".qcut", "update-notice.json");
}

/** Prints the update an answer's header names, unless it was said before. */
export function noticeLastUpdate(header: string | null | undefined): void {
	if (noticed || !header) return;
	noticed = true;
	try {
		const update = parseLastUpdateHeader(header);
		if (!update) return;
		const key = `${update.from}->${update.to}@${update.at}`;
		const file = noticeFile();
		try {
			const seen = JSON.parse(fs.readFileSync(file, "utf8")) as {
				noticed?: unknown;
			};
			if (seen.noticed === key) return;
		} catch {
			// Never said anything yet.
		}
		console.warn(
			`[QCut] QCut was updated from ${update.from} to ${update.to} (first run ${update.at}). What changed: ${update.releaseNotes}`
		);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify({ noticed: key })}\n`);
	} catch {
		// A notice is never worth failing a command over.
	}
}

/** Forgets that this process noticed, for tests. */
export function resetUpdateNoticeForTests(): void {
	noticed = false;
}
