import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeWindow {
	isDestroyed: () => boolean;
	webContents: {
		isLoading: () => boolean;
		executeJavaScript: ReturnType<typeof vi.fn>;
		once: ReturnType<typeof vi.fn>;
	};
	/** Simulate a reload: the page must report ready again. */
	reload: () => void;
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
	const listeners: Array<() => void> = [];
	return {
		isDestroyed: () => destroyed,
		webContents: {
			isLoading: () => false,
			executeJavaScript: vi.fn(async () => polls++ >= readyAfterPolls),
			once: vi.fn((_event: string, listener: () => void) => {
				listeners.push(listener);
			}),
		},
		reload: () => {
			for (const listener of listeners.splice(0)) listener();
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

	it("checks an open window's editor once per page load", async () => {
		const { ensureMainWindow } = await loadModule();
		const open = fakeWindow();
		electron.windows = [open];

		await ensureMainWindow();
		await ensureMainWindow();
		expect(open.webContents.executeJavaScript).toHaveBeenCalledOnce();

		open.reload();
		await ensureMainWindow();
		expect(open.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
	});

	it("waits for an open window whose editor is still starting", async () => {
		const { ensureMainWindow } = await loadModule();
		const starting = fakeWindow({ readyAfterPolls: 3 });
		electron.windows = [starting];

		expect(await ensureMainWindow()).toBe(starting);
		expect(starting.webContents.executeJavaScript).toHaveBeenCalledTimes(4);
	});

	it("reopens a closed window and makes every caller wait for its editor", async () => {
		const { ensureMainWindow, registerMainWindowFactory } = await loadModule();
		const reopened = fakeWindow({ readyAfterPolls: 2 });
		const create = vi.fn(() => {
			electron.windows = [reopened];
		});
		registerMainWindowFactory(create);

		const first = ensureMainWindow();
		// The window now exists, but its editor is not ready yet.
		const second = ensureMainWindow();
		const [firstWindow, secondWindow] = await Promise.all([first, second]);

		expect(firstWindow).toBe(reopened);
		expect(secondWindow).toBe(reopened);
		expect(create).toHaveBeenCalledOnce();
		expect(reopened.webContents.executeJavaScript).toHaveBeenCalledTimes(3);
	});

	it("gives up at the caller's deadline while the reopen carries on", async () => {
		const { ensureMainWindow, registerMainWindowFactory } = await loadModule();
		const reopened = fakeWindow({ readyAfterPolls: 5 });
		registerMainWindowFactory(() => {
			electron.windows = [reopened];
		});

		await expect(ensureMainWindow({ timeoutMs: 50 })).rejects.toThrow(
			"QCut is still reopening its window; retry the command in a moment."
		);
		// A later request gets the window once the editor is ready.
		expect(await ensureMainWindow()).toBe(reopened);
	});

	it("refuses a request whose deadline has already passed", async () => {
		const { ensureMainWindow, registerMainWindowFactory } = await loadModule();
		registerMainWindowFactory(() => {
			electron.windows = [fakeWindow()];
		});

		await expect(ensureMainWindow({ timeoutMs: 0 })).rejects.toThrow(
			"QCut is still reopening its window"
		);
	});

	it("explains how to recover when it cannot reopen", async () => {
		const { ensureMainWindow } = await loadModule();
		await expect(ensureMainWindow()).rejects.toThrow(
			"No active window: QCut's window is closed. Reopen it (click QCut in the Dock) and retry."
		);
	});

	it("gives up on an open window whose editor never becomes ready", async () => {
		const { ensureMainWindow } = await loadModule();
		electron.windows = [
			fakeWindow({ readyAfterPolls: Number.POSITIVE_INFINITY }),
		];

		await expect(ensureMainWindow({ timeoutMs: 250 })).rejects.toThrow(
			"QCut's editor was not ready within 0.3s. Retry the command."
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
