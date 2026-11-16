import { createHash } from "node:crypto";
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
	/** Runs when a file is about to take the name `to`. */
	beforeLink: undefined as undefined | ((to: string) => Promise<void>),
	/** Runs when a copy, or a new symbolic link, is about to take `to`. */
	beforeCopyOrSymlink: undefined as undefined | ((to: string) => Promise<void>),
}));

vi.mock("fs/promises", async (importOriginal) => {
	const real = await importOriginal<typeof import("fs/promises")>();
	return {
		...real,
		link: async (...args: Parameters<typeof real.link>) => {
			await hooks.beforeLink?.(String(args[1]));
			if (hooks.noHardLinks) {
				throw Object.assign(new Error("ENOTSUP: operation not supported"), {
					code: "ENOTSUP",
				});
			}
			return real.link(...args);
		},
		copyFile: async (...args: Parameters<typeof real.copyFile>) => {
			await hooks.beforeCopyOrSymlink?.(String(args[1]));
			return real.copyFile(...args);
		},
		symlink: async (...args: Parameters<typeof real.symlink>) => {
			await hooks.beforeCopyOrSymlink?.(String(args[1]));
			return real.symlink(...args);
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

/** Another restricted file's metadata, told from `RESTRICTED` by its item. */
const THEIRS = { ...RESTRICTED, itemId: "42002" } as const;

/** Where a media id's restricted metadata is kept. */
function sidecarOf(mediaId: string): string {
	return path.join(
		mediaDirectory(),
		".qcut-restricted-media",
		`${createHash("sha256").update(mediaId, "utf8").digest("hex")}.json`
	);
}

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
		hooks.beforeLink = undefined;
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

	/**
	 * A restricted file's metadata is kept by media id, and the id follows
	 * the name. A file that takes the wanted name while a rename is under
	 * way owns that id: the rename must neither write its own metadata over
	 * the other file's nor, when it gives up, remove it. Either way the other
	 * file would be left without its restriction.
	 */
	it("leaves alone the metadata of a restricted file that takes the name first", async () => {
		const shake = idOf("震屏01_踹盾.mp4");
		await persistMediaRestrictedMetadata({
			mediaId: shake,
			metadata: RESTRICTED,
			projectId: PROJECT_ID,
		});
		const wanted = path.join(mediaDirectory(), "wanted.mp4");
		// As an import does: the file, then its metadata, after the rename
		// has seen the name free.
		let reads = 0;
		hooks.onMetadataRead = async (readId) => {
			if (readId !== shake) return;
			reads += 1;
			if (reads !== 2) return;
			await fs.writeFile(wanted, "someone else");
			await persistMediaRestrictedMetadata({
				mediaId: idOf("wanted.mp4"),
				metadata: THEIRS,
				projectId: PROJECT_ID,
			});
		};
		await expect(
			renameMediaFileOnDisk({
				projectId: PROJECT_ID,
				mediaId: shake,
				newName: "wanted.mp4",
				exactName: true,
			})
		).rejects.toThrow("wanted.mp4 is already taken");
		hooks.onMetadataRead = undefined;

		expect(
			await readMediaRestrictedMetadata({
				mediaId: idOf("wanted.mp4"),
				projectId: PROJECT_ID,
			})
		).toMatchObject({ itemId: "42002" });
		expect(
			await readMediaRestrictedMetadata({
				mediaId: shake,
				projectId: PROJECT_ID,
			})
		).toMatchObject({ itemId: "42001" });
		expect(await fs.readFile(wanted, "utf8")).toBe("someone else");
	});

	it("takes away the metadata it staged, not what a file put there since", async () => {
		const shake = idOf("震屏01_踹盾.mp4");
		await persistMediaRestrictedMetadata({
			mediaId: shake,
			metadata: RESTRICTED,
			projectId: PROJECT_ID,
		});
		const wanted = path.join(mediaDirectory(), "wanted.mp4");
		// The rename has staged its metadata; the other file arrives, with
		// its own, just before the renamed file would take the name.
		hooks.beforeLink = async (to) => {
			if (to !== wanted) return;
			hooks.beforeLink = undefined;
			await fs.writeFile(wanted, "someone else");
			await persistMediaRestrictedMetadata({
				mediaId: idOf("wanted.mp4"),
				metadata: THEIRS,
				projectId: PROJECT_ID,
			});
		};
		await expect(
			renameMediaFileOnDisk({
				projectId: PROJECT_ID,
				mediaId: shake,
				newName: "wanted.mp4",
				exactName: true,
			})
		).rejects.toThrow("wanted.mp4 is already taken");

		expect(
			await readMediaRestrictedMetadata({
				mediaId: idOf("wanted.mp4"),
				projectId: PROJECT_ID,
			})
		).toMatchObject({ itemId: "42002" });
		expect(
			await readMediaRestrictedMetadata({
				mediaId: shake,
				projectId: PROJECT_ID,
			})
		).toMatchObject({ itemId: "42001" });
	});

	it("replaces metadata a file that is gone left behind, but not metadata only just written", async () => {
		const shake = idOf("震屏01_踹盾.mp4");
		await persistMediaRestrictedMetadata({
			mediaId: shake,
			metadata: RESTRICTED,
			projectId: PROJECT_ID,
		});
		// No file is named wanted.mp4; metadata for that id is there.
		await persistMediaRestrictedMetadata({
			mediaId: idOf("wanted.mp4"),
			metadata: THEIRS,
			projectId: PROJECT_ID,
		});
		const rename = () =>
			renameMediaFileOnDisk({
				projectId: PROJECT_ID,
				mediaId: shake,
				newName: "wanted.mp4",
				exactName: true,
			});
		// Written a moment ago: another move may be bringing its file.
		await expect(rename()).rejects.toThrow("wanted.mp4 is already taken");
		expect(
			await readMediaRestrictedMetadata({
				mediaId: idOf("wanted.mp4"),
				projectId: PROJECT_ID,
			})
		).toMatchObject({ itemId: "42002" });

		// Minutes old with no file: its file was removed outside the app.
		const longAgo = new Date(Date.now() - 10 * 60_000);
		await fs.utimes(sidecarOf(idOf("wanted.mp4")), longAgo, longAgo);
		const renamed = await rename();
		expect(renamed.name).toBe("wanted.mp4");
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

	/**
	 * A volume without hard links moves a file by a look at the name and a
	 * rename. A file that takes the name while the move is prepared must
	 * stay there too, and each file keep its own metadata.
	 */
	it("leaves both files and their metadata on a volume without hard links", async () => {
		hooks.noHardLinks = true;
		const shake = idOf("震屏01_踹盾.mp4");
		await persistMediaRestrictedMetadata({
			mediaId: shake,
			metadata: RESTRICTED,
			projectId: PROJECT_ID,
		});
		const wanted = path.join(mediaDirectory(), "wanted.mp4");
		let reads = 0;
		hooks.onMetadataRead = async (readId) => {
			if (readId !== shake) return;
			reads += 1;
			if (reads !== 2) return;
			await fs.writeFile(wanted, "someone else");
			await persistMediaRestrictedMetadata({
				mediaId: idOf("wanted.mp4"),
				metadata: THEIRS,
				projectId: PROJECT_ID,
			});
		};
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
		expect(
			await readMediaRestrictedMetadata({
				mediaId: idOf("wanted.mp4"),
				projectId: PROJECT_ID,
			})
		).toMatchObject({ itemId: "42002" });
		expect(
			await readMediaRestrictedMetadata({
				mediaId: shake,
				projectId: PROJECT_ID,
			})
		).toMatchObject({ itemId: "42001" });

		// A plain rename there takes the next free name, with its metadata.
		const renamed = await renameMediaFileOnDisk({
			projectId: PROJECT_ID,
			mediaId: shake,
			newName: "wanted.mp4",
		});
		expect(renamed.name).toBe("wanted_1.mp4");
		expect(await fs.readFile(renamed.path, "utf8")).toBe("shake");
		expect(
			await readMediaRestrictedMetadata({
				mediaId: renamed.id,
				projectId: PROJECT_ID,
			})
		).toMatchObject({ itemId: "42001" });
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
		hooks.beforeCopyOrSymlink = undefined;
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

	// Making a file's symbolic link needs a privilege on Windows.
	it.skipIf(process.platform === "win32")(
		"moves a symbolic link as the link it is",
		async () => {
			await fs.symlink(
				path.join(folder, "a.mp4"),
				path.join(folder, "link.mp4")
			);
			await moveWithoutOverwriting({
				from: path.join(folder, "link.mp4"),
				to: path.join(folder, "moved-link.mp4"),
			});
			const moved = await fs.lstat(path.join(folder, "moved-link.mp4"));
			expect(moved.isSymbolicLink()).toBe(true);
			expect(
				await fs.readFile(path.join(folder, "moved-link.mp4"), "utf8")
			).toBe("mine");
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
		}
	);

	it("still moves, and still refuses a taken name, on a volume without hard links", async () => {
		hooks.noHardLinks = true;
		const written = new Date("2026-11-01T08:00:00.000Z");
		await fs.utimes(path.join(folder, "a.mp4"), written, written);
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
		// Copied there, so a new file: it keeps the time the old one had.
		expect((await fs.stat(path.join(folder, "c.mp4"))).mtimeMs).toBe(
			written.getTime()
		);
	});

	/**
	 * Without hard links there is no look at the name followed by a rename:
	 * the name is taken by a copy that fails when something has it, however
	 * late that something got there.
	 */
	it("does not write over a file that takes the name at the last moment, without hard links", async () => {
		hooks.noHardLinks = true;
		const to = path.join(folder, "b.mp4");
		hooks.beforeCopyOrSymlink = async (destination) => {
			if (destination === to) await fs.writeFile(to, "theirs");
		};
		await expect(
			moveWithoutOverwriting({ from: path.join(folder, "a.mp4"), to })
		).rejects.toBeInstanceOf(MediaNameTakenError);
		expect(await fs.readFile(to, "utf8")).toBe("theirs");
		expect(await fs.readFile(path.join(folder, "a.mp4"), "utf8")).toBe("mine");
	});

	it.skipIf(process.platform === "win32")(
		"does not write over a file that takes a symbolic link's new name at the last moment",
		async () => {
			await fs.symlink(
				path.join(folder, "a.mp4"),
				path.join(folder, "link.mp4")
			);
			const to = path.join(folder, "b.mp4");
			hooks.beforeCopyOrSymlink = async (destination) => {
				if (destination === to) await fs.writeFile(to, "theirs");
			};
			await expect(
				moveWithoutOverwriting({ from: path.join(folder, "link.mp4"), to })
			).rejects.toBeInstanceOf(MediaNameTakenError);
			expect(await fs.readFile(to, "utf8")).toBe("theirs");
			expect(
				(await fs.lstat(path.join(folder, "link.mp4"))).isSymbolicLink()
			).toBe(true);
		}
	);

	it.skipIf(process.platform === "win32")(
		"keeps a relative symbolic link pointing at its file from another folder",
		async () => {
			await fs.mkdir(path.join(folder, "imported"));
			await fs.symlink(
				path.join("..", "a.mp4"),
				path.join(folder, "imported", "link.mp4")
			);
			await moveWithoutOverwriting({
				from: path.join(folder, "imported", "link.mp4"),
				to: path.join(folder, "moved.mp4"),
			});
			expect(await fs.readlink(path.join(folder, "moved.mp4"))).toBe("a.mp4");
			expect(await fs.readFile(path.join(folder, "moved.mp4"), "utf8")).toBe(
				"mine"
			);
		}
	);
});
