import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ documentsRoot: "" }));
const hooks = vi.hoisted(() => ({
	/**
	 * Runs when a file's restricted metadata is read: by the folder listing,
	 * and by a move once it has seen the new name free.
	 */
	onMetadataRead: undefined as undefined | ((mediaId: string) => Promise<void>),
	/** Stands in for a volume that has no hard links. */
	noHardLinks: false,
}));

vi.mock("fs/promises", async (importOriginal) => {
	const real = await importOriginal<typeof import("fs/promises")>();
	return {
		...real,
		link: async (...args: Parameters<typeof real.link>) => {
			if (hooks.noHardLinks) {
				throw Object.assign(new Error("ENOTSUP: operation not supported"), {
					code: "ENOTSUP",
				});
			}
			return real.link(...args);
		},
	};
});

vi.mock(
	"../claude/handlers/claude-media-restricted-metadata.js",
	async (importOriginal) => {
		const real =
			await importOriginal<
				typeof import("../claude/handlers/claude-media-restricted-metadata.js")
			>();
		return {
			...real,
			readMediaRestrictedMetadata: async (
				request: Parameters<typeof real.readMediaRestrictedMetadata>[0]
			) => {
				await hooks.onMetadataRead?.(request.mediaId);
				return real.readMediaRestrictedMetadata(request);
			},
		};
	}
);

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
	MediaNameTakenError,
	MediaNotFoundError,
	moveWithoutOverwriting,
	renameMediaFileOnDisk,
	undoMediaRename,
} from "../claude/handlers/claude-media-rename.js";
import {
	persistMediaRestrictedMetadata,
	readMediaRestrictedMetadata,
} from "../claude/handlers/claude-media-restricted-metadata.js";

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

const RESTRICTED = {
	animatedSticker: true,
	batchId: "jianying-2026-08-23-batch-18-v2",
	checksumSha256:
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	itemId: "42001",
	redistribution: "prohibited",
	referenceOnly: true,
	source: "sticker-lab",
	usage: "internal-reference-only",
} as const;

/**
 * Has someone else's file appear at `filePath` at the moment a move of
 * media `mediaId` has seen that name free and is reading the metadata it
 * will take along: `nthRead` is 2 for a rename, which lists the folder
 * first, and 1 for putting a file back.
 */
function appearWhileMoving({
	filePath,
	mediaId,
	nthRead,
}: {
	filePath: string;
	mediaId: string;
	nthRead: number;
}): void {
	let reads = 0;
	hooks.onMetadataRead = async (readId) => {
		if (readId !== mediaId) return;
		reads += 1;
		if (reads === nthRead) await fs.writeFile(filePath, "someone else");
	};
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
		hooks.onMetadataRead = undefined;
		hooks.noHardLinks = false;
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

	/**
	 * `fs.rename` replaces whatever has the new name, also a file that got
	 * there after the name was seen free. A move must leave both files.
	 */
	it("refuses an exact name that a file takes while the move is prepared", async () => {
		const shake = idOf("震屏01_踹盾.mp4");
		await persistMediaRestrictedMetadata({
			mediaId: shake,
			metadata: RESTRICTED,
			projectId: PROJECT_ID,
		});
		const wanted = path.join(mediaDirectory(), "wanted.mp4");
		appearWhileMoving({ filePath: wanted, mediaId: shake, nthRead: 2 });
		await expect(
			renameMediaFileOnDisk({
				projectId: PROJECT_ID,
				mediaId: shake,
				newName: "wanted.mp4",
				exactName: true,
			})
		).rejects.toThrow("wanted.mp4 is already taken");
		hooks.onMetadataRead = undefined;

		expect(await fs.readFile(wanted, "utf8")).toBe("someone else");
		expect(
			await fs.readFile(path.join(mediaDirectory(), "震屏01_踹盾.mp4"), "utf8")
		).toBe("shake");
		// The metadata stays with the file that was not moved, and the file
		// that appeared was given none.
		expect(
			await readMediaRestrictedMetadata({
				mediaId: shake,
				projectId: PROJECT_ID,
			})
		).toMatchObject({ itemId: "42001" });
		expect(
			await readMediaRestrictedMetadata({
				mediaId: idOf("wanted.mp4"),
				projectId: PROJECT_ID,
			})
		).toBeUndefined();
	});

	it("looks for the next free name when the one it picked is taken meanwhile", async () => {
		const shake = idOf("震屏01_踹盾.mp4");
		const picked = path.join(mediaDirectory(), "renamed.mp4");
		appearWhileMoving({ filePath: picked, mediaId: shake, nthRead: 2 });
		const renamed = await renameMediaFileOnDisk({
			projectId: PROJECT_ID,
			mediaId: shake,
			newName: "renamed.mp4",
		});
		hooks.onMetadataRead = undefined;

		expect(renamed.name).toBe("renamed_1.mp4");
		expect(renamed.id).toBe(idOf("renamed_1.mp4"));
		expect(await fs.readFile(picked, "utf8")).toBe("someone else");
		expect(await fs.readFile(renamed.path, "utf8")).toBe("shake");
		expect(await mediaNames()).toEqual([
			"renamed.mp4",
			"renamed_1.mp4",
			"taken.mp4",
		]);
	});

	it("does not put a file back over one that takes the old name while it is moved", async () => {
		const renamed = await renameMediaFileOnDisk({
			projectId: PROJECT_ID,
			mediaId: idOf("震屏01_踹盾.mp4"),
			newName: "renamed.mp4",
		});
		appearWhileMoving({
			filePath: renamed.previous.path,
			mediaId: renamed.id,
			nthRead: 1,
		});
		await expect(
			undoMediaRename({ projectId: PROJECT_ID, renamed })
		).rejects.toThrow("was taken again");
		hooks.onMetadataRead = undefined;

		expect(await fs.readFile(renamed.previous.path, "utf8")).toBe(
			"someone else"
		);
		expect(await fs.readFile(renamed.path, "utf8")).toBe("shake");
	});

	it("moves a file with its restricted metadata, and keeps the time it was written", async () => {
		const shake = idOf("震屏01_踹盾.mp4");
		const from = path.join(mediaDirectory(), "震屏01_踹盾.mp4");
		await persistMediaRestrictedMetadata({
			mediaId: shake,
			metadata: RESTRICTED,
			projectId: PROJECT_ID,
		});
		const written = new Date("2026-11-01T08:00:00.000Z");
		await fs.utimes(from, written, written);

		const renamed = await renameMediaFileOnDisk({
			projectId: PROJECT_ID,
			mediaId: shake,
			newName: "moved.mp4",
		});
		expect((await fs.stat(renamed.path)).mtimeMs).toBe(written.getTime());
		await expect(fs.access(from)).rejects.toThrow();
		expect(
			await readMediaRestrictedMetadata({
				mediaId: renamed.id,
				projectId: PROJECT_ID,
			})
		).toMatchObject({ itemId: "42001" });
		expect(
			await readMediaRestrictedMetadata({
				mediaId: shake,
				projectId: PROJECT_ID,
			})
		).toBeUndefined();
	});
});

describe("moving a file without writing over another", () => {
	let folder = "";

	beforeEach(async () => {
		folder = await fs.mkdtemp(path.join(os.tmpdir(), "qcut-media-move-"));
		await fs.writeFile(path.join(folder, "a.mp4"), "mine");
	});

	afterEach(async () => {
		hooks.noHardLinks = false;
		await fs.rm(folder, { recursive: true, force: true });
	});

	it("refuses a name that has a file, and leaves both", async () => {
		await fs.writeFile(path.join(folder, "b.mp4"), "theirs");
		await expect(
			moveWithoutOverwriting({
				from: path.join(folder, "a.mp4"),
				to: path.join(folder, "b.mp4"),
			})
		).rejects.toBeInstanceOf(MediaNameTakenError);
		expect(await fs.readFile(path.join(folder, "a.mp4"), "utf8")).toBe("mine");
		expect(await fs.readFile(path.join(folder, "b.mp4"), "utf8")).toBe(
			"theirs"
		);
	});

	it("leaves one file, under the new name", async () => {
		await moveWithoutOverwriting({
			from: path.join(folder, "a.mp4"),
			to: path.join(folder, "b.mp4"),
		});
		expect(await fs.readdir(folder)).toEqual(["b.mp4"]);
		expect(await fs.readFile(path.join(folder, "b.mp4"), "utf8")).toBe("mine");
		expect((await fs.stat(path.join(folder, "b.mp4"))).nlink).toBe(1);
	});

	it("reports a file that is not there", async () => {
		await expect(
			moveWithoutOverwriting({
				from: path.join(folder, "missing.mp4"),
				to: path.join(folder, "b.mp4"),
			})
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(await fs.readdir(folder)).toEqual(["a.mp4"]);
	});

	it("moves a symbolic link as the link it is", async () => {
		await fs.symlink(path.join(folder, "a.mp4"), path.join(folder, "link.mp4"));
		await moveWithoutOverwriting({
			from: path.join(folder, "link.mp4"),
			to: path.join(folder, "moved-link.mp4"),
		});
		const moved = await fs.lstat(path.join(folder, "moved-link.mp4"));
		expect(moved.isSymbolicLink()).toBe(true);
		expect(await fs.readlink(path.join(folder, "moved-link.mp4"))).toBe(
			path.join(folder, "a.mp4")
		);
		// The file it points to has one name still, its own.
		expect((await fs.stat(path.join(folder, "a.mp4"))).nlink).toBe(1);
		await fs.writeFile(path.join(folder, "b.mp4"), "theirs");
		await expect(
			moveWithoutOverwriting({
				from: path.join(folder, "moved-link.mp4"),
				to: path.join(folder, "b.mp4"),
			})
		).rejects.toBeInstanceOf(MediaNameTakenError);
		expect(await fs.readFile(path.join(folder, "b.mp4"), "utf8")).toBe(
			"theirs"
		);
	});

	it("still moves, and still refuses a taken name, on a volume without hard links", async () => {
		hooks.noHardLinks = true;
		await fs.writeFile(path.join(folder, "b.mp4"), "theirs");
		await expect(
			moveWithoutOverwriting({
				from: path.join(folder, "a.mp4"),
				to: path.join(folder, "b.mp4"),
			})
		).rejects.toBeInstanceOf(MediaNameTakenError);
		expect(await fs.readFile(path.join(folder, "b.mp4"), "utf8")).toBe(
			"theirs"
		);

		await moveWithoutOverwriting({
			from: path.join(folder, "a.mp4"),
			to: path.join(folder, "c.mp4"),
		});
		expect((await fs.readdir(folder)).sort()).toEqual(["b.mp4", "c.mp4"]);
		expect(await fs.readFile(path.join(folder, "c.mp4"), "utf8")).toBe("mine");
	});
});
