import { BrowserWindow, app } from "electron";
import type {
	EditorWindowFocusResult,
	EditorWindowInfo,
	EditorWindowsResult,
} from "../../types/claude-api.js";

function describeEditorWindow({
	win,
	main,
}: {
	win: BrowserWindow;
	main: boolean;
}): EditorWindowInfo {
	const bounds = win.getContentBounds();
	return {
		id: win.id,
		title: win.getTitle(),
		focused: win.isFocused(),
		visible: win.isVisible(),
		minimized: win.isMinimized(),
		bounds: {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
		},
		main,
	};
}

function openEditorWindows(): BrowserWindow[] {
	return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
}

/** Describe every open QCut window so a caller can pick one by id. */
export function describeEditorWindows(): EditorWindowsResult {
	const windows = openEditorWindows().map((win, index) =>
		describeEditorWindow({ win, main: index === 0 })
	);
	return { windows, count: windows.length };
}

/** How long a focus request may take to land before the window is described. */
export const FOCUS_SETTLE_TIMEOUT_MS = 1000;

/**
 * Resolves once `win` has focus, or after `timeoutMs`. Focus lands
 * asynchronously: on macOS the app has to become the active one first, so
 * `isFocused()` read right after `focus()` still says false.
 */
function waitForFocus({
	win,
	timeoutMs,
}: {
	win: BrowserWindow;
	timeoutMs: number;
}): Promise<void> {
	if (win.isDestroyed() || win.isFocused()) return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			if (!win.isDestroyed()) win.removeListener("focus", done);
			resolve();
		};
		const timer = setTimeout(done, timeoutMs);
		win.once("focus", done);
	});
}

/**
 * Brings a QCut window in front of the other apps. A minimized or hidden
 * window is shown first. On macOS a window can only take focus once its app
 * is the active one, so the app is activated as well. The window is described
 * once the focus has landed (or after `FOCUS_SETTLE_TIMEOUT_MS`), so
 * `focused` says where it ended up rather than where it was.
 */
export async function focusEditorWindow({
	win,
	timeoutMs = FOCUS_SETTLE_TIMEOUT_MS,
}: {
	win: BrowserWindow;
	timeoutMs?: number;
}): Promise<EditorWindowFocusResult> {
	const windowId = win.id;
	const restored = win.isMinimized() || !win.isVisible();
	if (win.isMinimized()) win.restore();
	win.show();
	app.focus({ steal: true });
	win.focus();
	await waitForFocus({ win, timeoutMs });
	if (win.isDestroyed()) {
		throw new Error(
			`QCut window ${windowId} closed while it was being focused`
		);
	}
	return {
		window: describeEditorWindow({
			win,
			main: openEditorWindows()[0]?.id === win.id,
		}),
		restored,
	};
}

/**
 * Resolve the window a pointer request targets: the given id when present, or
 * the fallback (normally the first window). Throws when the id is unknown so
 * callers fail closed instead of driving the wrong window.
 */
export function resolveEditorWindow({
	windowId,
	fallback,
}: {
	windowId?: number;
	fallback: () => BrowserWindow;
}): BrowserWindow {
	if (windowId === undefined) return fallback();
	const win = BrowserWindow.fromId(windowId);
	if (!win || win.isDestroyed()) {
		throw new Error(`No QCut window with id ${windowId}`);
	}
	return win;
}
