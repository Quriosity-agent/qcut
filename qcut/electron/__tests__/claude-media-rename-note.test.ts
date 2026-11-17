import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
	userData: "",
	/** The app's store cannot be written. */
	storeIsFull: false,
	/** What the editor can ask of the app, by channel. */
	handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => testState.userData) },
	ipcMain: {
		handle: (
			channel: string,
			handler: (event: unknown, ...args: unknown[]) => unknown
		) => {
			testState.handlers.set(channel, handler);
		},
	},
}));

vi.mock("../main-ipc/storage-json.js", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("../main-ipc/storage-json.js")>();
	return {
		...real,
		writeStorageJson: async (
			...args: Parameters<typeof real.writeStorageJson>
		) => {
			if (testState.storeIsFull) throw new Error("the disk is full");
			return real.writeStorageJson(...args);
		},
	};
});

import {
	forgetMediaRenameSettledByEditor,
	forgetUnsettledMediaRename,
	listUnsettledMediaRenames,
	noLongerAtWorkOnMediaRenames,
	noteUnsettledMediaRename,
	setupMediaRenameNotesIPC,
	unsettledRenameKey,
} from "../claude/handlers/claude-media-rename-note.js";

const OLD = "media_b2xkLm1wNA";
const NEW = "media_bmV3Lm1wNA";
/** The key of the note for these two ids. */
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
		noLongerAtWorkOnMediaRenames();
		testState.storeIsFull = false;
		vi.useRealTimers();
		await fs.rm(testState.userData, { recursive: true, force: true });
	});

	it("keeps a rename's note under one key, whichever way round its two ids", () => {
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
		// When the rename began: before this note, and before the file moves.
		expect(note.beganAt).toBeGreaterThanOrEqual(before);
		expect(note.beganAt).toBeLessThanOrEqual(note.notedAt);
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

	/**
	 * A rename can take any time: a large file copied on a volume without
	 * hard links. The editor must not settle it by the folder meanwhile: it
	 * would end on a name the file is about to leave. It went by the age of
	 * the note, which the app wrote again every minute; when those writes
	 * failed, the note of a rename under way looked like one the app had
	 * left. So the app says which renames it is at work on, and that is
	 * known to it whatever becomes of its notes.
	 */
	describe("what the app is at work on", () => {
		const HOUR = 60 * 60 * 1000;
		const notes = () => listUnsettledMediaRenames({ projectId: "project-1" });
		const atWork = async () => (await notes()).map((note) => note.atWork);
		const say = (stage: "moving" | "back" | "stays" | "left", by?: string) =>
			noteUnsettledMediaRename({
				projectId: "project-1",
				renamed: renamed(),
				stage,
				...(by ? { by } : {}),
			});
		const settledByEditor = (notedAt: number) =>
			forgetMediaRenameSettledByEditor({
				projectId: "project-1",
				oldId: OLD,
				newId: NEW,
				notedAt,
			});

		it("is a rename from its first note until the app says where it left the file", async () => {
			await say("moving");
			expect(await atWork()).toEqual([true]);
			await say("back");
			expect(await atWork()).toEqual([false]);

			await say("moving");
			expect(await atWork()).toEqual([true]);
			await say("stays");
			expect(await atWork()).toEqual([false]);
		});

		it("hands the editor the notes as they are stored, with that", async () => {
			await fs.writeFile(renamed().previous.path, "the renamed picture");
			await say("moving");
			expect(await notes()).toEqual([{ ...(await stored()), atWork: true }]);
		});

		/**
		 * The copy takes hours, and the store cannot be written all that
		 * time: the note is as old as the rename. Then the editor follows,
		 * its answer is lost, the file goes back, and the app cannot write
		 * that either. The note made before the move is what is left, and
		 * has to be there still.
		 */
		it("is that rename however long it takes, though its note is never written again, and leaves the note for the editor when it ends unsaid", async () => {
			vi.useFakeTimers({
				toFake: ["Date"],
				now: new Date("2026-11-17T08:00:00.000Z"),
			});
			await say("moving");
			const first = await stored();
			testState.storeIsFull = true;

			// The project is loaded again in the middle of the copy.
			vi.setSystemTime(Date.now() + 3 * HOUR);
			expect(await notes()).toEqual([{ ...first, atWork: true }]);
			// The editor does not settle it, and could not have it dropped.
			expect(await settledByEditor(first.notedAt)).toBe(false);
			expect(await stored()).toEqual(first);

			// The file is back, and the app cannot say so.
			vi.setSystemTime(Date.now() + HOUR);
			await expect(say("back")).rejects.toThrow("the disk is full");
			await say("left");

			// What settles the two is still there, and the editor's to settle.
			expect(await notes()).toEqual([{ ...first, atWork: false }]);
			expect(first).not.toHaveProperty("fileIs");
			expect(await settledByEditor(first.notedAt)).toBe(true);
			expect(await notes()).toEqual([]);
		});

		it("is no rename once the request that was making it is over, whatever is noted", async () => {
			await say("moving");
			const last = await stored();
			await say("left");
			expect(await notes()).toEqual([{ ...last, atWork: false }]);
			// Said again, to no effect.
			await say("left");
			expect(await stored()).toEqual(last);
		});

		it("is no rename whose note is dropped by the request that made it", async () => {
			await say("moving");
			await forgetUnsettledMediaRename({
				projectId: "project-1",
				renamed: renamed(),
			});
			expect(await notes()).toEqual([]);
			// A note of the two names that turns up later is not one at work.
			await say("back");
			expect(await atWork()).toEqual([false]);
		});

		it("is no rename once the process that was making the renames is gone", async () => {
			await say("moving");
			noLongerAtWorkOnMediaRenames();
			expect(await atWork()).toEqual([false]);
		});

		/** A rename that cannot be noted is not made. */
		it("is no rename that could not be noted", async () => {
			testState.storeIsFull = true;
			await expect(say("moving")).rejects.toThrow("the disk is full");
			testState.storeIsFull = false;
			expect(await notes()).toEqual([]);
			// Nor does it stand in the way of the next try.
			await say("moving", "another request");
			expect(await atWork()).toEqual([true]);
		});

		it("keeps the moment the rename began through all its notes", async () => {
			vi.useFakeTimers({
				toFake: ["Date"],
				now: new Date("2026-11-17T08:00:00.000Z"),
			});
			const began = Date.now();
			await say("moving");
			vi.setSystemTime(began + HOUR);
			await say("stays");
			const last = await stored();
			expect(last).toMatchObject({ beganAt: began, fileIs: "new" });
			expect(last.notedAt).toBeGreaterThanOrEqual(began + HOUR);
		});

		it("gives no two notes the same time", async () => {
			vi.useFakeTimers({
				toFake: ["Date"],
				now: new Date("2026-11-17T08:00:00.000Z"),
			});
			await say("moving");
			const first = (await stored()).notedAt;
			await say("moving");
			const second = (await stored()).notedAt;
			await say("back");
			const third = (await stored()).notedAt;
			expect(second).toBeGreaterThan(first);
			expect(third).toBeGreaterThan(second);
		});

		/**
		 * Two requests rename one file at once. The second took the first's
		 * note for its own: when its move failed it dropped that note, in the
		 * middle of the first one's rename.
		 */
		it("does not begin a rename another request is making, and leaves that request's alone", async () => {
			await say("moving", "first");
			const first = await stored();

			await expect(say("moving", "second")).rejects.toThrow(
				"Another request is renaming old.mp4 to new.mp4, or back, at this moment"
			);
			// The second request is over, and tidies up as it does.
			await say("left", "second");
			await forgetUnsettledMediaRename({
				projectId: "project-1",
				renamed: renamed(),
				by: "second",
			});
			expect(await notes()).toEqual([{ ...first, atWork: true }]);

			// The first one goes on as if nothing had been.
			await say("stays", "first");
			expect(await stored()).toMatchObject({
				fileIs: "new",
				beganAt: first.beganAt,
			});
			expect(await atWork()).toEqual([false]);
		});

		it("takes the same two names the other way round for the same rename", async () => {
			await say("moving", "first");
			const back = {
				previous: { id: NEW, name: "new.mp4", path: renamed().path },
				id: OLD,
				name: "old.mp4",
				path: renamed().previous.path,
			};
			await expect(
				noteUnsettledMediaRename({
					projectId: "project-1",
					renamed: back,
					stage: "moving",
					by: "second",
				})
			).rejects.toThrow("Another request is renaming new.mp4 to old.mp4");
			// In another project they are another rename.
			await expect(
				noteUnsettledMediaRename({
					projectId: "project-2",
					renamed: back,
					stage: "moving",
					by: "second",
				})
			).resolves.toBeUndefined();
		});

		/**
		 * A rename ended with the editor and the folder apart, and its note
		 * is still there when the same file is renamed again. The second
		 * rename wrote its own note over it, and dropped that when its move
		 * failed: the first rename was then no longer noted, and nothing was
		 * left to settle it by.
		 */
		describe("when an earlier rename between the two names is not settled", () => {
			it("puts the earlier note back when the file is not moved after all", async () => {
				await say("moving", "first");
				await say("stays", "first");
				const earlier = await stored();

				await say("moving", "second");
				expect(await stored()).not.toHaveProperty("fileIs");
				await forgetUnsettledMediaRename({
					projectId: "project-1",
					renamed: renamed(),
					by: "second",
					unmoved: true,
				});

				expect(await notes()).toEqual([{ ...earlier, atWork: false }]);
			});

			it("drops the note when the editor is where the file is after the second rename", async () => {
				await say("moving", "first");
				await say("back", "first");
				await say("moving", "second");
				// The editor followed: the two names are settled, both renames.
				await forgetUnsettledMediaRename({
					projectId: "project-1",
					renamed: renamed(),
					by: "second",
				});
				expect(await notes()).toEqual([]);
			});

			it("has nothing to put back for a rename that began with nothing noted", async () => {
				await say("moving");
				await forgetUnsettledMediaRename({
					projectId: "project-1",
					renamed: renamed(),
					unmoved: true,
				});
				expect(await notes()).toEqual([]);
			});

			/**
			 * Since the first rename began, another file can have taken one
			 * of the two names. The second rename's note must not make an
			 * item of that file look as if it had been there before.
			 */
			it("keeps the moment the first of them began", async () => {
				vi.useFakeTimers({
					toFake: ["Date"],
					now: new Date("2026-11-17T08:00:00.000Z"),
				});
				const firstBegan = Date.now();
				await say("moving", "first");
				await say("back", "first");

				vi.setSystemTime(firstBegan + 2 * HOUR);
				await say("moving", "second");
				expect((await stored()).beganAt).toBe(firstBegan);
				await say("stays", "second");
				expect(await stored()).toMatchObject({
					beganAt: firstBegan,
					fileIs: "new",
				});
			});
		});

		describe("when the editor says it has settled a note", () => {
			it("drops the note, and says that it is gone", async () => {
				await say("back");
				const { notedAt } = await stored();
				expect(await settledByEditor(notedAt)).toBe(true);
				expect(await notes()).toEqual([]);
				// Gone is gone, whoever dropped it.
				expect(await settledByEditor(notedAt)).toBe(true);
			});

			it("keeps the note of a rename it is at work on", async () => {
				await say("moving");
				const note = await stored();
				expect(await settledByEditor(note.notedAt)).toBe(false);
				expect(await stored()).toEqual(note);
			});

			/**
			 * The editor settles by what it read a moment ago. In that moment
			 * the app can have begun the rename again and ended it, leaving
			 * another note: one the editor has not seen.
			 */
			it("keeps a note it has written since the one the editor read", async () => {
				await say("back");
				const read = await stored();
				await say("moving");
				await say("stays");
				const written = await stored();

				expect(await settledByEditor(read.notedAt)).toBe(false);
				expect(await stored()).toEqual(written);
				expect(await settledByEditor(written.notedAt)).toBe(true);
			});

			/**
			 * The look at the note and its removal are one step to the app's
			 * own writes. A rename that begins while the editor's note is
			 * about to be dropped keeps its note, whichever of the two gets
			 * to the file first.
			 */
			it("does not take the note of a rename that begins while it is about to drop the old one", async () => {
				await say("back");
				const { notedAt } = await stored();

				const dropped = settledByEditor(notedAt);
				const begun = say("moving");
				// Not gone: the rename is under way again.
				expect(await dropped).toBe(false);
				await begun;

				const fresh = await stored();
				expect(fresh).not.toHaveProperty("fileIs");
				expect(fresh.notedAt).toBeGreaterThan(notedAt);
				expect(await atWork()).toEqual([true]);
			});

			it("does not drop the note of a rename that began a moment before", async () => {
				await say("back");
				const { notedAt } = await stored();

				const begun = say("moving");
				const dropped = settledByEditor(notedAt);
				await begun;
				expect(await dropped).toBe(false);
				expect(await atWork()).toEqual([true]);
			});
		});

		it("hands out the notes of one project, and nothing that is not a note of it", async () => {
			await say("back");
			const folder = path.join(testState.userData, "projects");
			// Another project's, whose id begins as this one's does.
			await fs.writeFile(
				path.join(
					folder,
					"media-rename-unsettled-project-1-of-two-0123456789abcdef0123456789abcdef.json"
				),
				JSON.stringify({ oldId: "x" })
			);
			await fs.writeFile(
				path.join(folder, "media-rename-unsettled-project-1-notes.json"),
				JSON.stringify({ oldId: "x" })
			);
			await fs.writeFile(
				path.join(folder, "overlay-stickers-project-1.json"),
				"[]"
			);
			// A note that cannot be read is left out, and left where it is.
			const damaged = `${unsettledRenameKey({
				projectId: "project-1",
				newId: "media_a",
				oldId: "media_b",
			})}.json`;
			await fs.writeFile(path.join(folder, damaged), "{ not json");

			expect(await notes()).toEqual([{ ...(await stored()), atWork: false }]);
			expect(await fs.readdir(folder)).toContain(damaged);
			expect(
				await listUnsettledMediaRenames({ projectId: "project-3" })
			).toEqual([]);
		});

		it("has no notes to hand out before any was written", async () => {
			expect(await notes()).toEqual([]);
		});

		it("answers the editor over its two channels, and nothing to what is not a request", async () => {
			setupMediaRenameNotesIPC();
			const list = testState.handlers.get("claude:media:unsettled-renames");
			const forget = testState.handlers.get(
				"claude:media:forget-settled-rename"
			);
			if (!list || !forget) throw new Error("The channels are not there");

			await say("back");
			const note = await stored();
			expect(await list({}, "project-1")).toEqual([{ ...note, atWork: false }]);
			expect(await list({}, undefined)).toEqual([]);
			expect(await list({}, { projectId: "project-1" })).toEqual([]);

			expect(await forget({}, undefined)).toBe(false);
			expect(
				await forget({}, { projectId: "project-1", oldId: OLD, newId: NEW })
			).toBe(false);
			expect(await stored()).toEqual(note);
			// The two ids either way round: one rename, one note.
			expect(
				await forget(
					{},
					{
						projectId: "project-1",
						oldId: NEW,
						newId: OLD,
						notedAt: note.notedAt,
					}
				)
			).toBe(true);
			expect(await list({}, "project-1")).toEqual([]);
		});
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
