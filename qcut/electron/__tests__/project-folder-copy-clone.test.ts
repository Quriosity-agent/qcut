import { execFile } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyProjectFolderContents } from "../lib/project-folder-copy.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const platform = Object.getOwnPropertyDescriptor(process, "platform");
let root = "";
let source = "";

beforeEach(() => {
	// Node cannot clone files on macOS, so a duplicate there goes through cp -c.
	Object.defineProperty(process, "platform", { value: "darwin" });
	root = mkdtempSync(path.join(tmpdir(), "qcut-project-clone-"));
	source = path.join(root, "src");
	mkdirSync(path.join(source, "media"), { recursive: true });
	writeFileSync(path.join(source, "media", "clip.mp4"), "video");
});

afterEach(() => {
	if (platform) Object.defineProperty(process, "platform", platform);
	vi.mocked(execFile).mockReset();
	rmSync(root, { recursive: true, force: true });
});

describe("project media copies on macOS", () => {
	it("clones the media files with cp -c", async () => {
		vi.mocked(execFile).mockImplementation(((
			_file: string,
			_args: string[],
			callback: (error: Error | null) => void
		) => callback(null)) as unknown as typeof execFile);
		await copyProjectFolderContents({
			sourceRoot: source,
			targetRoot: path.join(root, "dst"),
		});
		expect(vi.mocked(execFile).mock.calls[0].slice(0, 2)).toEqual([
			"/bin/cp",
			[
				"-c",
				"-f",
				"-R",
				`${path.join(source, "media")}/.`,
				path.join(root, "dst", "media"),
			],
		]);
	});

	it("copies the files itself when cp fails", async () => {
		vi.mocked(execFile).mockImplementation(((
			_file: string,
			_args: string[],
			callback: (error: Error | null) => void
		) => callback(new Error("cp: unavailable"))) as unknown as typeof execFile);
		const result = await copyProjectFolderContents({
			sourceRoot: source,
			targetRoot: path.join(root, "dst"),
		});
		expect(result.copiedMedia).toBe(true);
		expect(
			readFileSync(path.join(root, "dst", "media", "clip.mp4"), "utf8")
		).toBe("video");
	});
});
