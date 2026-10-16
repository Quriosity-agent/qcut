import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";

vi.mock("../native-pipeline/cli/project-json-builder.js", () => ({
	buildProjectJSON: vi.fn(async () => ({
		version: "1.0",
		projectId: "project-1",
		name: "门的计划",
		media: [],
	})),
	buildProjectJSONMinimal: vi.fn(),
}));

import { handleMediaProjectCommand } from "../native-pipeline/editor/editor-handlers-media.js";

describe("editor:project:export-state", () => {
	let dir: string;
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("writes the open editor's timeline next to the project state", async () => {
		dir = mkdtempSync(path.join(tmpdir(), "qcut-export-state-"));
		const client = {
			get: vi.fn(async (requestPath: string) => {
				if (requestPath === "/api/claude/timeline/project-1") {
					return { tracks: [{ id: "main", transitions: [{ id: "t1" }] }] };
				}
				throw new Error(`Unexpected path: ${requestPath}`);
			}),
		} as unknown as EditorApiClient;
		const output = path.join(dir, "state.json");
		const result = await handleMediaProjectCommand(client, {
			command: "editor:project:export-state",
			projectId: "project-1",
			output,
			outputDir: dir,
		} as CLIRunOptions);
		expect(result.success).toBe(true);
		const written = JSON.parse(readFileSync(output, "utf8"));
		expect(written.timeline.tracks[0].transitions).toEqual([{ id: "t1" }]);
		expect(written.timelineUnavailable).toBeUndefined();
	});

	it("says why the timeline is missing when the project is not open", async () => {
		dir = mkdtempSync(path.join(tmpdir(), "qcut-export-state-"));
		const client = {
			get: vi.fn(async () => {
				throw new Error("Project project-1 is not open in the editor");
			}),
		} as unknown as EditorApiClient;
		const output = path.join(dir, "state.json");
		await handleMediaProjectCommand(client, {
			command: "editor:project:export-state",
			projectId: "project-1",
			output,
			outputDir: dir,
		} as CLIRunOptions);
		const written = JSON.parse(readFileSync(output, "utf8"));
		expect(written.timeline).toBeUndefined();
		expect(written.timelineUnavailable).toContain("not open");
	});
});
