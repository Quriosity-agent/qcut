/**
 * Claude UI Panel Navigation Bridge
 *
 * Handles panel switch requests from the main process.
 * Enables the HTTP API and CLI to switch editor panels externally.
 *
 * @module lib/claude-bridge/claude-ui-bridge
 */

import {
	useMediaPanelStore,
	getGroupForTab,
	tabs,
	type Tab,
} from "@/components/editor/media-panel/store";

export function setupClaudeUiBridge(): void {
	const bridge = window.electronAPI?.claude?.ui;
	if (!bridge) return;

	bridge.onSwitchPanelRequest((data) => {
		try {
			const tab = data.panel as Tab;
			if (!(tab in tabs)) {
				bridge.sendSwitchPanelResponse(
					data.requestId,
					undefined,
					`Unknown panel: ${data.panel}. Available: ${Object.keys(tabs).join(", ")}`
				);
				return;
			}
			const store = useMediaPanelStore.getState();
			const group = getGroupForTab(tab);

			store.setActiveGroup(group);
			store.setActiveTab(tab);

			bridge.sendSwitchPanelResponse(data.requestId, {
				switched: true,
				panel: tab,
				group,
			});
		} catch (err) {
			bridge.sendSwitchPanelResponse(
				data.requestId,
				undefined,
				err instanceof Error ? err.message : String(err)
			);
		}
	});
}

export function cleanupClaudeUiBridge(): void {
	window.electronAPI?.claude?.ui?.removeListeners();
}
