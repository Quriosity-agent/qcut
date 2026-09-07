import type {
	AgentKeyboardModifier,
	AgentKeyboardPressRequest,
	AgentKeyboardResult,
	AgentKeyboardTypeRequest,
	AgentPointerButton,
	AgentPointerClickRequest,
	AgentPointerDragMode,
	AgentPointerDragRequest,
	AgentPointerHitTestRequest,
	AgentPointerHitTestResult,
	AgentPointerMoveRequest,
	AgentPointerResult,
	AgentPointerScrollRequest,
	AgentPointerTarget,
	AgentPointerVisualState,
} from "../../types/claude-api.js";
import { DEFAULT_AGENT_POINTER_INPUT_MODE } from "../../types/claude-api.js";
import { AgentPointerError } from "../handlers/agent-pointer-controller.js";
import { EditorSnapshotActionError } from "../handlers/claude-snapshot-handler.js";
import type { Router } from "../utils/http-router.js";
import { HttpError } from "../utils/http-router.js";

interface AgentPointerRouteHandlers {
	getState: () => Promise<AgentPointerVisualState>;
	move: (request: AgentPointerMoveRequest) => Promise<AgentPointerResult>;
	hover: (request: AgentPointerMoveRequest) => Promise<AgentPointerResult>;
	click: (request: AgentPointerClickRequest) => Promise<AgentPointerResult>;
	doubleClick: (
		request: AgentPointerClickRequest
	) => Promise<AgentPointerResult>;
	rightClick: (
		request: AgentPointerClickRequest
	) => Promise<AgentPointerResult>;
	drag: (request: AgentPointerDragRequest) => Promise<AgentPointerResult>;
	scroll: (request: AgentPointerScrollRequest) => Promise<AgentPointerResult>;
	hide: () => Promise<AgentPointerResult>;
	hitTest: (
		request: AgentPointerHitTestRequest
	) => Promise<AgentPointerHitTestResult>;
	pressKeys: (
		request: AgentKeyboardPressRequest
	) => Promise<AgentKeyboardResult>;
	typeText: (request: AgentKeyboardTypeRequest) => Promise<AgentKeyboardResult>;
	timeoutMs?: number;
}

function requireBodyObject({
	body,
}: {
	body: unknown;
}): Record<string, unknown> {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new HttpError(400, "Pointer request body must be an object.");
	}
	return body as Record<string, unknown>;
}

function parseFiniteNumber({
	value,
	field,
}: {
	value: unknown;
	field: string;
}): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new HttpError(400, `Pointer '${field}' must be a finite number.`);
	}
	return value;
}

export function parseAgentPointerTarget({
	value,
	required = true,
	field = "target",
}: {
	value: unknown;
	required?: boolean;
	field?: string;
}): AgentPointerTarget {
	const body = requireBodyObject({ body: value });
	const rawRef = body.ref;
	const ref =
		typeof rawRef === "string" && rawRef.trim().length > 0
			? rawRef.trim()
			: undefined;
	if (rawRef !== undefined && !ref) {
		throw new HttpError(400, `Pointer '${field}.ref' must be non-empty.`);
	}

	const x = parseFiniteNumber({ value: body.x, field: `${field}.x` });
	const y = parseFiniteNumber({ value: body.y, field: `${field}.y` });
	const hasCoordinates = x !== undefined || y !== undefined;
	if (hasCoordinates && (x === undefined || y === undefined)) {
		throw new HttpError(
			400,
			`Pointer '${field}' requires both x and y coordinates.`
		);
	}
	if (ref && hasCoordinates) {
		throw new HttpError(
			400,
			`Pointer '${field}' accepts either ref or coordinates, not both.`
		);
	}
	if (!ref && !hasCoordinates && required) {
		throw new HttpError(
			400,
			`Pointer '${field}' requires either ref or x/y coordinates.`
		);
	}

	if (ref) return { ref };
	if (x !== undefined && y !== undefined) return { x, y };
	return {};
}

export function parseAgentPointerInputMode({
	value,
}: {
	value: unknown;
}): "background" | "foreground" {
	if (value === undefined) return DEFAULT_AGENT_POINTER_INPUT_MODE;
	if (value === "background" || value === "foreground") return value;
	throw new HttpError(
		400,
		"Pointer 'inputMode' must be 'background' or 'foreground'."
	);
}

const AGENT_POINTER_DRAG_MODES: readonly AgentPointerDragMode[] = [
	"auto",
	"html5",
	"mouse",
];

export function parseAgentPointerDragMode({
	value,
}: {
	value: unknown;
}): AgentPointerDragMode | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value === "string" &&
		(AGENT_POINTER_DRAG_MODES as readonly string[]).includes(value)
	) {
		return value as AgentPointerDragMode;
	}
	throw new HttpError(
		400,
		"Pointer 'dnd' must be 'auto', 'html5', or 'mouse'."
	);
}

const MODIFIER_ALIASES: Record<string, AgentKeyboardModifier> = {
	alt: "Alt",
	option: "Alt",
	ctrl: "Control",
	control: "Control",
	cmd: "Meta",
	command: "Meta",
	meta: "Meta",
	super: "Meta",
	shift: "Shift",
};

export function parseAgentPointerModifiers({
	value,
}: {
	value: unknown;
}): AgentKeyboardModifier[] | undefined {
	if (value === undefined) return undefined;
	const list = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(",")
			: null;
	if (!list) {
		throw new HttpError(
			400,
			'Pointer \'modifiers\' must be an array such as ["Shift", "Meta"].'
		);
	}
	const modifiers: AgentKeyboardModifier[] = [];
	for (const entry of list) {
		if (typeof entry !== "string") {
			throw new HttpError(400, "Pointer modifiers must be strings.");
		}
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const modifier = MODIFIER_ALIASES[trimmed.toLowerCase()];
		if (!modifier) {
			throw new HttpError(
				400,
				`Unsupported pointer modifier '${trimmed}'. Use alt, ctrl, cmd/meta, or shift.`
			);
		}
		if (!modifiers.includes(modifier)) modifiers.push(modifier);
	}
	return modifiers;
}

export function parseAgentPointerButton({
	value,
}: {
	value: unknown;
}): AgentPointerButton | undefined {
	if (value === undefined) return undefined;
	if (value === "left" || value === "middle" || value === "right") return value;
	throw new HttpError(
		400,
		"Pointer 'button' must be 'left', 'middle', or 'right'."
	);
}

export function parseAgentPointerClickCount({
	value,
}: {
	value: unknown;
}): number | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= 3
	) {
		return value;
	}
	throw new HttpError(
		400,
		"Pointer 'clickCount' must be an integer from 1 to 3."
	);
}

function parseHitTestRequest({
	body,
}: {
	body: unknown;
}): AgentPointerHitTestRequest {
	const parsed = requireBodyObject({ body });
	const x = parseFiniteNumber({ value: parsed.x, field: "x" });
	const y = parseFiniteNumber({ value: parsed.y, field: "y" });
	if (x === undefined || y === undefined) {
		throw new HttpError(400, "Pointer hit-test requires x and y coordinates.");
	}
	return { x, y };
}

function parseTargetRequest({
	body,
}: {
	body: unknown;
}): AgentPointerClickRequest {
	const parsed = requireBodyObject({ body });
	const durationMs = parseFiniteNumber({
		value: parsed.durationMs,
		field: "durationMs",
	});
	if (durationMs !== undefined && durationMs < 0) {
		throw new HttpError(400, "Pointer 'durationMs' must be >= 0.");
	}
	return {
		...parseAgentPointerTarget({ value: parsed }),
		inputMode: parseAgentPointerInputMode({ value: parsed.inputMode }),
		durationMs,
		modifiers: parseAgentPointerModifiers({ value: parsed.modifiers }),
		button: parseAgentPointerButton({ value: parsed.button }),
		clickCount: parseAgentPointerClickCount({ value: parsed.clickCount }),
	};
}

function parseDragRequest({
	body,
}: {
	body: unknown;
}): AgentPointerDragRequest {
	const parsed = requireBodyObject({ body });
	const holdMs = parseFiniteNumber({ value: parsed.holdMs, field: "holdMs" });
	const durationMs = parseFiniteNumber({
		value: parsed.durationMs,
		field: "durationMs",
	});
	const releaseDelayMs = parseFiniteNumber({
		value: parsed.releaseDelayMs,
		field: "releaseDelayMs",
	});
	const steps = parseFiniteNumber({ value: parsed.steps, field: "steps" });
	const dragStartTimeoutMs = parseFiniteNumber({
		value: parsed.dragStartTimeoutMs,
		field: "dragStartTimeoutMs",
	});
	for (const [field, value] of [
		["holdMs", holdMs],
		["durationMs", durationMs],
		["releaseDelayMs", releaseDelayMs],
		["dragStartTimeoutMs", dragStartTimeoutMs],
	] as const) {
		if (value !== undefined && value < 0) {
			throw new HttpError(400, `Pointer '${field}' must be >= 0.`);
		}
	}
	if (
		steps !== undefined &&
		(!Number.isInteger(steps) || steps < 1 || steps > 500)
	) {
		throw new HttpError(
			400,
			"Pointer 'steps' must be an integer from 1 to 500."
		);
	}
	let via: AgentPointerTarget[] | undefined;
	if (parsed.via !== undefined) {
		if (!Array.isArray(parsed.via) || parsed.via.length > 50) {
			throw new HttpError(
				400,
				"Pointer 'via' must be an array of up to 50 targets."
			);
		}
		via = parsed.via.map((target, index) =>
			parseAgentPointerTarget({ value: target, field: `via[${index}]` })
		);
	}
	return {
		from: parseAgentPointerTarget({ value: parsed.from, field: "from" }),
		to: parseAgentPointerTarget({ value: parsed.to, field: "to" }),
		inputMode: parseAgentPointerInputMode({ value: parsed.inputMode }),
		via,
		holdMs,
		durationMs,
		releaseDelayMs,
		steps,
		dnd: parseAgentPointerDragMode({ value: parsed.dnd }),
		dragStartTimeoutMs,
		modifiers: parseAgentPointerModifiers({ value: parsed.modifiers }),
		button: parseAgentPointerButton({ value: parsed.button }),
	};
}

function parseKeyboardPressRequest(body: unknown): AgentKeyboardPressRequest {
	const parsed = requireBodyObject({ body });
	if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) {
		throw new HttpError(
			400,
			"Keyboard press requires a non-empty 'keys' array."
		);
	}
	const keys = parsed.keys.map((key) => {
		if (typeof key !== "string" || !key.trim()) {
			throw new HttpError(
				400,
				"Every keyboard key must be a non-empty string."
			);
		}
		return key.trim();
	});
	const intervalMs = parseFiniteNumber({
		value: parsed.intervalMs,
		field: "intervalMs",
	});
	if (intervalMs !== undefined && intervalMs < 0) {
		throw new HttpError(400, "Keyboard 'intervalMs' must be >= 0.");
	}
	return {
		keys,
		intervalMs,
		inputMode: parseAgentPointerInputMode({ value: parsed.inputMode }),
	};
}

function parseKeyboardTypeRequest(body: unknown): AgentKeyboardTypeRequest {
	const parsed = requireBodyObject({ body });
	if (typeof parsed.text !== "string") {
		throw new HttpError(400, "Keyboard type requires string 'text'.");
	}
	const intervalMs = parseFiniteNumber({
		value: parsed.intervalMs,
		field: "intervalMs",
	});
	if (intervalMs !== undefined && intervalMs < 0) {
		throw new HttpError(400, "Keyboard 'intervalMs' must be >= 0.");
	}
	return {
		text: parsed.text,
		intervalMs,
		inputMode: parseAgentPointerInputMode({ value: parsed.inputMode }),
	};
}

function parseScrollRequest({
	body,
}: {
	body: unknown;
}): AgentPointerScrollRequest {
	const parsed = requireBodyObject({ body });
	const target = parseAgentPointerTarget({ value: parsed, required: false });
	const deltaX = parseFiniteNumber({ value: parsed.deltaX, field: "deltaX" });
	const deltaY = parseFiniteNumber({ value: parsed.deltaY, field: "deltaY" });
	if (deltaX === undefined && deltaY === undefined) {
		throw new HttpError(400, "Pointer scroll requires deltaX or deltaY.");
	}
	return {
		...target,
		inputMode: parseAgentPointerInputMode({ value: parsed.inputMode }),
		deltaX,
		deltaY,
		modifiers: parseAgentPointerModifiers({ value: parsed.modifiers }),
	};
}

async function withPointerTimeout<T>({
	timeoutMs,
	work,
}: {
	timeoutMs: number;
	work: () => Promise<T>;
}): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new HttpError(504, "Pointer action timed out")),
					timeoutMs
				);
			}),
		]);
	} catch (error) {
		if (error instanceof HttpError) throw error;
		if (
			error instanceof AgentPointerError ||
			error instanceof EditorSnapshotActionError
		) {
			throw new HttpError(error.statusCode, error.message);
		}
		throw error;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export function registerAgentPointerRoutes(
	router: Router,
	handlers: AgentPointerRouteHandlers
): void {
	const timeoutMs = handlers.timeoutMs ?? 15_000;

	router.get("/api/claude/pointer/state", async () => {
		return await withPointerTimeout({ timeoutMs, work: handlers.getState });
	});

	router.post("/api/claude/pointer/move", async (req) => {
		const request = parseTargetRequest({ body: req.body });
		return await withPointerTimeout({
			timeoutMs,
			work: async () => await handlers.move(request),
		});
	});

	router.post("/api/claude/pointer/hover", async (req) => {
		const request = parseTargetRequest({ body: req.body });
		return await withPointerTimeout({
			timeoutMs,
			work: async () => await handlers.hover(request),
		});
	});

	router.post("/api/claude/pointer/click", async (req) => {
		const request = parseTargetRequest({ body: req.body });
		return await withPointerTimeout({
			timeoutMs,
			work: async () => await handlers.click(request),
		});
	});

	router.post("/api/claude/pointer/double-click", async (req) => {
		const request = parseTargetRequest({ body: req.body });
		return await withPointerTimeout({
			timeoutMs,
			work: async () => await handlers.doubleClick(request),
		});
	});

	router.post("/api/claude/pointer/right-click", async (req) => {
		const request = parseTargetRequest({ body: req.body });
		return await withPointerTimeout({
			timeoutMs,
			work: async () => await handlers.rightClick(request),
		});
	});

	router.post("/api/claude/pointer/drag", async (req) => {
		const request = parseDragRequest({ body: req.body });
		return await withPointerTimeout({
			timeoutMs,
			work: async () => await handlers.drag(request),
		});
	});

	router.post("/api/claude/pointer/scroll", async (req) => {
		const request = parseScrollRequest({ body: req.body });
		return await withPointerTimeout({
			timeoutMs,
			work: async () => await handlers.scroll(request),
		});
	});

	router.post("/api/claude/pointer/hide", async () => {
		return await withPointerTimeout({ timeoutMs, work: handlers.hide });
	});

	router.post("/api/claude/pointer/hit-test", async (req) => {
		const request = parseHitTestRequest({ body: req.body });
		return await withPointerTimeout({
			timeoutMs,
			work: async () => await handlers.hitTest(request),
		});
	});

	router.post("/api/claude/keyboard/press", async (req) => {
		const request = parseKeyboardPressRequest(req.body);
		return await withPointerTimeout({
			timeoutMs,
			work: async () => await handlers.pressKeys(request),
		});
	});

	router.post("/api/claude/keyboard/type", async (req) => {
		const request = parseKeyboardTypeRequest(req.body);
		return await withPointerTimeout({
			timeoutMs,
			work: async () => await handlers.typeText(request),
		});
	});
}
