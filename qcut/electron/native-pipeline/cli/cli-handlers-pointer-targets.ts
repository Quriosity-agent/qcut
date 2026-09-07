/**
 * Pointer target resolution, list-drag context, waits, and shared option validation for the editor pointer CLI.
 *
 * @module electron/native-pipeline/cli/cli-handlers-pointer-targets
 */

import type {
	AgentKeyboardModifier,
	AgentPointerButton,
	AgentPointerTarget,
	EditorSnapshotElement,
	EditorSnapshotResponse,
	EditorSnapshotResult,
} from "../../types/claude-api.js";
import type { EditorApiClient } from "../editor/editor-api-client.js";
import { ensureEditorPreviewReady } from "../editor/editor-preview-readiness.js";
import type { CLIRunOptions, CLIResult } from "./cli-runner/types.js";

interface PointerTargetOptions {
	target?: string;
	ref?: string;
	x?: number;
	y?: number;
	normalizedX?: number;
	normalizedY?: number;
}

interface UiWaitOptions {
	ref?: string;
	text?: string;
	value?: string;
	timeoutMs?: number;
	intervalMs?: number;
}

export const sleep = (durationMs: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, durationMs));

const SEMANTIC_TARGET_TEST_IDS: Record<string, string[]> = {
	"panel.media": ["media-panel-tab"],
	"panel.audio": ["audio-panel-tab"],
	"panel.text": ["text-panel-tab"],
	"panel.stickers": ["stickers-panel-tab"],
	"panel.effects": ["effects-panel-tab"],
	"panel.transitions": ["transitions-panel-tab"],
	"panel.captions": ["captions-panel-tab"],
	"panel.filters": ["filters-panel-tab"],
	"panel.adjustments": ["adjustments-panel-tab"],
	"panel.templates": ["templates-panel-tab"],
	"export.button": ["export-button", "export-start-button"],
	"export.start": ["export-start-button"],
	"timeline.playhead": ["timeline-playhead"],
	"timeline.toolbar": ["timeline-toolbar"],
	"timeline.zoom-in": ["zoom-in-button"],
	"timeline.zoom-out": ["zoom-out-button"],
	"timeline.play": ["timeline-play-button", "preview-play-button"],
	"timeline.pause": ["timeline-pause-button", "preview-pause-button"],
	"preview.canvas": ["preview-canvas", "preview-panel"],
	"media.import": ["import-media-button"],
	"text.add": ["text-overlay-button"],
	"text.content": ["text-content-input"],
	"text.font-size": ["text-font-size-input"],
	"text.animation": ["text-animation-group-toggle"],
	"text.animation.entrance": ["text-animation-phase-entrance"],
	"text.animation.loop": ["text-animation-phase-loop"],
	"text.animation.exit": ["text-animation-phase-exit"],
};

const TEXT_ANIMATION_TARGET_PATTERN =
	/^text\.animation\.(entrance|loop|exit)\.([a-z0-9-]+)$/;

function resolveSemanticTargetTestIds({
	target,
}: {
	target: string;
}): string[] {
	if (target.startsWith("testid:")) {
		return [target.slice("testid:".length)];
	}
	const textAnimationPreset = TEXT_ANIMATION_TARGET_PATTERN.exec(target);
	if (textAnimationPreset) {
		const [, phase, presetId] = textAnimationPreset;
		return [`text-animation-card-${phase}-${presetId}`];
	}
	return SEMANTIC_TARGET_TEST_IDS[target] ?? [target];
}

function isSemanticTarget({ target }: { target: string }): boolean {
	return (
		Boolean(SEMANTIC_TARGET_TEST_IDS[target]) ||
		target.startsWith("testid:") ||
		TEXT_ANIMATION_TARGET_PATTERN.test(target)
	);
}

const BACKGROUND_POINTER_CAPABILITY = {
	name: "state.pointer",
	minVersion: "1.1.0",
	feature: "Background pointer input",
	remediation:
		"Update QCut. Editors advertising state.pointer 1.0.0 can retry with --foreground.",
} as const;

export const HTML5_DRAG_CAPABILITY = {
	name: "state.pointer",
	minVersion: "1.2.0",
	feature: "HTML5 drag-and-drop",
	remediation:
		"Update QCut, or retry with --dnd auto so older editors fall back to a mouse drag.",
} as const;

const DRAG_MODES = ["auto", "html5", "mouse"] as const;

type DragMode = (typeof DRAG_MODES)[number];

export function parseDragMode({
	value,
}: {
	value: string | undefined;
}): { ok: true; mode: DragMode | undefined } | { ok: false; error: string } {
	if (value === undefined) return { ok: true, mode: undefined };
	if ((DRAG_MODES as readonly string[]).includes(value)) {
		return { ok: true, mode: value as DragMode };
	}
	return {
		ok: false,
		error: `--dnd must be one of ${DRAG_MODES.join(", ")} (got ${value})`,
	};
}

const POINTER_BUTTONS = ["left", "middle", "right"] as const;

/** Shared pointer input fields (modifiers, button, click count) validated from CLI options. */
export function pointerInputFields({
	options,
	allowButton = false,
	allowClickCount = false,
}: {
	options: Pick<CLIRunOptions, "modifiers" | "button" | "clickCount">;
	allowButton?: boolean;
	allowClickCount?: boolean;
}):
	| {
			ok: true;
			fields: {
				modifiers?: AgentKeyboardModifier[];
				button?: AgentPointerButton;
				clickCount?: number;
			};
	  }
	| { ok: false; error: string } {
	const fields: {
		modifiers?: AgentKeyboardModifier[];
		button?: AgentPointerButton;
		clickCount?: number;
	} = {};
	if (options.modifiers !== undefined) {
		const modifiers = options.modifiers
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
		if (modifiers.length === 0) {
			return {
				ok: false,
				error: "--modifiers must list at least one modifier",
			};
		}
		// Aliases such as cmd or ctrl are normalized by the editor route.
		fields.modifiers = modifiers as AgentKeyboardModifier[];
	}
	if (options.button !== undefined) {
		if (!allowButton) {
			return {
				ok: false,
				error: "--button only applies to pointer click and drag",
			};
		}
		if (!(POINTER_BUTTONS as readonly string[]).includes(options.button)) {
			return {
				ok: false,
				error: `--button must be one of ${POINTER_BUTTONS.join(", ")} (got ${options.button})`,
			};
		}
		fields.button = options.button as AgentPointerButton;
	}
	if (options.clickCount !== undefined) {
		if (!allowClickCount) {
			return {
				ok: false,
				error: "--click-count only applies to pointer click",
			};
		}
		if (
			!Number.isInteger(options.clickCount) ||
			options.clickCount < 1 ||
			options.clickCount > 3
		) {
			return { ok: false, error: "--click-count must be 1, 2, or 3" };
		}
		fields.clickCount = options.clickCount;
	}
	return { ok: true, fields };
}

export function pointerInputMode({
	options,
}: {
	options: CLIRunOptions;
}): "background" | "foreground" {
	return options.foreground ? "foreground" : "background";
}

export async function requirePointerInputSupport({
	client,
	options,
}: {
	client: EditorApiClient;
	options: CLIRunOptions;
}): Promise<void> {
	if (options.foreground) return;
	await client.requireCapability(BACKGROUND_POINTER_CAPABILITY);
}

export type PointerTargetResult =
	| { ok: true; target: AgentPointerTarget }
	| { ok: false; error: string };

function buildCoordinateTarget({
	options,
	label,
}: {
	options: PointerTargetOptions;
	label: string;
}): PointerTargetResult {
	const ref = options.ref?.trim();
	const semanticTarget = options.target?.trim();
	const hasX = typeof options.x === "number" && Number.isFinite(options.x);
	const hasY = typeof options.y === "number" && Number.isFinite(options.y);
	const hasAnyCoordinate = options.x !== undefined || options.y !== undefined;
	const hasAnyNormalizedCoordinate =
		options.normalizedX !== undefined || options.normalizedY !== undefined;
	if (
		[
			Boolean(ref),
			Boolean(semanticTarget),
			hasAnyCoordinate,
			hasAnyNormalizedCoordinate,
		].filter(Boolean).length > 1
	) {
		return {
			ok: false,
			error: `${label} accepts either --ref or coordinates/semantic target, not both`,
		};
	}
	if (semanticTarget) {
		return {
			ok: false,
			error: `${label} semantic target '${semanticTarget}' must be resolved from the editor snapshot`,
		};
	}
	if (ref) return { ok: true, target: { ref } };
	if (hasX && hasY) {
		return { ok: true, target: { x: options.x, y: options.y } };
	}

	return {
		ok: false,
		error: `${label} requires --target, --ref, both --x and --y, or both normalized coordinates`,
	};
}

export async function getEditorSnapshot(
	client: EditorApiClient
): Promise<EditorSnapshotResult> {
	const snapshot = await client.get<EditorSnapshotResponse>(
		"/api/claude/snapshot",
		{
			interactive: "true",
			depth: "32",
			maxNodes: "8000",
			maxBytes: String(1024 * 1024),
		}
	);
	if (snapshot.truncated === true) {
		throw new Error(`Editor snapshot was truncated: ${snapshot.reason}`);
	}
	return snapshot;
}

function findSemanticTarget({
	snapshot,
	target,
}: {
	snapshot: EditorSnapshotResult;
	target: string;
}): EditorSnapshotElement | undefined {
	const normalized = target.trim();
	const testIds = resolveSemanticTargetTestIds({ target: normalized });
	return snapshot.elements.find(
		(element) =>
			element.bounds.width > 0 &&
			element.bounds.height > 0 &&
			element.testId !== null &&
			testIds.includes(element.testId)
	);
}

export async function waitForSemanticTarget({
	client,
	target,
	timeoutMs = 5000,
	intervalMs = 100,
}: {
	client: EditorApiClient;
	target: string;
	timeoutMs?: number;
	intervalMs?: number;
}): Promise<EditorSnapshotElement> {
	const startedAt = Date.now();
	while (Date.now() - startedAt <= Math.max(1, timeoutMs)) {
		const snapshot = await getEditorSnapshot(client);
		const matched = findSemanticTarget({ snapshot, target });
		if (matched) return matched;
		await sleep(Math.max(20, intervalMs));
	}
	const supported = Object.keys(SEMANTIC_TARGET_TEST_IDS).join(", ");
	throw new Error(
		`Semantic target '${target}' did not appear within ${timeoutMs}ms. Supported targets: ${supported}; custom test IDs use testid:<id>.`
	);
}

export async function resolvePointerTarget({
	client,
	options,
	label,
	timeoutMs,
}: {
	client: EditorApiClient;
	options: PointerTargetOptions;
	label: string;
	timeoutMs?: number;
}): Promise<PointerTargetResult> {
	const semanticTarget = options.target?.trim();
	const ref = options.ref?.trim();
	const hasCoordinates = options.x !== undefined || options.y !== undefined;
	const hasNormalized =
		options.normalizedX !== undefined || options.normalizedY !== undefined;
	if (
		[
			Boolean(semanticTarget),
			Boolean(ref),
			hasCoordinates,
			hasNormalized,
		].filter(Boolean).length > 1
	) {
		return {
			ok: false,
			error: `${label} accepts either --ref or coordinates/semantic target, not both`,
		};
	}
	if (semanticTarget) {
		try {
			const element = await waitForSemanticTarget({
				client,
				target: semanticTarget,
				timeoutMs,
			});
			return { ok: true, target: { ref: element.ref } };
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
	if (hasNormalized) {
		const x = options.normalizedX;
		const y = options.normalizedY;
		if (
			typeof x !== "number" ||
			!Number.isFinite(x) ||
			typeof y !== "number" ||
			!Number.isFinite(y) ||
			x < 0 ||
			x > 1 ||
			y < 0 ||
			y > 1
		) {
			return {
				ok: false,
				error: `${label} normalized coordinates must include X and Y values from 0 to 1`,
			};
		}
		const snapshot = await getEditorSnapshot(client);
		if (!snapshot.viewport?.width || !snapshot.viewport.height) {
			return {
				ok: false,
				error:
					"The running QCut instance does not report viewport dimensions; update QCut or use --x/--y.",
			};
		}
		return {
			ok: true,
			target: {
				x: Math.min(
					snapshot.viewport.width - 1,
					Math.max(0, Math.round(x * snapshot.viewport.width))
				),
				y: Math.min(
					snapshot.viewport.height - 1,
					Math.max(0, Math.round(y * snapshot.viewport.height))
				),
			},
		};
	}
	return buildCoordinateTarget({ options, label });
}

export function speedMultiplier(options: Pick<CLIRunOptions, "speed">): number {
	const speed = options.speed ?? 1;
	if (!Number.isFinite(speed) || speed <= 0) {
		throw new Error("--speed must be greater than 0");
	}
	return speed;
}

export function scaledDuration(
	durationMs: number | undefined,
	speed: number,
	fallback: number
): number {
	return Math.max(0, (durationMs ?? fallback) / speed);
}

export async function captureFailureScreenshot(
	client: EditorApiClient
): Promise<unknown | undefined> {
	try {
		return await client.post("/api/claude/screenshot/capture", {
			fileName: `qcut-automation-failure-${Date.now()}.png`,
		});
	} catch {
		return undefined;
	}
}

export async function waitForEditorUi({
	client,
	options,
}: {
	client: EditorApiClient;
	options: UiWaitOptions;
}): Promise<CLIResult> {
	if (!options.ref && !options.text && options.value === undefined) {
		return {
			success: false,
			error: "UI wait requires --ref, --text, or --value",
		};
	}
	if (options.value !== undefined && !options.ref) {
		return {
			success: false,
			error:
				"UI value waits require --ref to avoid matching an unrelated control",
		};
	}
	const startedAt = Date.now();
	const timeoutMs = Math.max(1, options.timeoutMs ?? 5000);
	const intervalMs = Math.max(20, options.intervalMs ?? 100);
	while (Date.now() - startedAt <= timeoutMs) {
		const snapshot = await getEditorSnapshot(client);
		const matched = snapshot.elements.find((element) => {
			if (options.ref && element.ref !== options.ref) return false;
			if (
				options.text &&
				![element.name, element.textPreview]
					.filter((value): value is string => typeof value === "string")
					.some((value) => value.includes(options.text!))
			) {
				return false;
			}
			if (options.value !== undefined && element.value !== options.value) {
				return false;
			}
			return true;
		});
		if (matched) {
			return {
				success: true,
				data: { matched, elapsedMs: Date.now() - startedAt },
			};
		}
		await sleep(intervalMs);
	}
	const screenshot = await captureFailureScreenshot(client);
	return {
		success: false,
		error: `UI wait timed out after ${timeoutMs}ms`,
		data: { screenshot },
	};
}

export async function waitForRequestedState({
	client,
	value,
	timeoutMs,
	intervalMs,
	projectId,
}: {
	client: EditorApiClient;
	value: string;
	timeoutMs?: number;
	intervalMs?: number;
	projectId?: string;
}): Promise<CLIResult> {
	if (value === "preview.ready" || value === "preview.frame-ready") {
		try {
			const readiness = await ensureEditorPreviewReady({
				client,
				projectId,
				timeoutMs,
				intervalMs,
			});
			return { success: true, data: readiness };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
	if (isSemanticTarget({ target: value })) {
		try {
			const matched = await waitForSemanticTarget({
				client,
				target: value,
				timeoutMs,
				intervalMs,
			});
			return { success: true, data: { matched } };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
	return await waitForEditorUi({
		client,
		options: { text: value, timeoutMs, intervalMs },
	});
}

export async function materializeTargetPoint({
	client,
	target,
}: {
	client: EditorApiClient;
	target: AgentPointerTarget;
}): Promise<{ x: number; y: number }> {
	if (
		typeof target.x === "number" &&
		Number.isFinite(target.x) &&
		typeof target.y === "number" &&
		Number.isFinite(target.y)
	) {
		return { x: target.x, y: target.y };
	}
	if (target.ref) {
		const snapshot = await getEditorSnapshot(client);
		const element = snapshot.elements.find(
			(candidate) => candidate.ref === target.ref
		);
		if (!element) throw new Error(`Snapshot ref not found: ${target.ref}`);
		return {
			x: element.bounds.x + element.bounds.width / 2,
			y: element.bounds.y + element.bounds.height / 2,
		};
	}
	throw new Error("Pointer target does not contain coordinates or a ref");
}

export function numberValue(
	action: Record<string, unknown>,
	key: string
): number | undefined {
	const value = action[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function stringValue(
	action: Record<string, unknown>,
	key: string
): string | undefined {
	const value = action[key];
	return typeof value === "string" ? value : undefined;
}

/** Sequence actions may spell modifiers as an array or a comma-separated string. */
export function modifiersValue(
	action: Record<string, unknown>
): string | undefined {
	const raw = action.modifiers;
	if (Array.isArray(raw)) {
		const entries = raw.filter(
			(entry): entry is string => typeof entry === "string"
		);
		return entries.length > 0 ? entries.join(",") : undefined;
	}
	return stringValue(action, "modifiers");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
