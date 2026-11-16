/**
 * What `POST /api/claude/export/:projectId/start` does about the project's
 * media before it exports: it has the editor read again the files that were
 * written over in the project folder, and it does not start an export that
 * would leave a clip out for want of its media.
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

vi.mock("../claude/handlers/claude-export-handler.js", async (original) => ({
	...(await original<Record<string, unknown>>()),
	startExportJob: vi.fn(async () => ({
		jobId: "test-job",
		status: "queued",
	})),
	startRendererExportJob: vi.fn(async () => ({
		jobId: "renderer-test-job",
		status: "queued",
	})),
}));

vi.mock("../claude/handlers/claude-media-handler.js", async (original) => ({
	...(await original<Record<string, unknown>>()),
	listMediaFiles: vi.fn(async () => []),
}));

import {
	startExportJob,
	startRendererExportJob,
} from "../claude/handlers/claude-export-handler.js";
import { ClipMediaMissingError } from "../claude/handlers/claude-export-handler/missing-clip-media.js";
import {
	registerSharedRoutes,
	type WindowAccessor,
} from "../claude/http/claude-http-shared-routes";
import type { Router } from "../claude/utils/http-router";
import type { ClaudeTimeline } from "../types/claude-api";

type RouteHandler = (req: {
	params: Record<string, string>;
	query: Record<string, string>;
	body?: unknown;
}) => Promise<unknown>;

function buildRouterHarness(): {
	router: Router;
	getHandler: (method: string, path: string) => RouteHandler;
} {
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
	return {
		router,
		getHandler: (method, path) => {
			const handler = handlers.get(`${method} ${path}`);
			if (!handler) throw new Error(`Route not registered: ${method} ${path}`);
			return handler;
		},
	};
}

function buildAccessor(timeline: ClaudeTimeline): WindowAccessor {
	return new Proxy({} as WindowAccessor, {
		get(target, property) {
			const override = Reflect.get(target, property);
			if (override !== undefined) return override;
			if (property === "requestTimeline") {
				return async () => timeline;
			}
			if (property === "requestStateSnapshot") {
				return async () => ({
					version: 1,
					timestamp: Date.now(),
					state: { media: { items: [] } },
				});
			}
			if (property === "getAppVersion") {
				return () => "0.0.1-test";
			}
			if (property === "getWindow") {
				return () => ({ webContents: { send: () => {} } });
			}
			return vi.fn(async () => ({}));
		},
	});
}

function buildTimeline(projectId?: string): ClaudeTimeline {
	return {
		name: "Media before export",
		duration: 1,
		width: 1920,
		height: 1080,
		fps: 30,
		tracks: [],
		projectId,
	};
}

/** The same timeline with one clip of `shake.mp4` on it. */
function timelineWithShake({
	projectId,
	clip,
}: {
	projectId: string;
	clip: { sourceId?: string; sourceName?: string; mediaId?: string };
}): ClaudeTimeline {
	return {
		...buildTimeline(projectId),
		tracks: [
			{
				id: "main",
				index: 0,
				name: "Main",
				type: "media",
				elements: [
					{
						id: "clip-1",
						trackIndex: 0,
						startTime: 0,
						endTime: 1,
						duration: 1,
						type: "media",
						...clip,
					},
				],
			},
		],
	} as ClaudeTimeline;
}

const EXPORT_START = "POST /api/claude/export/:projectId/start";

describe("export start and the project's media", () => {
	beforeEach(() => {
		vi.mocked(startExportJob).mockClear();
		vi.mocked(startRendererExportJob).mockClear();
	});

	/**
	 * The editor plays its own copy of each media file. One written over in
	 * the project folder is read again before the export, so the preview and
	 * a renderer export hold what the folder holds.
	 */
	it("has the editor read changed media files again before it exports", async () => {
		const requestMediaRefresh = vi.fn(async () => ({
			checked: 3,
			refreshed: [{ id: "media_shake", name: "shake.mp4" }],
			failed: [],
		}));
		const accessor = buildAccessor(buildTimeline("project-a"));
		Object.assign(accessor, { requestMediaRefresh });
		const { router, getHandler } = buildRouterHarness();
		registerSharedRoutes(router, accessor);
		const [method, path] = EXPORT_START.split(" ");
		await getHandler(
			method,
			path
		)({ params: { projectId: "project-a" }, query: {}, body: {} });
		// It does not hold an export start up for long.
		expect(requestMediaRefresh).toHaveBeenCalledWith({
			projectId: "project-a",
			timeoutMs: 15_000,
		});
		expect(requestMediaRefresh.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(startExportJob).mock.invocationCallOrder[0]
		);
	});

	it("exports natively even when the editor could not read a changed file, or could not be asked", async () => {
		for (const requestMediaRefresh of [
			vi.fn(async () => ({
				checked: 1,
				refreshed: [],
				failed: [{ id: "m", name: "shake.mp4", error: "the file is gone" }],
			})),
			vi.fn(async () => {
				throw new Error("Renderer media refresh timed out.");
			}),
		]) {
			vi.mocked(startExportJob).mockClear();
			const accessor = buildAccessor(buildTimeline("project-a"));
			Object.assign(accessor, { requestMediaRefresh });
			const { router, getHandler } = buildRouterHarness();
			registerSharedRoutes(router, accessor);
			const [method, path] = EXPORT_START.split(" ");
			// The native export reads the folder's files, not the editor's copies.
			await expect(
				getHandler(
					method,
					path
				)({ params: { projectId: "project-a" }, query: {}, body: {} })
			).resolves.toMatchObject({ jobId: "test-job" });
			expect(startExportJob).toHaveBeenCalledTimes(1);
		}
	});

	it("refuses a renderer export while the editor holds an old copy of a file the timeline plays", async () => {
		// A clip names its media by id, or by the file's name.
		for (const clip of [
			{ sourceId: "m" },
			{ mediaId: "m" },
			{ sourceName: "shake.mp4" },
		]) {
			const accessor = buildAccessor(
				timelineWithShake({ projectId: "project-a", clip })
			);
			Object.assign(accessor, {
				requestMediaRefresh: vi.fn(async () => ({
					checked: 2,
					refreshed: [],
					failed: [
						{
							id: "m",
							name: "shake.mp4",
							error: "the file kept changing while it was read",
						},
						{ id: "unused", name: "spare.mp4", error: "the file is gone" },
					],
				})),
			});
			const { router, getHandler } = buildRouterHarness();
			registerSharedRoutes(router, accessor);
			const [method, path] = EXPORT_START.split(" ");
			await expect(
				getHandler(
					method,
					path
				)({
					params: { projectId: "project-a" },
					query: {},
					body: { engine: "muxer" },
				})
			).rejects.toMatchObject({
				status: 409,
				// The file no clip plays is not named: it holds nothing up.
				message:
					"A renderer export would use the editor's old copies: 1 media file(s) on the timeline changed in the project folder and the editor could not read them again: shake.mp4 (the file kept changing while it was read). Fix the files or import them again, then retry.",
			});
			expect(startRendererExportJob).not.toHaveBeenCalled();
		}
	});

	/**
	 * The check covers every media file of the project. A changed file that
	 * could not be read, and that no clip plays, would otherwise refuse
	 * every renderer export until it was fixed or removed.
	 */
	it("lets a renderer export start when the file that could not be read is not on the timeline", async () => {
		const accessor = buildAccessor(
			timelineWithShake({
				projectId: "project-a",
				clip: { sourceId: "media_other", sourceName: "other.mp4" },
			})
		);
		Object.assign(accessor, {
			requestMediaRefresh: vi.fn(async () => ({
				checked: 2,
				refreshed: [],
				failed: [{ id: "m", name: "shake.mp4", error: "the file is gone" }],
			})),
			requestLocalVideoExport: vi.fn(),
		});
		const { router, getHandler } = buildRouterHarness();
		registerSharedRoutes(router, accessor);
		const [method, path] = EXPORT_START.split(" ");
		await getHandler(
			method,
			path
		)({
			params: { projectId: "project-a" },
			query: {},
			body: { engine: "muxer" },
		});
		expect(startRendererExportJob).toHaveBeenCalledTimes(1);
	});

	/**
	 * A check that did not answer may still be reading a changed file: the
	 * renderer would draw the old copy, and a failure here used to pass as
	 * "nothing changed".
	 */
	it("refuses a renderer export when the check did not answer in time", async () => {
		const accessor = buildAccessor(
			timelineWithShake({ projectId: "project-a", clip: { sourceId: "m" } })
		);
		Object.assign(accessor, {
			requestMediaRefresh: vi.fn(async () => {
				throw new Error("Renderer media refresh timed out.");
			}),
		});
		const { router, getHandler } = buildRouterHarness();
		registerSharedRoutes(router, accessor);
		const [method, path] = EXPORT_START.split(" ");
		await expect(
			getHandler(
				method,
				path
			)({
				params: { projectId: "project-a" },
				query: {},
				body: { engine: "muxer" },
			})
		).rejects.toMatchObject({
			status: 409,
			message:
				"A renderer export would use the editor's old copies: the editor did not confirm that its media copies match the project folder (Renderer media refresh timed out.). It may still be reading files that changed; retry in a moment.",
		});
		expect(startRendererExportJob).not.toHaveBeenCalled();
	});

	it("lets a renderer export of a timeline without media start though the check did not answer", async () => {
		const accessor = buildAccessor(buildTimeline("project-a"));
		Object.assign(accessor, {
			requestMediaRefresh: vi.fn(async () => {
				throw new Error("Renderer media refresh timed out.");
			}),
			requestLocalVideoExport: vi.fn(),
		});
		const { router, getHandler } = buildRouterHarness();
		registerSharedRoutes(router, accessor);
		const [method, path] = EXPORT_START.split(" ");
		// Titles alone: the editor holds no copy of a file that could be old.
		await getHandler(
			method,
			path
		)({
			params: { projectId: "project-a" },
			query: {},
			body: { engine: "muxer" },
		});
		expect(startRendererExportJob).toHaveBeenCalledTimes(1);
	});

	it("answers 409 with the clips named when their media is not in the project", async () => {
		const missing = new ClipMediaMissingError({
			missing: [
				{
					elementId: "shake-1",
					trackName: "动效 · 震屏",
					startTime: 41.7,
					wanted: "media_renamed",
				},
			],
		});
		vi.mocked(startExportJob).mockRejectedValueOnce(missing);
		const { router, getHandler } = buildRouterHarness();
		registerSharedRoutes(router, buildAccessor(buildTimeline("project-a")));
		const [method, path] = EXPORT_START.split(" ");
		await expect(
			getHandler(
				method,
				path
			)({ params: { projectId: "project-a" }, query: {}, body: {} })
		).rejects.toMatchObject({
			// The project has to change first; it is not a server fault.
			status: 409,
			message: missing.message,
		});
	});
});
