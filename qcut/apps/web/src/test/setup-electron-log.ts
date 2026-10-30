/**
 * Keeps main-process test logs on the console: under Node, electron-log
 * would append them to ~/Library/Logs/qcut/main.log, the user's own QCut log.
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
