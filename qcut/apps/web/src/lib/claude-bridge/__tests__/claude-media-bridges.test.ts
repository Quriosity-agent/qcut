import { beforeEach, describe, expect, it, vi } from "vitest";

const project = vi.hoisted(() => ({
	activeProject: { id: "project-1" } as { id: string } | null,
}));
const renameProjectMedia = vi.hoisted(() =>
	vi.fn(async (..._args: unknown[]) => ({
		mediaRenamed: true,
		clipsUpdated: 2,
		stickersUpdated: 0,
	}))
);
const refreshChangedMediaSources = vi.hoisted(() =>
	vi.fn(async (..._args: unknown[]) => ({
		checked: 3,
		refreshed: [{ id: "media_a", name: "a.mp4" }],
		failed: [],
	}))
);

vi.mock("@/stores/project-store", () => ({
	useProjectStore: { getState: () => project },
}));
vi.mock("@/stores/media/media-rename", () => ({ renameProjectMedia }));
vi.mock("@/lib/project/media-source-refresh", () => ({
	refreshChangedMediaSources,
}));

import { setupMediaRefreshHandler } from "../claude-media-refresh-bridge";
import {
	parseClaudeRenamedMediaEvent,
	setupMediaRenameHandler,
} from "../claude-media-rename-bridge";

const EVENT = {
	projectId: "project-1",
	mediaId: "media_old",
	newMediaId: "media_new",
	newName: "shake_v2.mp4",
	newPath: "/project/media/shake_v2.mp4",
	requestId: "media-1",
};
const RENAME = {
	projectId: "project-1",
	fromId: "media_old",
	toId: "media_new",
	name: "shake_v2.mp4",
	localPath: "/project/media/shake_v2.mp4",
};

type Listener = (data: unknown) => unknown;

/** The desktop app's side: registers one listener and lets a test call it. */
function desktop() {
	let onRenamed: Listener | undefined;
	let onRefresh: Listener | undefined;
	return {
		media: {
			onMediaRenamed: (callback: Listener) => {
				onRenamed = callback;
			},
			onMediaRefresh: (callback: Listener) => {
				onRefresh = callback;
			},
		} as never,
		rename: (data: unknown) => (onRenamed as Listener)(data),
		refresh: (data: unknown) => (onRefresh as Listener)(data),
	};
}

describe("the editor's answer to a media rename", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		project.activeProject = { id: "project-1" };
	});

	it("reads the rename, with the moment the asker stops waiting", () => {
		expect(parseClaudeRenamedMediaEvent({ candidate: EVENT })).toEqual(RENAME);
		expect(
			parseClaudeRenamedMediaEvent({
				candidate: { ...EVENT, deadlineAt: 1_234_567 },
			})
		).toEqual({ ...RENAME, deadlineAt: 1_234_567 });
		expect(
			parseClaudeRenamedMediaEvent({
				candidate: { ...EVENT, deadlineAt: "soon" },
			})
		).toEqual(RENAME);
	});

	it("reads the name and path the file had, and that the request settles", () => {
		expect(
			parseClaudeRenamedMediaEvent({
				candidate: {
					...EVENT,
					previousName: "shake.mp4",
					previousPath: "/project/media/shake.mp4",
					settles: true,
				},
			})
		).toEqual({
			...RENAME,
			previous: { name: "shake.mp4", localPath: "/project/media/shake.mp4" },
			settles: true,
		});
		// Half of it is none of it, and only `true` settles.
		expect(
			parseClaudeRenamedMediaEvent({
				candidate: { ...EVENT, previousName: "shake.mp4", settles: "yes" },
			})
		).toEqual(RENAME);
	});

	/**
	 * A request that settles says where the file is for good. For a project
	 * that is not open the editor cannot act on it; it has to reach the
	 * rename all the same, which notes it for when the project is opened.
	 */
	it("passes on a request that settles, also for a project that is not open", async () => {
		const app = desktop();
		setupMediaRenameHandler({ media: app.media });
		project.activeProject = { id: "project-2" };
		await app.rename({ ...EVENT, settles: true });
		expect(renameProjectMedia).toHaveBeenCalledWith({
			...RENAME,
			settles: true,
		});
	});

	it("does not take anything else for a rename", () => {
		for (const candidate of [
			null,
			"media_old",
			[EVENT],
			{ ...EVENT, newMediaId: "" },
			{ ...EVENT, newPath: undefined },
			{ ...EVENT, projectId: 7 },
		]) {
			expect(parseClaudeRenamedMediaEvent({ candidate })).toBeNull();
		}
	});

	it("follows the rename for the open project, deadline and all", async () => {
		const app = desktop();
		setupMediaRenameHandler({ media: app.media });
		await app.rename({ ...EVENT, deadlineAt: 99 });
		expect(renameProjectMedia).toHaveBeenCalledWith({
			...RENAME,
			deadlineAt: 99,
		});
	});

	it("refuses a rename for a project that is not open, or one it cannot read", async () => {
		const app = desktop();
		setupMediaRenameHandler({ media: app.media });
		project.activeProject = { id: "project-2" };
		await expect(app.rename(EVENT)).rejects.toThrow(
			"Cannot rename media for inactive project project-1"
		);
		await expect(app.rename({ projectId: "project-2" })).rejects.toThrow(
			"Invalid media rename event"
		);
		expect(renameProjectMedia).not.toHaveBeenCalled();
	});

	it("passes on why the rename could not be followed", async () => {
		renameProjectMedia.mockRejectedValueOnce(new Error("Quota exceeded"));
		const app = desktop();
		setupMediaRenameHandler({ media: app.media });
		await expect(app.rename(EVENT)).rejects.toThrow("Quota exceeded");
	});
});

describe("the editor's answer to a media refresh", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		project.activeProject = { id: "project-1" };
	});

	it("reads changed files again for the open project and answers with what it did", async () => {
		const app = desktop();
		setupMediaRefreshHandler({ media: app.media });
		await expect(app.refresh({ projectId: "project-1" })).resolves.toEqual({
			checked: 3,
			refreshed: [{ id: "media_a", name: "a.mp4" }],
			failed: [],
		});
		expect(refreshChangedMediaSources).toHaveBeenCalledWith({
			projectId: "project-1",
		});
	});

	it("refuses another project's refresh, or a request that names none", async () => {
		const app = desktop();
		setupMediaRefreshHandler({ media: app.media });
		await expect(app.refresh({ projectId: "project-2" })).rejects.toThrow(
			"Cannot refresh media for inactive project project-2"
		);
		await expect(app.refresh({})).rejects.toThrow(
			"Invalid media refresh request"
		);
		expect(refreshChangedMediaSources).not.toHaveBeenCalled();
	});

	it("registers nothing with a desktop app that has no such requests", () => {
		expect(() =>
			setupMediaRefreshHandler({ media: {} as never })
		).not.toThrow();
		expect(() => setupMediaRenameHandler({ media: undefined })).not.toThrow();
	});
});
