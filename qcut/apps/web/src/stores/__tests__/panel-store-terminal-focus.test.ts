import { beforeEach, describe, expect, it } from "vitest";
import { PRESET_CONFIGS, usePanelStore } from "@/stores/panel-store";

describe("panel-store terminal focus", () => {
	beforeEach(() => {
		usePanelStore.setState({
			toolsPanel: 20,
			previewPanel: 55,
			propertiesPanel: 25,
			mainContent: 70,
			timeline: 30,
			aiPanelWidth: 22,
			aiPanelMinWidth: 4,
			activePreset: "default",
			preTerminalPreset: null,
			resetCounter: 0,
			presetCustomSizes: {
				default: {},
				media: {},
				inspector: {},
				"vertical-preview": {},
				terminal: {
					toolsPanel: 20,
					previewPanel: 55,
					propertiesPanel: 25,
					mainContent: 70,
					timeline: 30,
					aiPanelWidth: 22,
					aiPanelMinWidth: 4,
				},
			},
		});
	});

	it("forces terminal preset defaults when entering terminal focus", () => {
		usePanelStore.getState().enterTerminalFocus();

		const state = usePanelStore.getState();
		expect(state.activePreset).toBe("terminal");
		expect(state.preTerminalPreset).toBe("default");
		expect(state.toolsPanel).toBe(PRESET_CONFIGS.terminal.toolsPanel);
		expect(state.previewPanel).toBe(PRESET_CONFIGS.terminal.previewPanel);
		expect(state.propertiesPanel).toBe(PRESET_CONFIGS.terminal.propertiesPanel);
		expect(state.mainContent).toBe(PRESET_CONFIGS.terminal.mainContent);
		expect(state.timeline).toBe(PRESET_CONFIGS.terminal.timeline);
		expect(state.resetCounter).toBe(1);
	});

	it("restores the previous preset and sizes when exiting terminal focus", () => {
		usePanelStore.setState({
			activePreset: "media",
			toolsPanel: 32,
			previewPanel: 43,
			propertiesPanel: 25,
			mainContent: 74,
			timeline: 26,
		});

		usePanelStore.getState().enterTerminalFocus();
		usePanelStore.getState().exitTerminalFocus();

		const state = usePanelStore.getState();
		expect(state.activePreset).toBe("media");
		expect(state.preTerminalPreset).toBeNull();
		expect(state.toolsPanel).toBe(32);
		expect(state.previewPanel).toBe(43);
		expect(state.propertiesPanel).toBe(25);
		expect(state.mainContent).toBe(74);
		expect(state.timeline).toBe(26);
	});
});
