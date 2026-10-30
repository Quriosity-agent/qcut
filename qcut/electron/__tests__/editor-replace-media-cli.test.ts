import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { timelineReplaceMedia } from "../native-pipeline/editor/editor-handlers-replace-media.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import { getCommand } from "../native-pipeline/cli/command-registry.js";
import { parseCliArgs } from "../native-pipeline/cli/cli.js";

/**
 * N24 (2026-10-30 trailer report): `editor:timeline:replace-media` swaps a
 * clip's media in one step and answers with the clip as the timeline now
 * holds it.
 */

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function shotFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "qcut-replace-"));
	dirs.push(dir);
	const file = join(dir, "05_v2.mp4");
	writeFileSync(file, "");
	return file;
}

function timelineWith(clip: Record<string, unknown>) {
	return {
		name: "v21",
		tracks: [{ id: "main", index: 0, name: "主轨道", elements: [clip] }],
	};
}

const replaced = {
	id: "shot",
	name: "05_v2.mp4",
	sourceId: "v2",
	sourceName: "05_v2.mp4",
	startTime: 2,
	endTime: 7,
	trimStart: 3,
	trimEnd: 4,
};

function fakeClient({
	imported = {
		index: 0,
		success: true,
		editorReady: true,
		mediaFile: { id: "v2", name: "05_v2.mp4" },
	},
	clipAfter = replaced,
}: {
	imported?: Record<string, unknown>;
	clipAfter?: Record<string, unknown>;
} = {}) {
	const post = vi.fn(async () => [imported]);
	const get = vi.fn(async (path: string) =>
		path.startsWith("/api/claude/media/")
			? { id: "v2", duration: 12 }
			: timelineWith(clipAfter)
	);
	const patch = vi.fn(async () => ({ updated: true }));
	const remove = vi.fn(async () => true);
	return {
		client: { post, get, patch, delete: remove } as unknown as EditorApiClient,
		post,
		get,
		patch,
		remove,
	};
}

const options = (overrides: Partial<CLIRunOptions>): CLIRunOptions =>
	({
		command: "editor:timeline:replace-media",
		projectId: "p1",
		elementId: "shot",
		...overrides,
	}) as CLIRunOptions;

describe("editor timeline replace-media", () => {
	it("registers and reads its flags", () => {
		expect(
			getCommand("editor:timeline:replace-media")?.flags.map((f) => f.name)
		).toEqual([
			"--project-id",
			"--element-id",
			"--source",
			"--media-id",
			"--trim-start",
		]);
		expect(
			parseCliArgs([
				"editor",
				"timeline",
				"replace-media",
				"--project-id",
				"p",
				"--element-id",
				"e",
				"--media-id",
				"m",
				"--trim-start",
				"0",
			])
		).toMatchObject({
			command: "editor:timeline:replace-media",
			mediaId: "m",
			trimStart: 0,
		});
		const bad = parseCliArgs([
			"editor",
			"timeline",
			"replace-media",
			"--trim-start",
			"soon",
		]);
		expect(bad.trimStart).toBeNaN();
	});

	it("imports the file, swaps it in, and reports the clip", async () => {
		const source = shotFile();
		const { client, post, get, patch } = fakeClient();
		const result = await timelineReplaceMedia(client, options({ source }));

		expect(post).toHaveBeenCalledWith("/api/claude/media/p1/batch-import", {
			items: [{ path: source }],
		});
		expect(get).toHaveBeenCalledWith("/api/claude/media/p1/v2");
		expect(patch).toHaveBeenCalledWith(
			"/api/claude/timeline/p1/elements/shot",
			{ mediaId: "v2", sourceDuration: 12 }
		);
		expect(result).toEqual({
			success: true,
			data: {
				replaced: true,
				clip: {
					elementId: "shot",
					trackId: "main",
					name: "05_v2.mp4",
					mediaId: "v2",
					sourceName: "05_v2.mp4",
					startTime: 2,
					endTime: 7,
					trimStart: 3,
					trimEnd: 4,
				},
				imported: { id: "v2", name: "05_v2.mp4" },
			},
		});
	});

	it("uses media already in the project, from the in-point it is given", async () => {
		const { client, post, patch } = fakeClient();
		const result = await timelineReplaceMedia(
			client,
			options({ mediaId: "v2", trimStart: 0 })
		);
		expect(post).not.toHaveBeenCalled();
		expect(patch).toHaveBeenCalledWith(
			"/api/claude/timeline/p1/elements/shot",
			{ mediaId: "v2", sourceDuration: 12, trimStart: 0 }
		);
		expect(result.success).toBe(true);
	});

	it("refuses unclear requests before calling the editor", async () => {
		const { client, post, patch } = fakeClient();
		for (const [overrides, error] of [
			[{}, "Give either --source <file> or --media-id <id>"],
			[
				{ source: "/x.mp4", mediaId: "v2" },
				"Give either --source <file> or --media-id <id>",
			],
			[
				{ mediaId: "v2", trimStart: Number.NaN },
				"--trim-start must be a number of seconds, 0 or more",
			],
			[{ source: "/nowhere/05.mp4" }, "File not found: /nowhere/05.mp4"],
		] as const) {
			expect(await timelineReplaceMedia(client, options(overrides))).toEqual({
				success: false,
				error,
			});
		}
		expect(post).not.toHaveBeenCalled();
		expect(patch).not.toHaveBeenCalled();
	});

	it("names the imported media when the editor has not loaded it yet", async () => {
		const { client, patch } = fakeClient({
			imported: {
				index: 0,
				success: true,
				editorReady: false,
				warning: "Copied; the editor is still loading it.",
				mediaFile: { id: "v2", name: "05_v2.mp4" },
			},
		});
		const result = await timelineReplaceMedia(
			client,
			options({ source: shotFile() })
		);
		expect(result).toEqual({
			success: false,
			error:
				"05_v2.mp4 was imported as v2, but the editor has not loaded it yet (Copied; the editor is still loading it.); run again with --media-id v2",
		});
		expect(patch).not.toHaveBeenCalled();
	});

	it("takes back the file it imported when the editor refuses the swap", async () => {
		const { client, patch, remove } = fakeClient();
		patch.mockRejectedValueOnce(new Error("05_v2.mp4 is 3.000 s long"));
		await expect(
			timelineReplaceMedia(client, options({ source: shotFile() }))
		).rejects.toThrow("05_v2.mp4 is 3.000 s long");
		expect(remove).toHaveBeenCalledWith("/api/claude/media/p1/v2");

		// Media that was in the project already stays.
		patch.mockRejectedValueOnce(new Error("too short"));
		await expect(
			timelineReplaceMedia(client, options({ mediaId: "v2" }))
		).rejects.toThrow("too short");
		expect(remove).toHaveBeenCalledTimes(1);
	});

	it("fails when the timeline still shows the old media", async () => {
		const { client } = fakeClient({
			clipAfter: { ...replaced, sourceId: "old", sourceName: "05.mp4" },
		});
		expect(
			await timelineReplaceMedia(client, options({ mediaId: "v2" }))
		).toEqual({
			success: false,
			error: "The editor answered, but clip shot still plays 05.mp4",
		});
	});
});
