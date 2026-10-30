/**
 * The last update QCut found it had (N26), as `editor:health` reports it and
 * as every editor API answer carries it in a header, so the CLI can say once
 * that QCut changed under it. No imports: the utility process and the CLI
 * use this too.
 *
 * @module electron/update-notice
 */

/** The last update QCut found it had, in release versions. */
export interface UpdateRecord {
	from: string;
	to: string;
	/** When the new version first started (ISO time). */
	at: string;
	/** The new version's release notes. */
	releaseNotes: string;
}

/** The response header carrying the last update. */
export const LAST_UPDATE_HEADER = "x-qcut-last-update";

/** `from=…; to=…; at=…; notes=…` (all ASCII). */
export function formatLastUpdateHeader(record: UpdateRecord): string {
	return `from=${record.from}; to=${record.to}; at=${record.at}; notes=${record.releaseNotes}`;
}

/** The header back as a record; undefined when it is not one. */
export function parseLastUpdateHeader(
	value: string | null | undefined
): UpdateRecord | undefined {
	if (!value) return undefined;
	const fields = new Map<string, string>();
	for (const part of value.split(";")) {
		const separator = part.indexOf("=");
		if (separator > 0) {
			fields.set(
				part.slice(0, separator).trim(),
				part.slice(separator + 1).trim()
			);
		}
	}
	const from = fields.get("from");
	const to = fields.get("to");
	const at = fields.get("at");
	const releaseNotes = fields.get("notes");
	return from && to && at && releaseNotes
		? { from, to, at, releaseNotes }
		: undefined;
}
