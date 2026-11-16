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
	noteUnsettledRename,
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
const NOTE: UnsettledRename = {
	oldId: OLD,
	oldName: "old.mp4",
	oldPath: OLD_PATH,
	newId: NEW,
	newName: "new.mp4",
	newPath: NEW_PATH,
	notedAt: 0,
};
/** The same rename, with the file expected under its new name. */
const NOTE_FILE_STAYS: UnsettledRename = {
	oldId: NEW,
	oldName: "new.mp4",
	oldPath: NEW_PATH,
	newId: OLD,
	newName: "old.mp4",
	newPath: OLD_PATH,
	notedAt: 7,
};
const CHANGED = new Date("2026-11-01T08:00:00.123Z");
const SEEN = { size: 4096, modifiedAt: CHANGED.getTime() };

describe("the notes of unsettled renames", () => {
	beforeEach(() => {
		desktop.stored.clear();
	});

	it("keeps each note under a key of its own, made of the project and the two ids", async () => {
		expect(
			await unsettledRenameKey({ projectId: "project-1", rename: NOTE })
		).toBe(NOTES);
		// A rename and its undoing are one matter: one note either way round.
		expect(
			await unsettledRenameKey({
				projectId: "project-1",
				rename: NOTE_FILE_STAYS,
			})
		).toBe(NOTES);
		await noteUnsettledRename({ projectId: "project-1", rename: NOTE });
		expect(desktop.stored.get(NOTES)).toEqual(NOTE);
	});

	it("keeps one note for a pair of ids, and none once it is forgotten", async () => {
		await noteUnsettledRename({ projectId: "project-1", rename: NOTE });
		await noteUnsettledRename({
			projectId: "project-1",
			rename: { ...NOTE, newId: "media_third", newPath: "/p/third.mp4" },
		});
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

	/**
	 * The desktop app notes a rename before the editor can: it has seen the
	 * file, and says when it is done with it. The editor's own note of the
	 * same matter must not take that away.
	 */
	it("keeps the note that is there when it expects the file under the same name", async () => {
		const fromApp = { ...NOTE, file: SEEN, decided: true, notedAt: 3 };
		desktop.stored.set(NOTES, fromApp);
		await noteUnsettledRename({
			projectId: "project-1",
			rename: { ...NOTE, notedAt: 99 },
		});
		expect(desktop.stored.get(NOTES)).toEqual(fromApp);
	});

	it("replaces a note that expects the other name, and keeps what it knew of the file", async () => {
		desktop.stored.set(NOTES, { ...NOTE, file: SEEN });
		await noteUnsettledRename({
			projectId: "project-1",
			rename: NOTE_FILE_STAYS,
		});
		expect(desktop.stored.get(NOTES)).toEqual({
			...NOTE_FILE_STAYS,
			file: SEEN,
		});
		expect(await readUnsettledRenames("project-1")).toHaveLength(1);
	});

	/**
	 * The editor was asked to go back to the old id and took its time; the
	 * file could not be put back meanwhile, and the desktop app noted that
	 * it stays. The editor then fails, and would note that the file is
	 * expected under its old name: what the request wanted, no longer what
	 * is so.
	 */
	it("keeps a note the desktop app is done with, though it expects the other name", async () => {
		const fromApp = { ...NOTE_FILE_STAYS, file: SEEN, decided: true };
		desktop.stored.set(NOTES, fromApp);
		await noteUnsettledRename({
			projectId: "project-1",
			rename: { ...NOTE, notedAt: 99 },
		});
		expect(desktop.stored.get(NOTES)).toEqual(fromApp);
	});

	it("keeps every note when several are written at once", async () => {
		await Promise.all(
			["a", "b", "c"].map((name) =>
				noteUnsettledRename({
					projectId: "project-1",
					rename: { ...NOTE, newId: `media_${name}` },
				})
			)
		);
		expect(await readUnsettledRenames("project-1")).toHaveLength(3);
	});

	it("reads nothing from what is not a note, and nothing of a file from what does not describe one", async () => {
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
			decided: "yes",
		});
		expect(await readUnsettledRenames("project-1")).toEqual([NOTE]);
		desktop.stored.set(NOTES, { ...NOTE, file: SEEN, decided: true });
		expect(await readUnsettledRenames("project-1")).toEqual([
			{ ...NOTE, file: SEEN, decided: true },
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

	it("is the name that alone has a file, whatever that file looks like", async () => {
		desktop.files.set(OLD_PATH, another);
		expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toEqual(
			alone("old")
		);
		desktop.files.clear();
		desktop.files.set(NEW_PATH, another);
		expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toEqual(
			alone("new")
		);
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
	 * renamed file is the one that looks as the desktop app noted it.
	 */
	it("tells the renamed file from another file by its size and the time it was changed", async () => {
		desktop.files.set(OLD_PATH, another);
		desktop.files.set(NEW_PATH, theFile);
		expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toEqual(
			besideAnother("new")
		);

		desktop.files.set(OLD_PATH, theFile);
		desktop.files.set(NEW_PATH, another);
		expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toEqual(
			besideAnother("old")
		);
	});

	it("takes the name the note expects when that does not tell them apart", async () => {
		desktop.files.set(OLD_PATH, theFile);
		desktop.files.set(NEW_PATH, theFile);
		expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toEqual(
			besideAnother("old")
		);
		// Neither looks like it any more.
		desktop.files.set(OLD_PATH, another);
		desktop.files.set(NEW_PATH, { ...theFile, size: 1 });
		expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toEqual(
			besideAnother("old")
		);
		// Nothing was noted of the file.
		desktop.files.set(NEW_PATH, theFile);
		expect(await whereNotedFileIs(NOTE)).toEqual(besideAnother("old"));
	});

	it("reads the time a file was changed as a date, a number or a date in writing", async () => {
		desktop.files.set(OLD_PATH, another);
		for (const shown of [
			{ size: SEEN.size, modified: CHANGED },
			{ size: SEEN.size, modifiedAt: CHANGED.getTime() },
			{ size: SEEN.size, lastModified: CHANGED.toISOString() },
		]) {
			desktop.files.set(NEW_PATH, shown);
			expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toEqual(
				besideAnother("new")
			);
		}
	});
});
