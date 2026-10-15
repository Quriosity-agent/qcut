/**
 * Brings back the editor window when an API request needs one.
 *
 * On macOS QCut keeps running after its last window closes, and the editor
 * API keeps answering from the utility process. Every command that talks to
 * the editor then failed with "No active window" until someone clicked the
 * Dock icon. Now such a request reopens the window the way the Dock does and
 * waits until the editor inside it can take requests.
 *
 * @module electron/main-window-recovery
 */

import { BrowserWindow } from "electron";

const REOPEN_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 100;

/** Set by the renderer once its editor API listeners are registered. */
const RENDERER_READY_EXPRESSION = "window.__qcutClaudeBridgeReady === true";

export interface MainWindowState {
	hasWindow: boolean;
	count: number;
}

let createMainWindow: (() => void) | null = null;
let reopening: Promise<BrowserWindow> | null = null;

/** Record how this process opens its editor window (main.ts's createWindow). */
export function registerMainWindowFactory(create: () => void): void {
	createMainWindow = create;
}

/** Whether an editor window is open right now, for `editor health`. */
export function getMainWindowState(): MainWindowState {
	const count = BrowserWindow.getAllWindows().filter(
		(win) => !win.isDestroyed()
	).length;
	return { hasWindow: count > 0, count };
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilEditorReady({
	win,
	timeoutMs,
}: {
	win: BrowserWindow;
	timeoutMs: number;
}): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (win.isDestroyed()) {
			throw new Error(
				"QCut's reopened window closed before it finished loading"
			);
		}
		try {
			if (
				!win.webContents.isLoading() &&
				(await win.webContents.executeJavaScript(RENDERER_READY_EXPRESSION))
			) {
				return;
			}
		} catch {
			// The page is still navigating; keep waiting.
		}
		await delay(READY_POLL_MS);
	}
	throw new Error(
		`QCut reopened its window, but the editor was not ready within ${Math.round(timeoutMs / 1000)}s. Retry the command.`
	);
}

async function reopenMainWindow({
	create,
	timeoutMs,
}: {
	create: () => void;
	timeoutMs: number;
}): Promise<BrowserWindow> {
	create();
	const win = BrowserWindow.getAllWindows().find(
		(candidate) => !candidate.isDestroyed()
	);
	if (!win) throw new Error("QCut could not reopen its window");
	await waitUntilEditorReady({ win, timeoutMs });
	return win;
}

/**
 * The open editor window, reopening it first when every window was closed.
 * Concurrent requests share one reopen.
 */
export async function ensureMainWindow({
	timeoutMs = REOPEN_TIMEOUT_MS,
}: {
	timeoutMs?: number;
} = {}): Promise<BrowserWindow> {
	const existing = BrowserWindow.getAllWindows().find(
		(win) => !win.isDestroyed()
	);
	if (existing) return existing;
	const create = createMainWindow;
	if (!create) {
		throw new Error(
			"No active window: QCut's window is closed. Reopen it (click QCut in the Dock) and retry."
		);
	}
	reopening ??= reopenMainWindow({ create, timeoutMs }).finally(() => {
		reopening = null;
	});
	return reopening;
}
