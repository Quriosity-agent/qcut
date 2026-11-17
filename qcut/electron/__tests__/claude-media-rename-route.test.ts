/**
 * How `PATCH /api/claude/media/:projectId/:mediaId/rename` keeps the editor
 * and the folder together. The route notes every rename before the file is
 * moved, and keeps the note for as long as it does not know that the two
 * agree. When the editor does not follow, the file goes back under its old
 * name, and the editor is brought to the name the file ends under.
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
	settles: true,
};
/** What it is asked when the file could not be put back. */
const FOLLOW_THE_FILE = {
	projectId: "project-a",
	mediaId: OLD.id,
	newMediaId: RENAMED.id,
	newName: RENAMED.name,
	newPath: RENAMED.path,
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

/**
 * The rename on disk as the route sees it: it says where the file is about
 * to go, and moves it unless that could not be recorded.
 */
async function movesTheFile({
	beforeMove,
}: {
	beforeMove?: (planned: typeof RENAMED) => Promise<void>;
}): Promise<typeof RENAMED> {
	await beforeMove?.(RENAMED);
	return RENAMED;
}

function renameRoute({
	requestMediaRename,
	noteUnsettledMediaRename = vi.fn(async () => undefined),
	forgetUnsettledMediaRename = vi.fn(async () => undefined),
	notes = true,
}: {
	requestMediaRename: ReturnType<typeof vi.fn>;
	/** The desktop app's own note of a rename the editor may not have settled. */
	noteUnsettledMediaRename?: ReturnType<typeof vi.fn>;
	forgetUnsettledMediaRename?: ReturnType<typeof vi.fn>;
	/** Whether the server can keep such notes at all. */
	notes?: boolean;
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
				return notes ? noteUnsettledMediaRename : undefined;
			}
			if (property === "forgetUnsettledMediaRename") {
				return notes ? forgetUnsettledMediaRename : undefined;
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

/**
 * A rename the app does not live to see the end of, an answer that never
 * comes, an editor that is reloaded: whatever happens after the file has
 * moved, a record has to be there already. So the rename is noted first,
 * and a rename that cannot be noted is not made.
 */
describe("a media rename is noted before the file is moved", () => {
	beforeEach(() => {
		vi.mocked(renameMediaFileOnDisk)
			.mockReset()
			.mockImplementation(movesTheFile as never);
		vi.mocked(undoMediaRename).mockReset().mockResolvedValue(undefined);
	});

	it("notes it, has the editor follow, and drops the note", async () => {
		const events: string[] = [];
		vi.mocked(renameMediaFileOnDisk).mockImplementation((async (request: {
			beforeMove?: (planned: typeof RENAMED) => Promise<void>;
		}) => {
			await request.beforeMove?.(RENAMED);
			events.push("moved");
			return RENAMED;
		}) as never);
		const requestMediaRename = vi.fn(async () => {
			events.push("editor asked");
		});
		const noteUnsettledMediaRename = vi.fn(
			async ({ stage }: { stage: string }) => {
				events.push(stage === "left" ? "left" : "noted");
			}
		);
		const forgetUnsettledMediaRename = vi.fn(async () => {
			events.push("note dropped");
		});
		const answer = await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
			forgetUnsettledMediaRename,
		})();

		expect(answer).toMatchObject({
			renamed: true,
			id: RENAMED.id,
			previousId: OLD.id,
		});
		expect(answer).not.toHaveProperty("warning");
		// The last word: the request moves the file no more.
		expect(events).toEqual([
			"noted",
			"moved",
			"editor asked",
			"note dropped",
			"left",
		]);
		expect(noteUnsettledMediaRename).toHaveBeenCalledWith({
			projectId: "project-a",
			renamed: RENAMED,
			stage: "moving",
			by: expect.any(String),
		});
		expect(forgetUnsettledMediaRename).toHaveBeenCalledWith({
			projectId: "project-a",
			renamed: RENAMED,
			by: expect.any(String),
		});
		expect(requestMediaRename).toHaveBeenCalledTimes(1);
		expect(requestMediaRename).toHaveBeenCalledWith({
			projectId: "project-a",
			mediaId: OLD.id,
			newMediaId: RENAMED.id,
			newName: RENAMED.name,
			newPath: RENAMED.path,
		});
		expect(undoMediaRename).not.toHaveBeenCalled();
	});

	/**
	 * With no note and no answer from the editor, the file went back while
	 * the stored project could keep the new id, and nothing was left to put
	 * that right. Without a note there is no rename now.
	 */
	it("does not make a rename it cannot note", async () => {
		const requestMediaRename = vi.fn(async () => undefined);
		const noteUnsettledMediaRename = vi.fn(async () => {
			throw new Error("the disk is full");
		});
		const failure = await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
		})().catch((error: Error & { status?: number }) => error);

		expect(failure).toMatchObject({ status: 500 });
		expect((failure as Error).message).toBe(
			"The rename could not be noted for the editor to settle (the disk is full), so it was not made: nothing was changed"
		);
		// The editor is not asked, and there is no file to put back.
		expect(requestMediaRename).not.toHaveBeenCalled();
		expect(undoMediaRename).not.toHaveBeenCalled();
		// The app may have the note all the same (its answer did not get
		// through): it is told that the rename is over.
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual(["moving", "left"]);
	});

	it("does not make one where notes cannot be kept at all", async () => {
		const requestMediaRename = vi.fn(async () => undefined);
		await expect(
			renameRoute({ requestMediaRename, notes: false })()
		).rejects.toMatchObject({ status: 503 });
		expect(renameMediaFileOnDisk).not.toHaveBeenCalled();
		expect(requestMediaRename).not.toHaveBeenCalled();
	});

	it("gives the rename on disk the means to take a note back when the file did not move", async () => {
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		vi.mocked(renameMediaFileOnDisk).mockImplementation((async (request: {
			beforeMove?: (planned: typeof RENAMED) => Promise<void>;
			notMoved?: (planned: typeof RENAMED) => Promise<void>;
		}) => {
			await request.beforeMove?.(RENAMED);
			await request.notMoved?.(RENAMED);
			throw new Error("new.mp4 is already taken in the project's media folder");
		}) as never);
		await expect(
			renameRoute({
				requestMediaRename: vi.fn(async () => undefined),
				forgetUnsettledMediaRename,
			})()
		).rejects.toThrow("already taken");
		// Said to be unmoved: what was noted of the two names before this
		// rename, by an earlier one that is not settled, stays noted.
		expect(forgetUnsettledMediaRename).toHaveBeenCalledWith({
			projectId: "project-a",
			renamed: RENAMED,
			unmoved: true,
			by: expect.any(String),
		});
	});
});

/**
 * With its first note the app is at work on a rename, and the editor leaves
 * the rename alone: the file may still move. That has to end with the
 * request, however the request ends, or what is left noted is never
 * settled.
 */
describe("a media rename the app is at work on", () => {
	beforeEach(() => {
		vi.mocked(renameMediaFileOnDisk)
			.mockReset()
			.mockImplementation(movesTheFile as never);
		vi.mocked(undoMediaRename).mockReset().mockResolvedValue(undefined);
	});

	/**
	 * The move broke off with the file under both names. The note stays,
	 * since the folder is not as it was, and nothing more is said of the
	 * rename: the app stayed at work on it for as long as it ran.
	 */
	it("is over when the move breaks off part-way, and its note is left for the editor", async () => {
		vi.mocked(renameMediaFileOnDisk).mockImplementation((async (request: {
			beforeMove?: (planned: typeof RENAMED) => Promise<void>;
		}) => {
			await request.beforeMove?.(RENAMED);
			throw new Error(
				"new.mp4 has the file, and old.mp4 could not be given up"
			);
		}) as never);
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		await expect(
			renameRoute({
				requestMediaRename: vi.fn(async () => undefined),
				noteUnsettledMediaRename,
				forgetUnsettledMediaRename,
			})()
		).rejects.toThrow("could not be given up");
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual(["moving", "left"]);
		expect(forgetUnsettledMediaRename).not.toHaveBeenCalled();
	});

	it("is over for every name the rename set out for", async () => {
		const second = { ...RENAMED, id: "media_bmV3XzE", name: "new_1.mp4" };
		vi.mocked(renameMediaFileOnDisk).mockImplementation((async (request: {
			beforeMove?: (planned: typeof RENAMED) => Promise<void>;
			notMoved?: (planned: typeof RENAMED) => Promise<void>;
		}) => {
			// The first name was taken by the time the file got there.
			await request.beforeMove?.(RENAMED);
			await request.notMoved?.(RENAMED);
			await request.beforeMove?.(second);
			return second;
		}) as never);
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		await renameRoute({
			requestMediaRename: vi.fn(async () => undefined),
			noteUnsettledMediaRename,
		})();
		expect(
			noteUnsettledMediaRename.mock.calls.map(([payload]) => {
				const { stage, renamed } = payload as {
					stage: string;
					renamed: typeof RENAMED;
				};
				return `${stage} ${renamed.name}`;
			})
		).toEqual([
			"moving new.mp4",
			"moving new_1.mp4",
			"left new.mp4",
			"left new_1.mp4",
		]);
	});

	/**
	 * Two requests can rename one file at once. The app tells their words
	 * apart by the name each request gives itself, the same in all it says.
	 */
	it("speaks of its rename in one name of its own", async () => {
		const noteUnsettledMediaRename = vi.fn(async () => undefined);
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		const rename = renameRoute({
			requestMediaRename: vi.fn(async () => undefined),
			noteUnsettledMediaRename,
			forgetUnsettledMediaRename,
		});
		const saidBy = () =>
			[
				...noteUnsettledMediaRename.mock.calls,
				...forgetUnsettledMediaRename.mock.calls,
			].map(([payload]) => (payload as { by: string }).by);

		await rename();
		const first = saidBy();
		expect(first).toHaveLength(3);
		expect(new Set(first).size).toBe(1);
		expect(first[0]).toMatch(/\S{8,}/);

		noteUnsettledMediaRename.mockClear();
		forgetUnsettledMediaRename.mockClear();
		await rename();
		expect(new Set(saidBy()).size).toBe(1);
		expect(saidBy()[0]).not.toBe(first[0]);
	});

	it("fails as it did when the app cannot be told that the rename is over", async () => {
		const noteUnsettledMediaRename = vi.fn(
			async ({ stage }: { stage: string }) => {
				if (stage === "left") throw new Error("Main process request timed out");
			}
		);
		await expect(
			renameRoute({
				requestMediaRename: vi.fn(async () => undefined),
				noteUnsettledMediaRename,
			})()
		).resolves.toMatchObject({ renamed: true, id: RENAMED.id });

		const requestMediaRename = vi.fn().mockRejectedValue(TIMED_OUT);
		await expect(
			renameRoute({ requestMediaRename, noteUnsettledMediaRename })()
		).rejects.toMatchObject({ status: 504 });
	});
});

describe("a media rename the editor did not plainly refuse", () => {
	beforeEach(() => {
		vi.mocked(renameMediaFileOnDisk)
			.mockReset()
			.mockImplementation(movesTheFile as never);
		vi.mocked(undoMediaRename).mockReset().mockResolvedValue(undefined);
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
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual([
			"moving",
			"back",
			"left",
		]);
		expect(noteUnsettledMediaRename.mock.invocationCallOrder[0]).toBeLessThan(
			requestMediaRename.mock.invocationCallOrder[0]
		);
		expect(forgetUnsettledMediaRename).not.toHaveBeenCalled();
	});

	/**
	 * The note cannot be written a second time, and the editor does not
	 * confirm. The file goes back all the same. What settles the two is the
	 * note made before the file was moved, which is still there.
	 */
	it("leaves the note it made before the move when it cannot bring it up to date", async () => {
		const requestMediaRename = vi.fn().mockRejectedValue(TIMED_OUT);
		const noteUnsettledMediaRename = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValue(new Error("the disk is full"));
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		const failure = await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
			forgetUnsettledMediaRename,
		})().catch((error: Error & { status?: number }) => error);

		expect(failure).toMatchObject({ status: 504 });
		const { message } = failure as Error;
		expect(message).toContain("The file is back under old.mp4");
		expect(message).toContain("when the project is next opened");
		expect(undoMediaRename).toHaveBeenCalledTimes(1);
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual([
			"moving",
			"back",
			"left",
		]);
		// Nothing removed the first note.
		expect(forgetUnsettledMediaRename).not.toHaveBeenCalled();
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
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual(["moving", "left"]);
		expect(forgetUnsettledMediaRename).toHaveBeenCalledTimes(1);
		expect(forgetUnsettledMediaRename).toHaveBeenCalledWith({
			projectId: "project-a",
			renamed: RENAMED,
			by: expect.any(String),
		});
		expect(vi.mocked(undoMediaRename).mock.invocationCallOrder[0]).toBeLessThan(
			forgetUnsettledMediaRename.mock.invocationCallOrder[0]
		);
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
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		await expect(
			renameRoute({
				requestMediaRename,
				noteUnsettledMediaRename,
				forgetUnsettledMediaRename,
			})()
		).rejects.toMatchObject({
			status: 409,
			message: "Renderer media rename was rejected: Quota exceeded",
		});
		expect(requestMediaRename).toHaveBeenCalledTimes(1);
		expect(undoMediaRename).toHaveBeenCalledTimes(1);
		// The file is back and the editor never left: the note has no more to say.
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual(["moving", "left"]);
		expect(forgetUnsettledMediaRename).toHaveBeenCalledTimes(1);
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
		vi.mocked(renameMediaFileOnDisk)
			.mockReset()
			.mockImplementation(movesTheFile as never);
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
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual([
			"moving",
			"stays",
			"left",
		]);
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
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual([
			"moving",
			"stays",
			"left",
		]);
		expect(forgetUnsettledMediaRename).not.toHaveBeenCalled();
	});

	/**
	 * The note that the file stays cannot be written, and the editor cannot
	 * be asked to follow. What is left is the note made before the move,
	 * which does not say where the file was left. The editor settles by it
	 * all the same: with a file under each name it takes the new one, as
	 * media-rename-settle-taken-name.test.ts shows. So the note must stay.
	 */
	it("leaves the note made before the move when it cannot write that the file stays", async () => {
		const requestMediaRename = vi
			.fn()
			.mockRejectedValueOnce(TIMED_OUT)
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(WINDOW_GONE);
		const noteUnsettledMediaRename = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValue(new Error("the disk is full"));
		const forgetUnsettledMediaRename = vi.fn(async () => undefined);
		const failure = await renameRoute({
			requestMediaRename,
			noteUnsettledMediaRename,
			forgetUnsettledMediaRename,
		})().catch((error: Error & { status?: number }) => error);

		expect(failure).toMatchObject({ status: 500 });
		const { message } = failure as Error;
		expect(message).toContain("The file stays renamed to new.mp4");
		expect(message).toContain(
			"The editor did not confirm that it follows the renamed file (QCut main window is unavailable.)"
		);
		expect(message).toContain("when the project is next opened");
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual([
			"moving",
			"stays",
			"left",
		]);
		expect(forgetUnsettledMediaRename).not.toHaveBeenCalled();
	});

	/**
	 * A plain refusal leaves the editor on the old id. The file that stays
	 * renamed is noted as such, and followed.
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
		expect(stagesNoted(noteUnsettledMediaRename)).toEqual([
			"moving",
			"stays",
			"left",
		]);
		expect(forgetUnsettledMediaRename).toHaveBeenCalledTimes(1);
	});
});
