import { describe, it, expect, beforeEach } from "vitest";
import {
	useKeybindingsStore,
	defaultKeybindings,
} from "@/stores/keybindings-store";

describe("Keybinding", () => {
	beforeEach(() => {
		const store = useKeybindingsStore.getState();
		store.resetToDefaults();
	});

	it("registers default keybinding", () => {
		const store = useKeybindingsStore.getState();
		expect(store.keybindings.space).toBe("toggle-play");
		expect(store.keybindings.j).toBe("seek-backward");
		expect(store.keybindings.k).toBe("toggle-play");
	});

	it("updates custom keybinding", () => {
		const store = useKeybindingsStore.getState();
		store.updateKeybinding("a", "split-element" as any);

		// Check the keybinding was updated
		const updatedStore = useKeybindingsStore.getState();
		expect(updatedStore.keybindings.a).toBe("split-element");
	});

	it("resets to default keybindings", () => {
		const store = useKeybindingsStore.getState();
		store.updateKeybinding("space", "stop-playback" as any);
		store.resetToDefaults();

		expect(store.keybindings.space).toBe("toggle-play");
	});
});
