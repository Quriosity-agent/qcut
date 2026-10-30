import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	pendingProjectToReopen,
	projectIdFromEditorUrl,
	rememberOpenProject,
	reopenProjectAfterUpdate,
	trackOpenProject,
} from "../reopen-after-update";

/**
 * The first launch after an update opens the project that was open when
 * QCut quit, until it has opened; other launches open nothing by themselves.
 */

const directories: string[] = [];

function userDataPath(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qcut-reopen-"));
	directories.push(directory);
	return directory;
}

const projectId = "08437513-2be1-4c4b-a7a3-7d2b6b0ad6a9";
const editorUrl = `app://./index.html#/editor/${projectId}`;
const projectsUrl = "app://./index.html#/projects";

function leftOpenBy({ dir, version }: { dir: string; version: string }) {
	rememberOpenProject({
		userDataPath: dir,
		url: editorUrl,
		packageVersion: version,
	});
}

function logger() {
	return { log: vi.fn(), warn: vi.fn() };
}

afterEach(() => {
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("reopening the project after an update", () => {
	it("reads the project from the editor's address", () => {
		expect(projectIdFromEditorUrl(editorUrl)).toBe(projectId);
		expect(
			projectIdFromEditorUrl("app://./index.html#/editor/p1?panel=media")
		).toBe("p1");
		expect(projectIdFromEditorUrl(projectsUrl)).toBe(undefined);
	});

	it("opens it on a launch of another version, once it has opened", async () => {
		const dir = userDataPath();
		leftOpenBy({ dir, version: "2026.10.3001" });
		// A restart of the same version opens nothing by itself.
		expect(
			pendingProjectToReopen({
				userDataPath: dir,
				packageVersion: "2026.10.3001",
			})
		).toBeUndefined();
		expect(
			pendingProjectToReopen({
				userDataPath: dir,
				packageVersion: "2026.10.3002",
			})
		).toBe(projectId);

		const open = vi.fn(async () => ({ navigated: true }));
		const log = logger();
		await reopenProjectAfterUpdate({
			userDataPath: dir,
			packageVersion: "2026.10.3002",
			open,
			logger: log,
		});
		expect(open).toHaveBeenCalledWith(projectId);
		expect(log.log).toHaveBeenCalledWith(
			`[UpdateHistory] Reopened project ${projectId} after the update`
		);
		expect(
			pendingProjectToReopen({
				userDataPath: dir,
				packageVersion: "2026.10.3002",
			})
		).toBeUndefined();
	});

	it("leaves it to the next launch when the editor was not ready", async () => {
		const dir = userDataPath();
		leftOpenBy({ dir, version: "2026.10.3001" });
		const log = logger();
		await reopenProjectAfterUpdate({
			userDataPath: dir,
			packageVersion: "2026.10.3002",
			open: async () => {
				throw new Error("QCut's editor was not ready within 30s");
			},
			logger: log,
		});
		expect(log.warn).toHaveBeenCalledWith(
			`[UpdateHistory] Could not reopen project ${projectId} after the update (the next launch tries again): QCut's editor was not ready within 30s`
		);
		expect(
			pendingProjectToReopen({
				userDataPath: dir,
				packageVersion: "2026.10.3002",
			})
		).toBe(projectId);
	});

	it("keeps it when the empty startup window closes during the reopen", async () => {
		const dir = userDataPath();
		leftOpenBy({ dir, version: "2026.10.3001" });
		const win = Object.assign(new EventEmitter(), {
			webContents: { getURL: () => projectsUrl },
		});
		trackOpenProject({
			win,
			userDataPath: dir,
			packageVersion: "2026.10.3002",
		});
		await reopenProjectAfterUpdate({
			userDataPath: dir,
			packageVersion: "2026.10.3002",
			open: async () => {
				win.emit("close");
				throw new Error(
					"QCut's window closed before the editor finished loading"
				);
			},
			logger: logger(),
		});
		expect(
			pendingProjectToReopen({
				userDataPath: dir,
				packageVersion: "2026.10.3002",
			})
		).toBe(projectId);
	});

	it("forgets it when the editor refuses it, or a window closes on the list", async () => {
		const dir = userDataPath();
		leftOpenBy({ dir, version: "2026.10.3001" });
		const log = logger();
		await reopenProjectAfterUpdate({
			userDataPath: dir,
			packageVersion: "2026.10.3002",
			open: async () => ({ navigated: false, error: "Project not found" }),
			logger: log,
		});
		expect(log.warn).toHaveBeenCalledWith(
			`[UpdateHistory] Could not reopen project ${projectId} after the update: Project not found`
		);
		expect(
			pendingProjectToReopen({
				userDataPath: dir,
				packageVersion: "2026.10.3002",
			})
		).toBeUndefined();

		leftOpenBy({ dir, version: "2026.10.3001" });
		const win = Object.assign(new EventEmitter(), {
			webContents: { getURL: () => projectsUrl },
		});
		trackOpenProject({
			win,
			userDataPath: dir,
			packageVersion: "2026.10.3002",
		});
		win.emit("close");
		expect(
			pendingProjectToReopen({
				userDataPath: dir,
				packageVersion: "2026.10.3002",
			})
		).toBeUndefined();
	});
});
