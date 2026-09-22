import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createAgentPointerCursorProvider } from "../screen-recording-handler/agent-pointer-cursor.js";
import { CursorTelemetryRecorder } from "../screen-recording-handler/cursor-telemetry.js";

const mockUIOHook = vi.hoisted(() => ({
	on: vi.fn(),
	off: vi.fn(),
	start: vi.fn(),
	stop: vi.fn(),
}));

// A real global input hook can terminate the worker on headless Linux.
vi.mock("uiohook-napi", () => ({ uIOhook: mockUIOHook }));

vi.mock("electron", () => ({
	screen: {
		getCursorScreenPoint: () => ({ x: 5, y: 6 }),
		getAllDisplays: () => [],
		getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1, height: 1 } }),
	},
	app: { getPath: () => "/tmp" },
}));

function fakeWindow({ zoom = 1 }: { zoom?: number } = {}) {
	return {
		isDestroyed: () => false,
		getContentBounds: () => ({ x: 100, y: 50, width: 1200, height: 800 }),
		webContents: { getZoomFactor: () => zoom },
	} as unknown as BrowserWindow;
}

describe("createAgentPointerCursorProvider", () => {
	it("maps the visible overlay position into screen coordinates", () => {
		const provider = createAgentPointerCursorProvider({
			win: fakeWindow({ zoom: 1.5 }),
			peek: () => ({ visible: true, x: 200, y: 100, pressed: true }) as never,
		});

		expect(provider()).toEqual({
			x: 400,
			y: 200,
			pressed: true,
			source: "agent",
		});
	});

	it("yields to the physical cursor when the overlay is hidden or absent", () => {
		expect(
			createAgentPointerCursorProvider({
				win: fakeWindow(),
				peek: () => ({ visible: false, x: 1, y: 1 }) as never,
			})()
		).toBeNull();
		expect(
			createAgentPointerCursorProvider({
				win: fakeWindow(),
				peek: () => null,
			})()
		).toBeNull();
		expect(createAgentPointerCursorProvider({ win: null })()).toBeNull();
	});
});

describe("CursorTelemetryRecorder with a provider", () => {
	it("records provider samples tagged as agent instead of the OS cursor", async () => {
		vi.useFakeTimers();
		const recorder = new CursorTelemetryRecorder();
		try {
			let sample: { x: number; y: number; pressed: boolean } | null = {
				x: 320,
				y: 240,
				pressed: false,
			};
			recorder.start(
				{ x: 0, y: 0, width: 1920, height: 1080 },
				{ provider: () => (sample ? { ...sample, source: "agent" } : null) }
			);
			await vi.dynamicImportSettled();
			expect(mockUIOHook.start).toHaveBeenCalledOnce();
			await vi.advanceTimersByTimeAsync(40);
			sample = null;
			await vi.advanceTimersByTimeAsync(40);
			const data = recorder.stop();
			expect(mockUIOHook.stop).toHaveBeenCalledOnce();
			expect(mockUIOHook.off).toHaveBeenCalledWith(
				"mousedown",
				expect.any(Function)
			);
			expect(mockUIOHook.off).toHaveBeenCalledWith(
				"mouseup",
				expect.any(Function)
			);
			expect(vi.getTimerCount()).toBe(0);

			const agentPoints = data.points.filter((point) => point.c === "agent");
			const cursorPoints = data.points.filter((point) => point.c === undefined);
			expect(agentPoints.length).toBeGreaterThan(0);
			expect(agentPoints[0]).toEqual(
				expect.objectContaining({ x: 320, y: 240, p: false, c: "agent" })
			);
			expect(cursorPoints.length).toBeGreaterThan(0);
			expect(cursorPoints[0]).toEqual(expect.objectContaining({ x: 5, y: 6 }));
		} finally {
			recorder.stop();
			vi.useRealTimers();
		}
	});
});
