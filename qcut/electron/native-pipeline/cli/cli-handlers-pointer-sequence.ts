/**
 * Pointer action sequences with optional screen recording and event tracks.
 *
 * @module electron/native-pipeline/cli/cli-handlers-pointer-sequence
 */

import path from "node:path";
import type { EditorApiClient } from "../editor/editor-api-client.js";
import { resolveJsonInput } from "../editor/editor-api-types.js";
import type { CLIRunOptions, CLIResult } from "./cli-runner/types.js";
import {
	sleep,
	getEditorSnapshot,
	speedMultiplier,
	captureFailureScreenshot,
	waitForEditorUi,
	waitForRequestedState,
	numberValue,
	stringValue,
	modifiersValue,
	isRecord,
} from "./cli-handlers-pointer-targets.js";
import {
	postTargetAction,
	handleDrag,
	handleScroll,
	handleKeyboardCommand,
	handleDropFiles,
} from "./cli-handlers-pointer-actions.js";

async function executeSequenceAction({
	client,
	baseOptions,
	action,
}: {
	client: EditorApiClient;
	baseOptions: CLIRunOptions;
	action: Record<string, unknown>;
}): Promise<CLIResult> {
	const name = stringValue(action, "action") ?? stringValue(action, "type");
	if (!name)
		return { success: false, error: "Sequence action is missing 'action'" };
	const foreground =
		typeof action.foreground === "boolean"
			? action.foreground
			: baseOptions.foreground;
	const speed = numberValue(action, "speed") ?? speedMultiplier(baseOptions);
	if (!Number.isFinite(speed) || speed <= 0) {
		return { success: false, error: "Sequence action speed must be > 0" };
	}
	const actionOptions: CLIRunOptions = {
		...baseOptions,
		foreground,
		speed,
		waitFor: undefined,
		timeoutMs: numberValue(action, "timeoutMs") ?? baseOptions.timeoutMs,
	};

	if (
		["move", "hover", "click", "double-click", "right-click"].includes(name)
	) {
		return postTargetAction({
			client,
			options: {
				...actionOptions,
				target: stringValue(action, "target"),
				ref: stringValue(action, "ref"),
				x: numberValue(action, "x"),
				y: numberValue(action, "y"),
				normalizedX: numberValue(action, "normalizedX"),
				normalizedY: numberValue(action, "normalizedY"),
				modifiers: modifiersValue(action),
				button: stringValue(action, "button"),
				clickCount: numberValue(action, "clickCount"),
			},
			action: name as
				| "move"
				| "hover"
				| "click"
				| "double-click"
				| "right-click",
		});
	}

	if (name === "drag") {
		const from = isRecord(action.from) ? action.from : {};
		const to = isRecord(action.to) ? action.to : {};
		return handleDrag({
			client,
			options: {
				...actionOptions,
				from:
					stringValue(action, "fromTarget") ??
					stringValue(action, "from") ??
					stringValue(from, "target"),
				fromRef: stringValue(action, "fromRef") ?? stringValue(from, "ref"),
				fromX: numberValue(action, "fromX") ?? numberValue(from, "x"),
				fromY: numberValue(action, "fromY") ?? numberValue(from, "y"),
				fromNormalizedX:
					numberValue(action, "fromNormalizedX") ??
					numberValue(from, "normalizedX"),
				fromNormalizedY:
					numberValue(action, "fromNormalizedY") ??
					numberValue(from, "normalizedY"),
				to:
					stringValue(action, "toTarget") ??
					stringValue(action, "to") ??
					stringValue(to, "target"),
				toRef: stringValue(action, "toRef") ?? stringValue(to, "ref"),
				toX: numberValue(action, "toX") ?? numberValue(to, "x"),
				toY: numberValue(action, "toY") ?? numberValue(to, "y"),
				toNormalizedX:
					numberValue(action, "toNormalizedX") ??
					numberValue(to, "normalizedX"),
				toNormalizedY:
					numberValue(action, "toNormalizedY") ??
					numberValue(to, "normalizedY"),
				toTime: numberValue(action, "toTime"),
				toIndex: numberValue(action, "toIndex"),
				via: Array.isArray(action.via) ? JSON.stringify(action.via) : undefined,
				holdMs: numberValue(action, "holdMs"),
				durationMs: numberValue(action, "durationMs"),
				steps: numberValue(action, "steps"),
				releaseDelayMs: numberValue(action, "releaseDelayMs"),
				dnd: stringValue(action, "dnd"),
				modifiers: modifiersValue(action),
				button: stringValue(action, "button"),
				verify:
					typeof action.verify === "boolean"
						? action.verify
						: baseOptions.verify,
			},
		});
	}

	if (name === "scroll") {
		return handleScroll({
			client,
			options: {
				...actionOptions,
				target: stringValue(action, "target"),
				ref: stringValue(action, "ref"),
				x: numberValue(action, "x"),
				y: numberValue(action, "y"),
				normalizedX: numberValue(action, "normalizedX"),
				normalizedY: numberValue(action, "normalizedY"),
				deltaX: numberValue(action, "deltaX"),
				deltaY: numberValue(action, "deltaY"),
				modifiers: modifiersValue(action),
			},
		});
	}

	if (name === "hide") {
		const data = await client.post("/api/claude/pointer/hide", {});
		return { success: true, data };
	}

	if (name === "drop-files") {
		const files = Array.isArray(action.files)
			? action.files
					.filter((file): file is string => typeof file === "string")
					.join(",")
			: stringValue(action, "files");
		return handleDropFiles({
			client,
			options: {
				...actionOptions,
				files,
				target: stringValue(action, "target"),
				ref: stringValue(action, "ref"),
				x: numberValue(action, "x"),
				y: numberValue(action, "y"),
				normalizedX: numberValue(action, "normalizedX"),
				normalizedY: numberValue(action, "normalizedY"),
				modifiers: modifiersValue(action),
			},
		});
	}

	if (name === "press" || name === "keyboard:press") {
		const keys = Array.isArray(action.keys)
			? action.keys
					.filter((key): key is string => typeof key === "string")
					.join(",")
			: stringValue(action, "keys");
		return handleKeyboardCommand({
			client,
			options: {
				...actionOptions,
				command: "editor:keyboard:press",
				keys,
				intervalMs: (numberValue(action, "intervalMs") ?? 45) / speed,
			},
		});
	}

	if (name === "type" || name === "keyboard:type") {
		return handleKeyboardCommand({
			client,
			options: {
				...actionOptions,
				command: "editor:keyboard:type",
				text: stringValue(action, "text"),
				keyEvents: action.keyEvents === true,
				intervalMs:
					numberValue(action, "intervalMs") === undefined
						? undefined
						: numberValue(action, "intervalMs")! / speed,
			},
		});
	}

	if (name === "wait") {
		const semanticTarget = stringValue(action, "target");
		if (semanticTarget) {
			return await waitForRequestedState({
				client,
				value: semanticTarget,
				timeoutMs: numberValue(action, "timeoutMs"),
				intervalMs: numberValue(action, "intervalMs"),
				projectId: stringValue(action, "projectId") ?? baseOptions.projectId,
			});
		}
		return waitForEditorUi({
			client,
			options: {
				ref: stringValue(action, "ref"),
				text: stringValue(action, "text"),
				value: stringValue(action, "value"),
				timeoutMs: numberValue(action, "timeoutMs"),
				intervalMs: numberValue(action, "intervalMs"),
			},
		});
	}

	if (name === "sleep") {
		const durationMs = numberValue(action, "durationMs") ?? 0;
		const scaledMs = Math.max(0, durationMs / speed);
		await sleep(scaledMs);
		return { success: true, data: { durationMs: scaledMs } };
	}

	if (name === "seek" || name === "timeline:seek") {
		const time = numberValue(action, "time");
		if (time === undefined || time < 0) {
			return { success: false, error: "Seek action requires time >= 0" };
		}
		const navigator = await client.get<{ activeProjectId?: string | null }>(
			"/api/claude/navigator/projects"
		);
		const projectId =
			stringValue(action, "projectId") ??
			baseOptions.projectId ??
			navigator.activeProjectId ??
			undefined;
		if (!projectId) {
			return { success: false, error: "Seek action has no active project" };
		}
		const data = await client.post(
			`/api/claude/timeline/${encodeURIComponent(projectId)}/playback`,
			{ action: "seek", time }
		);
		return { success: true, data: { projectId, time, operation: data } };
	}

	if (name === "switch-panel") {
		const panel = stringValue(action, "panel");
		if (!panel) {
			return { success: false, error: "switch-panel requires panel" };
		}
		const data = await client.post("/api/claude/ui/switch-panel", {
			panel,
			...(stringValue(action, "tab")
				? { tab: stringValue(action, "tab") }
				: {}),
		});
		return { success: true, data };
	}

	if (name === "snapshot") {
		return { success: true, data: await getEditorSnapshot(client) };
	}

	if (name === "hide") {
		const data = await client.post("/api/claude/pointer/hide", {});
		return { success: true, data };
	}

	return { success: false, error: `Unsupported sequence action: ${name}` };
}

async function runSequenceAction({
	client,
	baseOptions,
	action,
}: {
	client: EditorApiClient;
	baseOptions: CLIRunOptions;
	action: Record<string, unknown>;
}): Promise<CLIResult> {
	const result = await executeSequenceAction({ client, baseOptions, action });
	const waitFor = stringValue(action, "waitFor");
	if (!result.success || !waitFor) return result;

	const waited = await waitForRequestedState({
		client,
		value: waitFor,
		timeoutMs: numberValue(action, "timeoutMs") ?? baseOptions.timeoutMs,
		intervalMs: numberValue(action, "intervalMs") ?? baseOptions.intervalMs,
		projectId: stringValue(action, "projectId") ?? baseOptions.projectId,
	});
	if (!waited.success) {
		return {
			success: false,
			error: `Action completed, but waitFor '${waitFor}' failed: ${waited.error}`,
			data: { action: result.data, waitFor: waited.data },
		};
	}
	return {
		success: true,
		data: { action: result.data, waitFor: waited.data },
	};
}

async function resolveRecordingOutputPath({
	requestedPath,
}: {
	requestedPath: string;
}): Promise<string> {
	const path = await import("node:path");
	const extension = path.extname(requestedPath).toLowerCase();
	if (extension && extension !== ".mp4") {
		throw new Error("Pointer sequence recordings must use the .mp4 extension");
	}
	return path.resolve(extension ? requestedPath : `${requestedPath}.mp4`);
}

async function moveRecordingToRequestedPath({
	recording,
	outputPath,
}: {
	recording: unknown;
	outputPath: string;
}): Promise<unknown> {
	if (!isRecord(recording) || typeof recording.filePath !== "string") {
		return recording;
	}
	const path = await import("node:path");
	const fs = await import("node:fs/promises");
	const sourcePath = path.resolve(recording.filePath);
	if (sourcePath === outputPath) return recording;

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.rm(outputPath, { force: true });
	try {
		await fs.rename(sourcePath, outputPath);
	} catch (error) {
		if (!isRecord(error) || error.code !== "EXDEV") throw error;
		await fs.copyFile(sourcePath, outputPath);
		await fs.unlink(sourcePath);
	}
	return { ...recording, filePath: outputPath };
}

async function stopSequenceRecording({
	client,
	outputPath,
}: {
	client: EditorApiClient;
	outputPath: string;
}): Promise<unknown> {
	const recording = await client.post("/api/claude/screen-recording/stop", {});
	return await moveRecordingToRequestedPath({ recording, outputPath });
}

async function writePointerEventTrack({
	requestedPath,
	captureStartedAt,
	sequenceStartedAt,
	endedAt,
	prerollMs,
	postrollMs,
	speed,
	skipIdle,
	events,
}: {
	requestedPath: string;
	captureStartedAt: number;
	sequenceStartedAt: number;
	endedAt: number;
	prerollMs: number;
	postrollMs: number;
	speed: number;
	skipIdle: boolean;
	events: Array<Record<string, unknown>>;
}): Promise<string> {
	const path = await import("node:path");
	const fs = await import("node:fs/promises");
	const outputPath = path.resolve(requestedPath);
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(
		outputPath,
		JSON.stringify(
			{
				version: 2,
				kind: "qcut-pointer-event-track",
				startedAt: new Date(captureStartedAt).toISOString(),
				sequenceStartedAt: new Date(sequenceStartedAt).toISOString(),
				durationMs: Math.max(0, endedAt - captureStartedAt),
				prerollMs,
				postrollMs,
				speed,
				skipIdle,
				events,
			},
			null,
			2
		),
		"utf8"
	);
	return outputPath;
}

export async function runPointerSequence({
	client,
	options,
}: {
	client: EditorApiClient;
	options: CLIRunOptions;
}): Promise<CLIResult> {
	if (!options.actions) return { success: false, error: "Missing --actions" };
	const parsed = await resolveJsonInput(options.actions);
	const actions = Array.isArray(parsed)
		? parsed
		: isRecord(parsed) && Array.isArray(parsed.actions)
			? parsed.actions
			: undefined;
	if (!actions)
		return { success: false, error: "--actions must be a JSON array" };

	let recordingStarted = false;
	let recordingStart: unknown;
	let recording: unknown;
	let recordingOutputPath: string | undefined;
	let eventTrackOutputPath = options.eventTrack;
	let captureStartedAt: number | undefined;
	let appliedPrerollMs = 0;
	let appliedPostrollMs = 0;
	if (options.record) {
		const path = await import("node:path");
		recordingOutputPath = await resolveRecordingOutputPath({
			requestedPath: options.record,
		});
		eventTrackOutputPath ??= path.join(
			path.dirname(recordingOutputPath),
			`${path.basename(
				recordingOutputPath,
				path.extname(recordingOutputPath)
			)}.pointer.json`
		);
		recordingStart = await client.post("/api/claude/screen-recording/start", {
			fileName: path.basename(recordingOutputPath),
			captureMode: "editor",
			recordingQuality: options.recordingQuality ?? "native",
		});
		recordingStarted = true;
		if (isRecord(recordingStart)) {
			captureStartedAt =
				numberValue(recordingStart, "captureStartedAt") ??
				numberValue(recordingStart, "startedAt");
		}
		appliedPrerollMs = Math.max(0, options.prerollMs ?? 0);
		if (appliedPrerollMs > 0) await sleep(appliedPrerollMs);
	}

	const results: Array<{ index: number; action: unknown; result: CLIResult }> =
		[];
	const events: Array<Record<string, unknown>> = [];
	const sequenceStartedAt = Date.now();
	const eventTrackStartedAt = captureStartedAt ?? sequenceStartedAt;
	const speed = speedMultiplier(options);
	let activeRef: string | undefined;
	try {
		for (const [index, action] of actions.entries()) {
			if (!isRecord(action)) {
				throw new Error(`Action ${index} must be an object`);
			}
			const actionName =
				stringValue(action, "action") ?? stringValue(action, "type");
			const contextualAction =
				actionName === "wait" &&
				typeof action.value === "string" &&
				typeof action.ref !== "string" &&
				activeRef
					? { ...action, ref: activeRef }
					: action;
			const actionStartedAt = Date.now();
			const skipped =
				options.skipIdle === true &&
				(actionName === "sleep" || action.idle === true);
			const result = skipped
				? {
						success: true,
						data: { skipped: true, reason: "skip-idle" },
					}
				: await runSequenceAction({
						client,
						baseOptions: { ...options, speed },
						action: contextualAction,
					});
			results.push({ index, action: action.action ?? action.type, result });
			events.push({
				index,
				action: actionName,
				startMs: actionStartedAt - eventTrackStartedAt,
				endMs: Date.now() - eventTrackStartedAt,
				durationMs: Date.now() - actionStartedAt,
				skipped,
				target: action.target,
				from: action.from ?? action.fromTarget,
				to: action.to ?? action.toTarget,
				toTime: action.toTime,
				label: stringValue(action, "label"),
				chapter: stringValue(action, "chapter"),
				success: result.success,
				result: result.data,
			});
			if (!result.success) {
				throw new Error(result.error || `Action ${index} failed`);
			}
			if (
				["click", "double-click", "right-click"].includes(actionName ?? "") &&
				typeof action.ref === "string"
			) {
				activeRef = action.ref;
			}
		}
	} catch (error) {
		const screenshot = await captureFailureScreenshot(client);
		const captureEndedAt = Date.now();
		if (recordingStarted && recordingOutputPath) {
			try {
				recording = await stopSequenceRecording({
					client,
					outputPath: recordingOutputPath,
				});
			} catch {
				// Preserve the action failure.
			}
		}
		let eventTrack: string | undefined;
		if (eventTrackOutputPath) {
			try {
				eventTrack = await writePointerEventTrack({
					requestedPath: eventTrackOutputPath,
					captureStartedAt: eventTrackStartedAt,
					sequenceStartedAt,
					endedAt: captureEndedAt,
					prerollMs: appliedPrerollMs,
					postrollMs: 0,
					speed,
					skipIdle: options.skipIdle === true,
					events,
				});
			} catch {
				// Preserve the action failure.
			}
		}
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			data: {
				results,
				screenshot,
				recording,
				eventTrack,
				capture: {
					start: recordingStart,
					captureStartedAt: eventTrackStartedAt,
					sequenceStartedAt,
					endedAt: captureEndedAt,
					expectedDurationMs: Math.max(0, captureEndedAt - eventTrackStartedAt),
					prerollMs: appliedPrerollMs,
					postrollMs: 0,
				},
			},
		};
	}

	if (recordingStarted) {
		appliedPostrollMs = Math.max(0, options.postrollMs ?? 0);
		if (appliedPostrollMs > 0) await sleep(appliedPostrollMs);
	}
	const captureEndedAt = Date.now();
	if (recordingStarted && recordingOutputPath) {
		recording = await stopSequenceRecording({
			client,
			outputPath: recordingOutputPath,
		});
	}
	const eventTrack = eventTrackOutputPath
		? await writePointerEventTrack({
				requestedPath: eventTrackOutputPath,
				captureStartedAt: eventTrackStartedAt,
				sequenceStartedAt,
				endedAt: captureEndedAt,
				prerollMs: appliedPrerollMs,
				postrollMs: appliedPostrollMs,
				speed,
				skipIdle: options.skipIdle === true,
				events,
			})
		: undefined;
	return {
		success: true,
		data: {
			actionCount: actions.length,
			executedActionCount: events.filter((event) => event.skipped !== true)
				.length,
			results,
			capture: {
				start: recordingStart,
				captureStartedAt: eventTrackStartedAt,
				sequenceStartedAt,
				endedAt: captureEndedAt,
				expectedDurationMs: Math.max(0, captureEndedAt - eventTrackStartedAt),
				prerollMs: appliedPrerollMs,
				postrollMs: appliedPostrollMs,
			},
			recording,
			eventTrack,
		},
	};
}
