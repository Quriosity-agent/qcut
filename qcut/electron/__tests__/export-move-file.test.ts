import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const real =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const rename = vi.fn(real.rename);
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		rename: (...args: Parameters<typeof actual.rename>) => rename(...args),
	};
});

import { moveFile } from "../claude/handlers/claude-export-handler/move-file.js";

/** Moving an export into the temp directory, on one disk and across two. */
describe("moveFile", () => {
	let dir = "";
	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "qcut-move-"));
		rename.mockImplementation(real.rename);
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

	it("passes other errors through", async () => {
		rename.mockImplementationOnce(async () => {
			throw Object.assign(new Error("EACCES"), { code: "EACCES" });
		});
		await expect(
			moveFile({ from: path.join(dir, "x"), to: path.join(dir, "y") })
		).rejects.toThrow("EACCES");
	});
});
