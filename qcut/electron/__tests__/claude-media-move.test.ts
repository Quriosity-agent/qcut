import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	/** Stands in for a volume that has no hard links. */
	noHardLinks: false,
	/** Runs when a copy, or a new symbolic link, is about to take `to`. */
	beforeCopyOrSymlink: undefined as undefined | ((to: string) => Promise<void>),
	/**
	 * Runs once a part of the file has been read for a copy, before it is
	 * written. What it throws breaks the copy off.
	 */
	whileCopying: undefined as undefined | (() => Promise<void>),
	/** Runs right after a hard link was made. */
	afterLink: undefined as undefined | (() => Promise<void>),
	/** The paths whose file cannot be removed. */
	removalRefused: new Set<string>(),
}));

vi.mock("fs", async (importOriginal) => {
	const real = await importOriginal<typeof import("fs")>();
	const { Readable } = await import("node:stream");
	return {
		...real,
		createReadStream: (...args: Parameters<typeof real.createReadStream>) => {
			const file = real.createReadStream(...args);
			if (!hooks.whileCopying) return file;
			return Readable.from(
				(async function* () {
					for await (const chunk of file) {
						await hooks.whileCopying?.();
						yield chunk;
					}
				})()
			);
		},
	};
});

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
			await real.link(...args);
			await hooks.afterLink?.();
		},
		// A copy begins by making its file where nothing is.
		open: async (...args: Parameters<typeof real.open>) => {
			if (args[1] === "wx") await hooks.beforeCopyOrSymlink?.(String(args[0]));
			return real.open(...args);
		},
		unlink: async (...args: Parameters<typeof real.unlink>) => {
			if (hooks.removalRefused.has(String(args[0]))) {
				throw Object.assign(new Error("EPERM: operation not permitted"), {
					code: "EPERM",
				});
			}
			return real.unlink(...args);
		},
		symlink: async (...args: Parameters<typeof real.symlink>) => {
			await hooks.beforeCopyOrSymlink?.(String(args[1]));
			return real.symlink(...args);
		},
	};
});

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => os.tmpdir()) },
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

import {
	MediaMoveIncompleteError,
	MediaNameTakenError,
	moveWithoutOverwriting,
} from "../claude/handlers/claude-media-rename.js";

describe("moving a file without writing over another", () => {
	let folder = "";

	beforeEach(async () => {
		folder = await fs.mkdtemp(path.join(os.tmpdir(), "qcut-media-move-"));
		await fs.writeFile(path.join(folder, "a.mp4"), "mine");
	});

	afterEach(async () => {
		hooks.noHardLinks = false;
		hooks.beforeCopyOrSymlink = undefined;
		hooks.whileCopying = undefined;
		hooks.afterLink = undefined;
		hooks.removalRefused.clear();
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

	it("copies a file that is read in several parts whole", async () => {
		hooks.noHardLinks = true;
		// More than two of the parts a copy is read in.
		const picture = Buffer.alloc(9 * 1024 * 1024 + 123);
		for (let at = 0; at < picture.length; at += 4099) picture[at] = at % 251;
		await fs.writeFile(path.join(folder, "long.mp4"), picture);
		await moveWithoutOverwriting({
			from: path.join(folder, "long.mp4"),
			to: path.join(folder, "moved.mp4"),
		});
		expect((await fs.readdir(folder)).sort()).toEqual(["a.mp4", "moved.mp4"]);
		const moved = await fs.readFile(path.join(folder, "moved.mp4"));
		expect(moved.equals(picture)).toBe(true);
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

	/**
	 * A copy can break off with a part of the file written (the volume is
	 * full, the source cannot be read on). That part is this move's own
	 * file, and is taken away again.
	 */
	it("takes away the part it wrote when a copy breaks off", async () => {
		hooks.noHardLinks = true;
		hooks.whileCopying = async () => {
			// The file is there by now, made by the move.
			expect(await fs.readdir(folder)).toEqual(["a.mp4", "b.mp4"]);
			throw Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" });
		};
		await expect(
			moveWithoutOverwriting({
				from: path.join(folder, "a.mp4"),
				to: path.join(folder, "b.mp4"),
			})
		).rejects.toMatchObject({ code: "EIO" });
		expect(await fs.readdir(folder)).toEqual(["a.mp4"]);
		expect(await fs.readFile(path.join(folder, "a.mp4"), "utf8")).toBe("mine");
	});

	it("says that the file is under both names when that part cannot be taken away", async () => {
		hooks.noHardLinks = true;
		const to = path.join(folder, "b.mp4");
		hooks.whileCopying = async () => {
			throw Object.assign(new Error("ENOSPC: no space left on device"), {
				code: "ENOSPC",
			});
		};
		hooks.removalRefused.add(to);
		const failure = await moveWithoutOverwriting({
			from: path.join(folder, "a.mp4"),
			to,
		}).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(MediaMoveIncompleteError);
		expect((failure as Error).message).toContain("no space left on device");
		expect((await fs.readdir(folder)).sort()).toEqual(["a.mp4", "b.mp4"]);
		expect(await fs.readFile(path.join(folder, "a.mp4"), "utf8")).toBe("mine");
	});

	/** As another program does that writes a file by renaming it into place. */
	const replaceWithTheirs = async (to: string) => {
		await fs.writeFile(path.join(folder, "theirs.tmp"), "theirs");
		await fs.rename(path.join(folder, "theirs.tmp"), to);
	};

	/**
	 * A rename by another program replaces the file a copy is being written
	 * to. That file is the other program's from then on: it is not removed
	 * when the copy fails, and the old name is not given up for it.
	 */
	// Windows does not let a file be replaced while it is open.
	it.skipIf(process.platform === "win32")(
		"leaves alone a file that replaces its copy while the copy is made",
		async () => {
			hooks.noHardLinks = true;
			const from = path.join(folder, "a.mp4");
			const to = path.join(folder, "b.mp4");

			// The copy goes through, into a file that no longer has the name.
			hooks.whileCopying = () => replaceWithTheirs(to);
			await expect(moveWithoutOverwriting({ from, to })).rejects.toBeInstanceOf(
				MediaNameTakenError
			);
			expect(await fs.readFile(to, "utf8")).toBe("theirs");
			expect(await fs.readFile(from, "utf8")).toBe("mine");

			// The copy breaks off after it was replaced.
			await fs.unlink(to);
			hooks.whileCopying = async () => {
				await replaceWithTheirs(to);
				throw Object.assign(new Error("EIO: i/o error, read"), {
					code: "EIO",
				});
			};
			await expect(moveWithoutOverwriting({ from, to })).rejects.toMatchObject({
				code: "EIO",
			});
			expect(await fs.readFile(to, "utf8")).toBe("theirs");
			expect(await fs.readFile(from, "utf8")).toBe("mine");
		}
	);

	/**
	 * The same for a hard link: with the new name replaced before the old
	 * one is given up, the file would be under neither.
	 */
	it("does not give up the old name when the new one is another file's by then", async () => {
		const from = path.join(folder, "a.mp4");
		const to = path.join(folder, "b.mp4");
		hooks.afterLink = () => replaceWithTheirs(to);
		await expect(moveWithoutOverwriting({ from, to })).rejects.toBeInstanceOf(
			MediaNameTakenError
		);
		expect(await fs.readFile(to, "utf8")).toBe("theirs");
		expect(await fs.readFile(from, "utf8")).toBe("mine");
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
