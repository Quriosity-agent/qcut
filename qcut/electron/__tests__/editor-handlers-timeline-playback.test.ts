import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleTimelineEditingCommand } from "../native-pipeline/editor/editor-handlers-timeline.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner.js";

const BASE_URL = "http://127.0.0.1:19891";
const PLAYBACK_PATH = "/api/claude/timeline/p1/playback";

let lastMethod = "";
let lastPath = "";
let lastBody: string | null = null;

const originalFetch = globalThis.fetch;

function makeOpts(overrides: Partial<CLIRunOptions>): CLIRunOptions {
	return {
		command: "editor:timeline:play",
		outputDir: "./output",
		json: false,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		...overrides,
	} as CLIRunOptions;
}

const noopProgress = () => {};

describe("Timeline playback handlers", () => {
	let client: EditorApiClient;

	beforeAll(() => {
		globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			const method = init?.method ?? "GET";
			const path = url.replace(BASE_URL, "").split("?")[0];

			lastMethod = method;
			lastPath = path;
			lastBody = (init?.body as string) ?? null;

			if (method === "POST" && path === PLAYBACK_PATH) {
				return new Response(
					JSON.stringify({ success: true, data: { received: true } }),
					{ headers: { "Content-Type": "application/json" } }
				);
			}

			return new Response(
				JSON.stringify({
					success: false,
					error: `Not found: ${method} ${path}`,
				}),
				{ status: 404, headers: { "Content-Type": "application/json" } }
			);
		};

		client = new EditorApiClient({ baseUrl: BASE_URL });
	});

	beforeEach(() => {
		lastMethod = "";
		lastPath = "";
		lastBody = null;
	});

	afterAll(() => {
		globalThis.fetch = originalFetch;
	});

	it("play posts playback action", async () => {
		const result = await handleTimelineEditingCommand(
			client,
			makeOpts({ command: "editor:timeline:play", projectId: "p1" }),
			noopProgress
		);

		expect(result.success).toBe(true);
		expect(lastMethod).toBe("POST");
		expect(lastPath).toBe(PLAYBACK_PATH);
		expect(JSON.parse(lastBody!)).toEqual({ action: "play" });
	});

	it("pause posts playback action", async () => {
		const result = await handleTimelineEditingCommand(
			client,
			makeOpts({ command: "editor:timeline:pause", projectId: "p1" }),
			noopProgress
		);

		expect(result.success).toBe(true);
		expect(JSON.parse(lastBody!)).toEqual({ action: "pause" });
	});

	it("toggle-play maps to toggle action", async () => {
		const result = await handleTimelineEditingCommand(
			client,
			makeOpts({ command: "editor:timeline:toggle-play", projectId: "p1" }),
			noopProgress
		);

		expect(result.success).toBe(true);
		expect(JSON.parse(lastBody!)).toEqual({ action: "toggle" });
	});

	it("seek requires --time", async () => {
		const result = await handleTimelineEditingCommand(
			client,
			makeOpts({ command: "editor:timeline:seek", projectId: "p1" }),
			noopProgress
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("--time");
	});

	it("seek posts seek action with time", async () => {
		const result = await handleTimelineEditingCommand(
			client,
			makeOpts({
				command: "editor:timeline:seek",
				projectId: "p1",
				seekTime: 12.5,
			}),
			noopProgress
		);

		expect(result.success).toBe(true);
		expect(JSON.parse(lastBody!)).toEqual({ action: "seek", time: 12.5 });
	});

	it("seek accepts start-time fallback", async () => {
		const result = await handleTimelineEditingCommand(
			client,
			makeOpts({
				command: "editor:timeline:seek",
				projectId: "p1",
				startTime: 3,
			}),
			noopProgress
		);

		expect(result.success).toBe(true);
		expect(JSON.parse(lastBody!)).toEqual({ action: "seek", time: 3 });
	});
});
