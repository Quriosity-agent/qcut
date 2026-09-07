import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseCliArgs } from "../native-pipeline/cli/cli.js";
import {
	handleKeyboardCommand,
	handlePointerCommand,
	waitForEditorUi,
} from "../native-pipeline/cli/cli-handlers-pointer.js";
import { parseSessionLine } from "../native-pipeline/cli/cli-runner/session.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";

const BACKGROUND_POINTER_REQUIREMENT = {
	name: "state.pointer",
	minVersion: "1.1.0",
	feature: "Background pointer input",
	remediation:
		"Update QCut. Editors advertising state.pointer 1.0.0 can retry with --foreground.",
} as const;

const HTML5_DRAG_REQUIREMENT = {
	name: "state.pointer",
	minVersion: "1.2.0",
	feature: "HTML5 drag-and-drop",
	remediation:
		"Update QCut, or retry with --dnd auto so older editors fall back to a mouse drag.",
} as const;

function makeOptions({
	command,
	values = {},
}: {
	command: string;
	values?: Partial<CLIRunOptions>;
}): CLIRunOptions {
	return {
		command,
		outputDir: "./output",
		json: true,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		...values,
	};
}

function createClient() {
	const post = vi.fn(async () => ({ ok: true }));
	const requireCapability = vi.fn(async () => undefined);
	return {
		client: { post, requireCapability } as unknown as EditorApiClient,
		post,
		requireCapability,
	};
}

describe("editor pointer CLI handlers", () => {
	it("waits using a bounded interactive snapshot", async () => {
		const get = vi.fn(async () => ({
			elements: [
				{
					ref: "@e7",
					name: "Ready to export",
					textPreview: "Ready to export",
					value: null,
				},
			],
		}));
		const client = { get } as unknown as EditorApiClient;
		const result = await waitForEditorUi({
			client,
			options: { text: "Ready", timeoutMs: 100 },
		});

		expect(result.success).toBe(true);
		expect(get).toHaveBeenCalledWith("/api/claude/snapshot", {
			interactive: "true",
			depth: "32",
			maxNodes: "8000",
			maxBytes: String(1024 * 1024),
		});
	});

	it("requires value waits to identify their input", async () => {
		const client = { get: vi.fn() } as unknown as EditorApiClient;
		const result = await waitForEditorUi({
			client,
			options: { value: "" },
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain("require --ref");
	});

	it("parses one-shot and session pointer coordinates", () => {
		const oneShot = parseCliArgs([
			"editor:pointer:drag",
			"--from-ref",
			"@e12",
			"--to-x",
			"700",
			"--to-y",
			"0",
			"--foreground",
			"--force",
			"--duration-ms",
			"800",
			"--steps",
			"32",
		]);
		const session = parseSessionLine(
			"editor:pointer:scroll --x 0 --y 500 --delta-y -400",
			{ json: true }
		);

		expect(oneShot).toEqual(
			expect.objectContaining({
				fromRef: "@e12",
				toX: 700,
				toY: 0,
				foreground: true,
				force: true,
				durationMs: 800,
				steps: 32,
			})
		);
		expect(session).toEqual(
			expect.objectContaining({
				command: "editor:pointer:scroll",
				x: 0,
				y: 500,
				deltaY: -400,
			})
		);
	});

	it.each([
		"move",
		"hover",
		"click",
		"double-click",
		"right-click",
	])("routes pointer %s by snapshot ref", async (action) => {
		const { client, post, requireCapability } = createClient();
		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: `editor:pointer:${action}`,
				values: { ref: "@e12" },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith(`/api/claude/pointer/${action}`, {
			ref: "@e12",
			inputMode: "background",
		});
		expect(requireCapability).toHaveBeenCalledWith(
			BACKGROUND_POINTER_REQUIREMENT
		);
	});

	it("routes coordinate drag endpoints without losing zero coordinates", async () => {
		const { client, post, requireCapability } = createClient();
		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:drag",
				values: { fromX: 0, fromY: 700, toX: 800, toY: 700 },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/drag", {
			from: { x: 0, y: 700 },
			to: { x: 800, y: 700 },
			inputMode: "background",
			via: undefined,
			holdMs: 120,
			durationMs: 450,
			steps: 24,
			releaseDelayMs: 100,
		});
		expect(requireCapability).toHaveBeenCalledWith(
			BACKGROUND_POINTER_REQUIREMENT
		);
	});

	it("passes the HTML5 drag mode through and requires the newer pointer capability", async () => {
		const { client, post, requireCapability } = createClient();
		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:drag",
				values: { fromX: 0, fromY: 700, toX: 800, toY: 700, dnd: "html5" },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/pointer/drag",
			expect.objectContaining({ dnd: "html5", inputMode: "background" })
		);
		expect(requireCapability).toHaveBeenCalledWith(
			BACKGROUND_POINTER_REQUIREMENT
		);
		expect(requireCapability).toHaveBeenCalledWith(HTML5_DRAG_REQUIREMENT);
	});

	it("rejects invalid or foreground HTML5 drag modes before sending a request", async () => {
		const { client, post } = createClient();
		const invalid = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:drag",
				values: { fromX: 0, fromY: 700, toX: 800, toY: 700, dnd: "native" },
			}),
		});
		expect(invalid.success).toBe(false);
		expect(invalid.error).toContain("--dnd must be one of");

		const foreground = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:drag",
				values: {
					fromX: 0,
					fromY: 700,
					toX: 800,
					toY: 700,
					dnd: "html5",
					foreground: true,
				},
			}),
		});
		expect(foreground.success).toBe(false);
		expect(foreground.error).toContain("--foreground");
		expect(post).not.toHaveBeenCalled();
	});

	it("parses --dnd for one-shot drags", () => {
		expect(
			parseCliArgs([
				"editor:pointer:drag",
				"--from-ref",
				"@e12",
				"--to-ref",
				"@e27",
				"--dnd",
				"html5",
			])
		).toEqual(expect.objectContaining({ dnd: "html5" }));
	});

	it("passes modifiers, buttons, and click counts through pointer clicks", async () => {
		const { client, post } = createClient();
		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:click",
				values: {
					ref: "@e12",
					modifiers: "shift, cmd",
					button: "middle",
					clickCount: 3,
				},
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/click", {
			ref: "@e12",
			inputMode: "background",
			modifiers: ["shift", "cmd"],
			button: "middle",
			clickCount: 3,
		});
	});

	it("rejects buttons and click counts on actions that cannot use them", async () => {
		const { client, post } = createClient();
		const hover = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:hover",
				values: { ref: "@e12", button: "middle" },
			}),
		});
		const rightClick = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:right-click",
				values: { ref: "@e12", clickCount: 2 },
			}),
		});
		const badButton = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:click",
				values: { ref: "@e12", button: "back" },
			}),
		});

		expect(hover.success).toBe(false);
		expect(hover.error).toContain("--button only applies");
		expect(rightClick.success).toBe(false);
		expect(rightClick.error).toContain("--click-count only applies");
		expect(badButton.success).toBe(false);
		expect(badButton.error).toContain("--button must be one of");
		expect(post).not.toHaveBeenCalled();
	});

	it("passes buttons and modifiers through drags and modifiers through scrolls", async () => {
		const { client, post } = createClient();
		await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:drag",
				values: {
					fromX: 0,
					fromY: 700,
					toX: 800,
					toY: 700,
					button: "right",
					modifiers: "alt",
				},
			}),
		});
		await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:scroll",
				values: { x: 640, y: 360, deltaY: -120, modifiers: "ctrl" },
			}),
		});

		expect(post).toHaveBeenCalledWith(
			"/api/claude/pointer/drag",
			expect.objectContaining({ button: "right", modifiers: ["alt"] })
		);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/pointer/scroll",
			expect.objectContaining({ deltaY: -120, modifiers: ["ctrl"] })
		);
	});

	it("reads pointer state and hit-tests a target without dispatching input", async () => {
		const get = vi.fn(async (path: string) => {
			if (path === "/api/claude/pointer/state") {
				return { visible: true, x: 10, y: 20, action: "idle" };
			}
			return {
				elements: [
					{
						ref: "@e12",
						bounds: { x: 100, y: 200, width: 40, height: 20 },
					},
				],
			};
		});
		const post = vi.fn(async () => ({
			action: "hit-test",
			hit: true,
			element: { testId: "timeline-element" },
		}));
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const state = await handlePointerCommand({
			client,
			options: makeOptions({ command: "editor:pointer:state" }),
		});
		const hit = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:hit-test",
				values: { ref: "@e12" },
			}),
		});
		const hitByCoordinates = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:hit-test",
				values: { x: 388, y: 879 },
			}),
		});

		expect(state.success).toBe(true);
		expect(state.data).toEqual(expect.objectContaining({ action: "idle" }));
		expect(hit.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/hit-test", {
			x: 120,
			y: 210,
		});
		expect(hitByCoordinates.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/hit-test", {
			x: 388,
			y: 879,
		});
	});

	it("parses --modifiers, --button, and --click-count for one-shot pointer commands", () => {
		expect(
			parseCliArgs([
				"editor:pointer:click",
				"--ref",
				"@e12",
				"--modifiers",
				"shift,cmd",
				"--button",
				"middle",
				"--click-count",
				"3",
			])
		).toEqual(
			expect.objectContaining({
				modifiers: "shift,cmd",
				button: "middle",
				clickCount: 3,
			})
		);
	});

	it("drops local files on a target and requires the HTML5 capability", async () => {
		const directory = mkdtempSync(join(tmpdir(), "qcut-drop-files-"));
		const stillPath = join(directory, "still.png");
		writeFileSync(stillPath, "png");
		try {
			const { client, post, requireCapability } = createClient();
			const result = await handlePointerCommand({
				client,
				options: makeOptions({
					command: "editor:pointer:drop-files",
					values: { x: 300, y: 200, files: `${stillPath}, ` },
				}),
			});
			expect(result.success).toBe(true);
			expect(post).toHaveBeenCalledWith("/api/claude/pointer/drop-files", {
				x: 300,
				y: 200,
				files: [stillPath],
				inputMode: "background",
			});
			expect(requireCapability).toHaveBeenCalledWith(HTML5_DRAG_REQUIREMENT);

			const missing = await handlePointerCommand({
				client,
				options: makeOptions({
					command: "editor:pointer:drop-files",
					values: { x: 300, y: 200, files: join(directory, "nope.png") },
				}),
			});
			expect(missing.success).toBe(false);
			expect(missing.error).toContain("Dropped file not found");

			const foreground = await handlePointerCommand({
				client,
				options: makeOptions({
					command: "editor:pointer:drop-files",
					values: { x: 300, y: 200, files: stillPath, foreground: true },
				}),
			});
			expect(foreground.success).toBe(false);
			expect(foreground.error).toContain("--foreground");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("resolves semantic, normalized, and ref waypoints in --via", async () => {
		const get = vi.fn(async () => ({
			viewport: { width: 1200, height: 800 },
			elements: [],
		}));
		const post = vi.fn(async () => ({ action: "drag" }));
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:drag",
				values: {
					fromX: 0,
					fromY: 700,
					toX: 800,
					toY: 700,
					via: JSON.stringify([
						{ normalizedX: 0.5, normalizedY: 0.25 },
						{ ref: "@e3" },
						{ x: 10, y: 20 },
					]),
				},
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/pointer/drag",
			expect.objectContaining({
				via: [{ x: 600, y: 200 }, { ref: "@e3" }, { x: 10, y: 20 }],
			})
		);
	});

	it("passes --key-events through keyboard type", async () => {
		const { client, post } = createClient();
		await handleKeyboardCommand({
			client,
			options: makeOptions({
				command: "editor:keyboard:type",
				values: { text: "hi", keyEvents: true },
			}),
		});
		expect(post).toHaveBeenCalledWith("/api/claude/keyboard/type", {
			text: "hi",
			intervalMs: undefined,
			inputMode: "background",
			keyEvents: true,
		});
	});

	it("keeps pointer flags in session mode", () => {
		const session = parseSessionLine(
			"editor:pointer:drag --from-ref @e1 --to-ref @e2 --dnd html5 --modifiers shift --button right --steps 12 --hold-ms 50 --no-verify --foreground",
			{ json: true }
		);
		expect(session).toEqual(
			expect.objectContaining({
				command: "editor:pointer:drag",
				fromRef: "@e1",
				toRef: "@e2",
				dnd: "html5",
				modifiers: "shift",
				button: "right",
				steps: 12,
				holdMs: 50,
				verify: false,
				foreground: true,
			})
		);
		const typed = parseSessionLine(
			"editor:keyboard:type --text hello --key-events --interval-ms 20",
			{ json: true }
		);
		expect(typed).toEqual(
			expect.objectContaining({
				keyEvents: true,
				intervalMs: 20,
				text: "hello",
			})
		);
		const drop = parseSessionLine(
			"editor:pointer:drop-files --files ./a.png,./b.mp4 --target panel.media --click-count 2",
			{ json: true }
		);
		expect(drop).toEqual(
			expect.objectContaining({
				files: "./a.png,./b.mp4",
				target: "panel.media",
				clickCount: 2,
			})
		);
	});

	it("drags flattened interactive list items by semantic index", async () => {
		const before = [
			{
				ref: "@e1",
				parentRef: null,
				role: "button",
				tagName: "button",
				name: "Reorder Main",
				testId: "timeline-track-reorder",
				bounds: { x: 10, y: 100, width: 24, height: 24 },
			},
			{
				ref: "@e2",
				parentRef: null,
				role: "button",
				tagName: "button",
				name: "Reorder Titles",
				testId: "timeline-track-reorder",
				bounds: { x: 10, y: 130, width: 24, height: 24 },
			},
		];
		const after = [
			{
				...before[1],
				ref: "@e1",
				bounds: { x: 10, y: 100, width: 24, height: 24 },
			},
			{
				...before[0],
				ref: "@e2",
				bounds: { x: 10, y: 130, width: 24, height: 24 },
			},
		];
		const get = vi
			.fn()
			.mockResolvedValueOnce({ elements: before })
			.mockResolvedValueOnce({ elements: after });
		const post = vi.fn(async () => ({ action: "drag" }));
		const requireCapability = vi.fn(async () => undefined);
		const client = {
			get,
			post,
			requireCapability,
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:drag",
				values: { fromRef: "@e2", toIndex: 0, verify: true },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/pointer/drag",
			expect.objectContaining({
				from: { ref: "@e2" },
				to: { x: 22, y: 104.8 },
			})
		);
	});

	it("excludes distant lookalike controls from a flattened list", async () => {
		const taskButton = {
			ref: "@task",
			parentRef: null,
			role: "button",
			tagName: "button",
			name: "Task center",
			testId: null,
			bounds: { x: 12, y: 10, width: 28, height: 28 },
		};
		const tracks = ["Main", "Titles", "Probe"].map((name, index) => ({
			ref: `@track-${index}`,
			parentRef: null,
			role: "button",
			tagName: "button",
			name: `Reorder ${name}`,
			testId: null,
			bounds: { x: 10, y: 100 + index * 30, width: 24, height: 24 },
		}));
		const after = [
			taskButton,
			{ ...tracks[0], ref: "@after-main", bounds: { ...tracks[0].bounds } },
			{ ...tracks[2], ref: "@after-probe", bounds: { ...tracks[1].bounds } },
			{ ...tracks[1], ref: "@after-titles", bounds: { ...tracks[2].bounds } },
		];
		const get = vi
			.fn()
			.mockResolvedValueOnce({ elements: [taskButton, ...tracks] })
			.mockResolvedValueOnce({ elements: after });
		const post = vi.fn(async () => ({ action: "drag" }));
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:drag",
				values: { fromRef: "@track-2", toIndex: 1, verify: true },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/pointer/drag",
			expect.objectContaining({ to: { x: 22, y: 134.8 } })
		);
	});

	it("routes keyboard chords and typed text", async () => {
		const { client, post } = createClient();
		const press = await handleKeyboardCommand({
			client,
			options: makeOptions({
				command: "editor:keyboard:press",
				values: { keys: "META,A", intervalMs: 25 },
			}),
		});
		const type = await handleKeyboardCommand({
			client,
			options: makeOptions({
				command: "editor:keyboard:type",
				values: { text: "QCut automation", intervalMs: 10 },
			}),
		});

		expect(press.success).toBe(true);
		expect(type.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/keyboard/press", {
			keys: ["META", "A"],
			intervalMs: 25,
			inputMode: "background",
		});
		expect(post).toHaveBeenCalledWith("/api/claude/keyboard/type", {
			text: "QCut automation",
			intervalMs: 10,
			inputMode: "background",
		});
	});

	it("executes a pointer and keyboard action sequence in order", async () => {
		const { client, post } = createClient();
		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:sequence",
				values: {
					actions: JSON.stringify([
						{ action: "click", ref: "@e1" },
						{ action: "press", keys: ["META", "A"] },
						{ action: "type", text: "replacement" },
					]),
				},
			}),
		});

		expect(result.success).toBe(true);
		expect(result.data).toEqual(expect.objectContaining({ actionCount: 3 }));
		expect(post.mock.calls.map(([url]) => url)).toEqual([
			"/api/claude/pointer/click",
			"/api/claude/keyboard/press",
			"/api/claude/keyboard/type",
		]);
	});

	it("waits for sequence postconditions after dispatching the action", async () => {
		const callOrder: string[] = [];
		let clicked = false;
		const post = vi.fn(async () => {
			callOrder.push("click");
			clicked = true;
			return { action: "click" };
		});
		const get = vi.fn(async () => {
			callOrder.push("snapshot");
			return {
				elements: clicked
					? [
							{
								ref: "@ready",
								testId: "animation-panel",
								bounds: { x: 10, y: 10, width: 100, height: 30 },
							},
						]
					: [],
			};
		});
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:sequence",
				values: {
					actions: JSON.stringify([
						{
							action: "click",
							ref: "@text-animation",
							waitFor: "testid:animation-panel",
						},
					]),
				},
			}),
		});

		expect(result.success).toBe(true);
		expect(callOrder).toEqual(["click", "snapshot"]);
	});

	it("hides the pointer in a sequence and writes a default labeled event track", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "qcut-pointer-sequence-"));
		const recordingPath = join(tempDir, "promo.mp4");
		const expectedTrackPath = join(tempDir, "promo.pointer.json");
		const post = vi.fn(async (url: string) => {
			if (url.endsWith("/start")) return { captureStartedAt: Date.now() };
			if (url.endsWith("/stop")) return { filePath: null };
			if (url.endsWith("/hide")) return { action: "hidden", visible: false };
			throw new Error(`Unexpected POST ${url}`);
		});
		const client = { post } as unknown as EditorApiClient;

		try {
			const result = await handlePointerCommand({
				client,
				options: makeOptions({
					command: "editor:pointer:sequence",
					values: {
						actions: JSON.stringify([
							{
								action: "hide",
								label: "Clean outro",
								chapter: "outro",
							},
						]),
						record: recordingPath,
					},
				}),
			});
			const data = result.data as { eventTrack?: string };
			const track = JSON.parse(readFileSync(expectedTrackPath, "utf8"));

			expect(result.success).toBe(true);
			expect(data.eventTrack).toBe(expectedTrackPath);
			expect(track.events[0]).toEqual(
				expect.objectContaining({
					action: "hide",
					label: "Clean outro",
					chapter: "outro",
					success: true,
				})
			);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("scopes sequence value waits to the most recently clicked ref", async () => {
		const post = vi.fn(async () => ({ ok: true }));
		const get = vi.fn(async () => ({
			elements: [
				{
					ref: "@input",
					name: "Search",
					value: "QCut",
					bounds: { x: 10, y: 10, width: 100, height: 30 },
				},
			],
		}));
		const client = {
			post,
			get,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;
		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:sequence",
				values: {
					actions: JSON.stringify([
						{ action: "click", ref: "@input" },
						{ action: "type", text: "QCut" },
						{ action: "wait", value: "QCut" },
					]),
				},
			}),
		});

		expect(result.success).toBe(true);
		expect(get).toHaveBeenCalled();
	});

	it("routes wheel deltas at an optional target", async () => {
		const { client, post, requireCapability } = createClient();
		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:scroll",
				values: { ref: "@e20", deltaY: 400 },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/scroll", {
			ref: "@e20",
			inputMode: "background",
			deltaY: 400,
		});
		expect(requireCapability).toHaveBeenCalledWith(
			BACKGROUND_POINTER_REQUIREMENT
		);
	});

	it("resolves semantic targets and scales pointer animation speed", async () => {
		const get = vi.fn(async () => ({
			elements: [
				{
					ref: "@text-tab",
					testId: "text-panel-tab",
					bounds: { x: 20, y: 30, width: 40, height: 40 },
				},
			],
		}));
		const post = vi.fn(async () => ({ action: "click" }));
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:click",
				values: { target: "panel.text", speed: 2 },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/click", {
			ref: "@text-tab",
			inputMode: "background",
			durationMs: 110,
		});
	});

	it("waits for requested state after the pointer action", async () => {
		let clicked = false;
		const get = vi.fn(async () => ({
			elements: [
				{
					ref: "@text-tab",
					testId: "text-panel-tab",
					bounds: { x: 20, y: 30, width: 40, height: 40 },
				},
				...(clicked
					? [
							{
								ref: "@add-text",
								testId: "text-overlay-button",
								bounds: { x: 80, y: 120, width: 100, height: 60 },
							},
						]
					: []),
			],
		}));
		const post = vi.fn(async () => {
			clicked = true;
			return { action: "click" };
		});
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:click",
				values: {
					target: "panel.text",
					waitFor: "text.add",
					timeoutMs: 100,
				},
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/click", {
			ref: "@text-tab",
			inputMode: "background",
		});
		expect(get).toHaveBeenCalledTimes(2);
	});

	it("resolves semantic timeline play without a raw test id", async () => {
		const get = vi.fn(async () => ({
			elements: [
				{
					ref: "@play",
					testId: "timeline-play-button",
					bounds: { x: 400, y: 700, width: 32, height: 32 },
				},
			],
		}));
		const post = vi.fn(async () => ({ action: "click" }));
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:click",
				values: { target: "timeline.play" },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/click", {
			ref: "@play",
			inputMode: "background",
		});
	});

	it("resolves text animation preset targets from phase and preset id", async () => {
		const get = vi.fn(async () => ({
			elements: [
				{
					ref: "@wave",
					testId: "text-animation-card-loop-wave",
					bounds: { x: 940, y: 330, width: 90, height: 72 },
				},
			],
		}));
		const post = vi.fn(async () => ({ action: "click" }));
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:click",
				values: { target: "text.animation.loop.wave" },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/click", {
			ref: "@wave",
			inputMode: "background",
		});
	});

	it("waits for canonical preview frame readiness", async () => {
		const get = vi.fn(async () => ({
			version: 1,
			timestamp: Date.now(),
			state: {
				editor: {
					initialization: {
						isInitializing: false,
						isPanelsReady: true,
					},
					preview: {
						panelMounted: true,
						canvasMounted: true,
						ready: true,
						reason: null,
						loading: false,
						activeVideoMediaIds: ["video-1"],
						nativeCompositionStatus: "idle",
						lastPresentedAt: Date.now(),
						videos: [],
					},
				},
			},
		}));
		const client = { get } as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:wait-for",
				values: { target: "preview.frame-ready", timeoutMs: 100 },
			}),
		});

		expect(result.success).toBe(true);
		expect(get).toHaveBeenCalledWith("/api/claude/state", {
			include: "timeline,playhead,media,editor,project",
		});
	});

	it("keeps capture padding in recording metadata", async () => {
		const captureStartedAt = Date.now();
		const post = vi.fn(async (url: string) => {
			if (url.endsWith("/start")) return { captureStartedAt };
			if (url.endsWith("/stop")) return { filePath: null };
			throw new Error(`Unexpected POST ${url}`);
		});
		const client = { post } as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:sequence",
				values: {
					actions: JSON.stringify([{ action: "sleep", durationMs: 0 }]),
					record: "/tmp/qcut-pointer-padding.mp4",
					recordingQuality: "4k",
					prerollMs: 5,
					postrollMs: 5,
				},
			}),
		});
		const data = result.data as {
			capture: {
				expectedDurationMs: number;
				prerollMs: number;
				postrollMs: number;
			};
		};

		expect(result.success).toBe(true);
		expect(data.capture.prerollMs).toBe(5);
		expect(data.capture.postrollMs).toBe(5);
		expect(data.capture.expectedDurationMs).toBeGreaterThanOrEqual(10);
		expect(post).toHaveBeenCalledWith("/api/claude/screen-recording/start", {
			captureMode: "editor",
			fileName: "qcut-pointer-padding.mp4",
			recordingQuality: "4k",
		});
	});

	it("converts normalized viewport coordinates", async () => {
		const get = vi.fn(async () => ({
			viewport: { width: 1200, height: 800 },
			elements: [],
		}));
		const post = vi.fn(async () => ({ action: "move" }));
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:move",
				values: { normalizedX: 0.5, normalizedY: 0.25 },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/move", {
			x: 600,
			y: 200,
			inputMode: "background",
		});
	});

	it("separates semantic playhead seek from its display-only animation", async () => {
		let sought = false;
		const get = vi.fn(async (url: string) => {
			if (url === "/api/claude/navigator/projects") {
				return { activeProjectId: "project-1" };
			}
			if (url === "/api/claude/snapshot") {
				return {
					elements: [
						{
							ref: "@playhead",
							testId: "timeline-playhead",
							bounds: {
								x: sought ? 500 : 100,
								y: 300,
								width: 2,
								height: 200,
							},
						},
					],
				};
			}
			throw new Error(`Unexpected GET ${url}`);
		});
		const post = vi.fn(async (url: string) => {
			if (url.includes("/playback")) sought = true;
			return { url };
		});
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:drag",
				values: {
					from: "timeline.playhead",
					toTime: 12,
					projectId: "project-1",
				},
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/timeline/project-1/playback",
			{ action: "seek", time: 12 }
		);
		expect(post.mock.calls.map(([url]) => url)).not.toContain(
			"/api/claude/pointer/drag"
		);
		expect(result.data).toEqual(
			expect.objectContaining({
				animation: expect.objectContaining({ type: "display-only" }),
			})
		);
	});

	it("routes explicit foreground input without changing the target", async () => {
		const { client, post, requireCapability } = createClient();
		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:click",
				values: { ref: "@e12", foreground: true },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/click", {
			ref: "@e12",
			inputMode: "foreground",
		});
		expect(requireCapability).not.toHaveBeenCalled();
	});

	it.each([
		["text.add", "text-overlay-button"],
		[
			"text.animation.entrance.typewriter-cursor",
			"text-animation-card-entrance-typewriter-cursor",
		],
	])("resolves semantic text target %s", async (target, testId) => {
		const get = vi.fn(async () => ({
			elements: [
				{
					ref: "@text-target",
					testId,
					bounds: { x: 100, y: 200, width: 80, height: 40 },
				},
			],
		}));
		const post = vi.fn(async () => ({ action: "click" }));
		const client = {
			get,
			post,
			requireCapability: vi.fn(async () => undefined),
		} as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:click",
				values: { target },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/click", {
			ref: "@text-target",
			inputMode: "background",
		});
	});

	it("supports hiding the virtual pointer inside a sequence", async () => {
		const post = vi.fn(async () => ({ action: "hidden" }));
		const client = { post } as unknown as EditorApiClient;

		const result = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:sequence",
				values: { actions: JSON.stringify([{ action: "hide" }]) },
			}),
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/hide", {});
	});

	it("rejects background input when the running editor is too old", async () => {
		const { client, post, requireCapability } = createClient();
		requireCapability.mockRejectedValue(
			new Error(
				"Background pointer input requires QCut capability 'state.pointer' 1.1.0+"
			)
		);

		await expect(
			handlePointerCommand({
				client,
				options: makeOptions({
					command: "editor:pointer:click",
					values: { ref: "@e12" },
				}),
			})
		).rejects.toThrow("state.pointer");
		expect(post).not.toHaveBeenCalled();
	});

	it("rejects ambiguous and partial pointer targets before sending a request", async () => {
		const { client, post } = createClient();

		const ambiguous = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:click",
				values: { ref: "@e12", x: 100, y: 200 },
			}),
		});
		const partialScroll = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:scroll",
				values: { x: 100, deltaY: 400 },
			}),
		});

		expect(ambiguous.success).toBe(false);
		expect(ambiguous.error).toContain("either --ref or coordinates");
		expect(partialScroll.success).toBe(false);
		expect(partialScroll.error).toContain("both --x");
		expect(post).not.toHaveBeenCalled();
	});

	it("routes hide and validates incomplete targets", async () => {
		const { client, post, requireCapability } = createClient();
		const hideResult = await handlePointerCommand({
			client,
			options: makeOptions({ command: "editor:pointer:hide" }),
		});
		expect(hideResult.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/pointer/hide", {});
		expect(requireCapability).not.toHaveBeenCalled();

		const invalidResult = await handlePointerCommand({
			client,
			options: makeOptions({
				command: "editor:pointer:move",
				values: { x: 100 },
			}),
		});
		expect(invalidResult.success).toBe(false);
		expect(invalidResult.error).toContain("both --x");
	});
});
