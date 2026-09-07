import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow, MouseInputEvent } from "electron";
import {
	AgentPointerController,
	buildPointerMovementPath,
} from "../handlers/agent-pointer-controller.js";
import type { AgentPointerResolvedTarget } from "../../types/claude-api.js";

type DebuggerListener = (
	event: unknown,
	method: string,
	params: Record<string, unknown>
) => void;

const INTERCEPTED_DRAG_DATA = {
	items: [{ mimeType: "application/x-media-item", data: '{"id":"media-1"}' }],
	dragOperationsMask: 1,
};

function createPointerHarness({
	dragIntercept = "never",
}: {
	dragIntercept?: "on-first-move" | "never";
} = {}) {
	const inputEvents: MouseInputEvent[] = [];
	const debuggerCommands: Array<{
		method: string;
		params?: Record<string, unknown>;
	}> = [];
	const debuggerListeners: DebuggerListener[] = [];
	let dragInterceptedEmitted = false;
	const visualStates: Array<Record<string, unknown>> = [];
	const resolvedTarget: AgentPointerResolvedTarget = {
		ref: "@e12",
		x: 240,
		y: 180,
		bounds: { x: 200, y: 160, width: 80, height: 40 },
		tagName: "button",
		role: "button",
		name: "Effects",
		value: null,
		disabled: false,
	};
	const resolveRef = vi.fn(async () => resolvedTarget);
	let focused = false;
	let debuggerAttached = false;
	const focus = vi.fn(() => {
		focused = true;
	});
	let destroyed = false;
	const win = {
		isDestroyed: () => destroyed,
		isVisible: () => true,
		isFocused: () => focused,
		isMinimized: () => false,
		show: vi.fn(),
		showInactive: vi.fn(),
		restore: vi.fn(),
		focus,
		getContentSize: () => [1200, 800] as [number, number],
		webContents: {
			backgroundThrottling: true,
			isDestroyed: () => destroyed,
			isDevToolsOpened: () => false,
			sendInputEvent: (event: MouseInputEvent) => inputEvents.push(event),
			send: (_channel: string, state: Record<string, unknown>) =>
				visualStates.push(state),
			debugger: {
				isAttached: () => debuggerAttached,
				attach: vi.fn(() => {
					debuggerAttached = true;
				}),
				detach: vi.fn(() => {
					debuggerAttached = false;
				}),
				on: vi.fn((_event: string, listener: DebuggerListener) => {
					debuggerListeners.push(listener);
				}),
				removeListener: vi.fn((_event: string, listener: DebuggerListener) => {
					const index = debuggerListeners.indexOf(listener);
					if (index >= 0) debuggerListeners.splice(index, 1);
				}),
				sendCommand: vi.fn(
					async (method: string, params?: Record<string, unknown>) => {
						debuggerCommands.push({ method, params });
						const pressedMove =
							method === "Input.dispatchMouseEvent" &&
							params?.type === "mouseMoved" &&
							params?.buttons === 1;
						if (
							pressedMove &&
							dragIntercept === "on-first-move" &&
							!dragInterceptedEmitted
						) {
							// Chromium reports the page's drag payload instead of starting an OS drag.
							dragInterceptedEmitted = true;
							for (const listener of [...debuggerListeners]) {
								listener({}, "Input.dragIntercepted", {
									data: INTERCEPTED_DRAG_DATA,
								});
							}
						}
					}
				),
			},
		},
	} as unknown as BrowserWindow;
	const controller = new AgentPointerController({
		win,
		resolveRef,
		sleep: async () => {},
	});
	return {
		controller,
		debuggerCommands,
		debuggerListeners,
		destroy: () => {
			destroyed = true;
		},
		focus,
		inputEvents,
		resolveRef,
		resolvedTarget,
		visualStates,
	};
}

describe("AgentPointerController", () => {
	it("uses background CDP input without focusing QCut by default", async () => {
		const harness = createPointerHarness();

		const result = await harness.controller.click({ ref: "@e12" });

		expect(harness.resolveRef).toHaveBeenCalledWith({
			win: expect.anything(),
			ref: "@e12",
		});
		expect(harness.focus).not.toHaveBeenCalled();
		expect(harness.inputEvents).toHaveLength(0);
		expect(harness.debuggerCommands.map(({ params }) => params?.type)).toEqual([
			"mouseMoved",
			"mousePressed",
			"mouseReleased",
		]);
		expect(harness.debuggerCommands.slice(1)).toEqual([
			expect.objectContaining({
				method: "Input.dispatchMouseEvent",
				params: expect.objectContaining({
					type: "mousePressed",
					button: "left",
					x: 240,
					y: 180,
				}),
			}),
			expect.objectContaining({
				method: "Input.dispatchMouseEvent",
				params: expect.objectContaining({
					type: "mouseReleased",
					button: "left",
					x: 240,
					y: 180,
				}),
			}),
		]);
		expect(result).toEqual(
			expect.objectContaining({
				action: "click",
				input: "cdp-dispatch-mouse-event",
				inputMode: "background",
				windowFocused: false,
				x: 240,
				y: 180,
			})
		);
		expect(harness.visualStates).toContainEqual(
			expect.objectContaining({
				active: true,
				action: "click",
				inputMode: "background",
				pulseId: 1,
			})
		);
		await expect(harness.controller.hide()).resolves.toEqual({
			action: "hidden",
			visible: false,
			input: "cdp-dispatch-mouse-event",
			inputMode: "background",
			windowFocused: false,
			x: 240,
			y: 180,
		});
	});

	it("moves through intermediate hover points", async () => {
		const harness = createPointerHarness();
		await harness.controller.move({
			x: 40,
			y: 40,
			inputMode: "foreground",
		});
		harness.inputEvents.splice(0, harness.inputEvents.length);

		await harness.controller.hover({
			x: 740,
			y: 440,
			inputMode: "foreground",
		});

		expect(harness.inputEvents.length).toBeGreaterThan(3);
		expect(
			harness.inputEvents.every((event) => event.type === "mouseMove")
		).toBe(true);
		expect(harness.inputEvents.at(-1)).toEqual(
			expect.objectContaining({ x: 740, y: 440 })
		);
		expect(harness.visualStates.at(-1)).toEqual(
			expect.objectContaining({
				action: "hover",
				inputMode: "foreground",
				x: 740,
				y: 440,
			})
		);
		expect(harness.focus).toHaveBeenCalled();
		await harness.controller.hide();
	});

	it("holds the left button while dragging along a real movement path", async () => {
		const harness = createPointerHarness();

		const result = await harness.controller.drag({
			from: { x: 200, y: 700 },
			to: { x: 820, y: 700 },
			inputMode: "foreground",
		});

		const downIndex = harness.inputEvents.findIndex(
			(event) => event.type === "mouseDown"
		);
		const upIndex = harness.inputEvents.findIndex(
			(event) => event.type === "mouseUp"
		);
		const dragMoves = harness.inputEvents.slice(downIndex + 1, upIndex);
		expect(downIndex).toBeGreaterThanOrEqual(0);
		expect(upIndex).toBeGreaterThan(downIndex);
		expect(dragMoves.length).toBeGreaterThan(2);
		expect(
			dragMoves.every(
				(event) => event.type === "mouseMove" && event.button === "left"
			)
		).toBe(true);
		expect(harness.visualStates).toContainEqual(
			expect.objectContaining({
				action: "drag",
				dragging: true,
				pressed: true,
			})
		);
		expect(result).toEqual(expect.objectContaining({ x: 820, y: 700 }));
		await harness.controller.hide();
	});

	it("releases the left button when a drag destination fails", async () => {
		const harness = createPointerHarness();

		await expect(
			harness.controller.drag({
				from: { x: 200, y: 700 },
				to: { x: 1400, y: 700 },
				inputMode: "foreground",
			})
		).rejects.toThrow("outside the editor viewport");

		expect(harness.inputEvents.map((event) => event.type)).toEqual([
			"mouseMove",
			"mouseDown",
			"mouseUp",
		]);
		expect(harness.visualStates.at(-1)).toEqual(
			expect.objectContaining({
				action: "drag",
				dragging: false,
				pressed: false,
			})
		);
		await harness.controller.hide();
	});

	it("supports double-click, right-click, wheel, and hide", async () => {
		const harness = createPointerHarness();

		await harness.controller.doubleClick({
			x: 300,
			y: 250,
			inputMode: "foreground",
		});
		const doubleClickEvents = harness.inputEvents.filter(
			(event) => event.type === "mouseDown" || event.type === "mouseUp"
		);
		expect(doubleClickEvents.map((event) => event.clickCount)).toEqual([
			1, 1, 2, 2,
		]);

		harness.inputEvents.splice(0, harness.inputEvents.length);
		await harness.controller.rightClick({
			x: 320,
			y: 260,
			inputMode: "foreground",
		});
		expect(
			harness.inputEvents
				.filter((event) => event.type !== "mouseMove")
				.map((event) => event.type)
		).toEqual(["mouseDown", "mouseUp"]);
		expect(
			harness.inputEvents
				.filter((event) => event.type !== "mouseMove")
				.every((event) => event.button === "right")
		).toBe(true);

		harness.inputEvents.splice(0, harness.inputEvents.length);
		const scrollResult = await harness.controller.scroll({
			deltaY: 400,
			inputMode: "foreground",
		});
		expect(harness.inputEvents).toContainEqual(
			expect.objectContaining({ type: "mouseWheel", deltaY: 400 })
		);
		expect(scrollResult).toEqual(
			expect.objectContaining({ action: "scroll", deltaY: 400 })
		);

		const hideResult = await harness.controller.hide();
		expect(hideResult.visible).toBe(false);
		expect(harness.visualStates.at(-1)).toEqual(
			expect.objectContaining({ action: "hidden", visible: false, pulseId: 0 })
		);
	});

	it("rejects coordinates outside the editor viewport", async () => {
		const harness = createPointerHarness();

		await expect(harness.controller.move({ x: 1200, y: 10 })).rejects.toThrow(
			"outside the editor viewport"
		);
	});

	it("can hide safely after the editor window closes", async () => {
		const harness = createPointerHarness();
		harness.destroy();

		await expect(harness.controller.hide()).resolves.toEqual(
			expect.objectContaining({ action: "hidden", visible: false })
		);
		expect(harness.visualStates).toHaveLength(0);
	});
});

describe("AgentPointerController HTML5 drag-and-drop", () => {
	const from = { x: 200, y: 700 };
	const to = { x: 820, y: 700 };

	function commandTypes(
		commands: Array<{ method: string; params?: Record<string, unknown> }>
	): string[] {
		return commands.map((command) => {
			if (command.method === "Input.setInterceptDrags") {
				return `intercept:${String(command.params?.enabled)}`;
			}
			return `${command.method === "Input.dispatchDragEvent" ? "drag" : "mouse"}:${String(command.params?.type)}`;
		});
	}

	it("replays an intercepted HTML5 drag with CDP drag events", async () => {
		const harness = createPointerHarness({ dragIntercept: "on-first-move" });

		const result = await harness.controller.drag({ from, to, dnd: "html5" });

		const types = commandTypes(harness.debuggerCommands);
		const enable = types.indexOf("intercept:true");
		const pressed = types.indexOf("mouse:mousePressed");
		const enter = types.indexOf("drag:dragEnter");
		const drop = types.indexOf("drag:drop");
		const released = types.indexOf("mouse:mouseReleased");
		const disable = types.indexOf("intercept:false");
		expect(enable).toBeGreaterThanOrEqual(0);
		expect(pressed).toBeGreaterThan(enable);
		expect(enter).toBeGreaterThan(pressed);
		expect(
			types.filter((type) => type === "drag:dragOver").length
		).toBeGreaterThan(2);
		expect(drop).toBeGreaterThan(enter);
		expect(released).toBeGreaterThan(drop);
		expect(disable).toBeGreaterThan(released);
		// Pressed mouse moves stop once the page owns the drag.
		expect(
			types.slice(enter).filter((type) => type === "mouse:mouseMoved")
		).toEqual([]);
		expect(harness.debuggerCommands[drop]?.params).toEqual({
			type: "drop",
			x: 820,
			y: 700,
			data: INTERCEPTED_DRAG_DATA,
		});
		expect(result.dnd).toEqual({
			mode: "html5",
			intercepted: true,
			backend: "cdp-dispatch-drag-event",
			mimeTypes: ["application/x-media-item"],
			fileCount: 0,
			dragOperationsMask: 1,
		});
		expect(result).toEqual(expect.objectContaining({ x: 820, y: 700 }));
		expect(harness.debuggerListeners).toEqual([]);
		expect(harness.visualStates.at(-1)).toEqual(
			expect.objectContaining({ dragging: false, pressed: false })
		);
		await harness.controller.hide();
	});

	it("fails closed when html5 is required but the page never starts a drag", async () => {
		const harness = createPointerHarness({ dragIntercept: "never" });

		await expect(
			harness.controller.drag({ from, to, dnd: "html5", dragStartTimeoutMs: 0 })
		).rejects.toThrow("did not start an HTML5 drag-and-drop");

		const types = commandTypes(harness.debuggerCommands);
		expect(types).toContain("mouse:mouseReleased");
		expect(types).toContain("intercept:false");
		expect(types.some((type) => type.startsWith("drag:"))).toBe(false);
		expect(harness.debuggerListeners).toEqual([]);
		expect(harness.visualStates.at(-1)).toEqual(
			expect.objectContaining({
				action: "drag",
				dragging: false,
				pressed: false,
			})
		);
		await harness.controller.hide();
	});

	it("falls back to a mouse drag in auto mode when nothing is intercepted", async () => {
		const harness = createPointerHarness({ dragIntercept: "never" });

		const result = await harness.controller.drag({
			from,
			to,
			dragStartTimeoutMs: 0,
		});

		const types = commandTypes(harness.debuggerCommands);
		expect(types).toContain("intercept:true");
		expect(types.some((type) => type.startsWith("drag:"))).toBe(false);
		const pressed = types.indexOf("mouse:mousePressed");
		const released = types.indexOf("mouse:mouseReleased");
		// Interception is switched off before the mouse fallback finishes the
		// gesture, so Chromium handles the remaining drag natively.
		const disabled = types.indexOf("intercept:false");
		expect(disabled).toBeGreaterThan(pressed);
		expect(disabled).toBeLessThan(released);
		expect(types.slice(disabled + 1, released)).toContain("mouse:mouseMoved");
		expect(types.filter((type) => type === "intercept:false")).toHaveLength(1);
		expect(
			types
				.slice(pressed + 1, released)
				.filter((type) => type === "mouse:mouseMoved").length
		).toBeGreaterThan(2);
		expect(result.dnd).toEqual({
			mode: "auto",
			intercepted: false,
			backend: "mouse",
			mimeTypes: [],
			fileCount: 0,
			dragOperationsMask: null,
		});
		await harness.controller.hide();
	});

	it("never intercepts in mouse mode", async () => {
		const harness = createPointerHarness({ dragIntercept: "on-first-move" });

		const result = await harness.controller.drag({ from, to, dnd: "mouse" });

		const types = commandTypes(harness.debuggerCommands);
		expect(types.some((type) => type.startsWith("intercept:"))).toBe(false);
		expect(types.some((type) => type.startsWith("drag:"))).toBe(false);
		expect(result.dnd).toEqual(
			expect.objectContaining({ mode: "mouse", intercepted: false })
		);
		await harness.controller.hide();
	});

	it("rejects html5 drags in foreground mode before pressing the button", async () => {
		const harness = createPointerHarness({ dragIntercept: "on-first-move" });

		await expect(
			harness.controller.drag({
				from,
				to,
				dnd: "html5",
				inputMode: "foreground",
			})
		).rejects.toThrow("requires background pointer input");

		expect(harness.inputEvents.map((event) => event.type)).not.toContain(
			"mouseDown"
		);
		await harness.controller.hide();
	});
});

describe("AgentPointerController buttons, modifiers, and click counts", () => {
	it("clicks with the requested button, modifiers, and click count", async () => {
		const harness = createPointerHarness();

		const result = await harness.controller.click({
			ref: "@e12",
			button: "middle",
			clickCount: 3,
			modifiers: ["Shift", "Meta"],
		});

		const presses = harness.debuggerCommands.filter(
			(command) => command.params?.type === "mousePressed"
		);
		expect(presses.map((command) => command.params?.clickCount)).toEqual([
			1, 2, 3,
		]);
		expect(presses[0]?.params).toEqual(
			expect.objectContaining({ button: "middle", buttons: 4, modifiers: 12 })
		);
		const releases = harness.debuggerCommands.filter(
			(command) => command.params?.type === "mouseReleased"
		);
		expect(releases).toHaveLength(3);
		expect(result).toEqual(
			expect.objectContaining({
				action: "click",
				button: "middle",
				clickCount: 3,
				modifiers: ["Shift", "Meta"],
			})
		);
		await harness.controller.hide();
	});

	it("clamps click counts and omits modifiers from results when none were held", async () => {
		const harness = createPointerHarness();

		const result = await harness.controller.click({
			ref: "@e12",
			clickCount: 9,
		});

		expect(
			harness.debuggerCommands.filter(
				(command) => command.params?.type === "mousePressed"
			)
		).toHaveLength(3);
		expect(result.clickCount).toBe(3);
		expect(result.button).toBe("left");
		expect(result).not.toHaveProperty("modifiers");
		await harness.controller.hide();
	});

	it("drags with the right button and modifiers held throughout", async () => {
		const harness = createPointerHarness();

		const result = await harness.controller.drag({
			from: { x: 200, y: 700 },
			to: { x: 820, y: 700 },
			button: "right",
			modifiers: ["Alt"],
			dnd: "mouse",
		});

		const pressed = harness.debuggerCommands.find(
			(command) => command.params?.type === "mousePressed"
		);
		const released = harness.debuggerCommands.find(
			(command) => command.params?.type === "mouseReleased"
		);
		const pressedMoves = harness.debuggerCommands.filter(
			(command) =>
				command.params?.type === "mouseMoved" && command.params?.buttons === 2
		);
		expect(pressed?.params).toEqual(
			expect.objectContaining({ button: "right", buttons: 2, modifiers: 1 })
		);
		expect(released?.params).toEqual(
			expect.objectContaining({ button: "right", buttons: 0, modifiers: 1 })
		);
		expect(pressedMoves.length).toBeGreaterThan(2);
		expect(
			pressedMoves.every((command) => command.params?.modifiers === 1)
		).toBe(true);
		expect(result).toEqual(
			expect.objectContaining({ button: "right", modifiers: ["Alt"] })
		);
		await harness.controller.hide();
	});

	it("scrolls with modifiers for ctrl-wheel zoom", async () => {
		const harness = createPointerHarness();

		const result = await harness.controller.scroll({
			x: 640,
			y: 360,
			deltaY: -120,
			modifiers: ["Control"],
		});

		const wheel = harness.debuggerCommands.find(
			(command) => command.params?.type === "mouseWheel"
		);
		expect(wheel?.params).toEqual(
			expect.objectContaining({ deltaY: -120, modifiers: 2 })
		);
		expect(result).toEqual(
			expect.objectContaining({ action: "scroll", modifiers: ["Control"] })
		);
		await harness.controller.hide();
	});
});

describe("AgentPointerController typing and file drops", () => {
	it("types with per-character key events when requested", async () => {
		const harness = createPointerHarness();

		const result = await harness.controller.typeText({
			text: "ab",
			keyEvents: true,
		});

		const keyEvents = harness.debuggerCommands.filter(
			(command) => command.method === "Input.dispatchKeyEvent"
		);
		expect(keyEvents.map((command) => command.params?.type)).toEqual([
			"keyDown",
			"keyUp",
			"keyDown",
			"keyUp",
		]);
		expect(
			harness.debuggerCommands.some(
				(command) => command.method === "Input.insertText"
			)
		).toBe(false);
		expect(result).toEqual(
			expect.objectContaining({ characterCount: 2, method: "key-events" })
		);
	});

	it("still inserts text by default", async () => {
		const harness = createPointerHarness();

		const result = await harness.controller.typeText({ text: "hello" });

		expect(harness.debuggerCommands.at(-1)).toEqual({
			method: "Input.insertText",
			params: { text: "hello" },
		});
		expect(result.method).toBe("insert-text");
	});

	it("drops files on a target with HTML5 drag events", async () => {
		const harness = createPointerHarness();

		const result = await harness.controller.dropFiles({
			ref: "@e12",
			files: ["/tmp/clip.mp4", "/tmp/cover.png"],
			modifiers: ["Alt"],
		});

		const dragEvents = harness.debuggerCommands.filter(
			(command) => command.method === "Input.dispatchDragEvent"
		);
		expect(dragEvents.map((command) => command.params?.type)).toEqual([
			"dragEnter",
			"dragOver",
			"drop",
		]);
		expect(dragEvents[2]?.params).toEqual(
			expect.objectContaining({
				x: 240,
				y: 180,
				modifiers: 1,
				data: {
					items: [],
					files: ["/tmp/clip.mp4", "/tmp/cover.png"],
					dragOperationsMask: 1,
				},
			})
		);
		expect(
			harness.debuggerCommands.some(
				(command) => command.params?.type === "mousePressed"
			)
		).toBe(false);
		expect(result).toEqual(
			expect.objectContaining({
				action: "drop-files",
				modifiers: ["Alt"],
				dnd: expect.objectContaining({
					backend: "cdp-dispatch-drag-event",
					fileCount: 2,
					intercepted: false,
				}),
			})
		);
		expect(harness.visualStates).toContainEqual(
			expect.objectContaining({ action: "drop-files", dragging: true })
		);
		expect(harness.visualStates.at(-1)).toEqual(
			expect.objectContaining({ dragging: false })
		);
		await harness.controller.hide();
	});

	it("refuses file drops through foreground input", async () => {
		const harness = createPointerHarness();

		await expect(
			harness.controller.dropFiles({
				ref: "@e12",
				files: ["/tmp/clip.mp4"],
				inputMode: "foreground",
			})
		).rejects.toThrow("require background pointer input");
		expect(harness.inputEvents).toEqual([]);
	});
});

describe("buildPointerMovementPath", () => {
	it("keeps the internal path limited to pointer coordinates", () => {
		const path = buildPointerMovementPath({
			from: null,
			to: {
				x: 120,
				y: 240,
				ref: "@e12",
				bounds: { x: 100, y: 200, width: 40, height: 80 },
			} as AgentPointerResolvedTarget,
		});

		expect(path).toEqual([{ x: 120, y: 240 }]);
	});

	it("lands exactly on the destination while producing smooth intermediate points", () => {
		const path = buildPointerMovementPath({
			from: { x: 0, y: 0 },
			to: { x: 700, y: 350 },
		});

		expect(path.length).toBeGreaterThan(3);
		expect(path.at(-1)).toEqual({ x: 700, y: 350 });
	});
});
