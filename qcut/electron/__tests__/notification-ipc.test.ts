import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
		removeHandler: vi.fn(),
	},
}));

import { ipcMain } from "electron";
import {
	notificationBridge,
	setupClaudeNotificationIPC,
} from "../claude/notification-bridge";

function getIpcHandler({
	channel,
}: {
	channel: string;
}): (event: unknown, payload?: unknown) => Promise<unknown> {
	const call = vi
		.mocked(ipcMain.handle)
		.mock.calls.find(([registered]) => registered === channel);
	if (!call) {
		throw new Error(`Missing IPC handler for channel: ${channel}`);
	}
	return call[1] as (event: unknown, payload?: unknown) => Promise<unknown>;
}

describe("notification IPC", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		notificationBridge.resetForTests();
	});

	it("registers handlers and supports enable/disable/status/history", async () => {
		setupClaudeNotificationIPC();

		const enable = getIpcHandler({ channel: "claude:notifications:enable" });
		const disable = getIpcHandler({ channel: "claude:notifications:disable" });
		const status = getIpcHandler({ channel: "claude:notifications:status" });
		const history = getIpcHandler({ channel: "claude:notifications:history" });

		const initialStatus = await status({});
		expect(initialStatus).toEqual({
			enabled: false,
			sessionId: null,
		});

		const enabledStatus = await enable({}, { sessionId: "pty-1" });
		expect(enabledStatus).toEqual({
			enabled: true,
			sessionId: "pty-1",
		});

		const disabledStatus = await disable({});
		expect(disabledStatus).toEqual({
			enabled: false,
			sessionId: null,
		});

		const historyItems = await history({}, { limit: 5 });
		expect(historyItems).toEqual([]);
	});

	it("throws when enabling without a session id", async () => {
		setupClaudeNotificationIPC();
		const enable = getIpcHandler({ channel: "claude:notifications:enable" });

		await expect(enable({}, {})).rejects.toThrow("sessionId is required");
	});
});
