import { beforeEach, describe, expect, it, vi } from "vitest";

/** The desktop app's side: the notes it hands out, and the project folder. */
const desktop = vi.hoisted(() => ({
	/** What the app answers when asked for a project's notes. */
	notes: new Map<string, unknown[]>(),
	/** What it was asked to drop, and whether it says the note is gone. */
	asked: [] as unknown[],
	keeps: false,
	/** Whether this is the desktop app at all. */
	isDesktop: true,
	/** What each path has: a file as the platform shows it, or an error. */
	files: new Map<string, unknown>(),
}));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({
		...(desktop.isDesktop
			? {
					claude: {
						media: {
							unsettledRenames: async (projectId: string) =>
								desktop.notes.get(projectId) ?? [],
							forgetSettledRename: async (request: unknown) => {
								desktop.asked.push(request);
								return !desktop.keeps;
							},
						},
					},
				}
			: {}),
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
	whereNotedFileIs,
	whoseItemIs,
} from "../media-rename-notes";

const OLD = "media_b2xkLm1wNA";
const NEW = "media_bmV3Lm1wNA";
const OLD_PATH = "/projects/project-1/media/old.mp4";
const NEW_PATH = "/projects/project-1/media/new.mp4";
/** A note of a rename the desktop app is not at work on. */
const NOTE: UnsettledRename = {
	oldId: OLD,
	oldName: "old.mp4",
	oldPath: OLD_PATH,
	newId: NEW,
	newName: "new.mp4",
	newPath: NEW_PATH,
	notedAt: 0,
	atWork: false,
};
const CHANGED = new Date("2026-11-01T08:00:00.123Z");
const SEEN = { size: 4096, modifiedAt: CHANGED.getTime() };

describe("the notes of unsettled renames", () => {
	beforeEach(() => {
		desktop.notes.clear();
		desktop.asked.length = 0;
		desktop.keeps = false;
		desktop.isDesktop = true;
	});

	it("reads a project's notes as the desktop app hands them out", async () => {
		const third = { ...NOTE, newId: "media_third", newPath: "/p/third.mp4" };
		desktop.notes.set("project-1", [
			{ ...NOTE, file: SEEN, fileIs: "new", beganAt: 1234 },
			{ ...third, atWork: true },
		]);
		expect(await readUnsettledRenames("project-1")).toEqual([
			{ ...NOTE, file: SEEN, fileIs: "new", beganAt: 1234 },
			{ ...third, atWork: true },
		]);
		// Another project's notes are its own.
		expect(await readUnsettledRenames("project-2")).toEqual([]);
	});

	it("finds the note of a rename by its two ids, whichever way round", async () => {
		const found = { ...NOTE, file: SEEN, fileIs: "new" as const };
		desktop.notes.set("project-1", [found]);
		expect(
			await readUnsettledRename({ projectId: "project-1", rename: NOTE })
		).toEqual(found);
		// A rename and its undoing are one matter: one note either way round.
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

	/**
	 * Only the app's plain "no" lets the editor settle a rename: whatever
	 * else it says of being at work is taken for a yes.
	 */
	it("takes the app to be at work on a rename unless it says that it is not", async () => {
		const { atWork: _atWork, ...unsaid } = NOTE;
		desktop.notes.set("project-1", [unsaid]);
		expect(await readUnsettledRenames("project-1")).toEqual([
			{ ...NOTE, atWork: true },
		]);
		desktop.notes.set("project-1", [{ ...NOTE, atWork: "no" }]);
		expect((await readUnsettledRenames("project-1"))[0].atWork).toBe(true);
	});

	it("reads nothing from what is not a note, and leaves out what a note says wrongly", async () => {
		desktop.notes.set("project-1", [{ newId: NEW }, [NOTE], null, "note"]);
		expect(await readUnsettledRenames("project-1")).toEqual([]);

		desktop.notes.set("project-1", [
			{
				...NOTE,
				file: { size: "large" },
				fileIs: "somewhere",
				beganAt: "yesterday",
			},
		]);
		expect(await readUnsettledRenames("project-1")).toEqual([NOTE]);
	});

	/**
	 * The app drops a note for the editor, and keeps it when it is at work
	 * on the rename again or has written the note since: the editor says
	 * which note it settled, by the time the note was written.
	 */
	it("has the app drop the note it settled, and says whether it is gone", async () => {
		expect(
			await forgetUnsettledRename({
				projectId: "project-1",
				rename: { ...NOTE, notedAt: 1731830400000 },
			})
		).toBe(true);
		expect(desktop.asked).toEqual([
			{
				projectId: "project-1",
				oldId: OLD,
				newId: NEW,
				notedAt: 1731830400000,
			},
		]);

		desktop.keeps = true;
		expect(
			await forgetUnsettledRename({ projectId: "project-1", rename: NOTE })
		).toBe(false);
	});

	it("has no notes, and drops none, where there is no desktop app", async () => {
		desktop.isDesktop = false;
		desktop.notes.set("project-1", [NOTE]);
		expect(await readUnsettledRenames("project-1")).toEqual([]);
		expect(
			await forgetUnsettledRename({ projectId: "project-1", rename: NOTE })
		).toBe(false);
	});
});

/**
 * Another file has taken the name the renamed file left, and the project
 * holds an item under that name's id: the renamed file's own, which the
 * editor has not brought over, or an item of the other file.
 */
describe("whose an item under the name the renamed file left is", () => {
	const BEGAN_AT = Date.parse("2026-11-10T12:00:00.000Z");
	const note = { ...NOTE, file: SEEN, beganAt: BEGAN_AT };
	/** An item as long as its copy is, with what it records of its file. */
	const item = (sourceFile?: Record<string, unknown>, bytes = 7) => ({
		file: new File(["x".repeat(bytes)], "old.mp4"),
		...(sourceFile ? { metadata: { sourceFile } } : {}),
	});
	const before = BEGAN_AT - 1;
	const since = BEGAN_AT;

	it("is the renamed file's when it was held before the rename began and was copied from a file of that look", () => {
		expect(
			whoseItemIs({ item: item({ ...SEEN, heldSince: before }), note })
		).toBe("the renamed file's");
	});

	/**
	 * A file of the same size and time that took the name afterwards: the
	 * same clip brought in a second time. Its look says nothing.
	 */
	it("is not known when a file of that look was copied since the rename began", () => {
		expect(
			whoseItemIs({ item: item({ ...SEEN, heldSince: since }), note })
		).toBe("unknown");
	});

	it("is not known when the record or the note leaves out the time", () => {
		expect(whoseItemIs({ item: item(SEEN), note })).toBe("unknown");
		expect(
			whoseItemIs({
				item: item({ ...SEEN, heldSince: before }),
				note: { ...NOTE, file: SEEN },
			})
		).toBe("unknown");
	});

	it("is another file's when it was copied from a file of another look, and not before the rename", () => {
		const another = { size: 512, modifiedAt: SEEN.modifiedAt };
		expect(
			whoseItemIs({ item: item({ ...another, heldSince: since }), note })
		).toBe("another file's");
		// Recorded before the time was kept: the look is all there is.
		expect(whoseItemIs({ item: item(another), note })).toBe("another file's");
	});

	it("is not known when it was held before the rename, and copied from a file of another look", () => {
		expect(
			whoseItemIs({
				item: item({ size: 512, modifiedAt: 1, heldSince: before }),
				note,
			})
		).toBe("unknown");
	});

	it("goes by the length of the copy for an item with no record: another length is another file's, the same length says nothing", () => {
		expect(whoseItemIs({ item: item(undefined, 7), note })).toBe(
			"another file's"
		);
		expect(whoseItemIs({ item: item(undefined, SEEN.size), note })).toBe(
			"unknown"
		);
	});

	it("is not known when nothing was noted of the renamed file", () => {
		expect(
			whoseItemIs({
				item: item({ ...SEEN, heldSince: before }),
				note: { ...NOTE, beganAt: BEGAN_AT },
			})
		).toBe("unknown");
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
	 * later note could not be written, or it ended. The file may have stayed
	 * renamed, with another file under its old name; or gone back, with
	 * another file under the new one. Both leave a file under each name, and
	 * when the two look alike, neither name is taken without evidence.
	 */
	it("is unclear when the app never said, and the two cannot be told apart", async () => {
		desktop.files.set(OLD_PATH, theFile);
		desktop.files.set(NEW_PATH, theFile);
		expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toBe("unclear");
		// Neither looks like it.
		desktop.files.set(OLD_PATH, another);
		desktop.files.set(NEW_PATH, another);
		expect(await whereNotedFileIs({ ...NOTE, file: SEEN })).toBe("unclear");
		// Nothing was noted of the file.
		desktop.files.set(NEW_PATH, theFile);
		expect(await whereNotedFileIs(NOTE)).toBe("unclear");
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
