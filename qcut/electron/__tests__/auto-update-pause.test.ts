import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAutoUpdateController,
	type AutoUpdaterLike,
	type UpdateInfoLike,
} from "../auto-update-controller";
import {
	DEFAULT_UPDATE_PREFERENCES,
	writeUpdatePreferences,
} from "../update-preferences";

/**
 * Paused updates download nothing by themselves, install nothing on quit,
 * and pick up where they were once resumed.
 */

class FakeUpdater extends EventEmitter implements AutoUpdaterLike {
	autoDownload = true;
	autoInstallOnAppQuit = true;
	allowPrerelease = false;
	channel = "";
	downloadCount = 0;
	installCount = 0;
	info: UpdateInfoLike = {
		version: "2026.10.3002",
		files: [{ size: 1_000 }],
	};

	async checkForUpdates(): Promise<unknown> {
		this.emit("update-available", this.info);
		return { updateInfo: this.info };
	}

	/** The next download fails, as a hand-over that cannot reach Squirrel. */
	nextDownloadError: Error | undefined;

	async downloadUpdate(): Promise<string[]> {
		this.downloadCount += 1;
		if (this.nextDownloadError) {
			const error = this.nextDownloadError;
			this.nextDownloadError = undefined;
			throw error;
		}
		this.emit("update-downloaded", this.info);
		return ["/tmp/update.zip"];
	}

	quitAndInstall(): void {
		this.installCount += 1;
	}
}

const directories: string[] = [];

function userDataPath({ paused = false }: { paused?: boolean } = {}): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qcut-pause-"));
	directories.push(directory);
	if (paused) {
		writeUpdatePreferences({
			userDataPath: directory,
			preferences: { ...DEFAULT_UPDATE_PREFERENCES, paused: true },
		});
	}
	return directory;
}

function setup({ paused = false }: { paused?: boolean } = {}) {
	const updater = new FakeUpdater();
	const withdrawInstallOnQuit = vi.fn();
	const onUpdateStaged = vi.fn();
	const controller = createAutoUpdateController({
		updater,
		currentVersion: "2026.10.3001",
		userDataPath: userDataPath({ paused }),
		logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
		sendToRenderer: () => undefined,
		onUpdateStaged,
		withdrawInstallOnQuit,
		checkIntervalMs: 60_000,
	});
	return { updater, controller, withdrawInstallOnQuit, onUpdateStaged };
}

afterEach(() => {
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("paused updates", () => {
	it("download nothing and install nothing on quit from the start", async () => {
		const { updater, controller } = setup({ paused: true });
		controller.start();
		await vi.waitFor(() =>
			expect(controller.getState().phase).toBe("available")
		);
		expect(controller.getState()).toMatchObject({
			decision: "paused",
			automaticDownload: false,
			paused: true,
		});
		expect(updater.autoInstallOnAppQuit).toBe(false);
		expect(updater.downloadCount).toBe(0);
		controller.stop();
	});

	it("withdraw an update already set to install on quit", async () => {
		const { updater, controller, withdrawInstallOnQuit } = setup();
		controller.start();
		await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
		expect(updater.autoInstallOnAppQuit).toBe(true);

		controller.setPreferences({ preferences: { paused: true } });
		expect(updater.autoInstallOnAppQuit).toBe(false);
		expect(withdrawInstallOnQuit).toHaveBeenCalledTimes(1);
		expect(controller.getState()).toMatchObject({
			phase: "ready",
			paused: true,
		});
		expect(controller.installUpdate()).toEqual({
			success: false,
			message: "Updates are paused; resume them to install this one",
		});
		expect(updater.installCount).toBe(0);

		// Pausing again changes nothing.
		controller.setPreferences({ preferences: { paused: true } });
		expect(withdrawInstallOnQuit).toHaveBeenCalledTimes(1);
		controller.stop();
	});

	it("hand the downloaded update over again on resume", async () => {
		const { updater, controller } = setup();
		controller.start();
		await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
		controller.setPreferences({ preferences: { paused: true } });

		controller.setPreferences({ preferences: { paused: false } });
		expect(updater.autoInstallOnAppQuit).toBe(true);
		// The cached download is handed over again, not fetched anew.
		await vi.waitFor(() => expect(updater.downloadCount).toBe(2));
		expect(controller.getState().paused).toBe(false);
		expect(controller.installUpdate().success).toBe(true);
		controller.stop();
	});

	it("keep an update fetched by hand while paused from installing", async () => {
		const { updater, controller, onUpdateStaged, withdrawInstallOnQuit } =
			setup({ paused: true });
		controller.start();
		await vi.waitFor(() =>
			expect(controller.getState().phase).toBe("available")
		);
		await updater.downloadUpdate();
		expect(controller.getState().phase).toBe("ready");
		// No "installs the next time you quit" notice while paused.
		expect(onUpdateStaged).not.toHaveBeenCalled();
		expect(withdrawInstallOnQuit).not.toHaveBeenCalled();

		controller.setPreferences({ preferences: { paused: false } });
		await vi.waitFor(() => expect(updater.downloadCount).toBe(2));
		controller.stop();
	});

	it("start a waiting automatic download once resumed", async () => {
		const { updater, controller } = setup({ paused: true });
		controller.start();
		await vi.waitFor(() =>
			expect(controller.getState().phase).toBe("available")
		);
		controller.setPreferences({ preferences: { paused: false } });
		await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
		expect(updater.downloadCount).toBe(1);
		controller.stop();
	});

	it("say when the install could not be withdrawn, and retry on the next pause", async () => {
		const { updater, controller, withdrawInstallOnQuit } = setup();
		controller.start();
		await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
		withdrawInstallOnQuit.mockImplementationOnce(() => {
			throw new Error("com.qcut.videoeditor.ShipIt is still loaded");
		});

		controller.setPreferences({ preferences: { paused: true } });
		expect(controller.getState().message).toBe(
			"Updates are paused, but QCut 2026.10.30.2 could still install when QCut quits: com.qcut.videoeditor.ShipIt is still loaded"
		);
		// Nothing was withdrawn, so resuming hands nothing over again.
		controller.setPreferences({ preferences: { paused: false } });
		expect(updater.downloadCount).toBe(1);

		controller.setPreferences({ preferences: { paused: true } });
		expect(withdrawInstallOnQuit).toHaveBeenCalledTimes(2);
		controller.stop();
	});

	it("keep the update withdrawn until it is handed over again", async () => {
		const { updater, controller } = setup();
		controller.start();
		await vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
		controller.setPreferences({ preferences: { paused: true } });

		updater.nextDownloadError = new Error("proxy closed");
		controller.setPreferences({ preferences: { paused: false } });
		await vi.waitFor(() => expect(updater.downloadCount).toBe(2));

		// The failed hand-over is tried again by the next resume.
		controller.setPreferences({ preferences: { paused: true } });
		controller.setPreferences({ preferences: { paused: false } });
		await vi.waitFor(() => expect(updater.downloadCount).toBe(3));
		controller.stop();
	});
});
