import { describe, expect, it, vi } from "vitest";

// The planner reads nothing; these keep the module's other imports light.
vi.mock("@qcut/platform-core", () => ({ platform: () => ({}) }));
vi.mock("@/lib/storage/storage-service", () => ({ storageService: {} }));
vi.mock("@/lib/media/alpha-playback-proxy", () => ({
	forgetMediaAlphaInspection: vi.fn(),
}));
vi.mock("@/lib/media/blob-manager", () => ({
	createReplacementObjectURL: vi.fn(),
	releaseObjectURL: vi.fn(),
}));
vi.mock("@/stores/media/media-store-helpers", () => ({
	getImageDimensions: vi.fn(),
}));

import {
	planMediaSourceRefresh,
	readSourceFileStat,
} from "../media-source-refresh";
import { diskFile, FOLDER, mediaItem, recorded } from "./media-source-fixtures";

describe("which media files changed in the project folder", () => {
	it("leaves an item alone whose file is as it was when it was copied", () => {
		const plan = planMediaSourceRefresh({
			diskFiles: [diskFile({ size: 400, modifiedAt: 5000.4 })],
			// The time comes back in whole milliseconds from one call and with
			// a fraction from another.
			mediaItems: [mediaItem(recorded(400, 5000))],
		});
		expect(plan).toEqual({
			changed: [],
			adopt: [],
			unsettled: [],
			checked: 1,
		});
	});

	it("reads a file again whose size or time moved", () => {
		const item = mediaItem(recorded(400, 5000));
		for (const file of [
			diskFile({ size: 512, modifiedAt: 5000 }),
			// Written again with the same length.
			diskFile({ size: 400, modifiedAt: 9000 }),
		]) {
			expect(
				planMediaSourceRefresh({ diskFiles: [file], mediaItems: [item] })
					.changed
			).toEqual([{ item, file }]);
		}
	});

	/**
	 * Items imported before the record existed: the size of the editor's copy
	 * is all that is known about the file it came from.
	 */
	it("compares an item that has no record by the size of the editor's copy", () => {
		const stale = mediaItem({ id: "stale", bytes: 300 });
		const current = mediaItem({
			id: "current",
			name: "other.mp4",
			localPath: `${FOLDER}/other.mp4`,
			bytes: 700,
		});
		const shake = diskFile({ size: 400 });
		const other = diskFile({
			name: "other.mp4",
			path: `${FOLDER}/other.mp4`,
			size: 700,
		});
		expect(
			planMediaSourceRefresh({
				diskFiles: [shake, other],
				mediaItems: [stale, current],
			})
		).toEqual({
			changed: [{ item: stale, file: shake }],
			adopt: [{ item: current, file: other }],
			unsettled: [],
			checked: 2,
		});
	});

	it("matches a path whichever slash it is written with", () => {
		const item = mediaItem({
			localPath: "C:\\Users\\Me\\QCut\\Projects\\p1\\media\\shake.mp4",
			bytes: 300,
		});
		const file = diskFile({
			path: "C:/Users/Me/QCut/Projects/p1/media/shake.mp4",
		});
		expect(
			planMediaSourceRefresh({ diskFiles: [file], mediaItems: [item] }).changed
		).toHaveLength(1);
	});

	/**
	 * `Shake.MP4` and `shake.mp4` are one file only where the file system
	 * says so. Where it tells them apart, the file in the folder is another
	 * file, and its picture is not this item's.
	 */
	it("sets case aside only where the folder's file system does", () => {
		const item = mediaItem({
			localPath: "C:\\Users\\Me\\QCut\\Projects\\p1\\media\\Shake.MP4",
			bytes: 300,
		});
		const file = diskFile({
			path: "c:/users/me/qcut/projects/p1/media/shake.mp4",
		});
		expect(
			planMediaSourceRefresh({
				diskFiles: [file],
				mediaItems: [item],
				ignoresCase: true,
			}).changed
		).toEqual([{ item, file }]);
		expect(
			planMediaSourceRefresh({ diskFiles: [file], mediaItems: [item] })
		).toEqual({ changed: [], adopt: [], unsettled: [], checked: 0 });
	});

	/**
	 * Where the file system tells `A.mp4` from `a.mp4`, they are two files:
	 * neither may be compared with, or read into, the other's item.
	 */
	it("keeps two files apart whose paths differ only by case", () => {
		const upper = mediaItem({
			id: "upper",
			localPath: `${FOLDER}/A.mp4`,
			...recorded(100, 1000),
		});
		const lower = mediaItem({
			id: "lower",
			localPath: `${FOLDER}/a.mp4`,
			...recorded(200, 2000),
		});
		const upperFile = diskFile({
			name: "A.mp4",
			path: `${FOLDER}/A.mp4`,
			size: 100,
			modifiedAt: 1000,
		});
		// Only the lower-case file was written over.
		const lowerFile = diskFile({
			name: "a.mp4",
			path: `${FOLDER}/a.mp4`,
			size: 250,
			modifiedAt: 9000,
		});
		for (const diskFiles of [
			[upperFile, lowerFile],
			[lowerFile, upperFile],
		]) {
			expect(
				planMediaSourceRefresh({ diskFiles, mediaItems: [upper, lower] })
			).toEqual({
				changed: [{ item: lower, file: lowerFile }],
				adopt: [],
				unsettled: [],
				checked: 2,
			});
		}
		// A path that names neither as written cannot say which one it means.
		const vague = mediaItem({ id: "vague", localPath: `${FOLDER}/A.MP4` });
		for (const ignoresCase of [false, true]) {
			expect(
				planMediaSourceRefresh({
					diskFiles: [upperFile, lowerFile],
					mediaItems: [vague],
					ignoresCase,
				}).checked
			).toBe(0);
		}
	});

	it("passes over items with no file in the folder, no bytes of their own, or not kept", () => {
		const plan = planMediaSourceRefresh({
			diskFiles: [diskFile({ size: 999 })],
			mediaItems: [
				mediaItem({ id: "elsewhere", localPath: "/tmp/elsewhere.mp4" }),
				mediaItem({ id: "no-path", localPath: undefined }),
				mediaItem({ id: "placeholder", bytes: 0 }),
				mediaItem({ id: "ephemeral", ephemeral: true }),
			],
		});
		expect(plan).toEqual({
			changed: [],
			adopt: [],
			unsettled: [],
			checked: 0,
		});
	});

	it("does not take a damaged record for a record", () => {
		expect(
			readSourceFileStat({
				item: { metadata: { sourceFile: { size: "400" } } },
			})
		).toBeUndefined();
		expect(readSourceFileStat({ item: {} })).toBeUndefined();
		expect(readSourceFileStat({ item: mediaItem(recorded(1, 2)) })).toEqual({
			size: 1,
			modifiedAt: 2,
		});
	});

	/**
	 * A file was renamed and the rename is not settled: another file can
	 * have its old name by now. The item's record of the file it was copied
	 * from is what tells it from an item of that other file. Read again from
	 * the file under its name, the record said the other file's, and the
	 * clips that were the renamed file's were taken for the other file's.
	 */
	it("leaves an item of a rename that is not settled as it is", () => {
		const renamedFilesItem = mediaItem(recorded(400, 5000));
		const unrecorded = mediaItem({
			id: "media_old_take",
			name: "take.mp4",
			localPath: `${FOLDER}/take.mp4`,
			bytes: 300,
		});
		const another = diskFile({ size: 512, modifiedAt: 9000 });
		const sameLength = diskFile({
			name: "take.mp4",
			path: `${FOLDER}/take.mp4`,
			relativePath: "media/take.mp4",
			size: 300,
		});
		const plan = planMediaSourceRefresh({
			diskFiles: [another, sameLength],
			mediaItems: [renamedFilesItem, unrecorded],
			unsettled: new Set(["media_shake", "media_old_take"]),
		});
		// Not read again; and nothing is recorded for the one without a
		// record, though the file is as long as its copy.
		expect(plan).toEqual({
			changed: [],
			adopt: [],
			unsettled: [{ item: renamedFilesItem, file: another }],
			checked: 2,
		});

		// With the rename settled it is a changed file like any other.
		expect(
			planMediaSourceRefresh({
				diskFiles: [another, sameLength],
				mediaItems: [renamedFilesItem, unrecorded],
				unsettled: new Set(),
			})
		).toMatchObject({
			changed: [{ item: renamedFilesItem, file: another }],
			adopt: [{ item: unrecorded, file: sameLength }],
			unsettled: [],
		});
	});
});
