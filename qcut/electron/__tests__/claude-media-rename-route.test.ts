/**
 * What `PATCH /api/claude/media/:projectId/:mediaId/rename` does when the
 * editor's answer leaves it open where the editor stands: it asks the editor
 * to end on the old id before the file goes back under its old name.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => tmpdir()),
		getVersion: vi.fn(() => "0.0.1-test"),
		isPackaged: false,
	},
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	},
	BrowserWindow: {
		getAllWindows: vi.fn(() => []),
	},
}));

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
const OLD = { id: "media_b2xk", name: "old.mp4", path: "/p/media/old.mp4" };
const RENAMED = {
	previous: OLD,
	id: "media_bmV3",
	name: "new.mp4",
	path: "/p/media/new.mp4",
};
/** What the editor is asked when the file is to keep its old name. */
const SETTLE_ON_OLD = {
	projectId: "project-a",
	mediaId: RENAMED.id,
	newMediaId: OLD.id,
	newName: OLD.name,
	newPath: OLD.path,
	previousName: RENAMED.name,
	previousPath: RENAMED.path,
	settles: true,
};

function renameRoute({
	requestMediaRename,
	noteUnsettledMediaRename = vi.fn(async () => undefined),
}: {
	requestMediaRename: ReturnType<typeof vi.fn>;
	/** The desktop app's own note of a rename the editor may not have settled. */
	noteUnsettledMediaRename?: ReturnType<typeof vi.fn>;
}): () => Promise<unknown> {
	const handlers = new Map<string, RouteHandler>();
	const record = (method: string) => (path: string, handler: RouteHandler) => {
		handlers.set(`${method} ${path}`, handler);
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
			params: { projectId: "project-a", mediaId: OLD.id },
			query: {},
			body: { newName: "new.mp4" },
		});
}

describe("a media rename the editor did not plainly refuse", () => {
	beforeEach(() => {
		vi.mocked(renameMediaFileOnDisk).mockReset().mockResolvedValue(RENAMED);
		vi.mocked(undoMediaRename).mockReset().mockResolvedValue(undefined);
	});

	it("tells the editor the name and path the file had", async () => {
		const requestMediaRename = vi.fn(async () => undefined);
		await expect(renameRoute({ requestMediaRename })()).resolves.toMatchObject({
			renamed: true,
			id: RENAMED.id,
			previousId: OLD.id,
		});
		expect(requestMediaRename).toHaveBeenCalledTimes(1);
		expect(requestMediaRename).toHaveBeenCalledWith({
			projectId: "project-a",
			mediaId: OLD.id,
			newMediaId: RENAMED.id,
			newName: RENAMED.name,
			newPath: RENAMED.path,
			previousName: OLD.name,
			previousPath: OLD.path,
		});
		expect(undoMediaRename).not.toHaveBeenCalled();
	});

	/**
	 * No answer in time is not a refusal: the editor may have finished, its
	 * answer late. Putting the file back then left the editor on the new id
	 * and the file under the old name.
	 */
	it("asks the editor to end on the old id before the file goes back, when its answer did not come", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(new Error("Renderer media rename timed out."))
			.mockResolvedValueOnce(undefined);
		await expect(renameRoute({ requestMediaRename })()).rejects.toMatchObject({
			status: 504,
			message:
				"Renderer media rename timed out: Renderer media rename timed out.",
		});
		expect(requestMediaRename).toHaveBeenCalledTimes(2);
		expect(requestMediaRename).toHaveBeenLastCalledWith(SETTLE_ON_OLD);
		expect(undoMediaRename).toHaveBeenCalledTimes(1);
		expect(requestMediaRename.mock.invocationCallOrder[1]).toBeLessThan(
			vi.mocked(undoMediaRename).mock.invocationCallOrder[0]
		);
	});

	/**
	 * The editor may never get to the request: it is busy, or reloaded. And
	 * the note it would write itself may not be written. So the desktop app
	 * notes the rename first, in its own name, before anything else.
	 */
	it("notes the rename itself before it asks the editor and before the file goes back", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValue(new Error("Renderer media rename timed out."));
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		await expect(
			renameRoute({ requestMediaRename, noteUnsettledMediaRename })()
		).rejects.toMatchObject({ status: 504 });
		expect(noteUnsettledMediaRename).toHaveBeenCalledTimes(1);
		expect(noteUnsettledMediaRename).toHaveBeenCalledWith({
			projectId: "project-a",
			renamed: RENAMED,
		});
		const noted = noteUnsettledMediaRename.mock.invocationCallOrder[0];
		const asked = requestMediaRename.mock.invocationCallOrder[1];
		const putBack = vi.mocked(undoMediaRename).mock.invocationCallOrder[0];
		expect(noted).toBeLessThan(asked);
		expect(asked).toBeLessThan(putBack);
	});

	it("does not promise that the editor will put right what could not be noted", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValue(new Error("Renderer media rename timed out."));
		const noteUnsettledMediaRename = vi.fn(async () => {
			throw new Error("the disk is full");
		});
		const failure = await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
		})().catch((error: Error & { status?: number }) => error);
		expect(failure).toMatchObject({ status: 504 });
		const { message } = failure as Error;
		expect(message).toContain("The file is back under old.mp4");
		expect(message).toContain(
			"the rename could not be noted for it to put right later (the disk is full)"
		);
		expect(message).toContain("the project may still name media_bmV3");
		expect(message).not.toContain("next opened");
		// The file goes back all the same: it is the one thing that can.
		expect(undoMediaRename).toHaveBeenCalledTimes(1);
	});

	it("needs no note read back when the editor confirms: it drops the note itself", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(new Error("Renderer media rename timed out."))
			.mockResolvedValueOnce(undefined);
		const noteUnsettledMediaRename = vi.fn(async () => {
			throw new Error("the disk is full");
		});
		// Confirmed on the old id: the first failure is all there is to say.
		await expect(
			renameRoute({ requestMediaRename, noteUnsettledMediaRename })()
		).rejects.toMatchObject({
			status: 504,
			message:
				"Renderer media rename timed out: Renderer media rename timed out.",
		});
	});

	it("asks the same when the editor could not take everything back", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(
				new Error(
					"Scene B could not be saved. Not everything could be taken back in the editor, which may still name media_bmV3: the open scene's timeline (The timeline could not be saved with the old media id)"
				)
			)
			.mockResolvedValueOnce(undefined);
		await expect(renameRoute({ requestMediaRename })()).rejects.toMatchObject({
			status: 409,
		});
		expect(requestMediaRename).toHaveBeenLastCalledWith(SETTLE_ON_OLD);
		expect(undoMediaRename).toHaveBeenCalledTimes(1);
	});

	it("puts the file back and says so when the editor does not confirm", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValue(new Error("Renderer media rename timed out."));
		const failure = await renameRoute({ requestMediaRename })().catch(
			(error: Error & { status?: number }) => error
		);
		expect(failure).toMatchObject({ status: 504 });
		const { message } = failure as Error;
		expect(message).toContain("The file is back under old.mp4");
		expect(message).toContain(
			"the editor did not confirm that it names media_b2xk again"
		);
		expect(message).toContain("when the project is next opened");
		expect(undoMediaRename).toHaveBeenCalledTimes(1);
	});

	it("does not ask again after a plain refusal: the editor took the rename back", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValue(new Error("Quota exceeded"));
		await expect(renameRoute({ requestMediaRename })()).rejects.toMatchObject({
			status: 409,
			message: "Renderer media rename was rejected: Quota exceeded",
		});
		expect(requestMediaRename).toHaveBeenCalledTimes(1);
		expect(undoMediaRename).toHaveBeenCalledTimes(1);
	});

	it("still says that the file kept its new name when it cannot be put back", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(new Error("Renderer media rename timed out."))
			.mockResolvedValueOnce(undefined);
		vi.mocked(undoMediaRename).mockRejectedValue(
			new Error("old.mp4 was taken again before the rename could be undone")
		);
		const failure = await renameRoute({ requestMediaRename })().catch(
			(error: Error & { status?: number }) => error
		);
		expect(failure).toMatchObject({ status: 500 });
		expect((failure as Error).message).toContain(
			"The file stays renamed to new.mp4"
		);
	});
});
