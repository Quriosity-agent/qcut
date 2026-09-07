import type { BrowserWindow } from "electron";
import { peekAgentPointerState } from "../claude/handlers/agent-pointer-controller.js";
import type { AgentPointerVisualState } from "../types/claude-api.js";
import type { CursorTelemetryProvider } from "./cursor-telemetry.js";

/**
 * Feed the Agent pointer's overlay position into cursor telemetry while it is
 * visible, so recordings driven by the CLI trace the pointer viewers actually
 * saw instead of the idle physical mouse. Overlay coordinates are CSS pixels of
 * the window content; telemetry wants screen DIP.
 */
export function createAgentPointerCursorProvider({
	win,
	peek = peekAgentPointerState,
}: {
	win: BrowserWindow | null | undefined;
	peek?: (input: { win: BrowserWindow }) => AgentPointerVisualState | null;
}): CursorTelemetryProvider {
	return () => {
		if (!win || win.isDestroyed()) return null;
		const state = peek({ win });
		if (!state || !state.visible) return null;
		const bounds = win.getContentBounds();
		const zoomFactor = win.webContents.getZoomFactor?.() ?? 1;
		const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
		return {
			x: Math.round(bounds.x + state.x * zoom),
			y: Math.round(bounds.y + state.y * zoom),
			pressed: state.pressed,
			source: "agent",
		};
	};
}
