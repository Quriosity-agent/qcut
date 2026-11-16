/**
 * The rename route and the desktop app's notes together, over a rename that
 * takes long and goes wrong at every later step.
 *
 * The editor used to tell a rename under way by the age of its note, which
 * the app wrote again every minute. With those writes failing, a project
 * loaded in the middle of a long copy took the note for one the app had
 * left, settled it by the folder as it was then, and dropped it. The copy
 * finished; the editor followed and its answer was lost; the request to go
 * back did not reach it; the file went back; and the app could not note
 * that. Nothing was left to settle the rename by, and the stored project
 * named an id no file had.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
	userData: "",
	/** The app's store cannot be written. */
	storeIsFull: false,
}));

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => testState.userData),
		getVersion: vi.fn(() => "0.0.1-test"),
		isPackaged: false,
	},
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	},
	BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock("../main-ipc/storage-json.js", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("../main-ipc/storage-json.js")>();
	return {
		...real,
		writeStorageJson: async (
			...args: Parameters<typeof real.writeStorageJson>
		) => {
			if (testState.storeIsFull) throw new Error("the disk is full");
			return real.writeStorageJson(...args);
		},
	};
});

vi.mock("../claude/handlers/claude-media-rename.js", async (original) => ({
	...(await original<Record<string, unknown>>()),
	renameMediaFileOnDisk: vi.fn(),
	undoMediaRename: vi.fn(),
}));

import {
	renameMediaFileOnDisk,
	undoMediaRename,
} from "../claude/handlers/claude-media-rename.js";
import {
	forgetMediaRenameSettledByEditor,
	forgetUnsettledMediaRename,
	listUnsettledMediaRenames,
	noLongerAtWorkOnMediaRenames,
	noteUnsettledMediaRename,
} from "../claude/handlers/claude-media-rename-note.js";
import {
	registerSharedRoutes,
	type WindowAccessor,
} from "../claude/http/claude-http-shared-routes";
import type { Router } from "../claude/utils/http-router";

type RouteHandler = (req: {
	params: Record<string, string>;
	query: Record<string, string>;
	body?: unknown;
}) => Promise<unknown>;

const RENAME = "PATCH /api/claude/media/:projectId/:mediaId/rename";
const OLD_ID = "media_b2xkLm1wNA";
const NEW_ID = "media_bmV3Lm1wNA";
const TIMED_OUT = new Error("Renderer media rename timed out.");
const WINDOW_GONE = new Error("QCut main window is unavailable.");

describe("a long rename whose notes cannot be written again", () => {
	let mediaFolder = "";
	const oldPath = () => path.join(mediaFolder, "old.mp4");
	const newPath = () => path.join(mediaFolder, "new.mp4");
	const renamed = () => ({
		previous: { id: OLD_ID, name: "old.mp4", path: oldPath() },
		id: NEW_ID,
		name: "new.mp4",
		path: newPath(),
	});
	/** The notes as the editor is handed them. */
	const notes = () => listUnsettledMediaRenames({ projectId: "project-a" });

	/** The route, with the app's own notes behind it. */
	function renameRoute(
		requestMediaRename: ReturnType<typeof vi.fn>
	): () => Promise<unknown> {
		const handlers = new Map<string, RouteHandler>();
		const record =
			(method: string) => (route: string, handler: RouteHandler) => {
				handlers.set(`${method} ${route}`, handler);
			};
		const router = {
			get: record("GET"),
			post: record("POST"),
			patch: record("PATCH"),
			delete: record("DELETE"),
			handle: () => {},
		} as unknown as Router;
		const accessor = new Proxy({} as WindowAccessor, {
			get(_target, property) {
				if (property === "requestMediaRename") return requestMediaRename;
				if (property === "noteUnsettledMediaRename") {
					return noteUnsettledMediaRename;
				}
				if (property === "forgetUnsettledMediaRename") {
					return forgetUnsettledMediaRename;
				}
				if (property === "requestStateSnapshot") {
					return async () => ({
						version: 1,
						timestamp: Date.now(),
						state: { project: { activeProject: { id: "project-a" } } },
					});
				}
				if (property === "getAppVersion") return () => "0.0.1-test";
				if (property === "getWindow") {
					return () => ({ webContents: { send: () => {} } });
				}
				return vi.fn(async () => ({}));
			},
		});
		registerSharedRoutes(router, accessor);
		const handler = handlers.get(RENAME);
		if (!handler) throw new Error(`Route not registered: ${RENAME}`);
		return () =>
			handler({
				params: { projectId: "project-a", mediaId: OLD_ID },
				query: {},
				body: { newName: "new.mp4" },
			});
	}

	beforeEach(async () => {
		testState.userData = await fs.mkdtemp(
			path.join(os.tmpdir(), "qcut-rename-at-work-")
		);
		mediaFolder = path.join(testState.userData, "media");
		await fs.mkdir(mediaFolder);
		await fs.writeFile(oldPath(), "the renamed picture");
		vi.mocked(renameMediaFileOnDisk).mockReset();
		vi.mocked(undoMediaRename)
			.mockReset()
			.mockImplementation(async () => {
				await fs.rename(newPath(), oldPath());
			});
	});

	afterEach(async () => {
		noLongerAtWorkOnMediaRenames();
		testState.storeIsFull = false;
		vi.useRealTimers();
		await fs.rm(testState.userData, { recursive: true, force: true });
	});

	it("keeps the note it made before the move, which settles the rename once the request is over", async () => {
		vi.useFakeTimers({
			toFake: ["Date"],
			now: new Date("2026-11-17T08:00:00.000Z"),
		});
		/** What the editor saw when the project was loaded during the copy. */
		let duringTheCopy:
			| { handed: Awaited<ReturnType<typeof notes>>; dropped: boolean }
			| undefined;
		vi.mocked(renameMediaFileOnDisk).mockImplementation((async (request: {
			beforeMove?: (planned: ReturnType<typeof renamed>) => Promise<void>;
		}) => {
			await request.beforeMove?.(renamed());
			// The copy takes an hour, and the store cannot be written in it.
			testState.storeIsFull = true;
			vi.setSystemTime(Date.now() + 60 * 60 * 1000);
			// The project is loaded again meanwhile, and the editor looks.
			const handed = await notes();
			duringTheCopy = {
				handed,
				dropped: await forgetMediaRenameSettledByEditor({
					projectId: "project-a",
					oldId: OLD_ID,
					newId: NEW_ID,
					notedAt: handed[0].notedAt as number,
				}),
			};
			await fs.rename(oldPath(), newPath());
			return renamed();
		}) as never);
		// The editor follows and its answer is lost; the request to go back
		// does not reach it.
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(TIMED_OUT)
			.mockRejectedValueOnce(WINDOW_GONE);

		const failure = await renameRoute(requestMediaRename)().catch(
			(error: Error & { status?: number }) => error
		);

		// The app was at work on it, and said so: nothing was settled, and
		// nothing dropped, in the middle of the copy.
		expect(duringTheCopy?.handed).toHaveLength(1);
		expect(duringTheCopy?.handed[0]).toMatchObject({
			oldId: OLD_ID,
			newId: NEW_ID,
			atWork: true,
		});
		expect(duringTheCopy?.dropped).toBe(false);

		// The file is back, and the caller is told what is left open.
		expect(failure).toMatchObject({ status: 504 });
		expect((failure as Error).message).toContain(
			"The file is back under old.mp4"
		);
		expect((failure as Error).message).toContain(
			"when the project is next opened"
		);
		expect(await fs.readdir(mediaFolder)).toEqual(["old.mp4"]);

		// The note made before the move is there, as it was written then, and
		// is the editor's to settle now: by the folder, which has the file
		// under its old name.
		const left = await notes();
		expect(left).toEqual([
			{
				...duringTheCopy?.handed[0],
				atWork: false,
			},
		]);
		expect(left[0]).not.toHaveProperty("fileIs");
		expect(left[0]).toMatchObject({
			oldPath: oldPath(),
			newPath: newPath(),
			file: { size: 19 },
		});

		// Settled, the editor has it dropped.
		expect(
			await forgetMediaRenameSettledByEditor({
				projectId: "project-a",
				oldId: OLD_ID,
				newId: NEW_ID,
				notedAt: left[0].notedAt as number,
			})
		).toBe(true);
		expect(await notes()).toEqual([]);
	});

	/**
	 * The same with a file that cannot be put back: the note says nothing of
	 * where the file was left, and the folder does.
	 */
	it("does the same when the file stays renamed and that cannot be noted either", async () => {
		vi.mocked(renameMediaFileOnDisk).mockImplementation((async (request: {
			beforeMove?: (planned: ReturnType<typeof renamed>) => Promise<void>;
		}) => {
			await request.beforeMove?.(renamed());
			testState.storeIsFull = true;
			await fs.rename(oldPath(), newPath());
			return renamed();
		}) as never);
		vi.mocked(undoMediaRename).mockRejectedValue(
			new Error("old.mp4 was taken again before the rename could be undone")
		);
		const requestMediaRename = vi.fn().mockRejectedValue(WINDOW_GONE);

		await expect(renameRoute(requestMediaRename)()).rejects.toMatchObject({
			status: 500,
		});

		const left = await notes();
		expect(left).toHaveLength(1);
		expect(left[0]).toMatchObject({ atWork: false, newPath: newPath() });
		expect(left[0]).not.toHaveProperty("fileIs");
		expect(await fs.readdir(mediaFolder)).toEqual(["new.mp4"]);
	});

	it("is at work on the rename until the request is over, and not after, when all goes well", async () => {
		const seen: boolean[] = [];
		vi.mocked(renameMediaFileOnDisk).mockImplementation((async (request: {
			beforeMove?: (planned: ReturnType<typeof renamed>) => Promise<void>;
		}) => {
			await request.beforeMove?.(renamed());
			await fs.rename(oldPath(), newPath());
			return renamed();
		}) as never);
		const requestMediaRename = vi.fn(async () => {
			seen.push(...(await notes()).map((note) => note.atWork));
		});

		await expect(renameRoute(requestMediaRename)()).resolves.toMatchObject({
			renamed: true,
			id: NEW_ID,
		});
		// While the editor was asked to follow, the rename was the app's.
		expect(seen).toEqual([true]);
		expect(await notes()).toEqual([]);
	});
});
