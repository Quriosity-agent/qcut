import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
	appFocus: vi.fn(),
	windows: [] as unknown[],
}));

vi.mock("electron", () => ({
	app: { focus: electronMocks.appFocus },
	BrowserWindow: {
		getAllWindows: () => electronMocks.windows,
		fromId: (id: number) =>
			(electronMocks.windows as Array<{ id: number }>).find(
				(win) => win.id === id
			) ?? null,
	},
}));

import {
	FOCUS_SETTLE_TIMEOUT_MS,
	focusEditorWindow,
	resolveEditorWindow,
} from "../claude/handlers/editor-windows.js";

/**
 * A window whose focus lands when `focus()` is called, or later when
 * `focusLands` is "later" (as on macOS, where the app has to become the
 * active one first), or never.
 */
function fakeWindow({
	id,
	minimized = false,
	visible = true,
	focusLands = "now",
}: {
	id: number;
	minimized?: boolean;
	visible?: boolean;
	focusLands?: "now" | "later" | "never";
}) {
	const state = { minimized, visible, focused: false };
	const calls: string[] = [];
	const focusListeners = new Set<() => void>();
	const landFocus = () => {
		state.focused = true;
		for (const listener of [...focusListeners]) listener();
	};
	const win = {
		id,
		isDestroyed: () => false,
		getTitle: () => `Window ${id}`,
		getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
		isMinimized: () => state.minimized,
		isVisible: () => state.visible,
		isFocused: () => state.focused,
		restore: () => {
			calls.push("restore");
			state.minimized = false;
		},
		show: () => {
			calls.push("show");
			state.visible = true;
		},
		focus: () => {
			calls.push("focus");
			if (focusLands === "now") landFocus();
			if (focusLands === "later") setTimeout(landFocus, 80);
		},
		once: (event: string, listener: () => void) => {
			if (event !== "focus") return;
			const wrapped = () => {
				focusListeners.delete(wrapped);
				listener();
			};
			focusListeners.add(wrapped);
		},
		removeListener: (_event: string, _listener: () => void) => {
			focusListeners.clear();
		},
		listenerCount: () => focusListeners.size,
	};
	return { win, calls };
}

describe("bringing a QCut window to the front", () => {
	beforeEach(() => {
		electronMocks.appFocus.mockClear();
		electronMocks.windows = [];
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("activates the app and focuses the first window by default", async () => {
		const main = fakeWindow({ id: 1 });
		electronMocks.windows = [main.win];
		const result = await focusEditorWindow({ win: main.win as never });
		expect(main.calls).toEqual(["show", "focus"]);
		// A background app's window cannot take focus on macOS without this.
		expect(electronMocks.appFocus).toHaveBeenCalledWith({ steal: true });
		expect(result).toEqual({
			window: expect.objectContaining({ id: 1, focused: true, main: true }),
			restored: false,
		});
	});

	it("restores a minimized window before focusing it", async () => {
		const main = fakeWindow({ id: 1 });
		const second = fakeWindow({ id: 2, minimized: true });
		electronMocks.windows = [main.win, second.win];
		const result = await focusEditorWindow({
			win: resolveEditorWindow({
				windowId: 2,
				fallback: () => main.win as never,
			}),
		});
		expect(second.calls).toEqual(["restore", "show", "focus"]);
		expect(main.calls).toEqual([]);
		expect(result).toEqual({
			window: expect.objectContaining({
				id: 2,
				minimized: false,
				focused: true,
				main: false,
			}),
			restored: true,
		});
	});

	it("shows a hidden window and reports that it was restored", async () => {
		const hidden = fakeWindow({ id: 1, visible: false });
		electronMocks.windows = [hidden.win];
		expect(
			(await focusEditorWindow({ win: hidden.win as never })).restored
		).toBe(true);
		expect(hidden.calls).toEqual(["show", "focus"]);
	});

	/** On macOS focus lands only once the app is the active one. */
	it("reports the window focused when the focus lands after the request", async () => {
		vi.useFakeTimers();
		const main = fakeWindow({ id: 1, focusLands: "later" });
		electronMocks.windows = [main.win];
		const pending = focusEditorWindow({ win: main.win as never });
		await vi.advanceTimersByTimeAsync(80);
		const result = await pending;
		expect(result.window.focused).toBe(true);
		expect(main.win.listenerCount()).toBe(0);
	});

	it("says the window is not focused when the focus never lands", async () => {
		vi.useFakeTimers();
		const main = fakeWindow({ id: 1, focusLands: "never" });
		electronMocks.windows = [main.win];
		const pending = focusEditorWindow({ win: main.win as never });
		await vi.advanceTimersByTimeAsync(FOCUS_SETTLE_TIMEOUT_MS);
		const result = await pending;
		expect(result.window.focused).toBe(false);
		expect(main.win.listenerCount()).toBe(0);
	});
});
