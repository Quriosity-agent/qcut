/**
 * Create keyboard events for testing keyboard shortcuts
 */
export function createKeyboardEvent(
	type: "keydown" | "keyup" | "keypress",
	key: string,
	options: Partial<KeyboardEventInit> = {}
): KeyboardEvent {
	return new KeyboardEvent(type, {
		key,
		code: getKeyCode(key),
		bubbles: true,
		cancelable: true,
		...options,
	});
}

/**
 * Map common keys to their key codes
 */
function getKeyCode(key: string): string {
	const keyCodes: Record<string, string> = {
		"Enter": "Enter",
		" ": "Space",
		"Escape": "Escape",
		"Delete": "Delete",
		"Backspace": "Backspace",
		"Tab": "Tab",
		"ArrowUp": "ArrowUp",
		"ArrowDown": "ArrowDown",
		"ArrowLeft": "ArrowLeft",
		"ArrowRight": "ArrowRight",
		"Home": "Home",
		"End": "End",
		"PageUp": "PageUp",
		"PageDown": "PageDown",
		"+": "Equal",
		"=": "Equal",
		"-": "Minus",
		"_": "Minus",
		"0": "Digit0",
		"1": "Digit1",
		"2": "Digit2",
		"3": "Digit3",
		"4": "Digit4",
		"5": "Digit5",
		"6": "Digit6",
		"7": "Digit7",
		"8": "Digit8",
		"9": "Digit9",
		"a": "KeyA",
		"s": "KeyS",
		"d": "KeyD",
		"z": "KeyZ",
		"x": "KeyX",
		"c": "KeyC",
		"v": "KeyV",
		"y": "KeyY",
	};

	// Check if key is in the mapping
	if (key in keyCodes) return keyCodes[key];

	// Handle single letters (A-Z)
	if (key.length === 1) {
		const upper = key.toUpperCase();
		if (upper >= "A" && upper <= "Z") {
			return `Key${upper}`;
		}
		// Handle digits (already mapped above, but as fallback)
		if (upper >= "0" && upper <= "9") {
			return `Digit${upper}`;
		}
	}

	// Return the key as-is for unmapped special keys
	return key;
}

/**
 * Create common keyboard shortcuts for testing
 */
export const shortcuts = {
	// Timeline shortcuts
	play: () => createKeyboardEvent("keydown", " "),
	stop: () => createKeyboardEvent("keydown", "Escape"),

	// Edit shortcuts
	undo: () => createKeyboardEvent("keydown", "z", { ctrlKey: true }),
	redo: () => createKeyboardEvent("keydown", "y", { ctrlKey: true }),
	cut: () => createKeyboardEvent("keydown", "x", { ctrlKey: true }),
	copy: () => createKeyboardEvent("keydown", "c", { ctrlKey: true }),
	paste: () => createKeyboardEvent("keydown", "v", { ctrlKey: true }),
	delete: () => createKeyboardEvent("keydown", "Delete"),

	// Navigation
	home: () => createKeyboardEvent("keydown", "Home"),
	end: () => createKeyboardEvent("keydown", "End"),

	// Selection
	selectAll: () => createKeyboardEvent("keydown", "a", { ctrlKey: true }),

	// Timeline zoom
	zoomIn: () =>
		createKeyboardEvent("keydown", "=", { ctrlKey: true, shiftKey: true }),
	zoomOut: () => createKeyboardEvent("keydown", "-", { ctrlKey: true }),
};

/**
 * Simulate typing text
 */
export function typeText(element: HTMLElement, text: string) {
	text.split("").forEach((char) => {
		element.dispatchEvent(createKeyboardEvent("keydown", char));
		element.dispatchEvent(createKeyboardEvent("keypress", char));
		element.dispatchEvent(createKeyboardEvent("keyup", char));
	});
}
