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

import { BrowserWindow, type WebContents } from "electron";

const REOPEN_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 100;

/** Set by the renderer once its editor API listeners are registered. */
const RENDERER_READY_EXPRESSION = "window.__qcutClaudeBridgeReady === true";

const REOPEN_PENDING_MESSAGE =
	"QCut is still reopening its window; retry the command in a moment.";

export interface MainWindowState {
	hasWindow: boolean;
	count: number;
}

let createMainWindow: (() => void) | null = null;
let reopening: Promise<BrowserWindow> | null = null;
/** Pages known to be listening. A reload drops a page until it says so again. */
const readyContents = new WeakSet<WebContents>();

/** Record how this process opens its editor window (main.ts's createWindow). */
export function registerMainWindowFactory(create: () => void): void {
	createMainWindow = create;
}

function findOpenWindow(): BrowserWindow | undefined {
	return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
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

/**
 * Resolves once the editor in `win` has its API listeners registered. The
 * answer is remembered per page load, so only the first request after a
 * launch, reopen or reload waits.
 */
async function waitUntilEditorReady({
	win,
	deadline,
	timeoutMs,
}: {
	win: BrowserWindow;
	deadline: number;
	/** The wait the caller allowed, for the message; a measured remainder would vary. */
	timeoutMs: number;
}): Promise<void> {
	const contents = win.webContents;
	if (readyContents.has(contents)) return;
	while (Date.now() < deadline) {
		if (win.isDestroyed()) {
			throw new Error(
				"QCut's window closed before the editor finished loading"
			);
		}
		try {
			if (
				!contents.isLoading() &&
				(await contents.executeJavaScript(RENDERER_READY_EXPRESSION))
			) {
				readyContents.add(contents);
				contents.once("did-start-loading", () =>
					readyContents.delete(contents)
				);
				return;
			}
		} catch {
			// The page is still navigating; keep waiting.
		}
		await delay(Math.min(READY_POLL_MS, Math.max(0, deadline - Date.now())));
	}
	throw new Error(
		`QCut's editor was not ready within ${Number((timeoutMs / 1000).toFixed(1))}s. Retry the command.`
	);
}

/** Settles with `promise`, or rejects once the caller's deadline passes. */
function withinDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
	const remainingMs = deadline - Date.now();
	if (remainingMs <= 0)
		return Promise.reject(new Error(REOPEN_PENDING_MESSAGE));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(REOPEN_PENDING_MESSAGE)),
			remainingMs
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

async function reopenMainWindow({
	create,
}: {
	create: () => void;
}): Promise<BrowserWindow> {
	create();
	const win = findOpenWindow();
	if (!win) throw new Error("QCut could not reopen its window");
	await waitUntilEditorReady({
		win,
		deadline: Date.now() + REOPEN_TIMEOUT_MS,
		timeoutMs: REOPEN_TIMEOUT_MS,
	});
	return win;
}

/**
 * The editor window, once the editor in it can take requests: an open window
 * is waited on until its page has registered its listeners, and a closed one
 * is reopened first. Concurrent requests share one reopen, and each gives up
 * at its own deadline so a request whose caller already timed out is never
 * carried out.
 */
export async function ensureMainWindow({
	timeoutMs = REOPEN_TIMEOUT_MS,
}: {
	timeoutMs?: number;
} = {}): Promise<BrowserWindow> {
	const deadline = Date.now() + timeoutMs;
	// The window a reopen just created belongs to it until its editor is ready.
	if (reopening) return withinDeadline(reopening, deadline);

	const existing = findOpenWindow();
	if (existing) {
		await waitUntilEditorReady({ win: existing, deadline, timeoutMs });
		return existing;
	}

	const create = createMainWindow;
	if (!create) {
		throw new Error(
			"No active window: QCut's window is closed. Reopen it (click QCut in the Dock) and retry."
		);
	}
	reopening = reopenMainWindow({ create }).finally(() => {
		reopening = null;
	});
	return withinDeadline(reopening, deadline);
}
