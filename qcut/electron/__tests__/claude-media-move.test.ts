import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	/** Stands in for a volume that has no hard links. */
	noHardLinks: false,
	/** Runs when a copy, or a new symbolic link, is about to take `to`. */
	beforeCopyOrSymlink: undefined as undefined | ((to: string) => Promise<void>),
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
