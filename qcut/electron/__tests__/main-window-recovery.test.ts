import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeWindow {
	isDestroyed: () => boolean;
	webContents: {
		isLoading: () => boolean;
		executeJavaScript: (code: string) => Promise<unknown>;
	};
}

const electron = vi.hoisted(() => ({ windows: [] as FakeWindow[] }));

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: () => electron.windows },
}));

function fakeWindow({
	readyAfterPolls = 0,
	destroyed = false,
}: {
	readyAfterPolls?: number;
	destroyed?: boolean;
} = {}): FakeWindow {
	let polls = 0;
	return {
		isDestroyed: () => destroyed,
		webContents: {
			isLoading: () => false,
			executeJavaScript: async () => polls++ >= readyAfterPolls,
		},
	};
}

async function loadModule() {
	vi.resetModules();
	return import("../main-window-recovery.js");
}

describe("ensureMainWindow", () => {
	beforeEach(() => {
		electron.windows = [];
	});

	it("returns the open window without reopening", async () => {
		const { ensureMainWindow, registerMainWindowFactory } = await loadModule();
		const open = fakeWindow();
		electron.windows = [open];
		const create = vi.fn();
		registerMainWindowFactory(create);

		expect(await ensureMainWindow()).toBe(open);
		expect(create).not.toHaveBeenCalled();
	});

	it("reopens a closed window and waits for the editor to be ready", async () => {
		const { ensureMainWindow, registerMainWindowFactory } = await loadModule();
		const reopened = fakeWindow({ readyAfterPolls: 2 });
		const create = vi.fn(() => {
			electron.windows = [reopened];
		});
		registerMainWindowFactory(create);

		const [first, second] = await Promise.all([
			ensureMainWindow(),
			ensureMainWindow(),
		]);

		expect(first).toBe(reopened);
		expect(second).toBe(reopened);
		expect(create).toHaveBeenCalledOnce();
	});

	it("explains how to recover when it cannot reopen", async () => {
		const { ensureMainWindow } = await loadModule();
		await expect(ensureMainWindow()).rejects.toThrow(
			"No active window: QCut's window is closed. Reopen it (click QCut in the Dock) and retry."
		);
	});

	it("gives up when the editor never becomes ready", async () => {
		const { ensureMainWindow, registerMainWindowFactory } = await loadModule();
		registerMainWindowFactory(() => {
			electron.windows = [
				fakeWindow({ readyAfterPolls: Number.POSITIVE_INFINITY }),
			];
		});

		await expect(ensureMainWindow({ timeoutMs: 250 })).rejects.toThrow(
			"QCut reopened its window, but the editor was not ready"
		);
	});
});

describe("getMainWindowState", () => {
	it("counts open windows only", async () => {
		const { getMainWindowState } = await loadModule();
		electron.windows = [];
		expect(getMainWindowState()).toEqual({ hasWindow: false, count: 0 });
		electron.windows = [fakeWindow(), fakeWindow({ destroyed: true })];
		expect(getMainWindowState()).toEqual({ hasWindow: true, count: 1 });
	});
});
