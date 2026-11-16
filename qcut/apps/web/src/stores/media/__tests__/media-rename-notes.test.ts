import { beforeEach, describe, expect, it, vi } from "vitest";

/** The desktop app's key-value store and its view of the project folder. */
const desktop = vi.hoisted(() => ({
	stored: new Map<string, unknown>(),
	/** What each path has: a file as the platform shows it, or an error. */
	files: new Map<string, unknown>(),
}));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({
		storage: {
			load: async (key: string) => desktop.stored.get(key) ?? null,
			save: async (key: string, value: unknown) => {
				desktop.stored.set(key, value);
				return true;
			},
			remove: async (key: string) => desktop.stored.delete(key),
			list: async () => [...desktop.stored.keys()],
		},
		files: {
			getFileInfo: async (filePath: string) => {
				const shown = desktop.files.get(filePath);
				if (shown instanceof Error) throw shown;
				if (shown === undefined) {
					// As the desktop app answers a file that is not there.
					throw new Error(
						`ENOENT: no such file or directory, stat '${filePath}'`
					);
				}
				return shown;
			},
		},
	}),
}));

import {
	forgetUnsettledRename,
	readUnsettledRename,
	readUnsettledRenames,
	type UnsettledRename,
	unsettledRenameKey,
	whereNotedFileIs,
} from "../media-rename-notes";

const OLD = "media_b2xkLm1wNA";
const NEW = "media_bmV3Lm1wNA";
const OLD_PATH = "/projects/project-1/media/old.mp4";
const NEW_PATH = "/projects/project-1/media/new.mp4";
/**
 * The key of the note for the two ids above. The desktop app writes notes
 * under the same key (claude-media-rename-note.test.ts has this literal too).
 */
const NOTES =
	"media-rename-unsettled-project-1-a3cbdd9407c9b3ca14077f6663acc643";
/** A note as the desktop app writes it before it moves the file. */
const NOTE: UnsettledRename = {
	oldId: OLD,
	oldName: "old.mp4",
	oldPath: OLD_PATH,
	newId: NEW,
	newName: "new.mp4",
	newPath: NEW_PATH,
	notedAt: 0,
};
const CHANGED = new Date("2026-11-01T08:00:00.123Z");
const SEEN = { size: 4096, modifiedAt: CHANGED.getTime() };

describe("the notes of unsettled renames", () => {
	beforeEach(() => {
		desktop.stored.clear();
	});

	it("finds each note under a key of its own, made of the project and the two ids", async () => {
		expect(
			await unsettledRenameKey({ projectId: "project-1", rename: NOTE })
		).toBe(NOTES);
		// A rename and its undoing are one matter: one note either way round.
		expect(
			await unsettledRenameKey({
				projectId: "project-1",
				rename: { oldId: NEW, newId: OLD },
			})
		).toBe(NOTES);
		expect(
			await unsettledRenameKey({ projectId: "project-2", rename: NOTE })
		).not.toBe(NOTES);

		desktop.stored.set(NOTES, { ...NOTE, file: SEEN, fileIs: "new" });
		const found = { ...NOTE, file: SEEN, fileIs: "new" };
		expect(
			await readUnsettledRename({ projectId: "project-1", rename: NOTE })
		).toEqual(found);
		expect(
			await readUnsettledRename({
				projectId: "project-1",
				rename: { oldId: NEW, newId: OLD },
			})
		).toEqual(found);
		expect(
			await readUnsettledRename({
				projectId: "project-1",
				rename: { oldId: OLD, newId: "media_third" },
			})
		).toBeUndefined();
	});

	it("reads a project's notes, and drops one by its two ids", async () => {
		const third = { ...NOTE, newId: "media_third", newPath: "/p/third.mp4" };
		desktop.stored.set(NOTES, NOTE);
		desktop.stored.set(
			await unsettledRenameKey({ projectId: "project-1", rename: third }),
			third
		);
		expect(
			(await readUnsettledRenames("project-1")).map((note) => note.newId).sort()
		).toEqual([NEW, "media_third"]);
		// Another project's notes are its own.
		expect(await readUnsettledRenames("project-2")).toEqual([]);

		await forgetUnsettledRename({ projectId: "project-1", rename: NOTE });
		await forgetUnsettledRename({
			projectId: "project-1",
			rename: { newId: OLD, oldId: "media_third" },
		});
		expect(desktop.stored.size).toBe(0);
	});

	it("reads nothing from what is not a note, and leaves out what a note says wrongly", async () => {
		desktop.stored.set("media-rename-unsettled-project-1-junk", {
			newId: NEW,
		});
		desktop.stored.set("media-rename-unsettled-project-1-list", [NOTE]);
		// Not a note of this project at all.
		desktop.stored.set("overlay-stickers-project-1", [NOTE]);
		expect(await readUnsettledRenames("project-1")).toEqual([]);

		desktop.stored.set(NOTES, {
			...NOTE,
			file: { size: "large" },
			fileIs: "somewhere",
		});
		expect(await readUnsettledRenames("project-1")).toEqual([NOTE]);
		desktop.stored.set(NOTES, { ...NOTE, file: SEEN, fileIs: "old" });
		expect(await readUnsettledRenames("project-1")).toEqual([
			{ ...NOTE, file: SEEN, fileIs: "old" },
		]);
	});
});

describe("which of a note's two names the file has", () => {
	const theFile = { size: SEEN.size, modified: CHANGED };
	const another = { size: 512, modified: new Date("2026-11-17T09:30:00Z") };
	/** The renamed file has the name, and the other name has no file. */
	const alone = (name: "old" | "new") => ({ name, otherNameTaken: false });
	/** It has the name, and another file has the other one. */
	const besideAnother = (name: "old" | "new") => ({
		name,
		otherNameTaken: true,
	});

	beforeEach(() => {
		desktop.files.clear();
	});

	it("is the name that alone has a file, whatever that file looks like and whatever the app said", async () => {
		desktop.files.set(OLD_PATH, another);
		expect(
			await whereNotedFileIs({ ...NOTE, file: SEEN, fileIs: "new" })
		).toEqual(alone("old"));
		desktop.files.clear();
		desktop.files.set(NEW_PATH, another);
		expect(
			await whereNotedFileIs({ ...NOTE, file: SEEN, fileIs: "old" })
		).toEqual(alone("new"));
	});

	it("is nowhere with a file under neither name, and unknown when the folder cannot be asked", async () => {
		expect(await whereNotedFileIs(NOTE)).toBe("nowhere");
		desktop.files.set(OLD_PATH, theFile);
		desktop.files.set(
			NEW_PATH,
			new Error("Error invoking remote method 'get-file-info'")
		);
		expect(await whereNotedFileIs(NOTE)).toBeUndefined();
	});

	/**
	 * Both names have a file when another file took one of them: the
	 * renamed file is the one that looks as the desktop app noted it,
	 * wherever the app meant to leave it.
	 */
	it("tells the renamed file from another file by its size and the time it was changed", async () => {
		desktop.files.set(OLD_PATH, another);
		desktop.files.set(NEW_PATH, theFile);
		expect(
			await whereNotedFileIs({ ...NOTE, file: SEEN, fileIs: "old" })
		).toEqual(besideAnother("new"));

		desktop.files.set(OLD_PATH, theFile);
		desktop.files.set(NEW_PATH, another);
		expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toEqual(
			besideAnother("old")
		);
	});

	it("is where the app left it when the two files cannot be told apart", async () => {
		desktop.files.set(OLD_PATH, theFile);
		desktop.files.set(NEW_PATH, theFile);
		expect(
			await whereNotedFileIs({ ...NOTE, file: SEEN, fileIs: "old" })
		).toEqual(besideAnother("old"));
		expect(
			await whereNotedFileIs({ ...NOTE, file: SEEN, fileIs: "new" })
		).toEqual(besideAnother("new"));
		// Neither looks like it any more.
		desktop.files.set(OLD_PATH, another);
		desktop.files.set(NEW_PATH, { ...theFile, size: 1 });
		expect(
			await whereNotedFileIs({ ...NOTE, file: SEEN, fileIs: "old" })
		).toEqual(besideAnother("old"));
	});

	/**
	 * The app noted the rename and never said where it left the file: its
	 * later note could not be written, or it ended. Put back under its old
	 * name, the file would have left the new one free. With a file under
	 * each, it is under the new name, and the old one is another file's.
	 */
	it("is the new name when the app never said, and the two cannot be told apart", async () => {
		desktop.files.set(OLD_PATH, theFile);
		desktop.files.set(NEW_PATH, theFile);
		expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toEqual(
			besideAnother("new")
		);
		// Nothing was noted of the file.
		desktop.files.set(OLD_PATH, another);
		expect(await whereNotedFileIs(NOTE)).toEqual(besideAnother("new"));
	});

	it("reads the time a file was changed as a date, a number or a date in writing", async () => {
		desktop.files.set(OLD_PATH, another);
		for (const shown of [
			{ size: SEEN.size, modified: CHANGED },
			{ size: SEEN.size, modifiedAt: CHANGED.getTime() },
			{ size: SEEN.size, lastModified: CHANGED.toISOString() },
		]) {
			desktop.files.set(NEW_PATH, shown);
			expect(
				await whereNotedFileIs({ ...NOTE, file: SEEN, fileIs: "old" })
			).toEqual(besideAnother("new"));
		}
	});
});
