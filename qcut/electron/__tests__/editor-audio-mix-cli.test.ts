import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readAudioMixOptions } from "../native-pipeline/cli/audio-mix-cli-options.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleGenerateExportCommand } from "../native-pipeline/editor/editor-handlers-generate.js";
import { handleTimelineEditingCommand } from "../native-pipeline/editor/editor-handlers-timeline.js";

/** The mixer commands: what each sends to the editor and what it prints. */

function options(
	command: string,
	overrides: Partial<CLIRunOptions> = {}
): CLIRunOptions {
	return {
		command,
		outputDir: "./output",
		json: true,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		projectId: "p1",
		...overrides,
	} as CLIRunOptions;
}

const bus = (id: string, name: string) => ({
	id,
	name,
	gainDb: 0,
	pan: 0,
	muted: false,
	solo: false,
	effects: {},
});

const mix = {
	projectId: "p1",
	master: bus("master", "Master"),
	buses: [bus("sfx", "SFX")],
	tracks: [
		{
			trackId: "guns",
			name: "SFX · Guns",
			type: "audio",
			muted: false,
			audio: { gainDb: -6 },
			effective: { silenced: false, busId: "sfx" },
		},
		{
			trackId: "voice",
			name: "Voice",
			type: "audio",
			muted: false,
			audio: { gainDb: 0 },
			effective: { silenced: false, busId: "master" },
		},
	],
};

function fakeClient() {
	const get = vi.fn(async () => mix);
	const patch = vi.fn(async () => ({
		track: mix.tracks[0],
		bus: mix.buses[0],
		mix,
	}));
	const post = vi.fn(async () => ({ busId: "sfx", bus: mix.buses[0], mix }));
	const del = vi.fn(async () => ({
		removed: "sfx",
		reroutedTrackIds: ["guns"],
		mix,
	}));
	const pollJob = vi.fn(async () => ({
		jobId: "job-1",
		status: "completed",
		result: {
			loudness: { integratedLufs: -14, truePeakDbtp: -1.1 },
			outputDir: "/abs/stems",
			stems: [{ busId: "sfx" }],
		},
	}));
	return {
		client: {
			get,
			patch,
			post,
			delete: del,
			pollJob,
		} as unknown as EditorApiClient,
		get,
		patch,
		post,
		del,
		pollJob,
	};
}

const run = (
	client: EditorApiClient,
	command: string,
	overrides?: Partial<CLIRunOptions>
) =>
	handleTimelineEditingCommand(client, options(command, overrides), () => {});

describe("mixer flags", () => {
	it("reads numbers, switches and JSON text", () => {
		expect(
			readAudioMixOptions({
				"gain-db": "-6",
				pan: "0.5",
				bus: "sfx",
				"no-mute": true,
				solo: true,
				off: true,
			})
		).toEqual({
			gainDb: -6,
			pan: 0.5,
			bus: "sfx",
			mute: false,
			solo: true,
			off: true,
		});
		expect(readAudioMixOptions({ "gain-db": "loud" }).gainDb).toBeNaN();
		expect(readAudioMixOptions({})).toEqual({});
	});
});

describe("track mixer commands", () => {
	it("sends only the given settings and prints the track read back", async () => {
		const { client, patch } = fakeClient();
		const result = await run(client, "editor:track:audio-set", {
			trackId: "guns",
			gainDb: -6,
			bus: "sfx",
			ducking: '{"enabled":true,"sourceTrackIds":["voice"]}',
		});
		expect(patch).toHaveBeenCalledWith("/api/claude/mix/p1/tracks/guns", {
			gainDb: -6,
			busId: "sfx",
			ducking: { enabled: true, sourceTrackIds: ["voice"] },
		});
		expect(result).toEqual({
			success: true,
			data: { projectId: "p1", track: mix.tracks[0] },
		});
	});

	it("names a flag that is not a number or not JSON", async () => {
		const { client, patch } = fakeClient();
		expect(
			await run(client, "editor:track:audio-set", {
				trackId: "guns",
				gainDb: Number.NaN,
			})
		).toEqual({ success: false, error: "--gain-db must be a number" });
		const badJson = await run(client, "editor:track:audio-set", {
			trackId: "guns",
			effects: "{compressor",
		});
		expect(badJson.success).toBe(false);
		expect(badJson.error).toMatch(/^--effects: /);
		expect(patch).not.toHaveBeenCalled();
	});

	it("sets a track's curve from --param and --points, or clears it", async () => {
		const { client, patch } = fakeClient();
		await run(client, "editor:track:audio-automation", {
			trackId: "guns",
			param: "gainDb",
			points: '[{"time":2.5,"value":-10},{"time":3,"value":-30}]',
		});
		await run(client, "editor:track:audio-automation", {
			trackId: "guns",
			param: "pan",
			clear: true,
		});
		expect(patch.mock.calls.map((call) => call[1])).toEqual([
			{
				automation: {
					gainDb: [
						{ time: 2.5, value: -10 },
						{ time: 3, value: -30 },
					],
				},
			},
			{ automation: { pan: null } },
		]);
		expect(
			await run(client, "editor:track:audio-automation", {
				trackId: "guns",
				param: "volume",
				points: "[]",
			})
		).toEqual({ success: false, error: "--param must be gainDb or pan" });
		expect(
			await run(client, "editor:track:audio-automation", {
				trackId: "guns",
				param: "gainDb",
			})
		).toEqual({
			success: false,
			error: "Give --points <json|@file> or --clear",
		});
	});

	it("mutes and solos, and turns them off with --off", async () => {
		const { client, patch } = fakeClient();
		await run(client, "editor:track:mute", { trackId: "guns" });
		await run(client, "editor:track:solo", { trackId: "guns", off: true });
		expect(patch.mock.calls.map((call) => call[1])).toEqual([
			{ muted: true },
			{ solo: false },
		]);
	});

	it("shows one track, or lists the audio tracks when the id is wrong", async () => {
		const { client } = fakeClient();
		expect(
			await run(client, "editor:track:audio-get", { trackId: "voice" })
		).toEqual({
			success: true,
			data: { projectId: "p1", track: mix.tracks[1] },
		});
		expect(
			await run(client, "editor:track:audio-get", { trackId: "titles" })
		).toEqual({
			success: false,
			error:
				"Track titles is not an audio track on the timeline; audio tracks: guns (SFX · Guns), voice (Voice)",
		});
	});
});

describe("bus and master commands", () => {
	it("lists each bus with the tracks feeding it", async () => {
		const { client } = fakeClient();
		const result = await run(client, "editor:mix:bus-list");
		expect(result.data).toMatchObject({
			master: { id: "master", tracks: [{ trackId: "voice", name: "Voice" }] },
			buses: [{ id: "sfx", tracks: [{ trackId: "guns", name: "SFX · Guns" }] }],
		});
	});

	it("creates a bus with the id and name given", async () => {
		const { client, post } = fakeClient();
		const result = await run(client, "editor:mix:bus-create", {
			trackName: "SFX",
			busId: "sfx",
			gainDb: -3,
		});
		expect(post).toHaveBeenCalledWith("/api/claude/mix/p1/buses", {
			name: "SFX",
			gainDb: -3,
			id: "sfx",
		});
		expect(result.data).toEqual({
			projectId: "p1",
			busId: "sfx",
			bus: mix.buses[0],
		});
	});

	it("changes a bus or the master, and removes a bus", async () => {
		const { client, patch, del } = fakeClient();
		await run(client, "editor:mix:bus-set", { busId: "sfx", mute: true });
		await run(client, "editor:mix:master-set", { gainDb: -1 });
		const removed = await run(client, "editor:mix:bus-remove", {
			busId: "sfx",
		});
		expect(patch.mock.calls).toEqual([
			["/api/claude/mix/p1/buses/sfx", { muted: true }],
			["/api/claude/mix/p1/buses/master", { gainDb: -1 }],
		]);
		expect(del).toHaveBeenCalledWith("/api/claude/mix/p1/buses/sfx");
		expect(removed.data).toEqual({
			projectId: "p1",
			removed: "sfx",
			reroutedTrackIds: ["guns"],
		});
	});

	it("sets a bus's or the master's curve", async () => {
		const { client, patch } = fakeClient();
		await run(client, "editor:mix:bus-automation", {
			busId: "master",
			param: "gainDb",
			points: '[{"time":0,"value":-6},{"time":4,"value":0}]',
		});
		expect(patch).toHaveBeenCalledWith("/api/claude/mix/p1/buses/master", {
			automation: {
				gainDb: [
					{ time: 0, value: -6 },
					{ time: 4, value: 0 },
				],
			},
		});
	});

	it("starts a loudness job and waits for its numbers", async () => {
		const { client, post, pollJob } = fakeClient();
		post.mockResolvedValueOnce({ jobId: "job-1", status: "running" } as never);
		const result = await run(client, "editor:mix:loudness", { timeout: 60 });
		expect(post).toHaveBeenCalledWith("/api/claude/mix/p1/loudness", {});
		expect(pollJob).toHaveBeenCalledWith("/api/claude/mix/p1/jobs/job-1", {
			interval: 3_000,
			timeout: 60_000,
		});
		expect(result).toEqual({
			success: true,
			data: {
				projectId: "p1",
				jobId: "job-1",
				integratedLufs: -14,
				truePeakDbtp: -1.1,
			},
		});
	});

	it("hands back the job id with --no-wait, and names it when the wait runs out", async () => {
		const { client, post, pollJob } = fakeClient();
		post.mockResolvedValue({ jobId: "job-1", status: "running" } as never);
		expect(await run(client, "editor:mix:loudness", { noWait: true })).toEqual({
			success: true,
			data: { projectId: "p1", jobId: "job-1", status: "running" },
		});
		pollJob.mockRejectedValueOnce(
			new Error(
				"Polling timed out after 10s, but job job-1 is still running (progress ?). Keep polling."
			)
		);
		expect(await run(client, "editor:mix:loudness", { timeout: 10 })).toEqual({
			success: false,
			error:
				"Waited 10 s; the render is still running in QCut (jobId=job-1). Follow it with: qcut editor mix job-status --project-id p1 --job-id job-1",
		});
	});

	it("reads a render job's status", async () => {
		const { client, get } = fakeClient();
		get.mockResolvedValueOnce({ jobId: "job-1", status: "running" } as never);
		expect(
			await run(client, "editor:mix:job-status", { jobId: "job-1" })
		).toEqual({
			success: true,
			data: { projectId: "p1", jobId: "job-1", status: "running" },
		});
		expect(get).toHaveBeenCalledWith("/api/claude/mix/p1/jobs/job-1");
	});
	it("writes stems into an absolute folder as a job, and needs one", async () => {
		const { client, post, pollJob } = fakeClient();
		post.mockResolvedValueOnce({ jobId: "job-1", status: "running" } as never);
		expect(await run(client, "editor:mix:stems")).toEqual({
			success: false,
			error: "Pass --output-dir <folder> for the stems",
		});
		const result = await run(client, "editor:mix:stems", {
			outputDir: "relative/stems",
			pollInterval: 1,
		});
		expect(post).toHaveBeenCalledWith("/api/claude/mix/p1/stems", {
			outputDir: path.resolve("relative/stems"),
		});
		expect(pollJob).toHaveBeenCalledWith("/api/claude/mix/p1/jobs/job-1", {
			interval: 1_000,
			timeout: 1_800_000,
		});
		expect(result.data).toEqual({
			projectId: "p1",
			jobId: "job-1",
			outputDir: "/abs/stems",
			stems: [{ busId: "sfx" }],
		});
	});
	it("writes stems beside an export once it is done", async () => {
		const post = vi.fn(async (route: string) =>
			route.endsWith("/start")
				? { jobId: "export-1" }
				: { jobId: "mix-1", status: "running" }
		);
		const pollJob = vi.fn(async (statusPath: string) =>
			statusPath.includes("/mix/")
				? {
						jobId: "mix-1",
						status: "completed",
						result: { outputDir: "/out", stems: [{ busId: "sfx" }] },
					}
				: { status: "completed", outputPath: "/out/doors.mp4" }
		);
		const client = { post, pollJob } as unknown as EditorApiClient;

		const result = await handleGenerateExportCommand(
			client,
			options("editor:export:start", {
				output: "/out/doors.mp4",
				stems: true,
			}),
			() => {}
		);

		expect(post).toHaveBeenLastCalledWith("/api/claude/mix/p1/stems", {
			// Resolved like the handler does, so Windows gets its drive letter too.
			outputDir: path.resolve("/out"),
			fileNamePrefix: "doors-",
		});
		expect(result).toMatchObject({
			success: true,
			data: {
				outputPath: "/out/doors.mp4",
				stems: { jobId: "mix-1", outputDir: "/out" },
			},
		});
		expect(
			await handleGenerateExportCommand(
				client,
				options("editor:export:start", { stems: true }),
				() => {}
			)
		).toEqual({
			success: false,
			error: "--stems needs --output: the stems go beside it",
		});
	});
	it("says what to pass when nothing would change", async () => {
		const { client } = fakeClient();
		expect(await run(client, "editor:mix:master-set")).toEqual({
			success: false,
			error: "Pass --gain-db, --pan, --mute/--no-mute or --effects",
		});
	});
});
