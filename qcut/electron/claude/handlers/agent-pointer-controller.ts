import type { BrowserWindow } from "electron";
import {
	type AgentKeyboardModifier,
	type AgentKeyboardPressRequest,
	type AgentKeyboardResult,
	type AgentKeyboardTypeRequest,
	type AgentPointerAction,
	type AgentPointerButton,
	type AgentPointerClickRequest,
	type AgentPointerDragRequest,
	type AgentPointerMoveRequest,
	type AgentPointerPoint,
	type AgentPointerResolvedTarget,
	type AgentPointerResult,
	type AgentPointerScrollRequest,
	type AgentPointerTarget,
	type AgentPointerVisualState,
} from "../../types/claude-api.js";
import { runAgentPointerDrag } from "./agent-pointer-drag.js";
import { AgentPointerError } from "./agent-pointer-error.js";
import {
	AgentPointerInput,
	type AgentPointerInputSession,
	hasExplicitPointerTarget,
} from "./agent-pointer-input.js";
import {
	buildPointerMovementPath,
	POINTER_MOVE_STEP_MS,
} from "./agent-pointer-motion.js";
import { AgentPointerOperationQueue } from "./agent-pointer-operation-queue.js";
import {
	AgentPointerTargetResolver,
	type ResolveAgentPointerRef,
} from "./agent-pointer-target-resolver.js";
import { AgentPointerVisualStateStore } from "./agent-pointer-visual-state.js";

export { AgentPointerError } from "./agent-pointer-error.js";
export { buildPointerMovementPath } from "./agent-pointer-motion.js";

const POINTER_PRESS_MS = 55;
const POINTER_DOUBLE_CLICK_GAP_MS = 80;
const POINTER_HOVER_SETTLE_MS = 180;
const KEY_PRESS_MS = 35;
const KEY_SEQUENCE_INTERVAL_MS = 45;

type Sleep = (input: { durationMs: number }) => Promise<void>;

interface AgentPointerControllerOptions {
	win: BrowserWindow;
	resolveRef: ResolveAgentPointerRef;
	sleep?: Sleep;
}

interface MovePathOptions {
	session: AgentPointerInputSession;
	points: AgentPointerPoint[];
	index?: number;
	action: AgentPointerAction;
	button: AgentPointerButton | null;
	dragging: boolean;
	stepDelayMs?: number;
	modifiers?: AgentKeyboardModifier[];
}

interface MoveToOptions {
	session: AgentPointerInputSession;
	target: AgentPointerTarget;
	action: AgentPointerAction;
	button?: AgentPointerButton | null;
	dragging?: boolean;
	durationMs?: number;
	modifiers?: AgentKeyboardModifier[];
}

interface MoveStepOptions {
	session: AgentPointerInputSession;
	point: AgentPointerPoint;
	action: AgentPointerAction;
	button: AgentPointerButton | null;
	dragging: boolean;
	modifiers?: AgentKeyboardModifier[];
}

interface PressCycleOptions {
	session: AgentPointerInputSession;
	target: AgentPointerResolvedTarget;
	action: "click" | "double-click" | "right-click";
	button: AgentPointerButton;
	clickCount: number;
	modifiers?: AgentKeyboardModifier[];
}

const MAX_CLICK_COUNT = 3;

function clampClickCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 1;
	return Math.min(MAX_CLICK_COUNT, Math.max(1, Math.round(value)));
}

function reportedModifiers(modifiers: AgentKeyboardModifier[] | undefined): {
	modifiers?: AgentKeyboardModifier[];
} {
	return modifiers && modifiers.length > 0 ? { modifiers } : {};
}

function defaultSleep({ durationMs }: { durationMs: number }): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function parseKeyChord(value: string): {
	key: string;
	modifiers: AgentKeyboardModifier[];
} {
	const aliases: Record<string, AgentKeyboardModifier> = {
		alt: "Alt",
		option: "Alt",
		ctrl: "Control",
		control: "Control",
		cmd: "Meta",
		command: "Meta",
		meta: "Meta",
		shift: "Shift",
	};
	const parts = value
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) {
		throw new AgentPointerError({
			message: "Keyboard key must be non-empty.",
			statusCode: 400,
		});
	}
	const rawKey = parts.pop()!;
	const modifiers = parts.map((part) => {
		const modifier = aliases[part.toLowerCase()];
		if (!modifier) {
			throw new AgentPointerError({
				message: `Unsupported keyboard modifier: ${part}`,
				statusCode: 400,
			});
		}
		return modifier;
	});
	return {
		key: rawKey.toLowerCase() === "space" ? "Space" : rawKey,
		modifiers: [...new Set(modifiers)],
	};
}

export class AgentPointerController {
	private readonly sleep: Sleep;
	private readonly input: AgentPointerInput;
	private readonly operations: AgentPointerOperationQueue;
	private readonly targets: AgentPointerTargetResolver;
	private readonly visual: AgentPointerVisualStateStore;
	private currentPosition: AgentPointerPoint | null = null;

	constructor({
		win,
		resolveRef,
		sleep = defaultSleep,
	}: AgentPointerControllerOptions) {
		this.sleep = sleep;
		this.input = new AgentPointerInput({ win });
		this.operations = new AgentPointerOperationQueue({ input: this.input });
		this.targets = new AgentPointerTargetResolver({
			win,
			input: this.input,
			resolveRef,
		});
		this.visual = new AgentPointerVisualStateStore({ win });
	}

	getState(): AgentPointerVisualState {
		return this.visual.getState();
	}

	move(request: AgentPointerMoveRequest): Promise<AgentPointerResult> {
		return this.operations.runInput({
			inputMode: request.inputMode,
			operation: async ({ session }) => {
				const target = await this.moveTo({
					session,
					target: request,
					action: "move",
					durationMs: request.durationMs,
					modifiers: request.modifiers,
				});
				this.visual.scheduleIdle();
				return {
					...this.buildResult({ session, action: "move", target }),
					...reportedModifiers(request.modifiers),
				};
			},
		});
	}

	hover(request: AgentPointerMoveRequest): Promise<AgentPointerResult> {
		return this.operations.runInput({
			inputMode: request.inputMode,
			operation: async ({ session }) => {
				const target = await this.moveTo({
					session,
					target: request,
					action: "hover",
					durationMs: request.durationMs,
					modifiers: request.modifiers,
				});
				await this.sleep({ durationMs: POINTER_HOVER_SETTLE_MS });
				this.visual.scheduleIdle();
				return {
					...this.buildResult({ session, action: "hover", target }),
					...reportedModifiers(request.modifiers),
				};
			},
		});
	}

	click(request: AgentPointerClickRequest): Promise<AgentPointerResult> {
		return this.operations.runInput({
			inputMode: request.inputMode,
			operation: async ({ session }) => {
				const button: AgentPointerButton = request.button ?? "left";
				const clickCount = clampClickCount(request.clickCount);
				const target = await this.moveTo({
					session,
					target: request,
					action: "click",
					durationMs: request.durationMs,
					modifiers: request.modifiers,
				});
				this.targets.assertEnabled({ target });
				for (let count = 1; count <= clickCount; count += 1) {
					if (count > 1) {
						await this.sleep({ durationMs: POINTER_DOUBLE_CLICK_GAP_MS });
					}
					await this.pressCycle({
						session,
						target,
						action: "click",
						button,
						clickCount: count,
						modifiers: request.modifiers,
					});
				}
				this.visual.scheduleIdle();
				return {
					...this.buildResult({ session, action: "click", target }),
					button,
					clickCount,
					...reportedModifiers(request.modifiers),
				};
			},
		});
	}

	doubleClick(request: AgentPointerClickRequest): Promise<AgentPointerResult> {
		return this.operations.runInput({
			inputMode: request.inputMode,
			operation: async ({ session }) => {
				const target = await this.moveTo({
					session,
					target: request,
					action: "double-click",
					durationMs: request.durationMs,
					modifiers: request.modifiers,
				});
				this.targets.assertEnabled({ target });
				await this.pressCycle({
					session,
					target,
					action: "double-click",
					button: "left",
					clickCount: 1,
					modifiers: request.modifiers,
				});
				await this.sleep({ durationMs: POINTER_DOUBLE_CLICK_GAP_MS });
				await this.pressCycle({
					session,
					target,
					action: "double-click",
					button: "left",
					clickCount: 2,
					modifiers: request.modifiers,
				});
				this.visual.scheduleIdle();
				return {
					...this.buildResult({
						session,
						action: "double-click",
						target,
					}),
					button: "left",
					clickCount: 2,
					...reportedModifiers(request.modifiers),
				};
			},
		});
	}

	rightClick(request: AgentPointerClickRequest): Promise<AgentPointerResult> {
		return this.operations.runInput({
			inputMode: request.inputMode,
			operation: async ({ session }) => {
				const target = await this.moveTo({
					session,
					target: request,
					action: "right-click",
					durationMs: request.durationMs,
					modifiers: request.modifiers,
				});
				this.targets.assertEnabled({ target });
				await this.pressCycle({
					session,
					target,
					action: "right-click",
					button: "right",
					clickCount: 1,
					modifiers: request.modifiers,
				});
				this.visual.scheduleIdle();
				return {
					...this.buildResult({
						session,
						action: "right-click",
						target,
					}),
					button: "right",
					clickCount: 1,
					...reportedModifiers(request.modifiers),
				};
			},
		});
	}

	drag(request: AgentPointerDragRequest): Promise<AgentPointerResult> {
		return this.operations.runInput({
			inputMode: request.inputMode,
			operation: async ({ session }) => {
				const { destination, outcome, button, modifiers } =
					await runAgentPointerDrag({
						host: this.dragHost(),
						session,
						request,
					});
				return {
					...this.buildResult({ session, action: "drag", target: destination }),
					dnd: outcome,
					button,
					...reportedModifiers(modifiers),
				};
			},
		});
	}

	pressKeys(request: AgentKeyboardPressRequest): Promise<AgentKeyboardResult> {
		return this.operations.runInput({
			inputMode: request.inputMode,
			operation: async ({ session }) => {
				for (const [index, value] of request.keys.entries()) {
					const chord = parseKeyChord(value);
					await this.input.sendKey({
						session,
						type: "keyDown",
						key: chord.key,
						modifiers: chord.modifiers,
					});
					await this.sleep({ durationMs: KEY_PRESS_MS });
					await this.input.sendKey({
						session,
						type: "keyUp",
						key: chord.key,
						modifiers: chord.modifiers,
					});
					if (index < request.keys.length - 1) {
						await this.sleep({
							durationMs: request.intervalMs ?? KEY_SEQUENCE_INTERVAL_MS,
						});
					}
				}
				return {
					action: "press",
					input:
						session.inputMode === "background"
							? "cdp-dispatch-key-event"
							: "electron-send-input-event",
					inputMode: session.inputMode,
					windowFocused: this.input.isWindowFocused(),
					keyCount: request.keys.length,
				};
			},
		});
	}

	typeText(request: AgentKeyboardTypeRequest): Promise<AgentKeyboardResult> {
		return this.operations.runInput({
			inputMode: request.inputMode,
			operation: async ({ session }) => {
				const characters = Array.from(request.text);
				if (request.intervalMs && request.intervalMs > 0) {
					for (const [index, character] of characters.entries()) {
						await this.input.insertText({ session, text: character });
						if (index < characters.length - 1) {
							await this.sleep({ durationMs: request.intervalMs });
						}
					}
				} else {
					await this.input.insertText({ session, text: request.text });
				}
				return {
					action: "type",
					input:
						session.inputMode === "background"
							? "cdp-dispatch-key-event"
							: "electron-send-input-event",
					inputMode: session.inputMode,
					windowFocused: this.input.isWindowFocused(),
					characterCount: characters.length,
				};
			},
		});
	}

	scroll(request: AgentPointerScrollRequest): Promise<AgentPointerResult> {
		return this.operations.runInput({
			inputMode: request.inputMode,
			operation: async ({ session }) => {
				const target = hasExplicitPointerTarget({ target: request })
					? await this.moveTo({
							session,
							target: request,
							action: "scroll",
							modifiers: request.modifiers,
						})
					: this.targets.currentOrCenter({
							currentPosition: this.currentPosition,
						});
				this.visual.update({
					action: "scroll",
					inputMode: session.inputMode,
					x: target.x,
					y: target.y,
				});

				const deltaX = request.deltaX ?? 0;
				const deltaY = request.deltaY ?? 0;
				await this.input.sendWheel({
					session,
					point: target,
					deltaX,
					deltaY,
					modifiers: request.modifiers,
				});
				this.visual.scheduleIdle();
				return {
					...this.buildResult({ session, action: "scroll", target }),
					deltaX,
					deltaY,
					...reportedModifiers(request.modifiers),
				};
			},
		});
	}

	hide(): Promise<AgentPointerResult> {
		return this.operations.run({
			operation: async () => {
				this.visual.clearIdle();
				this.visual.update({
					visible: false,
					active: false,
					action: "hidden",
					pressed: false,
					dragging: false,
					button: null,
					inputMode: null,
					pulseId: 0,
				});
				const point = this.currentPosition ?? { x: 0, y: 0 };
				const lastInput = this.operations.getLastInput();
				return {
					action: "hidden",
					visible: false,
					input: lastInput.backend,
					inputMode: lastInput.inputMode,
					windowFocused: this.input.isWindowFocused(),
					...point,
				};
			},
		});
	}

	private dragHost() {
		return {
			input: this.input,
			visual: this.visual,
			targets: this.targets,
			sleep: this.sleep,
			getPosition: () => this.currentPosition,
			setPosition: (point: AgentPointerPoint) => {
				this.currentPosition = { x: point.x, y: point.y };
			},
			moveTo: (input: MoveToOptions) => this.moveTo(input),
			moveStep: (input: MoveStepOptions) => this.moveStep(input),
			moveAlongPath: (input: MovePathOptions) => this.moveAlongPath(input),
		};
	}

	private async moveTo({
		session,
		target,
		action,
		button = null,
		dragging = false,
		durationMs,
		modifiers,
	}: MoveToOptions): Promise<AgentPointerResolvedTarget> {
		const resolvedTarget = await this.targets.resolve({ target });
		const points = buildPointerMovementPath({
			from: this.currentPosition,
			to: resolvedTarget,
		});
		await this.moveAlongPath({
			session,
			points,
			action,
			button,
			dragging,
			stepDelayMs:
				durationMs === undefined
					? undefined
					: durationMs / Math.max(1, points.length - 1),
			modifiers,
		});
		return resolvedTarget;
	}

	private async moveAlongPath({
		session,
		points,
		index = 0,
		action,
		button,
		dragging,
		stepDelayMs = POINTER_MOVE_STEP_MS,
		modifiers,
	}: MovePathOptions): Promise<void> {
		const point = points[index];
		if (!point) return;

		await this.moveStep({
			session,
			point,
			action,
			button,
			dragging,
			modifiers,
		});

		if (index >= points.length - 1) return;
		await this.sleep({ durationMs: Math.max(0, stepDelayMs) });
		await this.moveAlongPath({
			session,
			points,
			index: index + 1,
			action,
			button,
			dragging,
			stepDelayMs,
			modifiers,
		});
	}

	private async moveStep({
		session,
		point,
		action,
		button,
		dragging,
		modifiers,
	}: MoveStepOptions): Promise<void> {
		const previous = this.currentPosition;
		await this.input.sendMouse({
			session,
			type: "mouseMove",
			point,
			button: button ?? undefined,
			movement: previous
				? { x: point.x - previous.x, y: point.y - previous.y }
				: undefined,
			modifiers,
		});
		this.currentPosition = { x: point.x, y: point.y };
		this.visual.update({
			action,
			inputMode: session.inputMode,
			x: point.x,
			y: point.y,
			pressed: button !== null,
			dragging,
			button,
		});
	}

	private async pressCycle({
		session,
		target,
		action,
		button,
		clickCount,
		modifiers,
	}: PressCycleOptions): Promise<void> {
		this.visual.update({
			action,
			inputMode: session.inputMode,
			pressed: true,
			button,
			x: target.x,
			y: target.y,
		});
		await this.input.sendMouse({
			session,
			type: "mouseDown",
			point: target,
			button,
			clickCount,
			modifiers,
		});
		await this.sleep({ durationMs: POINTER_PRESS_MS });
		await this.input.sendMouse({
			session,
			type: "mouseUp",
			point: target,
			button,
			clickCount,
			modifiers,
		});
		this.visual.update({
			action,
			inputMode: session.inputMode,
			pressed: false,
			button: null,
			pulseId: this.visual.getState().pulseId + 1,
		});
	}

	private buildResult({
		session,
		action,
		target,
	}: {
		session: AgentPointerInputSession;
		action: AgentPointerAction;
		target: AgentPointerResolvedTarget;
	}): AgentPointerResult {
		return {
			action,
			visible: true,
			input: session.backend,
			inputMode: session.inputMode,
			windowFocused: this.input.isWindowFocused(),
			x: target.x,
			y: target.y,
			target,
		};
	}
}

const controllerByWindow = new WeakMap<BrowserWindow, AgentPointerController>();

export function getAgentPointerController({
	win,
	resolveRef,
}: {
	win: BrowserWindow;
	resolveRef: ResolveAgentPointerRef;
}): AgentPointerController {
	const existing = controllerByWindow.get(win);
	if (existing) return existing;

	const controller = new AgentPointerController({ win, resolveRef });
	controllerByWindow.set(win, controller);
	return controller;
}
