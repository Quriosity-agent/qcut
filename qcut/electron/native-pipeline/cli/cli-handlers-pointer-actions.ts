/**
 * Single pointer, keyboard, hit-test, and file-drop CLI actions.
 *
 * @module electron/native-pipeline/cli/cli-handlers-pointer-actions
 */

import { existsSync } from "node:fs";
import path from "node:path";
import type {
	AgentPointerDragRequest,
	AgentPointerScrollRequest,
	AgentPointerTarget,
} from "../../types/claude-api.js";
import type { EditorApiClient } from "../editor/editor-api-client.js";
import { resolveJsonInput } from "../editor/editor-api-types.js";
import type { CLIRunOptions, CLIResult } from "./cli-runner/types.js";
import {
	sleep,
	HTML5_DRAG_CAPABILITY,
	parseDragMode,
	pointerInputFields,
	pointerInputMode,
	requirePointerInputSupport,
	type PointerTargetResult,
	getEditorSnapshot,
	waitForSemanticTarget,
	resolvePointerTarget,
	speedMultiplier,
	scaledDuration,
	captureFailureScreenshot,
	waitForRequestedState,
	materializeTargetPoint,
	numberValue,
	stringValue,
} from "./cli-handlers-pointer-targets.js";
import {
	type ListDragContext,
	findSnapshotElement,
	resolveListDragContext,
} from "./cli-handlers-pointer-list-drag.js";

export async function postTargetAction({
	client,
	options,
	action,
}: {
	client: EditorApiClient;
	options: CLIRunOptions;
	action: "move" | "hover" | "click" | "double-click" | "right-click";
}): Promise<CLIResult> {
	const target = await resolvePointerTarget({
		client,
		options: {
			target: options.target,
			ref: options.ref,
			x: options.x,
			y: options.y,
			normalizedX: options.normalizedX,
			normalizedY: options.normalizedY,
		},
		label: `Pointer ${action}`,
		timeoutMs: options.timeoutMs,
	});
	if (!target.ok) return { success: false, error: target.error };
	const inputFields = pointerInputFields({
		options,
		allowButton: action === "click",
		allowClickCount: action === "click",
	});
	if (!inputFields.ok) return { success: false, error: inputFields.error };

	await requirePointerInputSupport({ client, options });
	const speed = speedMultiplier(options);
	const data = await client.post(`/api/claude/pointer/${action}`, {
		...target.target,
		inputMode: pointerInputMode({ options }),
		...(options.speed !== undefined || options.durationMs !== undefined
			? { durationMs: scaledDuration(options.durationMs, speed, 220) }
			: {}),
		...inputFields.fields,
	});
	if (options.waitFor) {
		const waited = await waitForRequestedState({
			client,
			value: options.waitFor,
			timeoutMs: options.timeoutMs,
			intervalMs: options.intervalMs,
			projectId: options.projectId,
		});
		if (!waited.success) return waited;
	}
	return { success: true, data };
}

async function handleSemanticTimelineSeek({
	client,
	options,
	from,
}: {
	client: EditorApiClient;
	options: CLIRunOptions;
	from: AgentPointerTarget;
}): Promise<CLIResult> {
	if (
		typeof options.toTime !== "number" ||
		!Number.isFinite(options.toTime) ||
		options.toTime < 0
	) {
		return { success: false, error: "--to-time must be a number >= 0" };
	}
	const navigator = await client.get<{ activeProjectId?: string | null }>(
		"/api/claude/navigator/projects"
	);
	const projectId = options.projectId ?? navigator.activeProjectId ?? undefined;
	if (!projectId) {
		return {
			success: false,
			error: "No active project; pass --project-id for --to-time",
		};
	}
	const speed = speedMultiplier(options);
	const fromPoint = await materializeTargetPoint({ client, target: from });
	const operation = await client.post(
		`/api/claude/timeline/${encodeURIComponent(projectId)}/playback`,
		{ action: "seek", time: options.toTime }
	);
	await sleep(Math.max(20, 120 / speed));
	const playhead = await waitForSemanticTarget({
		client,
		target: "timeline.playhead",
		timeoutMs: options.timeoutMs,
	});
	const toPoint = {
		x: playhead.bounds.x + playhead.bounds.width / 2,
		y: playhead.bounds.y + playhead.bounds.height / 2,
	};
	await requirePointerInputSupport({ client, options });
	const inputMode = pointerInputMode({ options });
	const animationStart = await client.post("/api/claude/pointer/move", {
		...fromPoint,
		inputMode,
		durationMs: scaledDuration(undefined, speed, 120),
	});
	const animationEnd = await client.post("/api/claude/pointer/move", {
		...toPoint,
		inputMode,
		durationMs: scaledDuration(options.durationMs, speed, 450),
	});
	return {
		success: true,
		data: {
			projectId,
			time: options.toTime,
			operation,
			animation: {
				type: "display-only",
				from: fromPoint,
				to: toPoint,
				start: animationStart,
				end: animationEnd,
			},
		},
	};
}

export async function handleDrag({
	client,
	options,
}: {
	client: EditorApiClient;
	options: CLIRunOptions;
}): Promise<CLIResult> {
	if (options.waitFor) {
		const waited = await waitForRequestedState({
			client,
			value: options.waitFor,
			timeoutMs: options.timeoutMs,
			intervalMs: options.intervalMs,
			projectId: options.projectId,
		});
		if (!waited.success) return waited;
	}
	let from = await resolvePointerTarget({
		client,
		options: {
			target: options.from,
			ref: options.fromRef,
			x: options.fromX,
			y: options.fromY,
			normalizedX: options.fromNormalizedX,
			normalizedY: options.fromNormalizedY,
		},
		label: "Pointer drag start",
		timeoutMs: options.timeoutMs,
	});
	if (!from.ok) return { success: false, error: from.error };
	if (options.toTime !== undefined) {
		return await handleSemanticTimelineSeek({
			client,
			options,
			from: from.target,
		});
	}

	let listContext: ListDragContext | undefined;
	let to: PointerTargetResult;
	if (options.toIndex !== undefined) {
		if (!options.fromRef) {
			return { success: false, error: "--to-index requires --from-ref" };
		}
		try {
			const snapshot = await getEditorSnapshot(client);
			listContext = resolveListDragContext({
				elements: snapshot.elements,
				fromRef: options.fromRef,
				toIndex: options.toIndex,
			});
			from = { ok: true, target: { ref: listContext.source.ref } };
			to = { ok: true, target: listContext.destination };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	} else {
		to = await resolvePointerTarget({
			client,
			options: {
				target: options.to,
				ref: options.toRef,
				x: options.toX,
				y: options.toY,
				normalizedX: options.toNormalizedX,
				normalizedY: options.toNormalizedY,
			},
			label: "Pointer drag destination",
			timeoutMs: options.timeoutMs,
		});
		if (!to.ok) return { success: false, error: to.error };
	}

	let via: AgentPointerTarget[] | undefined;
	if (options.via) {
		const parsed = await resolveJsonInput(options.via);
		if (!Array.isArray(parsed)) {
			return { success: false, error: "--via must be a JSON array" };
		}
		via = [];
		for (const [index, entry] of parsed.entries()) {
			if (typeof entry !== "object" || entry === null) {
				return {
					success: false,
					error: `--via target ${index} must be an object`,
				};
			}
			// Waypoints accept the same spellings as --from/--to: semantic targets,
			// refs, viewport coordinates, or normalized ratios.
			const waypoint = entry as Record<string, unknown>;
			const resolved = await resolvePointerTarget({
				client,
				options: {
					target: stringValue(waypoint, "target"),
					ref: stringValue(waypoint, "ref"),
					x: numberValue(waypoint, "x"),
					y: numberValue(waypoint, "y"),
					normalizedX: numberValue(waypoint, "normalizedX"),
					normalizedY: numberValue(waypoint, "normalizedY"),
				},
				label: `Pointer drag waypoint ${index}`,
				timeoutMs: options.timeoutMs,
			});
			if (!resolved.ok) return { success: false, error: resolved.error };
			via.push(resolved.target);
		}
	}

	const dragMode = parseDragMode({ value: options.dnd });
	if (!dragMode.ok) return { success: false, error: dragMode.error };
	const inputFields = pointerInputFields({ options, allowButton: true });
	if (!inputFields.ok) return { success: false, error: inputFields.error };
	if (dragMode.mode === "html5" && options.foreground) {
		return {
			success: false,
			error:
				"--dnd html5 needs background input; drop --foreground or use --dnd mouse",
		};
	}

	const speed = speedMultiplier(options);
	const request: AgentPointerDragRequest = {
		from: from.target,
		to: to.target,
		inputMode: pointerInputMode({ options }),
		via,
		holdMs: scaledDuration(options.holdMs, speed, 120),
		durationMs: scaledDuration(options.durationMs, speed, 450),
		steps: options.steps ?? 24,
		releaseDelayMs: scaledDuration(options.releaseDelayMs, speed, 100),
		...(dragMode.mode ? { dnd: dragMode.mode } : {}),
		...inputFields.fields,
	};
	await requirePointerInputSupport({ client, options });
	if (dragMode.mode === "html5") {
		await client.requireCapability(HTML5_DRAG_CAPABILITY);
	}
	const data = await client.post("/api/claude/pointer/drag", request);

	if (
		listContext &&
		options.verify !== false &&
		options.toIndex !== undefined
	) {
		await sleep(120);
		const after = await getEditorSnapshot(client);
		try {
			const sourceAfterDrag = findSnapshotElement({
				elements: after.elements,
				source: listContext.source,
			});
			if (!sourceAfterDrag) {
				throw new Error("dragged item is no longer present in the UI snapshot");
			}
			const verified = resolveListDragContext({
				elements: after.elements,
				fromRef: sourceAfterDrag.ref,
				toIndex: options.toIndex,
			});
			if (verified.sourceIndex !== options.toIndex) {
				const screenshot = await captureFailureScreenshot(client);
				return {
					success: false,
					error: `Drag verification failed: expected index ${options.toIndex}, got ${verified.sourceIndex}`,
					data: { pointer: data, screenshot },
				};
			}
		} catch (error) {
			const screenshot = await captureFailureScreenshot(client);
			return {
				success: false,
				error: `Drag verification failed: ${error instanceof Error ? error.message : String(error)}`,
				data: { pointer: data, screenshot },
			};
		}
	}
	return { success: true, data };
}

export async function handleScroll({
	client,
	options,
}: {
	client: EditorApiClient;
	options: CLIRunOptions;
}): Promise<CLIResult> {
	const hasDeltaX =
		typeof options.deltaX === "number" && Number.isFinite(options.deltaX);
	const hasDeltaY =
		typeof options.deltaY === "number" && Number.isFinite(options.deltaY);
	if (!hasDeltaX && !hasDeltaY) {
		return {
			success: false,
			error: "Pointer scroll requires --delta-x <number> or --delta-y <number>",
		};
	}

	const inputFields = pointerInputFields({ options });
	if (!inputFields.ok) return { success: false, error: inputFields.error };
	const request: AgentPointerScrollRequest = {
		inputMode: pointerInputMode({ options }),
		...(hasDeltaX ? { deltaX: options.deltaX } : {}),
		...(hasDeltaY ? { deltaY: options.deltaY } : {}),
		...inputFields.fields,
	};
	const hasTargetOption =
		options.target !== undefined ||
		options.ref !== undefined ||
		options.x !== undefined ||
		options.y !== undefined ||
		options.normalizedX !== undefined ||
		options.normalizedY !== undefined;
	if (hasTargetOption) {
		const target = await resolvePointerTarget({
			client,
			options: {
				target: options.target,
				ref: options.ref,
				x: options.x,
				y: options.y,
				normalizedX: options.normalizedX,
				normalizedY: options.normalizedY,
			},
			label: "Pointer scroll target",
			timeoutMs: options.timeoutMs,
		});
		if (!target.ok) return { success: false, error: target.error };
		Object.assign(request, target.target);
	}

	await requirePointerInputSupport({ client, options });
	const data = await client.post("/api/claude/pointer/scroll", request);
	return { success: true, data };
}

export async function handleKeyboardCommand({
	client,
	options,
}: {
	client: EditorApiClient;
	options: CLIRunOptions;
}): Promise<CLIResult> {
	const action = options.command.split(":")[2];
	await requirePointerInputSupport({ client, options });
	if (action === "press") {
		const keys = options.keys
			?.split(",")
			.map((key) => key.trim())
			.filter(Boolean);
		if (!keys?.length) {
			return { success: false, error: "Keyboard press requires --keys" };
		}
		const data = await client.post("/api/claude/keyboard/press", {
			keys,
			intervalMs: options.intervalMs,
			inputMode: pointerInputMode({ options }),
		});
		return { success: true, data };
	}
	if (action === "type") {
		if (options.text === undefined) {
			return { success: false, error: "Keyboard type requires --text" };
		}
		const data = await client.post("/api/claude/keyboard/type", {
			text: options.text,
			intervalMs: options.intervalMs,
			inputMode: pointerInputMode({ options }),
			...(options.keyEvents ? { keyEvents: true } : {}),
		});
		return { success: true, data };
	}
	return {
		success: false,
		error: `Unknown keyboard action: ${action ?? ""}. Available: press, type`,
	};
}

/** Drop local files on a target as an external HTML5 file drop. */
export async function handleDropFiles({
	client,
	options,
}: {
	client: EditorApiClient;
	options: CLIRunOptions;
}): Promise<CLIResult> {
	const files = options.files
		?.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => path.resolve(entry));
	if (!files?.length) {
		return {
			success: false,
			error: "Pointer drop-files requires --files <path[,path...]>",
		};
	}
	for (const file of files) {
		if (!existsSync(file)) {
			return { success: false, error: `Dropped file not found: ${file}` };
		}
	}
	if (options.foreground) {
		return {
			success: false,
			error: "drop-files needs background input; drop --foreground",
		};
	}
	const target = await resolvePointerTarget({
		client,
		options: {
			target: options.target,
			ref: options.ref,
			x: options.x,
			y: options.y,
			normalizedX: options.normalizedX,
			normalizedY: options.normalizedY,
		},
		label: "Pointer drop-files target",
		timeoutMs: options.timeoutMs,
	});
	if (!target.ok) return { success: false, error: target.error };
	const inputFields = pointerInputFields({ options });
	if (!inputFields.ok) return { success: false, error: inputFields.error };

	await requirePointerInputSupport({ client, options });
	await client.requireCapability(HTML5_DRAG_CAPABILITY);
	const speed = speedMultiplier(options);
	const data = await client.post("/api/claude/pointer/drop-files", {
		...target.target,
		files,
		inputMode: pointerInputMode({ options }),
		...(options.speed !== undefined || options.durationMs !== undefined
			? { durationMs: scaledDuration(options.durationMs, speed, 220) }
			: {}),
		...inputFields.fields,
	});
	if (options.waitFor) {
		const waited = await waitForRequestedState({
			client,
			value: options.waitFor,
			timeoutMs: options.timeoutMs,
			intervalMs: options.intervalMs,
			projectId: options.projectId,
		});
		if (!waited.success) return waited;
	}
	return { success: true, data };
}

/** Report what the editor renders under a target without dispatching input. */
export async function handleHitTest({
	client,
	options,
}: {
	client: EditorApiClient;
	options: CLIRunOptions;
}): Promise<CLIResult> {
	const target = await resolvePointerTarget({
		client,
		options: {
			target: options.target,
			ref: options.ref,
			x: options.x,
			y: options.y,
			normalizedX: options.normalizedX,
			normalizedY: options.normalizedY,
		},
		label: "Pointer hit-test",
		timeoutMs: options.timeoutMs,
	});
	if (!target.ok) return { success: false, error: target.error };
	let point: { x: number; y: number };
	try {
		point = await materializeTargetPoint({ client, target: target.target });
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	const data = await client.post("/api/claude/pointer/hit-test", point);
	return { success: true, data };
}
