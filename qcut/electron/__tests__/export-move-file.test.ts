import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const real =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const realSync = await vi.importActual<typeof import("node:fs")>("node:fs");
const rename = vi.fn(real.rename);
const copyFile = vi.fn(real.copyFile);
const renameSync = vi.fn(realSync.renameSync);
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		rename: (...args: Parameters<typeof actual.rename>) => rename(...args),
		copyFile: (...args: Parameters<typeof actual.copyFile>) =>
			copyFile(...args),
	};
});
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		renameSync: (...args: Parameters<typeof actual.renameSync>) =>
			renameSync(...args),
	};
});

import {
	moveFile,
	moveFileSync,
} from "../claude/handlers/claude-export-handler/move-file.js";

/** Moving an export into the temp directory, on one disk and across two. */
describe("moveFile", () => {
	let dir = "";
	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "qcut-move-"));
		rename.mockImplementation(real.rename);
		copyFile.mockImplementation(real.copyFile);
		renameSync.mockImplementation(realSync.renameSync);
	});
	afterEach(() => rm(dir, { recursive: true, force: true }));

	it("renames on the same device", async () => {
		const from = path.join(dir, "a.mp4");
		const to = path.join(dir, "b.mp4");
		await writeFile(from, "video");
		await moveFile({ from, to });
		expect(await readFile(to, "utf8")).toBe("video");
		await expect(stat(from)).rejects.toThrow();
	});

	it("copies and deletes when the rename crosses devices", async () => {
		const from = path.join(dir, "export.mp4");
		const to = path.join(dir, "temp", "video-before-audio-mix.mp4");
		await real.mkdir(path.dirname(to));
		await writeFile(from, "video on another disk");
		rename.mockImplementationOnce(async () => {
			throw Object.assign(new Error("EXDEV: cross-device link not permitted"), {
				code: "EXDEV",
			});
		});
		await moveFile({ from, to });
		expect(await readFile(to, "utf8")).toBe("video on another disk");
		await expect(stat(from)).rejects.toThrow();
	});

	it("removes a partial copy when the cross-device copy fails", async () => {
		const from = path.join(dir, "export.mp4");
		const to = path.join(dir, "video-before-audio-mix.mp4");
		await writeFile(from, "video on another disk");
		rename.mockImplementationOnce(async () => {
			throw Object.assign(new Error("EXDEV: cross-device link not permitted"), {
				code: "EXDEV",
			});
		});
		copyFile.mockImplementationOnce(async (_source, destination) => {
			await real.writeFile(destination, "video on");
			throw Object.assign(new Error("ENOSPC: no space left on device"), {
				code: "ENOSPC",
			});
		});
		await expect(moveFile({ from, to })).rejects.toThrow("ENOSPC");
		await expect(stat(to)).rejects.toThrow();
		expect(await readFile(from, "utf8")).toBe("video on another disk");
	});

	it("moves synchronously across devices too", async () => {
		const from = path.join(dir, "export.mp4");
		const to = path.join(dir, "frames", "concat_before_audio.mp4");
		await real.mkdir(path.dirname(to));
		await writeFile(from, "video on another disk");
		renameSync.mockImplementationOnce(() => {
			throw Object.assign(new Error("EXDEV: cross-device link not permitted"), {
				code: "EXDEV",
			});
		});
		moveFileSync({ from, to });
		expect(await readFile(to, "utf8")).toBe("video on another disk");
		await expect(stat(from)).rejects.toThrow();
	});

	it("is what the export paths use instead of a bare rename", async () => {
		const handlerDir = path.resolve(
			__dirname,
			"../claude/handlers/claude-export-handler"
		);
		for (const file of [
			path.join(handlerDir, "export-engine.ts"),
			path.resolve(__dirname, "../ffmpeg-export-mode15.ts"),
		]) {
			const source = await real.readFile(file, "utf8");
			expect(source, file).not.toMatch(/\brename(Sync)?\(/);
			expect(source, file).toMatch(/moveFile(Sync)?\(/);
		}
	});

	it("passes other errors through", async () => {
		rename.mockImplementationOnce(async () => {
			throw Object.assign(new Error("EACCES"), { code: "EACCES" });
		});
		await expect(
			moveFile({ from: path.join(dir, "x"), to: path.join(dir, "y") })
		).rejects.toThrow("EACCES");
	});
});
