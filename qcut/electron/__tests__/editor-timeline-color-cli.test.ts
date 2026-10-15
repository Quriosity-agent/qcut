import { describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleTimelineEditingCommand } from "../native-pipeline/editor/editor-handlers-timeline.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";

function makeOptions(overrides: Partial<CLIRunOptions>): CLIRunOptions {
	return {
		command: "editor:timeline:color-label",
		outputDir: "./output",
		json: true,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		projectId: "p1",
		...overrides,
	} as CLIRunOptions;
}

function fakeClient(response: unknown = { ok: true }) {
	const post = vi.fn(async () => response);
	const patch = vi.fn(async () => response);
	const get = vi.fn(async () => ({
		tracks: [
			{
				id: "guns",
				index: 0,
				name: "SFX · Guns",
				type: "audio",
				colorLabel: "red",
				elements: [{}, {}],
			},
		],
	}));
	return {
		client: { post, patch, get } as unknown as EditorApiClient,
		post,
		patch,
	};
}

const run = (client: EditorApiClient, overrides: Partial<CLIRunOptions>) =>
	handleTimelineEditingCommand(client, makeOptions(overrides), () => {});

describe("clip colour commands", () => {
	it("colours every clip on a track", async () => {
		const { client, post } = fakeClient({ updatedCount: 2, skipped: [] });
		const result = await run(client, { trackId: "guns", color: "Red" });

		expect(result).toEqual({
			success: true,
			data: { updatedCount: 2, skipped: [] },
		});
		expect(post).toHaveBeenCalledWith("/api/claude/timeline/p1/color-label", {
			trackId: "guns",
			colorLabel: "red",
		});
	});

	it("takes element ids as a JSON array, a comma list, or repeated flags", async () => {
		const { client, post } = fakeClient();
		await run(client, {
			elementIds: ['["a","b"]', "c, d", "e"],
			clear: true,
		});

		expect(post).toHaveBeenCalledWith("/api/claude/timeline/p1/color-label", {
			elementIds: ["a", "b", "c", "d", "e"],
			colorLabel: null,
		});
	});

	it("refuses an unknown colour, no target, or a colour with --clear", async () => {
		const { client, post } = fakeClient();
		expect(await run(client, { trackId: "guns", color: "teal" })).toMatchObject(
			{
				success: false,
				error: expect.stringContaining("--color must be one of"),
			}
		);
		expect(await run(client, { color: "red" })).toMatchObject({
			success: false,
			error: "Give --track-id (every clip on it) or --element-ids",
		});
		expect(
			await run(client, { trackId: "guns", color: "red", clear: true })
		).toMatchObject({ success: false });
		expect(post).not.toHaveBeenCalled();
	});

	it("selects clips by colour", async () => {
		const { client, post } = fakeClient({ selected: 3 });
		const result = await run(client, {
			command: "editor:timeline:select",
			color: "green",
		});

		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith("/api/claude/timeline/p1/selection", {
			colorLabel: "green",
		});
	});
});

describe("track colour flags", () => {
	it("creates a track with a colour", async () => {
		const { client, post } = fakeClient();
		await run(client, {
			command: "editor:track:create",
			trackType: "audio",
			trackName: "SFX · Guns",
			color: "red",
		});

		expect(post).toHaveBeenCalledWith("/api/claude/timeline/p1/tracks", {
			type: "audio",
			name: "SFX · Guns",
			index: undefined,
			colorLabel: "red",
		});
	});

	it("clears a track colour with --color none", async () => {
		const { client, patch } = fakeClient();
		const result = await run(client, {
			command: "editor:track:update",
			trackId: "guns",
			color: "none",
		});

		expect(result.success).toBe(true);
		expect(patch).toHaveBeenCalledWith("/api/claude/timeline/p1/tracks/guns", {
			index: undefined,
			name: undefined,
			colorLabel: null,
		});
	});

	it("lists track colours", async () => {
		const { client } = fakeClient();
		const result = await run(client, { command: "editor:track:list" });

		expect(result.data).toMatchObject({
			tracks: [{ id: "guns", colorLabel: "red", elementCount: 2 }],
		});
	});
});
