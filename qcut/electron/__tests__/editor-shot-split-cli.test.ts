import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import {
	parseCutPoints,
	timelineJobStatus,
	timelineShotSplit,
} from "../native-pipeline/editor/editor-handlers-shot-split.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import { getCommand } from "../native-pipeline/cli/command-registry.js";
import { parseCliArgs } from "../native-pipeline/cli/cli.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function fakeClient() {
	const post = vi.fn(async () => ({ jobId: "job-1", status: "running" }));
	const get = vi.fn(async () => ({ jobId: "job-1", status: "running" }));
	const pollJob = vi.fn(async () => ({
		jobId: "job-1",
		status: "completed",
		result: {
			results: [
				{
					elementId: "e1",
					cuts: [{ sourceTime: 3.333, timelineTime: 136.625 }],
				},
			],
			failed: [],
		},
	}));
	return {
		client: { post, get, pollJob } as unknown as EditorApiClient,
		post,
		get,
		pollJob,
	};
}

const options = (overrides: Partial<CLIRunOptions>): CLIRunOptions =>
	({
		command: "editor:timeline:shot-split",
		projectId: "p1",
		...overrides,
	}) as CLIRunOptions;

describe("--cuts", () => {
	it("reads comma-separated seconds and files from analyze shots or scenes", () => {
		expect(parseCutPoints({ text: "3.333, 15.167 21.5" })).toEqual([
			3.333, 15.167, 21.5,
		]);
		const dir = mkdtempSync(join(tmpdir(), "qcut-cuts-"));
		dirs.push(dir);
		writeFileSync(join(dir, "list.json"), "[1, 2.5]");
		writeFileSync(
			join(dir, "shots.json"),
			JSON.stringify({
				status: "ok",
				data: { data: { cut_points: [3.333, 4.125] } },
			})
		);
		writeFileSync(
			join(dir, "scenes.json"),
			JSON.stringify({ scenes: [{ timestamp: 0 }, { timestamp: 7.5 }] })
		);
		expect(parseCutPoints({ text: `@${join(dir, "list.json")}` })).toEqual([
			1, 2.5,
		]);
		expect(parseCutPoints({ text: `@${join(dir, "shots.json")}` })).toEqual([
			3.333, 4.125,
		]);
		expect(parseCutPoints({ text: `@${join(dir, "scenes.json")}` })).toEqual([
			7.5,
		]);
		expect(() => parseCutPoints({ text: "a,b" })).toThrow("--cuts needs");
	});
});

describe("editor timeline shot-split", () => {
	it("registers with its flags under the timeline group", () => {
		const command = getCommand("editor:timeline:shot-split");
		expect(command?.flags.map((flag) => flag.name)).toEqual(
			expect.arrayContaining([
				"--element-id",
				"--track-id",
				"--engine",
				"--cuts",
				"--dry-run",
				"--min-shot",
			])
		);
		expect(
			parseCliArgs([
				"editor",
				"timeline",
				"shot-split",
				"--project-id",
				"p",
				"--element-id",
				"e",
				"--cuts",
				"1,2",
				"--min-shot",
				"0.5",
				"--dry-run",
			])
		).toMatchObject({
			command: "editor:timeline:shot-split",
			cuts: "1,2",
			minShot: 0.5,
			dryRun: true,
		});
		expect(
			getCommand("editor:timeline:job-status")?.flags.map((f) => f.name)
		).toEqual(["--project-id", "--job-id"]);
		expect(getCommand("editor:analyze:engines")).toBeDefined();
		expect(
			getCommand("editor:analyze:scenes")?.flags.map((f) => f.name)
		).toEqual(expect.arrayContaining(["--engine", "--ai-analysis"]));
	});

	it("needs exactly one target and valid flags", async () => {
		const { client } = fakeClient();
		expect(await timelineShotSplit(client, options({}))).toEqual({
			success: false,
			error: "Give exactly one of --element-id or --track-id",
		});
		expect(
			await timelineShotSplit(
				client,
				options({ elementId: "e1", trackId: "t1" })
			)
		).toMatchObject({ success: false });
		expect(
			await timelineShotSplit(
				client,
				options({ elementId: "e1", engine: "magic" })
			)
		).toEqual({
			success: false,
			error: "--engine must be one of auto, jianying, onnx, ffmpeg",
		});
		expect(
			await timelineShotSplit(client, options({ elementId: "e1", minShot: -1 }))
		).toMatchObject({
			success: false,
			error: expect.stringContaining("--min-shot"),
		});
	});

	it("starts the job with the plan, waits for it and hands back its result", async () => {
		const { client, post, pollJob } = fakeClient();
		const result = await timelineShotSplit(
			client,
			options({
				elementId: "e1",
				engine: "jianying",
				cuts: "3.333",
				minShot: 1,
				dryRun: true,
				timeout: 30,
			})
		);
		expect(post).toHaveBeenCalledWith("/api/claude/timeline/p1/shot-split", {
			elementId: "e1",
			engine: "jianying",
			cuts: [3.333],
			minShotSeconds: 1,
			dryRun: true,
		});
		expect(pollJob).toHaveBeenCalledWith("/api/claude/timeline/p1/jobs/job-1", {
			interval: 2_000,
			timeout: 30_000,
		});
		expect(result).toMatchObject({
			success: true,
			data: {
				projectId: "p1",
				jobId: "job-1",
				results: [{ elementId: "e1" }],
				failed: [],
			},
		});
	});

	it("returns the job id with --no-wait and names the job when the wait runs out", async () => {
		const { client, pollJob } = fakeClient();
		expect(
			await timelineShotSplit(client, options({ trackId: "t1", noWait: true }))
		).toEqual({
			success: true,
			data: { projectId: "p1", jobId: "job-1", status: "running" },
		});
		pollJob.mockRejectedValueOnce(
			new Error("Polling timed out after 5s, but job job-1 is still running")
		);
		expect(
			await timelineShotSplit(client, options({ trackId: "t1", timeout: 5 }))
		).toEqual({
			success: false,
			error:
				"Waited 5 s; the shot split is still running in QCut (jobId=job-1). Follow it with: qcut editor timeline job-status --project-id p1 --job-id job-1",
		});
	});

	it("reads a job's status", async () => {
		const { client, get } = fakeClient();
		expect(
			await timelineJobStatus(client, options({ jobId: "job-1" }))
		).toEqual({
			success: true,
			data: { jobId: "job-1", status: "running" },
		});
		expect(get).toHaveBeenCalledWith("/api/claude/timeline/p1/jobs/job-1");
		expect(await timelineJobStatus(client, options({}))).toEqual({
			success: false,
			error: "Missing --job-id",
		});
	});
});
