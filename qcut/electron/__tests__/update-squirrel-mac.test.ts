import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import {
	readBundleIdentifier,
	watchSquirrelWhilePaused,
	withdrawSquirrelInstall,
} from "../update-squirrel-mac";

/**
 * N26 (2026-10-30 trailer report): pausing updates must keep an update
 * Squirrel already prepared from installing when QCut quits; its ShipIt job
 * waits for QCut to exit, so the pause removes that job.
 */

const execPath =
	"/Applications/QCut AI Video Editor.app/Contents/MacOS/QCut AI Video Editor";

function commands({ launchctlFails = false } = {}) {
	return vi.fn((file: string, args: string[]) => {
		if (file === "/usr/bin/plutil") return "com.qcut.videoeditor\n";
		if (launchctlFails) throw new Error("Could not find specified service");
		return `${file} ${args.join(" ")}`;
	});
}

describe("withdrawing Squirrel's install on quit", () => {
	it("reads the bundle identifier from the app's Info.plist", () => {
		const runCommand = commands();
		expect(readBundleIdentifier({ execPath, runCommand })).toBe(
			"com.qcut.videoeditor"
		);
		expect(runCommand).toHaveBeenCalledWith("/usr/bin/plutil", [
			"-extract",
			"CFBundleIdentifier",
			"raw",
			"-o",
			"-",
			"/Applications/QCut AI Video Editor.app/Contents/Info.plist",
		]);
	});

	it("removes the app's ShipIt job, and says when there was none", () => {
		const runCommand = commands();
		expect(withdrawSquirrelInstall({ execPath, runCommand })).toBe(true);
		expect(runCommand).toHaveBeenLastCalledWith("/bin/launchctl", [
			"remove",
			"com.qcut.videoeditor.ShipIt",
		]);
		expect(
			withdrawSquirrelInstall({
				execPath,
				runCommand: commands({ launchctlFails: true }),
			})
		).toBe(false);
	});

	it("withdraws again when Squirrel finishes preparing while paused", () => {
		const nativeUpdater = new EventEmitter();
		const runCommand = commands();
		let paused = false;
		watchSquirrelWhilePaused({
			nativeUpdater,
			isPaused: () => paused,
			logger: { log: vi.fn() },
			execPath,
			runCommand,
		});
		nativeUpdater.emit("update-downloaded");
		expect(runCommand).not.toHaveBeenCalled();
		paused = true;
		nativeUpdater.emit("update-downloaded");
		expect(runCommand).toHaveBeenLastCalledWith("/bin/launchctl", [
			"remove",
			"com.qcut.videoeditor.ShipIt",
		]);
	});
});
