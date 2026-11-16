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
		expect(requestMediaRefresh).toHaveBeenCalledWith({
			projectId: "project-a",
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

	it("refuses a renderer export while the editor holds an old copy of a changed file", async () => {
		const accessor = buildAccessor(buildTimeline("project-a"));
		Object.assign(accessor, {
			requestMediaRefresh: vi.fn(async () => ({
				checked: 1,
				refreshed: [],
				failed: [
					{
						id: "m",
						name: "shake.mp4",
						error: "the file kept changing while it was read",
					},
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
			message: expect.stringContaining(
				"1 media file(s) changed in the project folder and the editor could not read them again, so a renderer export would use its old copies: shake.mp4 (the file kept changing while it was read)."
			),
		});
		expect(startRendererExportJob).not.toHaveBeenCalled();
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
