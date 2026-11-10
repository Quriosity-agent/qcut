import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_ACTION_POLICY,
	evaluateActionPolicy,
} from "../native-pipeline/cli/action-policy.js";
import { parseCliArgs } from "../native-pipeline/cli/cli.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import { getCommand } from "../native-pipeline/cli/command-registry.js";
import {
	type EditorApiClient,
	EditorApiError,
} from "../native-pipeline/editor/editor-api-client.js";
import { mediaReplace } from "../native-pipeline/editor/editor-handlers-media-replace.js";

/**
 * `editor:media:replace`: a file rendered again goes in the place of the
 * media item it was imported as. Importing it alone adds `name_1.ext` beside
 * the old item, and the clips go on playing the old one.
 */

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function renderedFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "qcut-media-replace-"));
	dirs.push(dir);
	const file = join(dir, "shake_03.mov");
	writeFileSync(file, "");
	return file;
}

const OLD = "media_old";
const NEW = "media_new";

/** An editor with two clips of the old media, one of another, and its API. */
function fakeEditor({
	refuse,
	stickyClip,
	removalFails = false,
}: {
	/** The clip whose swap the editor refuses, and with what status. */
	refuse?: { elementId: string; status: number };
	/** A clip the editor reports as still playing the old media afterwards. */
	stickyClip?: string;
	removalFails?: boolean;
} = {}) {
	const playing = new Map<string, string>([
		["shake-a", OLD],
		["shake-b", OLD],
		["other", "media_other"],
	]);
	const log: string[] = [];
	const get = vi.fn(async (path: string) => {
		if (path === `/api/claude/media/p1/${OLD}`) {
			return { id: OLD, name: "shake_03.mov", duration: 4 };
		}
		if (path === `/api/claude/media/p1/${NEW}`) {
			return { id: NEW, name: "shake_03_1.mov", duration: 6 };
		}
		if (path.startsWith("/api/claude/media/")) return null;
		return {
			name: "v2",
			tracks: [
				{
					id: "overlays",
					index: 0,
					name: "Overlays",
					elements: [...playing].map(([id, mediaId]) => ({
						id,
						name: id,
						sourceId: id === stickyClip ? OLD : mediaId,
					})),
				},
			],
		};
	});
	const post = vi.fn(async (path: string) => {
		log.push(`POST ${path}`);
		if (path.endsWith("/batch-import")) {
			return [
				{
					index: 0,
					success: true,
					editorReady: true,
					mediaFile: { id: NEW, name: "shake_03_1.mov" },
				},
			];
		}
		if (path === "/api/claude/transaction/begin") {
			return { transactionId: "txn-1" };
		}
		return {};
	});
	const patch = vi.fn(async (path: string, body: { mediaId: string }) => {
		const elementId = decodeURIComponent(path.split("/").at(-1) ?? "");
		log.push(`PATCH ${elementId}`);
		if (refuse?.elementId === elementId) {
			throw new EditorApiError(
				"The new media ends before the clip's out-point",
				refuse.status
			);
		}
		playing.set(elementId, body.mediaId);
		return { updated: true };
	});
	const remove = vi.fn(async (path: string) => {
		log.push(`DELETE ${path}`);
		if (removalFails) throw new Error("the file is in use");
		return true;
	});
	return {
		client: { get, post, patch, delete: remove } as unknown as EditorApiClient,
		log,
		patch,
		remove,
	};
}

const options = (overrides: Partial<CLIRunOptions> = {}): CLIRunOptions =>
	({
		command: "editor:media:replace",
		projectId: "p1",
		mediaId: OLD,
		source: renderedFile(),
		...overrides,
	}) as CLIRunOptions;

describe("editor media replace", () => {
	it("registers, reads its flags and asks before it removes the old item", () => {
		expect(
			getCommand("editor:media:replace")?.flags.map((flag) => flag.name)
		).toEqual(["--project-id", "--media-id", "--source"]);
		expect(
			parseCliArgs([
				"editor",
				"media",
				"replace",
				"--project-id",
				"p",
				"--media-id",
				"m",
				"--source",
				"/tmp/x.mov",
			])
		).toMatchObject({
			command: "editor:media:replace",
			projectId: "p",
			mediaId: "m",
			source: "/tmp/x.mov",
		});
		expect(
			evaluateActionPolicy({
				command: "editor:media:replace",
				policy: DEFAULT_ACTION_POLICY,
			}).decision
		).toBe("confirm");
	});

	it("imports the file, gives it to every clip of the old media in one undo step, then removes the old media", async () => {
		const editor = fakeEditor();
		const result = await mediaReplace(editor.client, options());

		expect(result).toEqual({
			success: true,
			data: {
				oldMediaId: OLD,
				oldName: "shake_03.mov",
				mediaId: NEW,
				name: "shake_03_1.mov",
				clips: [
					{ elementId: "shake-a", trackId: "overlays", name: "shake-a" },
					{ elementId: "shake-b", trackId: "overlays", name: "shake-b" },
				],
				oldMediaRemoved: true,
			},
		});
		expect(editor.log).toEqual([
			"POST /api/claude/media/p1/batch-import",
			"POST /api/claude/transaction/begin",
			"PATCH shake-a",
			"PATCH shake-b",
			"POST /api/claude/transaction/txn-1/commit",
			`DELETE /api/claude/media/p1/${OLD}`,
		]);
		// The new file's length goes with the swap, as replace-media sends it.
		expect(editor.patch).toHaveBeenCalledWith(
			"/api/claude/timeline/p1/elements/shake-a",
			{ mediaId: NEW, sourceDuration: 6 }
		);
	});

	it("puts every clip back and takes its import back when the editor refuses one", async () => {
		const editor = fakeEditor({
			refuse: { elementId: "shake-b", status: 409 },
		});
		const result = await mediaReplace(editor.client, options());

		expect(result).toEqual({
			success: false,
			error:
				"Clip shake-b (shake-b) could not take shake_03_1.mov: The new media ends before the clip's out-point. No clip was changed.",
		});
		expect(editor.log.slice(-2)).toEqual([
			"POST /api/claude/transaction/txn-1/rollback",
			`DELETE /api/claude/media/p1/${NEW}`,
		]);
	});

	it("keeps its import after any other failure, and says how to remove it", async () => {
		const editor = fakeEditor({
			refuse: { elementId: "shake-a", status: 504 },
		});
		const result = await mediaReplace(editor.client, options());

		expect(result.success).toBe(false);
		expect(result.error).toContain(
			`shake_03_1.mov (${NEW}) is still in the project ("qcut editor:media:delete --project-id p1 --media-id ${NEW}" removes it).`
		);
		expect(editor.remove).not.toHaveBeenCalled();
	});

	it("keeps the old media while any clip still plays it, since removing it would remove the clip", async () => {
		const editor = fakeEditor({ stickyClip: "shake-b" });
		const result = await mediaReplace(editor.client, options());

		expect(result).toMatchObject({
			success: true,
			data: {
				mediaId: NEW,
				oldMediaRemoved: false,
				warning: "1 clip(s) still play shake_03.mov (shake-b), so it was kept",
			},
		});
		expect(editor.remove).not.toHaveBeenCalled();
	});

	it("says so when the old media could not be removed", async () => {
		const editor = fakeEditor({ removalFails: true });
		const result = await mediaReplace(editor.client, options());

		expect(result).toMatchObject({
			success: true,
			data: {
				oldMediaRemoved: false,
				warning: expect.stringContaining(
					`shake_03.mov could not be removed (the file is in use); "qcut editor:media:delete --project-id p1 --media-id ${OLD}" removes it`
				),
			},
		});
	});

	it("refuses what it cannot act on before importing anything", async () => {
		for (const [overrides, error] of [
			[{ projectId: undefined }, "Missing --project-id"],
			[{ mediaId: undefined }, "Missing --media-id"],
			[{ source: undefined }, "Missing --source"],
			[{ source: "/nowhere/shake.mov" }, "File not found: /nowhere/shake.mov"],
			[
				{ mediaId: "media_gone" },
				"Media media_gone is not in project p1 (see editor:media:list)",
			],
		] as const) {
			const editor = fakeEditor();
			expect(await mediaReplace(editor.client, options(overrides))).toEqual({
				success: false,
				error,
			});
			expect(editor.log).toEqual([]);
		}
	});
});
