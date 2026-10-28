/**
 * N14 (2026-10-28 trailer report): putting a new media track over the main
 * one took an index the caller worked out and re-checked. `track move` also
 * takes `--above` or `--below` another track.
 */
import { describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleTimelineEditingCommand } from "../native-pipeline/editor/editor-handlers-timeline.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";

function run(overrides: Partial<CLIRunOptions>) {
	const patch = vi.fn(async () => ({ trackId: "subs", index: 2 }));
	const client = { patch } as unknown as EditorApiClient;
	const result = handleTimelineEditingCommand(
		client,
		{
			command: "editor:track:move",
			outputDir: "./output",
			json: true,
			verbose: false,
			quiet: false,
			saveIntermediates: false,
			projectId: "p1",
			trackId: "subs",
			...overrides,
		} as CLIRunOptions,
		() => {}
	);
	return { patch, result };
}

describe("track move", () => {
	it("places a track directly above or below another one", async () => {
		const above = run({ above: "main" });
		await expect(above.result).resolves.toEqual({
			success: true,
			data: { trackId: "subs", index: 2 },
		});
		expect(above.patch).toHaveBeenCalledWith(
			"/api/claude/timeline/p1/tracks/subs",
			{ aboveTrackId: "main" }
		);

		const below = run({ below: "main" });
		await below.result;
		expect(below.patch).toHaveBeenCalledWith(
			"/api/claude/timeline/p1/tracks/subs",
			{ belowTrackId: "main" }
		);
	});

	it("still moves to an index", async () => {
		const { patch, result } = run({ index: 0 });
		await result;
		expect(patch).toHaveBeenCalledWith("/api/claude/timeline/p1/tracks/subs", {
			index: 0,
		});
	});

	it("needs exactly one target", async () => {
		const error =
			"Give exactly one of --index, --above <trackId> or --below <trackId>";
		for (const overrides of [{}, { index: 1, above: "main" }]) {
			const { patch, result } = run(overrides);
			await expect(result).resolves.toEqual({ success: false, error });
			expect(patch).not.toHaveBeenCalled();
		}
	});
});
