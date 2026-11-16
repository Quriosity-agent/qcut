/**
 * What `PATCH /api/claude/media/:projectId/:mediaId/rename` does when the
 * editor does not follow the rename: the file goes back under its old name,
 * and the editor is brought to the name the file ends under. The route
 * notes the rename itself for as long as it does not know that the two
 * agree.
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
/** What it is asked when the file could not be put back. */
const FOLLOW_THE_FILE = {
	projectId: "project-a",
	mediaId: OLD.id,
	newMediaId: RENAMED.id,
	newName: RENAMED.name,
	newPath: RENAMED.path,
	previousName: OLD.name,
	previousPath: OLD.path,
	settles: true,
};
const TIMED_OUT = new Error("Renderer media rename timed out.");
/** What a request gets that cannot be sent: the editor's window is gone. */
const WINDOW_GONE = new Error("QCut main window is unavailable.");
const NAME_TAKEN = new Error(
	"old.mp4 was taken again before the rename could be undone"
);

/** The stages the route noted the rename at, in order. */
const stagesNoted = (note: ReturnType<typeof vi.fn>) =>
	note.mock.calls.map(([payload]) => (payload as { stage: string }).stage);

function renameRoute({
	requestMediaRename,
	noteUnsettledMediaRename = vi.fn(async () => undefined),
	forgetUnsettledMediaRename = vi.fn(async () => undefined),
}: {
	requestMediaRename: ReturnType<typeof vi.fn>;
	/** The desktop app's own note of a rename the editor may not have settled. */
	noteUnsettledMediaRename?: ReturnType<typeof vi.fn>;
	forgetUnsettledMediaRename?: ReturnType<typeof vi.fn>;
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
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		const answer = await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
		})();
		expect(answer).toMatchObject({
			renamed: true,
			id: RENAMED.id,
			previousId: OLD.id,
		});
		expect(answer).not.toHaveProperty("warning");
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
		// Nothing is open: nothing is noted.
		expect(noteUnsettledMediaRename).not.toHaveBeenCalled();
	});

	/**
	 * No answer in time is not a refusal: the editor may have finished, its
	 * answer late. Putting the file back then left the editor on the new id
	 * and the file under the old name.
	 */
	it("asks the editor to end on the old id before the file goes back, when its answer did not come", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(TIMED_OUT)
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
		const requestMediaRename = vi.fn().mockRejectedValue(TIMED_OUT);
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		await expect(
			renameRoute({ requestMediaRename, noteUnsettledMediaRename })()
		).rejects.toMatchObject({ status: 504 });
		expect(noteUnsettledMediaRename).toHaveBeenNthCalledWith(1, {
			projectId: "project-a",
			renamed: RENAMED,
			stage: "moving",
		});
		const noted = noteUnsettledMediaRename.mock.invocationCallOrder[0];
		const asked = requestMediaRename.mock.invocationCallOrder[1];
		const putBack = vi.mocked(undoMediaRename).mock.invocationCallOrder[0];
		expect(noted).toBeLessThan(asked);
		expect(asked).toBeLessThan(putBack);
	});

	/**
	 * The editor had made the rename, its answer was lost, and the request
	 * to end on the old id cannot be sent: its window is gone. The file goes
	 * back, so the stored project names an id no file has. The route's own
	 * note is what puts that right: it is there, says that the file is back,
	 * and stays.
	 */
	it("keeps its note when the editor cannot be asked to end on the old id", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(TIMED_OUT)
			.mockRejectedValueOnce(WINDOW_GONE);
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		const failure = await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
			forgetUnsettledMediaRename,
		})().catch((error: Error & { status?: number }) => error);

		expect(failure).toMatchObject({ status: 504 });
		const { message } = failure as Error;
		expect(message).toContain("The file is back under old.mp4");
		expect(message).toContain(
			"the editor did not confirm that it names media_b2xk again (QCut main window is unavailable.)"
		);
		expect(message).toContain("when the project is next opened");
		expect(undoMediaRename).toHaveBeenCalledTimes(1);
		// Noted before the file moved, and again once it was back.
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual(["moving", "back"]);
		expect(noteUnsettledMediaRename.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(undoMediaRename).mock.invocationCallOrder[0]
		);
		expect(forgetUnsettledMediaRename).not.toHaveBeenCalled();
	});

	it("does not promise that the editor will put right what could not be noted", async () => {
		const requestMediaRename = vi.fn().mockRejectedValue(TIMED_OUT);
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

	/**
	 * The editor drops no note when it has gone back: the file is still
	 * under its new name then. The route drops it, once the file is back.
	 */
	it("drops its note once the editor is on the old id and the file is back", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(TIMED_OUT)
			.mockResolvedValueOnce(undefined);
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		// Confirmed on the old id: the first failure is all there is to say.
		await expect(
			renameRoute({
				requestMediaRename,
				noteUnsettledMediaRename,
				forgetUnsettledMediaRename,
			})()
		).rejects.toMatchObject({
			status: 504,
			message:
				"Renderer media rename timed out: Renderer media rename timed out.",
		});
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual(["moving"]);
		expect(forgetUnsettledMediaRename).toHaveBeenCalledTimes(1);
		expect(forgetUnsettledMediaRename).toHaveBeenCalledWith({
			projectId: "project-a",
			renamed: RENAMED,
		});
		expect(vi.mocked(undoMediaRename).mock.invocationCallOrder[0]).toBeLessThan(
			forgetUnsettledMediaRename.mock.invocationCallOrder[0]
		);
	});

	it("says the same when the note could not be written but the editor confirmed", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(TIMED_OUT)
			.mockResolvedValueOnce(undefined);
		const noteUnsettledMediaRename = vi.fn(async () => {
			throw new Error("the disk is full");
		});
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		await expect(
			renameRoute({
				requestMediaRename,
				noteUnsettledMediaRename,
				forgetUnsettledMediaRename,
			})()
		).rejects.toMatchObject({
			status: 504,
			message:
				"Renderer media rename timed out: Renderer media rename timed out.",
		});
		// There is no note to drop.
		expect(forgetUnsettledMediaRename).not.toHaveBeenCalled();
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
		const requestMediaRename = vi.fn().mockRejectedValue(TIMED_OUT);
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
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		await expect(
			renameRoute({ requestMediaRename, noteUnsettledMediaRename })()
		).rejects.toMatchObject({
			status: 409,
			message: "Renderer media rename was rejected: Quota exceeded",
		});
		expect(requestMediaRename).toHaveBeenCalledTimes(1);
		expect(undoMediaRename).toHaveBeenCalledTimes(1);
		expect(noteUnsettledMediaRename).not.toHaveBeenCalled();
	});
});

/**
 * The file's old name can be taken while the editor is asked, or the folder
 * can refuse the move. The editor has by then gone back to the old id, or
 * never left it, and the file keeps the new name: the two are apart, with
 * the clips on an id no file has.
 */
describe("a media rename whose file cannot be put back", () => {
	beforeEach(() => {
		vi.mocked(renameMediaFileOnDisk).mockReset().mockResolvedValue(RENAMED);
		vi.mocked(undoMediaRename).mockReset().mockRejectedValue(NAME_TAKEN);
	});

	it("has the editor follow the file after it had confirmed the old id, and the rename stands", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(TIMED_OUT)
			// On the old id again, as asked.
			.mockResolvedValueOnce(undefined)
			// And on the new one, where the file stays.
			.mockResolvedValueOnce(undefined);
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		const answer = (await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
			forgetUnsettledMediaRename,
		})()) as { warning?: string };

		expect(answer).toMatchObject({
			renamed: true,
			id: RENAMED.id,
			name: RENAMED.name,
			previousId: OLD.id,
		});
		expect(answer.warning).toContain(
			"the file could not be put back under old.mp4 (old.mp4 was taken again before the rename could be undone)"
		);
		expect(answer.warning).toContain("the rename stands");
		expect(requestMediaRename).toHaveBeenCalledTimes(3);
		expect(requestMediaRename).toHaveBeenNthCalledWith(2, SETTLE_ON_OLD);
		expect(requestMediaRename).toHaveBeenNthCalledWith(3, FOLLOW_THE_FILE);

		// The note is there throughout: it says that the file stays before
		// the editor is asked to follow, and goes when the editor has.
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual(["moving", "stays"]);
		const [, notedStays] = noteUnsettledMediaRename.mock.invocationCallOrder;
		const [, , askedToFollow] = requestMediaRename.mock.invocationCallOrder;
		const [forgotten] = forgetUnsettledMediaRename.mock.invocationCallOrder;
		expect(vi.mocked(undoMediaRename).mock.invocationCallOrder[0]).toBeLessThan(
			notedStays
		);
		expect(notedStays).toBeLessThan(askedToFollow);
		expect(askedToFollow).toBeLessThan(forgotten);
		expect(forgetUnsettledMediaRename).toHaveBeenCalledTimes(1);
	});

	it("keeps the note, and says where things stand, when the editor does not follow the file", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(TIMED_OUT)
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("The timeline could not be saved"));
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		const failure = await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
			forgetUnsettledMediaRename,
		})().catch((error: Error & { status?: number }) => error);

		expect(failure).toMatchObject({ status: 500 });
		const { message } = failure as Error;
		expect(message).toContain(
			"The file stays renamed to new.mp4 (media_bmV3), and putting it back failed: old.mp4 was taken again"
		);
		expect(message).toContain(
			"The editor did not confirm that it follows the renamed file (The timeline could not be saved)"
		);
		expect(message).toContain("when the project is next opened");
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual(["moving", "stays"]);
		expect(forgetUnsettledMediaRename).not.toHaveBeenCalled();
	});

	it("says which id the project may still name when that could not be noted either", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(TIMED_OUT)
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(WINDOW_GONE);
		const noteUnsettledMediaRename = vi.fn(async () => {
			throw new Error("the disk is full");
		});
		const failure = await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
		})().catch((error: Error & { status?: number }) => error);
		expect(failure).toMatchObject({ status: 500 });
		const { message } = failure as Error;
		expect(message).toContain("The file stays renamed to new.mp4");
		expect(message).toContain(
			"the rename could not be noted for it to put right later (the disk is full)"
		);
		// The old id is the one no file has now.
		expect(message).toContain("the project may still name media_b2xk");
		expect(message).not.toContain("next opened");
	});

	/**
	 * A plain refusal leaves the editor on the old id, with nothing noted so
	 * far. The file that stays renamed is noted then, and followed.
	 */
	it("notes and follows the file after a plain refusal too", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(new Error("Quota exceeded"))
			.mockResolvedValueOnce(undefined);
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		const answer = (await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
			forgetUnsettledMediaRename,
		})()) as { warning?: string };

		expect(answer).toMatchObject({ renamed: true, id: RENAMED.id });
		expect(answer.warning).toContain("Quota exceeded");
		expect(requestMediaRename).toHaveBeenCalledTimes(2);
		expect(requestMediaRename).toHaveBeenLastCalledWith(FOLLOW_THE_FILE);
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual(["stays"]);
		expect(forgetUnsettledMediaRename).toHaveBeenCalledTimes(1);
	});
});
