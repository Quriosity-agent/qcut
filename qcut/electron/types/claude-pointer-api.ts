export const AGENT_POINTER_STATE_CHANNEL = "claude:pointer:state";

export type AgentPointerButton = "left" | "middle" | "right";
export type AgentPointerInputMode = "background" | "foreground";
export type AgentPointerInputBackend =
	| "cdp-dispatch-mouse-event"
	| "electron-send-input-event";

export const DEFAULT_AGENT_POINTER_INPUT_MODE: AgentPointerInputMode =
	"background";

export type AgentPointerAction =
	| "hidden"
	| "idle"
	| "move"
	| "hover"
	| "press"
	| "click"
	| "double-click"
	| "right-click"
	| "drag"
	| "scroll"
	| "drop-files";

export interface AgentPointerPoint {
	x: number;
	y: number;
}

export interface AgentPointerTarget extends Partial<AgentPointerPoint> {
	ref?: string;
}

export interface AgentPointerInputOptions {
	inputMode?: AgentPointerInputMode;
}

/** Keyboard modifiers held while a pointer event is dispatched. */
export interface AgentPointerModifierOptions {
	modifiers?: AgentKeyboardModifier[];
}

export interface AgentPointerBounds extends AgentPointerPoint {
	width: number;
	height: number;
}

export interface AgentPointerResolvedTarget extends AgentPointerPoint {
	ref?: string;
	bounds?: AgentPointerBounds;
	tagName?: string;
	role?: string | null;
	name?: string | null;
	value?: string | null;
	disabled?: boolean;
}

export interface AgentPointerMoveRequest
	extends AgentPointerTarget,
		AgentPointerInputOptions,
		AgentPointerModifierOptions {
	durationMs?: number;
}

export interface AgentPointerClickRequest
	extends AgentPointerTarget,
		AgentPointerInputOptions,
		AgentPointerModifierOptions {
	durationMs?: number;
	/** Mouse button for `click`; `double-click` and `right-click` fix their own. */
	button?: AgentPointerButton;
	/** Number of press cycles for `click` (1 to 3); 3 selects a paragraph in text. */
	clickCount?: number;
}

/**
 * How a drag should treat HTML5 drag-and-drop sources.
 * - `auto`: intercept a drag the page starts and finish it with CDP drag
 *   events; otherwise fall back to a plain mouse drag.
 * - `html5`: require the page to start a drag; fail if it does not.
 * - `mouse`: never intercept; dispatch mouse events only.
 */
export type AgentPointerDragMode = "auto" | "html5" | "mouse";

export interface AgentPointerDragDataItem {
	mimeType: string;
	data: string;
}

/** Drag payload captured from `Input.dragIntercepted` and replayed on drop. */
export interface AgentPointerDragData {
	items: AgentPointerDragDataItem[];
	files?: string[];
	dragOperationsMask: number;
}

export interface AgentPointerDragOutcome {
	mode: AgentPointerDragMode;
	intercepted: boolean;
	backend: "cdp-dispatch-drag-event" | "mouse";
	mimeTypes: string[];
	fileCount: number;
	dragOperationsMask: number | null;
}

export interface AgentPointerDragRequest
	extends AgentPointerInputOptions,
		AgentPointerModifierOptions {
	from: AgentPointerTarget;
	to: AgentPointerTarget;
	/** Button held during the drag; defaults to left. */
	button?: AgentPointerButton;
	via?: AgentPointerTarget[];
	holdMs?: number;
	durationMs?: number;
	steps?: number;
	releaseDelayMs?: number;
	dnd?: AgentPointerDragMode;
	/** How long to wait for the page to start an HTML5 drag after the first moves. */
	dragStartTimeoutMs?: number;
}

export type AgentKeyboardModifier = "Alt" | "Control" | "Meta" | "Shift";

export interface AgentKeyboardPressRequest extends AgentPointerInputOptions {
	keys: string[];
	intervalMs?: number;
}

export interface AgentKeyboardTypeRequest extends AgentPointerInputOptions {
	text: string;
	intervalMs?: number;
	/** Dispatch keyDown/keyUp per character so keydown handlers fire, instead of inserting text. */
	keyEvents?: boolean;
}

export interface AgentKeyboardResult {
	action: "press" | "type";
	input: "cdp-dispatch-key-event" | "electron-send-input-event";
	inputMode: AgentPointerInputMode;
	windowFocused: boolean;
	keyCount?: number;
	characterCount?: number;
	/** How typed text reached the page. */
	method?: "insert-text" | "key-events";
}

/** Drop local files onto a target as an external HTML5 file drop. */
export interface AgentPointerDropFilesRequest
	extends AgentPointerTarget,
		AgentPointerInputOptions,
		AgentPointerModifierOptions {
	files: string[];
	durationMs?: number;
}

export interface AgentPointerScrollRequest
	extends AgentPointerTarget,
		AgentPointerInputOptions,
		AgentPointerModifierOptions {
	deltaX?: number;
	deltaY?: number;
}

export interface AgentPointerVisualState extends AgentPointerPoint {
	visible: boolean;
	active: boolean;
	action: AgentPointerAction;
	label: string;
	pressed: boolean;
	dragging: boolean;
	button: AgentPointerButton | null;
	inputMode: AgentPointerInputMode | null;
	pulseId: number;
	sequence: number;
	timestamp: number;
}

export interface AgentPointerResult extends AgentPointerPoint {
	action: AgentPointerAction;
	visible: boolean;
	input: AgentPointerInputBackend;
	inputMode: AgentPointerInputMode;
	windowFocused: boolean;
	target?: AgentPointerResolvedTarget;
	deltaX?: number;
	deltaY?: number;
	dnd?: AgentPointerDragOutcome;
	/** Button used for click and drag actions. */
	button?: AgentPointerButton;
	/** Modifiers held during the action, when any. */
	modifiers?: AgentKeyboardModifier[];
	/** Press cycles dispatched for click actions. */
	clickCount?: number;
}

/** What `document.elementFromPoint` finds under an editor viewport point. */
export interface AgentPointerHitTestRequest extends AgentPointerPoint {}

export interface AgentPointerHitTestElement {
	tagName: string;
	role: string | null;
	name: string | null;
	value: string | null;
	testId: string | null;
	ref: string | null;
	disabled: boolean;
	bounds: AgentPointerBounds;
}

export interface AgentPointerRulerLabel extends AgentPointerBounds {
	time: number;
}

/** Timeline ruler tick labels with their viewport bounds. */
export interface AgentPointerRulerLabelsResult {
	action: "ruler-labels";
	labels: AgentPointerRulerLabel[];
	count: number;
}

export interface AgentPointerHitTestResult extends AgentPointerPoint {
	action: "hit-test";
	hit: boolean;
	element: AgentPointerHitTestElement | null;
	/** Nearest ancestors carrying a `data-testid`, closest first. */
	ancestors: Array<{ tagName: string; testId: string }>;
}
