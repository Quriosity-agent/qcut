import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyProjectFolderContents } from "../lib/project-folder-copy.js";

describe("copyProjectFolderContents", () => {
	let root: string;
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("copies the media tree and project.qcut into the target folder", async () => {
		root = mkdtempSync(path.join(tmpdir(), "qcut-project-copy-"));
		const source = path.join(root, "src");
		mkdirSync(path.join(source, "media", "imported"), { recursive: true });
		writeFileSync(path.join(source, "media", "08.mp4"), "video");
		writeFileSync(path.join(source, "media", "imported", "x.mov"), "mov");
		writeFileSync(path.join(source, "project.qcut"), '{"name":"门的计划"}');
		writeFileSync(path.join(source, "project.json"), "{}");

		const result = await copyProjectFolderContents({
			sourceRoot: source,
			targetRoot: path.join(root, "dst"),
		});

		expect(result).toEqual({
			sourceRoot: source,
			targetRoot: path.join(root, "dst"),
			copiedMedia: true,
			copiedSettings: true,
		});
		expect(
			readFileSync(path.join(root, "dst", "media", "08.mp4"), "utf8")
		).toBe("video");
		expect(
			readFileSync(path.join(root, "dst", "media", "imported", "x.mov"), "utf8")
		).toBe("mov");
		expect(readFileSync(path.join(root, "dst", "project.qcut"), "utf8")).toBe(
			'{"name":"门的计划"}'
		);
	});

	it("leaves the source alone when the copy changes, and the copy when the source does", async () => {
		root = mkdtempSync(path.join(tmpdir(), "qcut-project-copy-"));
		const source = path.join(root, "src");
		mkdirSync(path.join(source, "media"), { recursive: true });
		writeFileSync(path.join(source, "media", "clip.mp4"), "source video");
		writeFileSync(path.join(source, "media", "card.png"), "card");

		await copyProjectFolderContents({
			sourceRoot: source,
			targetRoot: path.join(root, "dst"),
		});
		writeFileSync(path.join(root, "dst", "media", "clip.mp4"), "edited copy");
		rmSync(path.join(root, "dst", "media", "card.png"));
		expect(readFileSync(path.join(source, "media", "clip.mp4"), "utf8")).toBe(
			"source video"
		);
		expect(readFileSync(path.join(source, "media", "card.png"), "utf8")).toBe(
			"card"
		);
		writeFileSync(path.join(source, "media", "clip.mp4"), "edited source");
		expect(
			readFileSync(path.join(root, "dst", "media", "clip.mp4"), "utf8")
		).toBe("edited copy");
	});

	it("reports what was missing and refuses to copy a folder onto itself", async () => {
		root = mkdtempSync(path.join(tmpdir(), "qcut-project-copy-"));
		const source = path.join(root, "empty");
		mkdirSync(source);
		expect(
			await copyProjectFolderContents({
				sourceRoot: source,
				targetRoot: path.join(root, "dst"),
			})
		).toMatchObject({ copiedMedia: false, copiedSettings: false });
		await expect(
			copyProjectFolderContents({ sourceRoot: source, targetRoot: source })
		).rejects.toThrow("onto itself");
	});
});
