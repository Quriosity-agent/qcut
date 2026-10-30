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

/**
 * `from=…; to=…; at=…; notes=…`, each value URI-encoded: a header takes only
 * plain characters, and a hand-edited record must not break every answer.
 */
export function formatLastUpdateHeader(record: UpdateRecord): string {
	const field = (value: string) => encodeURIComponent(String(value));
	return `from=${field(record.from)}; to=${field(record.to)}; at=${field(record.at)}; notes=${field(record.releaseNotes)}`;
}

function decodeField(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
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
	const [from, to, at, releaseNotes] = ["from", "to", "at", "notes"].map(
		(name) => {
			const value = fields.get(name);
			return value ? decodeField(value) : undefined;
		}
	);
	return from && to && at && releaseNotes
		? { from, to, at, releaseNotes }
		: undefined;
}
