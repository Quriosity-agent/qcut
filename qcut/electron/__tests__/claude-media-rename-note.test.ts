import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => testState.userData) },
}));

import {
	forgetUnsettledMediaRename,
	noteUnsettledMediaRename,
	unsettledRenameKey,
} from "../claude/handlers/claude-media-rename-note.js";

const OLD = "media_b2xkLm1wNA";
const NEW = "media_bmV3Lm1wNA";
/**
 * The key of the note for these two ids. The editor reads and removes notes
 * under the same key (media-rename-notes.test.ts has this literal too): a
 * key made differently here would be a note nobody finds.
 */
const KEY = "media-rename-unsettled-project-1-a3cbdd9407c9b3ca14077f6663acc643";

describe("the desktop app's note of a rename the editor may not have settled", () => {
	let mediaFolder = "";
	/** The rename of old.mp4 to new.mp4 in the test's media folder. */
	const renamed = () => ({
		previous: {
			id: OLD,
			name: "old.mp4",
			path: path.join(mediaFolder, "old.mp4"),
		},
		id: NEW,
		name: "new.mp4",
		path: path.join(mediaFolder, "new.mp4"),
	});
	const stored = async () =>
		JSON.parse(
			await fs.readFile(
				path.join(testState.userData, "projects", `${KEY}.json`),
				"utf8"
			)
		);

	beforeEach(async () => {
		testState.userData = await fs.mkdtemp(
			path.join(os.tmpdir(), "qcut-rename-note-")
		);
		mediaFolder = path.join(testState.userData, "media");
		await fs.mkdir(mediaFolder);
	});

	afterEach(async () => {
		await fs.rm(testState.userData, { recursive: true, force: true });
	});

	it("makes the key the editor's notes are kept under", () => {
		expect(
			unsettledRenameKey({ projectId: "project-1", newId: NEW, oldId: OLD })
		).toBe(KEY);
		// A rename and its undoing are one matter: one note either way round.
		expect(
			unsettledRenameKey({ projectId: "project-1", newId: OLD, oldId: NEW })
		).toBe(KEY);
		expect(
			unsettledRenameKey({ projectId: "project-2", newId: NEW, oldId: OLD })
		).not.toBe(KEY);
	});

	it("writes the note where the app's key-value store keeps its records", async () => {
		const before = Date.now();
		await noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
		});
		const note = await stored();
		expect(note).toMatchObject({
			newId: NEW,
			newName: "new.mp4",
			newPath: renamed().path,
			oldId: OLD,
			oldName: "old.mp4",
			oldPath: renamed().previous.path,
		});
		expect(note.notedAt).toBeGreaterThanOrEqual(before);
		// The file may still move: the app has not said where it left it.
		expect(note).not.toHaveProperty("fileIs");
		// No file to look at: nothing is said of it.
		expect(note).not.toHaveProperty("file");
	});

	/**
	 * Another file can take one of the two names before the editor settles
	 * the rename. The note says what the renamed file looked like, as the
	 * editor is shown a file (its size, and the time it was changed in
	 * whole milliseconds).
	 */
	it("says what the renamed file looks like, wherever it is by then", async () => {
		// Noted before the file is moved: it has its old name still.
		await fs.writeFile(renamed().previous.path, "the renamed picture");
		const changed = new Date("2026-11-01T08:00:00.123Z");
		await fs.utimes(renamed().previous.path, changed, changed);
		const seen = { size: 19, modifiedAt: changed.getTime() };
		await noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
			stage: "moving",
		});
		expect((await stored()).file).toEqual(seen);

		await fs.rename(renamed().previous.path, renamed().path);
		await noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
			stage: "moving",
		});
		expect((await stored()).file).toEqual(seen);

		await noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
			stage: "stays",
		});
		expect((await stored()).file).toEqual(seen);

		// Put back: it is looked at under its old name, and another file
		// that took the new name since is not taken for it.
		await fs.rename(renamed().path, renamed().previous.path);
		await fs.writeFile(renamed().path, "another file altogether");
		await noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
			stage: "back",
		});
		expect((await stored()).file).toEqual(seen);
	});

	/**
	 * The two names keep their places in the note whatever becomes of the
	 * file: which one it had before, which one the rename gave it. Where the
	 * app left it is said beside them.
	 */
	it("says that the file is under its old name once it is back", async () => {
		await noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
			stage: "back",
		});
		expect(await stored()).toMatchObject({
			oldId: OLD,
			oldPath: renamed().previous.path,
			newId: NEW,
			newPath: renamed().path,
			fileIs: "old",
		});
	});

	it("says that the file is under its new name when it could not be put back", async () => {
		await noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
		});
		await noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
			stage: "stays",
		});
		// One note for the rename, saying the latest.
		expect(await fs.readdir(path.join(testState.userData, "projects"))).toEqual(
			[`${KEY}.json`]
		);
		expect(await stored()).toMatchObject({
			oldId: OLD,
			oldName: "old.mp4",
			oldPath: renamed().previous.path,
			newId: NEW,
			newName: "new.mp4",
			newPath: renamed().path,
			fileIs: "new",
		});
	});

	it("drops the note, and has nothing to drop where none is", async () => {
		await noteUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
		});
		await forgetUnsettledMediaRename({
			projectId: "project-1",
			renamed: renamed(),
		});
		expect(await fs.readdir(path.join(testState.userData, "projects"))).toEqual(
			[]
		);
		await expect(
			forgetUnsettledMediaRename({ projectId: "project-1", renamed: renamed() })
		).resolves.toBeUndefined();
	});

	it("fits a key into a file name whatever the length of the ids", () => {
		const long = `media_${"长".repeat(200)}`;
		const key = unsettledRenameKey({
			projectId: "0d27ff43-87c9-4980-94cc-dd29dbb5b75e",
			newId: long,
			oldId: `${long}_2`,
		});
		expect(Buffer.byteLength(`${key}.json`)).toBeLessThan(255);
	});
});
