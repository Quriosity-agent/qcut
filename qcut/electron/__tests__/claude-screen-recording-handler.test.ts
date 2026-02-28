import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
	ipcOnMock: vi.fn(),
	ipcRemoveListenerMock: vi.fn(),
}));

const handlerMocks = vi.hoisted(() => ({
	forceStopMock: vi.fn(),
	buildStatusMock: vi.fn(),
}));

vi.mock("electron", () => ({
	ipcMain: {
		on: electronMocks.ipcOnMock,
		removeListener: electronMocks.ipcRemoveListenerMock,
	},
	BrowserWindow: {},
}));

vi.mock("../screen-recording-handler/index.js", () => ({
	buildStatus: handlerMocks.buildStatusMock,
	forceStopActiveScreenRecordingSession: handlerMocks.forceStopMock,
}));

vi.mock("../claude/utils/logger.js", () => ({
	claudeLog: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { ipcMain } from "electron";
import { requestStopRecordingFromRenderer } from "../claude/handlers/claude-screen-recording-handler";

function createWindowWithRendererStopResponse({
	response,
}: {
	response: {
		result?: {
			success: boolean;
			filePath: string | null;
			bytesWritten: number;
			durationMs: number;
			discarded: boolean;
		};
		error?: string;
	};
}): { webContents: { send: (channel: string, payload: unknown) => void } } {
	let stopResponseHandler:
		| ((event: unknown, payload: unknown) => void)
		| undefined;

	vi.mocked(ipcMain.on).mockImplementation((channel, handler) => {
		if (channel === "claude:screen-recording:stop:response") {
			stopResponseHandler = handler as (event: unknown, payload: unknown) => void;
		}
		return ipcMain;
	});

	return {
		webContents: {
			send: (channel: string, payload: unknown): void => {
				try {
					if (channel !== "claude:screen-recording:stop:request") {
						return;
					}
					if (!stopResponseHandler) {
						throw new Error("Stop response handler was not registered");
					}
					const typedPayload = payload as { requestId: string };
					stopResponseHandler({}, { requestId: typedPayload.requestId, ...response });
				} catch (error) {
					throw new Error(
						`Failed to simulate renderer stop response: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			},
		},
	};
}

describe("claude-screen-recording-handler stop recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("force-stops when renderer returns success but main session remains active", async () => {
		handlerMocks.buildStatusMock
			.mockReturnValueOnce({ recording: true })
			.mockReturnValueOnce({ recording: true });
		handlerMocks.forceStopMock.mockResolvedValue({
			success: true,
			wasRecording: true,
			filePath: "/tmp/recovered.mp4",
			bytesWritten: 256,
			durationMs: 1234,
			discarded: false,
		});

		const win = createWindowWithRendererStopResponse({
			response: {
				result: {
					success: true,
					filePath: null,
					bytesWritten: 0,
					durationMs: 0,
					discarded: true,
				},
			},
		});

		const result = await requestStopRecordingFromRenderer(win as never, {});

		expect(handlerMocks.forceStopMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			success: true,
			filePath: "/tmp/recovered.mp4",
			bytesWritten: 256,
			durationMs: 1234,
			discarded: false,
		});
	});

	it("returns renderer result when main session is cleared", async () => {
		handlerMocks.buildStatusMock
			.mockReturnValueOnce({ recording: true })
			.mockReturnValueOnce({ recording: false });

		const rendererResult = {
			success: true,
			filePath: "/tmp/renderer.mp4",
			bytesWritten: 1024,
			durationMs: 4000,
			discarded: false,
		};

		const win = createWindowWithRendererStopResponse({
			response: { result: rendererResult },
		});

		const result = await requestStopRecordingFromRenderer(win as never, {});

		expect(handlerMocks.forceStopMock).not.toHaveBeenCalled();
		expect(result).toEqual(rendererResult);
	});

	it("force-stops when renderer stop returns an error", async () => {
		handlerMocks.buildStatusMock.mockReturnValueOnce({ recording: true });
		handlerMocks.forceStopMock.mockResolvedValue({
			success: true,
			wasRecording: true,
			filePath: "/tmp/fallback.mp4",
			bytesWritten: 300,
			durationMs: 2500,
			discarded: false,
		});

		const win = createWindowWithRendererStopResponse({
			response: { error: "Renderer stop failed" },
		});

		const result = await requestStopRecordingFromRenderer(win as never, {});

		expect(handlerMocks.forceStopMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			success: true,
			filePath: "/tmp/fallback.mp4",
			bytesWritten: 300,
			durationMs: 2500,
			discarded: false,
		});
	});
});
