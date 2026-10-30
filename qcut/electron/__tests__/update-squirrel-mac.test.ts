import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
	readBundleIdentifier,
	watchSquirrelWhilePaused,
	withdrawSquirrelInstall,
} from "../update-squirrel-mac";

/**
 * Pausing updates must keep an update Squirrel already prepared from
 * installing when QCut quits: its ShipIt job waits for QCut to exit, so the
 * pause removes that job, and says when it could not.
 */

const execPath =
	"/Applications/QCut AI Video Editor.app/Contents/MacOS/QCut AI Video Editor";
const label = "com.qcut.videoeditor.ShipIt";

/** A launchd with (or without) the ShipIt job; `stuck` keeps it on remove. */
function launchd({ loaded = true, stuck = false } = {}) {
	let jobLoaded = loaded;
	const runCommand = vi.fn((file: string, args: string[]) => {
		if (file === "/usr/bin/plutil") return "com.qcut.videoeditor\n";
		if (args[0] === "list") {
			if (!jobLoaded) throw new Error("Could not find service");
			return `"Label" = "${args[1]}";`;
		}
		if (args[0] === "remove") {
			if (!jobLoaded) throw new Error("Could not find specified service");
			if (stuck) throw new Error("Operation not permitted");
			jobLoaded = false;
			return "";
		}
		throw new Error(`unexpected ${file} ${args.join(" ")}`);
	});
	return { runCommand, isLoaded: () => jobLoaded };
}

describe("withdrawing Squirrel's install on quit", () => {
	it("reads the bundle identifier from the app's Info.plist", () => {
		const { runCommand } = launchd();
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
		const present = launchd();
		expect(
			withdrawSquirrelInstall({ execPath, runCommand: present.runCommand })
		).toBe(true);
		expect(present.runCommand).toHaveBeenCalledWith("/bin/launchctl", [
			"remove",
			label,
		]);
		expect(present.isLoaded()).toBe(false);

		const absent = launchd({ loaded: false });
		expect(
			withdrawSquirrelInstall({ execPath, runCommand: absent.runCommand })
		).toBe(false);
	});

	it("throws when the job is still loaded after the removal", () => {
		const { runCommand } = launchd({ stuck: true });
		expect(() => withdrawSquirrelInstall({ execPath, runCommand })).toThrow(
			`${label} is still loaded, so the update would install when QCut quits`
		);
	});

	it("tells the updater when Squirrel finishes preparing an update", () => {
		const nativeUpdater = new EventEmitter();
		const onSquirrelStaged = vi.fn();
		const { runCommand } = launchd();
		watchSquirrelWhilePaused({
			nativeUpdater,
			onSquirrelStaged,
			logger: { log: vi.fn() },
			execPath,
			runCommand,
		});
		nativeUpdater.emit("update-downloaded");
		expect(onSquirrelStaged).toHaveBeenCalledTimes(1);
		// Whether to withdraw it is the updater's call.
		expect(runCommand).not.toHaveBeenCalled();
	});

	it("hands the updater a withdrawal that says what it did, or throws", () => {
		const logger = { log: vi.fn() };
		const present = launchd();
		const withdraw = watchSquirrelWhilePaused({
			nativeUpdater: new EventEmitter(),
			onSquirrelStaged: vi.fn(),
			logger,
			execPath,
			runCommand: present.runCommand,
		});
		withdraw();
		expect(present.isLoaded()).toBe(false);
		expect(logger.log).toHaveBeenLastCalledWith(
			"[AutoUpdater] Withdrew the staged install; it will not install on quit"
		);
		withdraw();
		expect(logger.log).toHaveBeenLastCalledWith(
			"[AutoUpdater] No staged install to withdraw"
		);

		const stuck = watchSquirrelWhilePaused({
			nativeUpdater: new EventEmitter(),
			onSquirrelStaged: vi.fn(),
			logger,
			execPath,
			runCommand: launchd({ stuck: true }).runCommand,
		});
		expect(stuck).toThrow(
			`${label} is still loaded, so the update would install when QCut quits`
		);
	});
});
