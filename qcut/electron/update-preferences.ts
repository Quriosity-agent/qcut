import fs from "fs";
import path from "path";

export const MAX_AUTOMATIC_UPDATE_BYTES = 1024 * 1024 * 1024;

export interface UpdatePreferences {
	automaticUpdates: boolean;
	maxAutomaticDownloadBytes: number;
	/**
	 * Updates held back while a project is under way (N26, 2026-10-30
	 * trailer report): nothing downloads by itself, and nothing downloaded
	 * installs when QCut quits, until they are resumed.
	 */
	paused: boolean;
}

export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
	automaticUpdates: true,
	maxAutomaticDownloadBytes: MAX_AUTOMATIC_UPDATE_BYTES,
	paused: false,
};

function getPreferencesPath({
	userDataPath,
}: {
	userDataPath: string;
}): string {
	return path.join(userDataPath, "update-preferences.json");
}

export function readUpdatePreferences({
	userDataPath,
}: {
	userDataPath: string;
}): UpdatePreferences {
	try {
		const raw = fs.readFileSync(getPreferencesPath({ userDataPath }), "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			automaticUpdates:
				typeof parsed.automaticUpdates === "boolean"
					? parsed.automaticUpdates
					: DEFAULT_UPDATE_PREFERENCES.automaticUpdates,
			maxAutomaticDownloadBytes: MAX_AUTOMATIC_UPDATE_BYTES,
			paused: parsed.paused === true,
		};
	} catch {
		return { ...DEFAULT_UPDATE_PREFERENCES };
	}
}

export function writeUpdatePreferences({
	userDataPath,
	preferences,
}: {
	userDataPath: string;
	preferences: UpdatePreferences;
}): UpdatePreferences {
	const normalized: UpdatePreferences = {
		automaticUpdates: preferences.automaticUpdates,
		maxAutomaticDownloadBytes: MAX_AUTOMATIC_UPDATE_BYTES,
		paused: preferences.paused === true,
	};
	const preferencesPath = getPreferencesPath({ userDataPath });
	const temporaryPath = `${preferencesPath}.tmp-${process.pid}`;

	fs.mkdirSync(userDataPath, { recursive: true });
	fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
		mode: 0o600,
	});
	fs.renameSync(temporaryPath, preferencesPath);
	return normalized;
}
