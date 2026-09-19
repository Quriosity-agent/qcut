// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedRequest, Router } from "../claude/utils/http-router";
import { registerAnalysisRoutes } from "../claude/http/claude-http-analysis-routes";

const mocks = vi.hoisted(() => ({
	detectScenes: vi.fn(),
	logOperation: vi.fn(),
}));
vi.mock("../claude/handlers/claude-scene-handler.js", () => ({
	detectScenes: mocks.detectScenes,
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
vi.mock("../claude/claude-operation-log.js", () => ({
	logOperation: mocks.logOperation,
}));
vi.mock("../claude/utils/logger.js", () => ({ claudeLog: { debug: vi.fn() } }));

function sceneRoute() {
	const routes = new Map<string, Parameters<Router["post"]>[1]>();
	registerAnalysisRoutes(
		{
			post: (path, handler) => {
				routes.set(path, handler);
			},
			get: vi.fn(),
			patch: vi.fn(),
			delete: vi.fn(),
			handle: vi.fn(),
		},
		{
			getWindow: () => {
				throw new Error("Scene analysis must not mutate the renderer");
			},
		}
	);
	const handler = routes.get("/api/claude/analyze/:projectId/scenes");
	if (!handler) throw new Error("Scene route missing");
	return ({ body }: { body: Record<string, unknown> }) =>
		handler({
			params: { projectId: "project" },
			query: {},
			body,
		} as ParsedRequest);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.detectScenes
		.mockReset()
		.mockResolvedValue({
			engine: "onnx",
			route: "onnx-route",
			scenes: [],
			totalScenes: 0,
			averageShotDuration: 0,
		});
});

describe("scene HTTP engine routing", () => {
	it("forwards the explicit ONNX selection and records returned engine metadata", async () => {
		const result = await sceneRoute()({
			body: { mediaId: "video", engine: "onnx", aiAnalysis: false },
		});
		expect(mocks.detectScenes).toHaveBeenCalledWith("project", {
			mediaId: "video",
			engine: "onnx",
			aiAnalysis: false,
		});
		expect(result).toMatchObject({ engine: "onnx" });
		expect(mocks.logOperation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					engine: "onnx",
					route: "onnx-route",
				}),
			})
		);
	});

	it("leaves an omitted engine for the handler's FFmpeg default", async () => {
		await sceneRoute()({ body: { mediaId: "video" } });
		expect(mocks.detectScenes).toHaveBeenCalledWith(
			"project",
			expect.objectContaining({ engine: undefined })
		);
	});

	it.each([
		null,
		false,
		0,
		"auto",
		"ONNX",
		"torch",
		"",
		[],
		{},
	])("rejects invalid engine %j as HTTP 400", async (engine) => {
		await expect(
			sceneRoute()({ body: { mediaId: "video", engine } })
		).rejects.toMatchObject({
			status: 400,
			message: expect.stringContaining("Invalid scene detection engine"),
		});
		expect(mocks.detectScenes).not.toHaveBeenCalled();
	});

	it.each([
		"true",
		"false",
		1,
		null,
	])("rejects ambiguous cloud opt-in %j", async (aiAnalysis) => {
		await expect(
			sceneRoute()({ body: { mediaId: "video", engine: "onnx", aiAnalysis } })
		).rejects.toMatchObject({ status: 400 });
		expect(mocks.detectScenes).not.toHaveBeenCalled();
	});

	it("rejects a FFmpeg threshold on the fixed ONNX profile", async () => {
		await expect(
			sceneRoute()({
				body: { mediaId: "video", engine: "onnx", threshold: 0.3 },
			})
		).rejects.toMatchObject({ status: 400 });
		expect(mocks.detectScenes).not.toHaveBeenCalled();
	});

	it("returns the ONNX failure instead of trying FFmpeg", async () => {
		mocks.detectScenes.mockRejectedValueOnce(
			new Error("ONNX weights unavailable")
		);
		await expect(
			sceneRoute()({ body: { mediaId: "video", engine: "onnx" } })
		).rejects.toMatchObject({
			status: 500,
			message: "ONNX weights unavailable",
		});
		expect(mocks.detectScenes).toHaveBeenCalledTimes(1);
	});
});
