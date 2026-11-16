import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ documentsRoot: "" }));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => testState.documentsRoot) },
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	},
}));

vi.mock("electron-log", () => ({
	default: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}));

import { listMediaFiles } from "../claude/handlers/claude-media-handler.js";
import {
	MediaNotFoundError,
	renameMediaFileOnDisk,
	undoMediaRename,
} from "../claude/handlers/claude-media-rename.js";

const PROJECT_ID = "media-rename-test";
const idOf = (name: string) =>
	`media_${Buffer.from(name).toString("base64url")}`;

function mediaDirectory(): string {
	return path.join(
		testState.documentsRoot,
		"QCut",
		"Projects",
		PROJECT_ID,
		"media"
	);
}

async function mediaNames(): Promise<string[]> {
	return (await listMediaFiles(PROJECT_ID)).map((file) => file.name).sort();
}

describe("renaming a media file in the project folder", () => {
	beforeEach(async () => {
		testState.documentsRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "qcut-media-rename-")
		);
		await fs.mkdir(mediaDirectory(), { recursive: true });
		await fs.writeFile(path.join(mediaDirectory(), "震屏01_踹盾.mp4"), "shake");
		await fs.writeFile(path.join(mediaDirectory(), "taken.mp4"), "taken");
	});

	afterEach(async () => {
		await fs.rm(testState.documentsRoot, { recursive: true, force: true });
	});

	it("says where the file was and what its new id is", async () => {
		const renamed = await renameMediaFileOnDisk({
			projectId: PROJECT_ID,
			mediaId: idOf("震屏01_踹盾.mp4"),
			newName: "震屏01_踹盾_v2",
		});
		expect(renamed).toEqual({
			previous: {
				id: idOf("震屏01_踹盾.mp4"),
				name: "震屏01_踹盾.mp4",
				path: path.join(mediaDirectory(), "震屏01_踹盾.mp4"),
			},
			// The extension is kept when the new name has none.
			id: idOf("震屏01_踹盾_v2.mp4"),
			name: "震屏01_踹盾_v2.mp4",
			path: path.join(mediaDirectory(), "震屏01_踹盾_v2.mp4"),
		});
		expect(await mediaNames()).toEqual(["taken.mp4", "震屏01_踹盾_v2.mp4"]);
		expect(await fs.readFile(renamed.path, "utf8")).toBe("shake");
	});

	it("throws for an id that is not in the project", async () => {
		await expect(
			renameMediaFileOnDisk({
				projectId: PROJECT_ID,
				mediaId: idOf("missing.mp4"),
				newName: "anything.mp4",
			})
		).rejects.toBeInstanceOf(MediaNotFoundError);
		expect(await mediaNames()).toEqual(["taken.mp4", "震屏01_踹盾.mp4"]);
	});

	it("leaves a file alone when it is renamed to its own name", async () => {
		const renamed = await renameMediaFileOnDisk({
			projectId: PROJECT_ID,
			mediaId: idOf("taken.mp4"),
			newName: "taken.mp4",
		});
		expect(renamed.id).toBe(renamed.previous.id);
		expect(renamed.path).toBe(renamed.previous.path);
		// It used to come back as taken_1.mp4: its own name counted as taken.
		expect(await mediaNames()).toEqual(["taken.mp4", "震屏01_踹盾.mp4"]);
	});

	it("gives a taken name a suffix, and refuses it when the exact name was asked for", async () => {
		await expect(
			renameMediaFileOnDisk({
				projectId: PROJECT_ID,
				mediaId: idOf("震屏01_踹盾.mp4"),
				newName: "taken.mp4",
				exactName: true,
			})
		).rejects.toThrow("taken.mp4 is already taken");
		expect(await mediaNames()).toEqual(["taken.mp4", "震屏01_踹盾.mp4"]);

		const renamed = await renameMediaFileOnDisk({
			projectId: PROJECT_ID,
			mediaId: idOf("震屏01_踹盾.mp4"),
			newName: "taken.mp4",
		});
		expect(renamed.name).toBe("taken_1.mp4");
		expect(renamed.id).toBe(idOf("taken_1.mp4"));
	});

	it("puts a renamed file back under the name and id it had", async () => {
		const renamed = await renameMediaFileOnDisk({
			projectId: PROJECT_ID,
			mediaId: idOf("震屏01_踹盾.mp4"),
			newName: "renamed.mp4",
		});
		await undoMediaRename({ projectId: PROJECT_ID, renamed });
		expect(await mediaNames()).toEqual(["taken.mp4", "震屏01_踹盾.mp4"]);
		const back = (await listMediaFiles(PROJECT_ID)).find(
			(file) => file.name === "震屏01_踹盾.mp4"
		);
		expect(back?.id).toBe(idOf("震屏01_踹盾.mp4"));
		expect(await fs.readFile(renamed.previous.path, "utf8")).toBe("shake");
	});

	it("does not write over a file that took the old name meanwhile", async () => {
		const renamed = await renameMediaFileOnDisk({
			projectId: PROJECT_ID,
			mediaId: idOf("震屏01_踹盾.mp4"),
			newName: "renamed.mp4",
		});
		await fs.writeFile(renamed.previous.path, "someone else");
		await expect(
			undoMediaRename({ projectId: PROJECT_ID, renamed })
		).rejects.toThrow("was taken again");
		expect(await fs.readFile(renamed.previous.path, "utf8")).toBe(
			"someone else"
		);
		expect(await fs.readFile(renamed.path, "utf8")).toBe("shake");
	});
});
