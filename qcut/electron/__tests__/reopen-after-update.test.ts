import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	projectIdFromEditorUrl,
	rememberOpenProject,
	reopenProjectAfterUpdate,
	takeProjectToReopen,
	trackOpenProject,
} from "../reopen-after-update";

/**
 * N26 (2026-10-30 trailer report): QCut updated itself overnight and came
 * back with no project open. The first launch after an update now opens the
 * project that was open; other launches open nothing by themselves.
 */

const directories: string[] = [];

function userDataPath(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qcut-reopen-"));
	directories.push(directory);
	return directory;
}

const editorUrl =
	"app://./index.html#/editor/08437513-2be1-4c4b-a7a3-7d2b6b0ad6a9";

afterEach(() => {
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("reopening the project after an update", () => {
	it("reads the project from the editor's address", () => {
		expect(projectIdFromEditorUrl(editorUrl)).toBe(
			"08437513-2be1-4c4b-a7a3-7d2b6b0ad6a9"
		);
		expect(
			projectIdFromEditorUrl("app://./index.html#/editor/p1?panel=media")
		).toBe("p1");
		expect(projectIdFromEditorUrl("app://./index.html#/projects")).toBe(
			undefined
		);
	});

	it("opens it once, and only on a launch of another version", () => {
		const dir = userDataPath();
		rememberOpenProject({
			userDataPath: dir,
			url: editorUrl,
			packageVersion: "2026.10.3001",
		});
		// A restart of the same version opens nothing by itself, and forgets.
		expect(
			takeProjectToReopen({ userDataPath: dir, packageVersion: "2026.10.3001" })
		).toBeUndefined();

		rememberOpenProject({
			userDataPath: dir,
			url: editorUrl,
			packageVersion: "2026.10.3001",
		});
		expect(
			takeProjectToReopen({ userDataPath: dir, packageVersion: "2026.10.3002" })
		).toBe("08437513-2be1-4c4b-a7a3-7d2b6b0ad6a9");
		expect(
			takeProjectToReopen({ userDataPath: dir, packageVersion: "2026.10.3002" })
		).toBeUndefined();
	});

	it("forgets the project once the window closes on the project list", () => {
		const dir = userDataPath();
		const win = Object.assign(new EventEmitter(), {
			webContents: { getURL: () => editorUrl },
		});
		trackOpenProject({
			win,
			userDataPath: dir,
			packageVersion: "2026.10.3001",
		});
		win.emit("close");
		win.webContents.getURL = () => "app://./index.html#/projects";
		win.emit("close");
		expect(
			takeProjectToReopen({ userDataPath: dir, packageVersion: "2026.10.3002" })
		).toBeUndefined();
	});

	it("opens the project in the editor and says so", async () => {
		const dir = userDataPath();
		rememberOpenProject({
			userDataPath: dir,
			url: editorUrl,
			packageVersion: "2026.10.3001",
		});
		const open = vi.fn(async () => ({ navigated: true }));
		const logger = { log: vi.fn(), warn: vi.fn() };
		await reopenProjectAfterUpdate({
			userDataPath: dir,
			packageVersion: "2026.10.3002",
			open,
			logger,
		});
		expect(open).toHaveBeenCalledWith("08437513-2be1-4c4b-a7a3-7d2b6b0ad6a9");
		expect(logger.log).toHaveBeenCalledWith(
			"[UpdateHistory] Reopened project 08437513-2be1-4c4b-a7a3-7d2b6b0ad6a9 after the update"
		);

		// A project the editor cannot open (deleted meanwhile) is reported.
		rememberOpenProject({
			userDataPath: dir,
			url: editorUrl,
			packageVersion: "2026.10.3001",
		});
		await reopenProjectAfterUpdate({
			userDataPath: dir,
			packageVersion: "2026.10.3002",
			open: async () => ({ navigated: false, error: "Project not found" }),
			logger,
		});
		expect(logger.warn).toHaveBeenCalledWith(
			"[UpdateHistory] Could not reopen project 08437513-2be1-4c4b-a7a3-7d2b6b0ad6a9 after the update: Project not found"
		);
	});
});
