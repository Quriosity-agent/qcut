// Location: electron/__tests__/ffmpeg-basic-handlers.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TempManager } from "../temp-manager.js";
import type { OpenFolderResult } from "../ffmpeg/types.js";

// vi.hoisted runs before vi.mock hoisting — safe to reference in factories
const { mockHandle, mockOpenPath } = vi.hoisted(() => ({
	mockHandle: vi.fn(),
	mockOpenPath: vi.fn().mockResolvedValue(""),
}));

vi.mock("electron", () => ({
	ipcMain: { handle: mockHandle },
	shell: { openPath: mockOpenPath },
	app: { getPath: vi.fn(() => "/tmp") },
}));

vi.mock("fs", () => ({
	default: {
		existsSync: vi.fn(() => true),
		writeFileSync: vi.fn(),
		readFileSync: vi.fn(() => Buffer.from("video-data")),
	},
	existsSync: vi.fn(() => true),
	writeFileSync: vi.fn(),
	readFileSync: vi.fn(() => Buffer.from("video-data")),
}));

vi.mock("../ffmpeg/utils", () => ({
	getFFmpegPath: vi.fn(() => "/usr/bin/ffmpeg"),
}));

import { setupBasicHandlers } from "../ffmpeg-basic-handlers";

/** Extract the handler callback registered for a given channel name */
function getHandler(channel: string) {
	const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel);
	if (!call) throw new Error(`No handler registered for "${channel}"`);
	return call[1] as (...args: unknown[]) => unknown;
}

describe("setupBasicHandlers", () => {
	const mockTempManager = {
		createExportSession: vi.fn(() => ({
			sessionId: "123",
			frameDir: "/tmp/qcut-export/123/frames",
			outputDir: "/tmp/qcut-export/123/output",
		})),
		cleanup: vi.fn(),
		getFrameDir: vi.fn((id: string) => `/tmp/qcut-export/${id}/frames`),
		getOutputDir: vi.fn((id: string) => `/tmp/qcut-export/${id}/output`),
		getSessionDir: vi.fn((id: string) => `/tmp/qcut-export/${id}`),
		getTempDir: vi.fn(() => "/tmp/qcut-export"),
		cleanupOldSessions: vi.fn(),
	};

	const mockGetFFmpegHealth = vi.fn().mockResolvedValue({
		ffmpegOk: true,
		ffprobeOk: true,
		ffmpegVersion: "6.1.1",
		ffprobeVersion: "6.1.1",
		ffmpegPath: "/usr/bin/ffmpeg",
		ffprobePath: "/usr/bin/ffprobe",
		errors: [],
	});

	beforeEach(() => {
		vi.clearAllMocks();
		setupBasicHandlers(
			mockTempManager as unknown as TempManager,
			mockGetFFmpegHealth
		);
	});

	it("registers all 8 IPC handlers", () => {
		expect(mockHandle).toHaveBeenCalledTimes(8);

		const channels = mockHandle.mock.calls.map((c: unknown[]) => c[0]);
		expect(channels).toContain("ffmpeg-path");
		expect(channels).toContain("ffmpeg-health");
		expect(channels).toContain("create-export-session");
		expect(channels).toContain("save-frame");
		expect(channels).toContain("read-output-file");
		expect(channels).toContain("cleanup-export-session");
		expect(channels).toContain("open-frames-folder");
		expect(channels).toContain("ffmpeg-ass-font-metrics");
	});

	it("ffmpeg-ass-font-metrics omits a face it cannot measure", async () => {
		const handler = getHandler("ffmpeg-ass-font-metrics");
		// An uninstalled family would measure a neutral 1.0, which the renderer
		// cannot tell from a real measurement, so it has to be left out (N31).
		// Which families a runner has is not knowable, so this asserts the
		// absent one is gone and that anything returned is a real measurement.
		const replies: Array<{
			family: string;
			sizeFactor: number;
			lineHeightEm: number;
			coversCjk: boolean;
		}> = await handler({}, [
			{ family: "QCutNotAnInstalledFamily" },
			{ family: "Helvetica" },
			{ family: "DejaVu Sans" },
		]);

		expect(
			replies.some((reply) => reply.family === "QCutNotAnInstalledFamily")
		).toBe(false);
		for (const reply of replies) {
			expect(reply.sizeFactor).toBeGreaterThan(0);
			expect(reply.lineHeightEm).toBeGreaterThan(0);
			expect(typeof reply.coversCjk).toBe("boolean");
		}
	});

	it("ffmpeg-ass-font-metrics tolerates a malformed request list", async () => {
		const handler = getHandler("ffmpeg-ass-font-metrics");
		expect(await handler({}, undefined)).toEqual([]);
	});

	it("ffmpeg-ass-font-metrics drops malformed entries instead of throwing", async () => {
		const handler = getHandler("ffmpeg-ass-font-metrics");
		// The array crosses IPC from the renderer, so nothing about its shape
		// is guaranteed: a null entry would throw on `request.family`, and a
		// non-boolean `bold` would quietly pick the wrong face.
		expect(
			await handler({}, [
				null,
				42,
				{},
				{ family: "" },
				{ family: "   " },
				{ family: "Helvetica", bold: "yes" },
				{ family: "Helvetica", italic: 1 },
			])
		).toEqual([]);
	});

	it("ffmpeg-path returns a string path", async () => {
		const handler = getHandler("ffmpeg-path");
		const result = await handler();
		expect(typeof result).toBe("string");
		expect(result).toBe("/usr/bin/ffmpeg");
	});

	it("ffmpeg-health returns health result", async () => {
		const handler = getHandler("ffmpeg-health");
		const result = await handler();
		expect(result).toEqual(
			expect.objectContaining({
				ffmpegOk: true,
				ffprobeOk: true,
			})
		);
		expect(mockGetFFmpegHealth).toHaveBeenCalled();
	});

	it("create-export-session calls tempManager.createExportSession", async () => {
		const handler = getHandler("create-export-session");
		const result = await handler();
		expect(mockTempManager.createExportSession).toHaveBeenCalled();
		expect(result).toEqual({
			sessionId: "123",
			frameDir: "/tmp/qcut-export/123/frames",
			outputDir: "/tmp/qcut-export/123/output",
		});
	});

	it("cleanup-export-session calls tempManager.cleanup", async () => {
		const handler = getHandler("cleanup-export-session");
		await handler({}, "session-42");
		expect(mockTempManager.cleanup).toHaveBeenCalledWith("session-42");
	});

	it("open-frames-folder opens the frame directory", async () => {
		const handler = getHandler("open-frames-folder");
		const result = (await handler({}, "session-99")) as OpenFolderResult;
		expect(mockTempManager.getFrameDir).toHaveBeenCalledWith("session-99");
		expect(mockOpenPath).toHaveBeenCalledWith(
			"/tmp/qcut-export/session-99/frames"
		);
		expect(result.success).toBe(true);
		expect(result.path).toBe("/tmp/qcut-export/session-99/frames");
	});
});
