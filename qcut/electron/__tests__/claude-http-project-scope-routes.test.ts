import { describe, expect, it, vi } from "vitest";
import type { ParsedRequest, Router } from "../claude/utils/http-router";
import { registerAnalysisRoutes } from "../claude/http/claude-http-analysis-routes";

vi.mock("../claude/handlers/claude-scene-handler.js", () => ({
	INVALID_SCENE_ENGINE_MESSAGE: "Invalid scene detection engine",
	detectScenes: vi.fn(),
	inspectSceneEngines: vi.fn(),
}));
vi.mock("../claude/handlers/claude-analyze-handler.js", () => ({}));
vi.mock("../claude/handlers/claude-transcribe-handler.js", () => ({}));
vi.mock("../claude/handlers/claude-vision-handler.js", () => ({}));
vi.mock("../claude/handlers/claude-filler-handler.js", () => ({}));
vi.mock("../claude/handlers/claude-beats-handler.js", () => ({}));
vi.mock("../claude/handlers/claude-cuts-handler.js", () => ({}));
vi.mock("../claude/handlers/claude-range-handler.js", () => ({}));
vi.mock("../claude/handlers/claude-auto-edit-handler.js", () => ({}));
vi.mock("../claude/handlers/claude-suggest-handler.js", () => ({}));
vi.mock("../claude/handlers/claude-media-handler.js", () => ({}));
vi.mock("../claude/http/claude-http-search-routes.js", () => ({}));
vi.mock("../claude/http/claude-http-meta-routes.js", () => ({}));
vi.mock("../claude/claude-operation-log.js", () => ({ logOperation: vi.fn() }));
vi.mock("../claude/utils/logger.js", () => ({ claudeLog: { debug: vi.fn() } }));

function rangeRoute({ openProjectId }: { openProjectId: string }) {
	const routes = new Map<string, Parameters<Router["delete"]>[1]>();
	const executeDeleteRange = vi.fn(async () => ({
		deletedElements: 1,
		splitElements: 0,
		totalRemovedDuration: 1,
	}));
	registerAnalysisRoutes(
		{
			post: vi.fn(),
			get: vi.fn(),
			patch: vi.fn(),
			delete: (path, handler) => {
				routes.set(path, handler);
			},
			handle: vi.fn(),
		},
		{
			getWindow: () => {
				throw new Error("must not reach the window");
			},
			executeDeleteRange,
			requestStateSnapshot: vi.fn(async () => ({
				state: { project: { activeProject: { id: openProjectId } } },
			})) as never,
		}
	);
	const handler = routes.get("/api/claude/timeline/:projectId/range");
	if (!handler) throw new Error("range route missing");
	return {
		executeDeleteRange,
		call: (projectId: string) =>
			handler({
				params: { projectId },
				query: {},
				body: { startTime: 1, endTime: 2 },
			} as ParsedRequest),
	};
}

/** The drill: `delete-range --project-id fake` deleted a second from the open project. */
describe("delete-range project scope", () => {
	it("refuses a project id that is not the open one, before touching the timeline", async () => {
		const { call, executeDeleteRange } = rangeRoute({ openProjectId: "real" });
		await expect(call("fake")).rejects.toMatchObject({
			status: 409,
			message: expect.stringContaining("has real open, not fake"),
		});
		expect(executeDeleteRange).not.toHaveBeenCalled();
	});

	it("runs for the open project", async () => {
		const { call, executeDeleteRange } = rangeRoute({ openProjectId: "real" });
		await expect(call("real")).resolves.toMatchObject({ deletedElements: 1 });
		expect(executeDeleteRange).toHaveBeenCalledWith({
			startTime: 1,
			endTime: 2,
			trackIds: undefined,
			ripple: undefined,
			crossTrackRipple: undefined,
		});
	});
});
