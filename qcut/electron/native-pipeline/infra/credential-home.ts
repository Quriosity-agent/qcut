/**
 * Where QCut's credential files live: `~/.qcut/.env` (canonical) and AICP's
 * legacy `credentials.env`. `QCUT_CREDENTIALS_HOME` moves both under another
 * folder, so an isolated test app reads and writes copies instead of the
 * user's own keys (an E2E run once replaced a real FAL_KEY in both files with
 * its `test-fal-api-key-e2e` placeholder).
 *
 * @module electron/native-pipeline/infra/credential-home
 */
import * as os from "node:os";
import * as path from "node:path";

function overriddenHome(): string | undefined {
	return process.env.QCUT_CREDENTIALS_HOME?.trim() || undefined;
}

/** The folder holding `.qcut/.env`: the user's home unless overridden. */
export function credentialHome(): string {
	return overriddenHome() ?? os.homedir();
}

/** `~/.qcut/.env`. */
export function qcutEnvFilePath(): string {
	return path.join(credentialHome(), ".qcut", ".env");
}

/** AICP's legacy `credentials.env` (under %APPDATA% on Windows). */
export function aicpCredentialsFilePath(): string {
	const home = overriddenHome();
	if (home) {
		return path.join(home, ".config", "video-ai-studio", "credentials.env");
	}
	if (process.platform === "win32") {
		return path.join(
			process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
			"video-ai-studio",
			"credentials.env"
		);
	}
	return path.join(
		os.homedir(),
		".config",
		"video-ai-studio",
		"credentials.env"
	);
}
