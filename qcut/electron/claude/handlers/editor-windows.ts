import { BrowserWindow } from "electron";
import type {
	EditorWindowInfo,
	EditorWindowsResult,
} from "../../types/claude-api.js";

/** Describe every open QCut window so a caller can pick one by id. */
export function describeEditorWindows(): EditorWindowsResult {
	const windows = BrowserWindow.getAllWindows()
		.filter((win) => !win.isDestroyed())
		.map((win, index): EditorWindowInfo => {
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
				main: index === 0,
			};
		});
	return { windows, count: windows.length };
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
