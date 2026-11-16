import { beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({ getFileInfo: vi.fn() }));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({ files }),
}));

import {
	readSourceFileStat,
	readWithSourceRecord,
	sameSourceFile,
} from "../media-source-stat";

const PATH = "/Users/me/Documents/QCut/Projects/p1/media/shake.mp4";
const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
/** The desktop app shows a file's time as a date. */
const shown = (size: number, time: number) => ({
	size,
	lastModified: new Date(time),
});

/**
 * An item records the file its bytes were copied from, and by when the
 * editor held them. A file that gets the item's name later than that is not
 * what the item was copied from.
 */
describe("the record of the file an item was copied from", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("is the file as it was, with the moment its bytes had been read", async () => {
		files.getFileInfo.mockResolvedValue(shown(8, 9000));
		let read = 0;
		const { bytes, sourceFile } = await readWithSourceRecord({
			filePath: PATH,
			read: async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				read = Date.now();
				return BYTES;
			},
		});
		expect(bytes).toBe(BYTES);
		expect(sourceFile).toEqual({
			size: 8,
			modifiedAt: 9000,
			heldSince: expect.any(Number),
		});
		// Not the moment the read began: the bytes could be of a file that
		// got the name while they were read.
		expect(sourceFile?.heldSince).toBeGreaterThanOrEqual(read);
		expect(sourceFile?.heldSince).toBeLessThanOrEqual(Date.now());
		expect(files.getFileInfo).toHaveBeenCalledWith(PATH);
	});

	it("is not made of a file that changed while it was read", async () => {
		files.getFileInfo
			.mockResolvedValueOnce(shown(8, 9000))
			.mockResolvedValueOnce(shown(8, 9500));
		expect(
			await readWithSourceRecord({ filePath: PATH, read: async () => BYTES })
		).toEqual({ bytes: BYTES });

		// Nor of one that is longer by now than what was read of it.
		files.getFileInfo.mockReset().mockResolvedValue(shown(12, 9000));
		expect(
			await readWithSourceRecord({ filePath: PATH, read: async () => BYTES })
		).toEqual({ bytes: BYTES });
	});

	it("is left out, and the bytes are still handed over, when the file cannot be looked at", async () => {
		files.getFileInfo.mockRejectedValue(new Error("get-file-info failed"));
		expect(
			await readWithSourceRecord({ filePath: PATH, read: async () => BYTES })
		).toEqual({ bytes: BYTES });
	});

	it("is left out when there are no bytes", async () => {
		files.getFileInfo.mockResolvedValue(shown(8, 9000));
		expect(
			await readWithSourceRecord({ filePath: PATH, read: async () => null })
		).toEqual({ bytes: null });
	});

	it("is read off an item with the moment it has, and without one from before that was kept", () => {
		const item = (sourceFile: unknown) => ({ metadata: { sourceFile } });
		expect(
			readSourceFileStat({
				item: item({ size: 8, modifiedAt: 9000, heldSince: 1234 }),
			})
		).toEqual({ size: 8, modifiedAt: 9000, heldSince: 1234 });
		expect(
			readSourceFileStat({ item: item({ size: 8, modifiedAt: 9000 }) })
		).toEqual({ size: 8, modifiedAt: 9000 });
		expect(
			readSourceFileStat({
				item: item({ size: 8, modifiedAt: 9000, heldSince: "long ago" }),
			})
		).toEqual({ size: 8, modifiedAt: 9000 });
		expect(readSourceFileStat({ item: item({ size: 8 }) })).toBeUndefined();
		expect(readSourceFileStat({ item: {} })).toBeUndefined();
	});

	it("takes two records for one file whenever the editor came to hold it", () => {
		expect(
			sameSourceFile(
				{ size: 8, modifiedAt: 9000, heldSince: 1 },
				{ size: 8, modifiedAt: 9001 }
			)
		).toBe(true);
		expect(
			sameSourceFile(
				{ size: 8, modifiedAt: 9000 },
				{ size: 9, modifiedAt: 9000 }
			)
		).toBe(false);
	});
});
