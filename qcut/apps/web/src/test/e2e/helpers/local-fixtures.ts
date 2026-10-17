import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Media that exists only on a developer's machine: the project clips, music
 * cues and research captures some specs measure against. A spec names the
 * variable for its file; the path comes from the environment or from
 * `local-fixtures.local.json` next to the specs (gitignored), for example
 * `{ "QCUT_SHOT_SPLIT_E2E_SOURCE": "/Volumes/media/clip.mp4" }`. Nothing
 * personal is checked in, and a spec skips when neither names a file that is
 * here.
 */
const LOCAL_FIXTURES_FILE = path.resolve(
	"apps/web/src/test/e2e/local-fixtures.local.json"
);

function readLocalFixtures(): Record<string, string> {
	if (!existsSync(LOCAL_FIXTURES_FILE)) return {};
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(LOCAL_FIXTURES_FILE, "utf8")
		);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		return Object.fromEntries(
			Object.entries(parsed as Record<string, unknown>).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string"
			)
		);
	} catch {
		return {};
	}
}

/** The local file `name` points at, or "" when it is not on this machine. */
export function localFixturePath(name: string): string {
	const candidate =
		process.env[name]?.trim() || readLocalFixtures()[name]?.trim();
	return candidate && existsSync(candidate) ? candidate : "";
}
