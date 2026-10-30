/**
 * Withdraws the update Squirrel.Mac is waiting to install when QCut quits
 * (N26, 2026-10-30 trailer report: pausing updates while a project is under
 * way). electron-updater hands a finished download to Squirrel, which starts
 * a ShipIt job that waits for QCut to exit and then replaces the app.
 * Removing that job keeps the update from installing; resuming hands the
 * cached download over again, and Squirrel starts a new job.
 *
 * @module electron/update-squirrel-mac
 */

import { execFileSync } from "node:child_process";
import { posix } from "node:path";

type Run = (file: string, args: string[]) => string;

const run: Run = (file, args) =>
	execFileSync(file, args, { encoding: "utf8", timeout: 5000 });

/** The app's bundle identifier, read from the Info.plist beside its binary. */
export function readBundleIdentifier({
	execPath,
	runCommand = run,
}: {
	execPath: string;
	runCommand?: Run;
}): string {
	// A macOS bundle path, whatever platform computes it.
	const infoPlist = posix.join(posix.dirname(execPath), "..", "Info.plist");
	return runCommand("/usr/bin/plutil", [
		"-extract",
		"CFBundleIdentifier",
		"raw",
		"-o",
		"-",
		infoPlist,
	]).trim();
}

/**
 * Removes the ShipIt job Squirrel submitted for this app (its label is the
 * bundle identifier plus `.ShipIt`). Returns false when there was none, and
 * throws when the job is still loaded afterwards: the update would then still
 * install when QCut quits.
 */
export function withdrawSquirrelInstall({
	execPath,
	runCommand = run,
}: {
	execPath: string;
	runCommand?: Run;
}): boolean {
	const label = `${readBundleIdentifier({ execPath, runCommand })}.ShipIt`;
	const loaded = () => {
		try {
			runCommand("/bin/launchctl", ["list", label]);
			return true;
		} catch {
			return false;
		}
	};
	if (!loaded()) return false;
	try {
		runCommand("/bin/launchctl", ["remove", label]);
	} catch {
		// Whether it went is checked below.
	}
	if (loaded()) {
		throw new Error(
			`${label} is still loaded, so the update would install when QCut quits`
		);
	}
	return true;
}

/**
 * The withdrawal a paused updater calls, also run whenever Squirrel finishes
 * preparing an update while updates are paused (a download that was already
 * being handed over when the pause came).
 */
export function watchSquirrelWhilePaused({
	nativeUpdater,
	isPaused,
	logger,
	execPath = process.execPath,
	runCommand = run,
}: {
	nativeUpdater: {
		on(event: "update-downloaded", listener: () => void): unknown;
	};
	isPaused: () => boolean;
	logger: {
		log(message?: unknown, ...optionalParams: unknown[]): void;
		warn(message?: unknown, ...optionalParams: unknown[]): void;
	};
	execPath?: string;
	runCommand?: Run;
}): () => void {
	/** Throws when the install could not be withdrawn. */
	const withdraw = () => {
		const withdrawn = withdrawSquirrelInstall({ execPath, runCommand });
		logger.log(
			withdrawn
				? "[AutoUpdater] Withdrew the staged install; it will not install on quit"
				: "[AutoUpdater] No staged install to withdraw"
		);
	};
	nativeUpdater.on("update-downloaded", () => {
		if (!isPaused()) return;
		try {
			withdraw();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.warn(
				"[AutoUpdater] Could not withdraw the staged install:",
				message
			);
		}
	});
	return withdraw;
}
