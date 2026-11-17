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

function renderedFile({ name = "shake_03.mov" } = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "qcut-media-replace-"));
	dirs.push(dir);
	const file = join(dir, name);
	writeFileSync(file, "");
	return file;
}

const OLD = "media_old";
const NEW = "media_new";
/** The id the new item has once it carries the old item's name again. */
const NAMED = "media_named_shake_03";

/** An editor with two clips of the old media, one of another, and its API. */
function fakeEditor({
	refuse,
	stickyClip,
	removalFails = false,
	transactionFails,
	renameRefused = false,
	mediaAfterRename,
}: {
	/** The clip whose swap the editor refuses, and with what status. */
	refuse?: { elementId: string; status: number };
	/** A clip the editor reports as still playing the old media afterwards. */
	stickyClip?: string;
	removalFails?: boolean;
	/** The transaction call the editor does not answer. */
	transactionFails?: "begin" | "commit" | "rollback";
	/** The old name was taken again before the new item could have it. */
	renameRefused?: boolean;
	/**
	 * What the project's media list holds once the rename request has
	 * failed, or "unreadable" when the list cannot be had either. Left out:
	 * the new item under its spare name, beside whatever took the old name.
	 */
	mediaAfterRename?: Array<{ id: string; name: string }> | "unreadable";
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
		if (path === "/api/claude/media/p1") {
			if (mediaAfterRename === "unreadable") {
				throw new Error("the editor did not answer");
			}
			return (
				mediaAfterRename ?? [
					{ id: NEW, name: "shake_03_1.mov" },
					{ id: "media_someone_elses", name: "shake_03.mov" },
				]
			);
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
		if (transactionFails && path.endsWith(`/${transactionFails}`)) {
			throw new Error("the editor did not answer");
		}
		if (path === "/api/claude/transaction/begin") {
			return { transactionId: "txn-1" };
		}
		return {};
	});
	const patch = vi.fn(async (path: string, body: Record<string, unknown>) => {
		if (path === `/api/claude/media/p1/${NEW}/rename`) {
			log.push(`RENAME ${NEW} to ${JSON.stringify(body)}`);
			if (renameRefused) {
				throw new EditorApiError(
					"shake_03.mov is already taken in the project's media folder",
					500
				);
			}
			return {
				renamed: true,
				id: NAMED,
				name: body.newName,
				previousId: NEW,
				previousName: "shake_03_1.mov",
			};
		}
		const elementId = decodeURIComponent(path.split("/").at(-1) ?? "");
		log.push(`PATCH ${elementId}`);
		if (refuse?.elementId === elementId) {
			throw new EditorApiError(
				"The new media ends before the clip's out-point",
				refuse.status
			);
		}
		playing.set(elementId, String(body.mediaId));
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
		const result = await mediaReplace(
			editor.client,
			options({ source: renderedFile({ name: "shake_03_take2.mov" }) })
		);

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
		// A file with a name of its own keeps the name it was imported under.
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

	/**
	 * The usual case: the file was rendered again under its own name. It is
	 * imported as `shake_03_1.mov` because the old item still holds the name;
	 * left there, a script that finds media by file name no longer finds it.
	 */
	it("gives a file with the old item's name that name back once the old item is gone", async () => {
		const editor = fakeEditor();
		const result = await mediaReplace(editor.client, options());

		expect(result).toEqual({
			success: true,
			data: {
				oldMediaId: OLD,
				oldName: "shake_03.mov",
				mediaId: NAMED,
				name: "shake_03.mov",
				importedAs: "shake_03_1.mov",
				clips: [
					{ elementId: "shake-a", trackId: "overlays", name: "shake-a" },
					{ elementId: "shake-b", trackId: "overlays", name: "shake-b" },
				],
				oldMediaRemoved: true,
			},
		});
		// Only after the old item is removed, and never onto a taken name.
		expect(editor.log.slice(-2)).toEqual([
			`DELETE /api/claude/media/p1/${OLD}`,
			`RENAME ${NEW} to {"newName":"shake_03.mov","exactName":true}`,
		]);
	});

	it("keeps the spare name, and says so, when the old name cannot be had", async () => {
		const editor = fakeEditor({ renameRefused: true });
		const result = await mediaReplace(editor.client, options());

		expect(result).toMatchObject({
			success: true,
			data: {
				mediaId: NEW,
				name: "shake_03_1.mov",
				oldMediaRemoved: true,
				warning:
					"shake_03_1.mov could not be given the name shake_03.mov back (shake_03.mov is already taken in the project's media folder); it keeps shake_03_1.mov",
			},
		});
	});

	/**
	 * The rename route moves the file before it answers. An answer that is
	 * lost or late is a failure to the command, while the file has its old
	 * name back, and with it the old id.
	 */
	it("reports the name the file has when the rename landed but its answer did not", async () => {
		const editor = fakeEditor({
			renameRefused: true,
			mediaAfterRename: [{ id: NAMED, name: "shake_03.mov" }],
		});
		const result = await mediaReplace(editor.client, options());

		expect(result).toMatchObject({
			success: true,
			data: {
				mediaId: NAMED,
				name: "shake_03.mov",
				importedAs: "shake_03_1.mov",
				oldMediaRemoved: true,
			},
		});
		expect(
			(result.data as { warning?: string } | undefined)?.warning
		).toBeUndefined();
	});

	it("does not claim a name it could not look up", async () => {
		const editor = fakeEditor({
			renameRefused: true,
			mediaAfterRename: "unreadable",
		});
		const result = await mediaReplace(editor.client, options());

		expect(result).toMatchObject({
			success: true,
			data: {
				oldMediaRemoved: true,
				warning:
					'shake_03_1.mov may not have been given the name shake_03.mov back (shake_03.mov is already taken in the project\'s media folder); "qcut editor:media:list --project-id p1" shows the name and id it has now',
			},
		});
	});

	it("leaves the names alone while the old item is still in the project", async () => {
		for (const editor of [
			fakeEditor({ stickyClip: "shake-b" }),
			fakeEditor({ removalFails: true }),
		]) {
			const result = await mediaReplace(editor.client, options());
			expect(result).toMatchObject({
				success: true,
				data: { mediaId: NEW, name: "shake_03_1.mov", oldMediaRemoved: false },
			});
			expect(editor.log.some((entry) => entry.startsWith("RENAME"))).toBe(
				false
			);
		}
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

	it("takes its import back when the replace cannot even be started", async () => {
		const editor = fakeEditor({ transactionFails: "begin" });
		const result = await mediaReplace(editor.client, options());

		expect(result).toEqual({
			success: false,
			error:
				"The replace could not be started: the editor did not answer. No clip was changed.",
		});
		expect(editor.patch).not.toHaveBeenCalled();
		expect(editor.log.at(-1)).toBe(`DELETE /api/claude/media/p1/${NEW}`);
	});

	it("says what is left when a refused replace cannot be rolled back either", async () => {
		const editor = fakeEditor({
			refuse: { elementId: "shake-b", status: 409 },
			transactionFails: "rollback",
		});
		const result = await mediaReplace(editor.client, options());

		// The first clip was changed and may still play the new file, so the
		// import stays, and the open transaction is named.
		expect(result).toEqual({
			success: false,
			error:
				"Clip shake-b (shake-b) could not take shake_03_1.mov: The new media ends before the clip's out-point. " +
				"The clips changed before it could not be put back either: the rollback failed (the editor did not answer). " +
				'Transaction txn-1 may still be open; the editor rolls it back when it times out, and "qcut editor:transaction:rollback --transaction-id txn-1" does it now. ' +
				`shake_03_1.mov (${NEW}) was left in the project, since clips may still play it; once none does, "qcut editor:media:delete --project-id p1 --media-id ${NEW}" removes it.`,
		});
		expect(editor.remove).not.toHaveBeenCalled();
	});

	it("does not call the replace done when it cannot be committed", async () => {
		const editor = fakeEditor({ transactionFails: "commit" });
		const result = await mediaReplace(editor.client, options());

		expect(result.success).toBe(false);
		expect(result.error).toBe(
			"Every clip was given shake_03_1.mov, but the change could not be committed (the editor did not answer). " +
				'Transaction txn-1 may still be open; the editor rolls it back when it times out, and "qcut editor:transaction:rollback --transaction-id txn-1" does it now. ' +
				`shake_03_1.mov (${NEW}) was left in the project, since clips may still play it; once none does, "qcut editor:media:delete --project-id p1 --media-id ${NEW}" removes it. ` +
				"shake_03.mov was kept."
		);
		// Neither item is removed: the clips play one now and the other after
		// a rollback.
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
