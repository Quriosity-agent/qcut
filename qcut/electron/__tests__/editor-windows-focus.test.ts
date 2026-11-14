import { beforeEach, describe, expect, it, vi } from "vitest";

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
	focusEditorWindow,
	resolveEditorWindow,
} from "../claude/handlers/editor-windows.js";

function fakeWindow({
	id,
	minimized = false,
	visible = true,
}: {
	id: number;
	minimized?: boolean;
	visible?: boolean;
}) {
	const state = { minimized, visible, focused: false };
	const calls: string[] = [];
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
			state.focused = true;
		},
	};
	return { win, calls };
}

describe("bringing a QCut window to the front", () => {
	beforeEach(() => {
		electronMocks.appFocus.mockClear();
		electronMocks.windows = [];
	});

	it("activates the app and focuses the first window by default", () => {
		const main = fakeWindow({ id: 1 });
		electronMocks.windows = [main.win];
		const result = focusEditorWindow({ win: main.win as never });
		expect(main.calls).toEqual(["show", "focus"]);
		// A background app's window cannot take focus on macOS without this.
		expect(electronMocks.appFocus).toHaveBeenCalledWith({ steal: true });
		expect(result).toEqual({
			window: expect.objectContaining({ id: 1, focused: true, main: true }),
			restored: false,
		});
	});

	it("restores a minimized window before focusing it", () => {
		const main = fakeWindow({ id: 1 });
		const second = fakeWindow({ id: 2, minimized: true });
		electronMocks.windows = [main.win, second.win];
		const result = focusEditorWindow({
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

	it("shows a hidden window and reports that it was restored", () => {
		const hidden = fakeWindow({ id: 1, visible: false });
		electronMocks.windows = [hidden.win];
		expect(focusEditorWindow({ win: hidden.win as never }).restored).toBe(true);
		expect(hidden.calls).toEqual(["show", "focus"]);
	});
});
