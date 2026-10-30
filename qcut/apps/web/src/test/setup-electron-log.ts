/**
 * Main-process code logs through electron-log, which under Node appends to
 * ~/Library/Logs/qcut/main.log: the user's own QCut log (N29, 2026-10-30
 * trailer report: a test run's "rename refused" and "Export job job-1
 * cancelled" sat among the app's real lines). Tests keep their log lines on
 * the console.
 */
import { createRequire } from "node:module";

try {
	const log = createRequire(import.meta.url)("electron-log") as {
		transports: { file: { level: string | false } };
	};
	log.transports.file.level = false;
} catch {
	// electron-log is not installed here, so nothing writes a log file.
}
