import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	return {
		listeners,
		ipcMain: {
			on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
				listeners.set(channel, listener);
			}),
			removeListener: vi.fn(
				(channel: string, listener: (...args: unknown[]) => void) => {
					if (listeners.get(channel) === listener) listeners.delete(channel);
				}
			),
		},
	};
});

vi.mock("electron", () => ({ ipcMain: electronMocks.ipcMain }));

import {
	MEDIA_REFRESH_BEFORE_EXPORT_MS,
	MEDIA_REFRESH_CLIENT_TIMEOUT_MS,
	MEDIA_REFRESH_TIMEOUT_MS,
	MEDIA_RENAME_CLIENT_TIMEOUT_MS,
	MEDIA_RENAME_COMMIT_MARGIN_MS,
	MEDIA_RENAME_TIMEOUT_MS,
	UTILITY_BRIDGE_MARGIN_MS,
	mediaRefreshWaitMs,
} from "../handlers/claude-media-deadlines";
import {
	requestMediaDeleteFromRenderer,
	requestMediaImportFromRenderer,
	requestMediaRefreshFromRenderer,
	requestMediaRenameFromRenderer,
} from "../handlers/claude-media-renderer-handler";

function createWindow({
	responseError,
	result,
	answers = true,
}: {
	responseError?: string;
	/** What the editor's handler returned. */
	result?: unknown;
	/** False for an editor that is still at work when the wait ends. */
	answers?: boolean;
} = {}): Electron.BrowserWindow {
	const webContents = {
		isDestroyed: () => false,
		mainFrame: {},
		send: vi.fn((channel: string, payload: { requestId: string }) => {
			const responseChannel = `${channel}:response`;
			const listener = electronMocks.listeners.get(responseChannel);
			if (!listener) throw new Error(`Missing listener for ${responseChannel}`);
			if (!answers) return;
			queueMicrotask(() =>
				listener(
					{
						sender: webContents,
						senderFrame: webContents.mainFrame,
					},
					{
						...(responseError ? { error: responseError } : {}),
						...(result === undefined ? {} : { result }),
						requestId: payload.requestId,
					}
				)
			);
		}),
	};
	return {
		isDestroyed: () => false,
		webContents,
	} as unknown as Electron.BrowserWindow;
}

describe("Claude media renderer acknowledgement", () => {
	beforeEach(() => {
		electronMocks.listeners.clear();
		vi.clearAllMocks();
	});

	it("waits for renderer persistence before resolving an import", async () => {
		const win = createWindow();

		await expect(
			requestMediaImportFromRenderer({
				payload: {
					id: "media-1",
					name: "reference.gif",
					path: "/project/media/reference.gif",
					projectId: "project-1",
					size: 128,
					type: "image",
				},
				win,
			})
		).resolves.toBeUndefined();

		expect(win.webContents.send).toHaveBeenCalledWith(
			"claude:media:imported",
			expect.objectContaining({
				id: "media-1",
				requestId: expect.any(String),
			})
		);
		expect(electronMocks.listeners.size).toBe(0);
	});

	it("propagates a renderer persistence failure", async () => {
		const win = createWindow({ responseError: "IndexedDB write failed" });

		await expect(
			requestMediaImportFromRenderer({
				payload: {
					id: "media-1",
					name: "reference.gif",
					path: "/project/media/reference.gif",
					projectId: "project-1",
					size: 128,
					type: "image",
				},
				win,
			})
		).rejects.toThrow("IndexedDB write failed");
	});

	it("acknowledges renderer deletion separately", async () => {
		const win = createWindow();

		await expect(
			requestMediaDeleteFromRenderer({
				payload: { mediaId: "media-1", projectId: "project-1" },
				win,
			})
		).resolves.toBeUndefined();

		expect(win.webContents.send).toHaveBeenCalledWith(
			"claude:media:deleted",
			expect.objectContaining({ mediaId: "media-1" })
		);
	});

	const RENAME = {
		projectId: "project-1",
		mediaId: "media_old",
		newMediaId: "media_new",
		newName: "shake_v2.mp4",
		newPath: "/project/media/shake_v2.mp4",
	};

	/**
	 * The editor is told when the wait for it ends: a rename it finished
	 * after that would stand in the editor while the file is renamed back.
	 */
	it("tells the editor when the wait for a rename ends, a little before it does", async () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(1_000_000);
			const win = createWindow();
			await requestMediaRenameFromRenderer({ payload: RENAME, win });
			expect(win.webContents.send).toHaveBeenCalledWith(
				"claude:media:renamed",
				{
					...RENAME,
					deadlineAt:
						1_000_000 + MEDIA_RENAME_TIMEOUT_MS - MEDIA_RENAME_COMMIT_MARGIN_MS,
					requestId: expect.any(String),
				}
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("gives up on a rename only after the editor's own deadline", async () => {
		vi.useFakeTimers();
		try {
			const win = createWindow({ answers: false });
			let failure: Error | undefined;
			const waiting = requestMediaRenameFromRenderer({
				payload: RENAME,
				win,
			}).catch((error: Error) => {
				failure = error;
			});
			await vi.advanceTimersByTimeAsync(MEDIA_RENAME_TIMEOUT_MS - 1);
			expect(failure).toBeUndefined();
			await vi.advanceTimersByTimeAsync(1);
			await waiting;
			expect(failure?.message).toBe("Renderer media rename timed out.");
		} finally {
			vi.useRealTimers();
		}
	});

	it("hands back what a refresh read and what it could not", async () => {
		const win = createWindow({
			result: {
				checked: 3,
				refreshed: [{ id: "media_a", name: "a.mp4" }, "not an entry"],
				failed: [{ id: "media_b", name: "b.mp4", error: "the file is gone" }],
			},
		});
		await expect(
			requestMediaRefreshFromRenderer({
				payload: { projectId: "project-1" },
				win,
			})
		).resolves.toEqual({
			checked: 3,
			refreshed: [{ id: "media_a", name: "a.mp4" }],
			failed: [{ id: "media_b", name: "b.mp4", error: "the file is gone" }],
		});
	});

	it("waits for a refresh as long as the asker does, and no longer than its own limit", async () => {
		vi.useFakeTimers();
		try {
			const win = createWindow({ answers: false });
			let failure: Error | undefined;
			const waiting = requestMediaRefreshFromRenderer({
				payload: {
					projectId: "project-1",
					timeoutMs: MEDIA_REFRESH_BEFORE_EXPORT_MS,
				},
				win,
			}).catch((error: Error) => {
				failure = error;
			});
			await vi.advanceTimersByTimeAsync(MEDIA_REFRESH_BEFORE_EXPORT_MS - 1);
			expect(failure).toBeUndefined();
			await vi.advanceTimersByTimeAsync(1);
			await waiting;
			expect(failure?.message).toBe("Renderer media refresh timed out.");
		} finally {
			vi.useRealTimers();
		}
		expect(mediaRefreshWaitMs({})).toBe(MEDIA_REFRESH_TIMEOUT_MS);
		expect(mediaRefreshWaitMs({ timeoutMs: 15_000 })).toBe(15_000);
		expect(mediaRefreshWaitMs({ timeoutMs: 999_999_999 })).toBe(
			MEDIA_REFRESH_TIMEOUT_MS
		);
		expect(mediaRefreshWaitMs({ timeoutMs: "soon" })).toBe(
			MEDIA_REFRESH_TIMEOUT_MS
		);
	});

	/**
	 * A request passes through the editor, the main process, the utility
	 * process that serves the HTTP API, and the command line. An outer wait
	 * that ended first answered "failed" while the work went on inside: the
	 * utility process's usual wait is 10 s.
	 */
	it("keeps every wait longer than the one inside it", () => {
		const UTILITY_HTTP_REQUEST_MS = 120_000;
		// Rename: editor < main < utility bridge < command line.
		expect(MEDIA_RENAME_COMMIT_MARGIN_MS).toBeGreaterThan(0);
		expect(MEDIA_RENAME_TIMEOUT_MS + UTILITY_BRIDGE_MARGIN_MS).toBeLessThan(
			MEDIA_RENAME_CLIENT_TIMEOUT_MS
		);
		expect(MEDIA_RENAME_CLIENT_TIMEOUT_MS).toBeLessThan(
			UTILITY_HTTP_REQUEST_MS
		);
		// Refresh: main < utility bridge < one HTTP request < command line.
		expect(MEDIA_REFRESH_TIMEOUT_MS + UTILITY_BRIDGE_MARGIN_MS).toBeLessThan(
			UTILITY_HTTP_REQUEST_MS
		);
		expect(UTILITY_HTTP_REQUEST_MS).toBeLessThan(
			MEDIA_REFRESH_CLIENT_TIMEOUT_MS
		);
		// An export start's own check fits inside a usual 30 s request.
		expect(
			MEDIA_REFRESH_BEFORE_EXPORT_MS + UTILITY_BRIDGE_MARGIN_MS
		).toBeLessThan(30_000);
	});
});
