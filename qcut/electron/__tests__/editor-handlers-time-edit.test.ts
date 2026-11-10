import { afterEach, describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner.js";
import { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleTimelineEditingCommand } from "../native-pipeline/editor/editor-handlers-timeline.js";
import {
	snapSecondsToFrame,
	summarizeFrameAlignment,
} from "../native-pipeline/editor/editor-handlers-time-edit.js";

/**
 * `editing insert-gap`, `timeline snap --to frames` and `--snap-frames`: what
 * each command sends the editor, and what it refuses before calling it.
 */

afterEach(() => {
	vi.unstubAllGlobals();
});

interface Call {
	method: string;
	path: string;
	body: Record<string, unknown> | undefined;
}

function run(
	overrides: Partial<CLIRunOptions>,
	{ fps = 24 }: { fps?: unknown } = {}
) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const path = String(input).replace("http://127.0.0.1:19880", "");
			calls.push({
				method: init?.method ?? "GET",
				path,
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			});
			const data = path.endsWith("/settings")
				? { name: "Trailer", fps }
				: { answered: path };
			return new Response(JSON.stringify({ success: true, data }), {
				headers: { "Content-Type": "application/json" },
			});
		})
	);
	const client = new EditorApiClient({
		baseUrl: "http://127.0.0.1:19880",
		skipCapabilityCheck: true,
	});
	const options = {
		outputDir: "/tmp",
		json: false,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		projectId: "p1",
		...overrides,
	} as CLIRunOptions;
	return {
		calls,
		result: handleTimelineEditingCommand(client, options, vi.fn()),
	};
}

describe("snapSecondsToFrame", () => {
	it("gives the nearest frame's time", () => {
		expect(snapSecondsToFrame({ seconds: 52.425_333, fps: 24 })).toBeCloseTo(
			1258 / 24,
			12
		);
		expect(snapSecondsToFrame({ seconds: 0.02, fps: 24 })).toBe(0);
	});
});

describe("editor:editing:insert-gap", () => {
	it("asks the editor to open the time on the named tracks", async () => {
		const { calls, result } = run({
			command: "editor:editing:insert-gap",
			at: 0,
			duration: "5",
			trackId: "main, titles",
			keepAutomation: true,
		});
		expect(await result).toEqual({
			success: true,
			data: { answered: "/api/claude/timeline/p1/gap" },
		});
		expect(calls).toEqual([
			{
				method: "POST",
				path: "/api/claude/timeline/p1/gap",
				body: {
					time: 0,
					duration: 5,
					trackIds: ["main", "titles"],
					keepAutomation: true,
				},
			},
		]);
	});

	it("reads --start-time as --at, beside delete-range's flags", async () => {
		const { calls, result } = run({
			command: "editor:editing:insert-gap",
			startTime: 12.5,
			duration: "2",
		});
		expect((await result).success).toBe(true);
		expect(calls[0].body).toEqual({ time: 12.5, duration: 2 });
	});

	it("rounds the point and the length to frames with --snap-frames, and says what it used", async () => {
		const { calls, result } = run({
			command: "editor:editing:insert-gap",
			at: 52.425_333,
			duration: "2.01",
			snapFrames: true,
		});
		expect(await result).toEqual({
			success: true,
			data: {
				answered: "/api/claude/timeline/p1/gap",
				snapped: { fps: 24, time: 1258 / 24, duration: 2 },
			},
		});
		expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
			"GET /api/claude/project/p1/settings",
			"POST /api/claude/timeline/p1/gap",
		]);
		expect(calls[1].body).toEqual({ time: 1258 / 24, duration: 2 });
	});

	it("refuses a missing or unreadable point or length before calling the editor", async () => {
		for (const [overrides, error] of [
			[{ duration: "5" }, "Missing --at"],
			[
				{ at: Number.NaN, duration: "5" },
				"--at must be a number of seconds, 0 or more",
			],
			[
				{ at: -1, duration: "5" },
				"--at must be a number of seconds, 0 or more",
			],
			[{ at: 0 }, "Missing --duration"],
			[
				{ at: 0, duration: "5s" },
				'--duration must be a number of seconds above 0 (got "5s")',
			],
			[
				{ at: 0, duration: "0" },
				'--duration must be a number of seconds above 0 (got "0")',
			],
		] as const) {
			const { calls, result } = run({
				command: "editor:editing:insert-gap",
				...overrides,
			});
			expect(await result).toEqual({ success: false, error });
			expect(calls).toEqual([]);
		}
	});

	it("refuses a length that --snap-frames rounds away", async () => {
		const { calls, result } = run({
			command: "editor:editing:insert-gap",
			at: 0,
			duration: "0.01",
			snapFrames: true,
		});
		expect(await result).toEqual({
			success: false,
			error:
				"--duration 0.01 is less than half a frame at 24 fps, so --snap-frames leaves nothing to insert",
		});
		expect(calls.map((call) => call.method)).toEqual(["GET"]);
	});
});

describe("editor:timeline:snap --to frames", () => {
	it("asks the editor to snap the named tracks and clips", async () => {
		const { calls, result } = run({
			command: "editor:timeline:snap",
			to: "frames",
			trackId: "main",
			elementIds: ["a,b", "c"],
			frameAlign: "all",
			dryRun: true,
		});
		expect((await result).success).toBe(true);
		expect(calls).toEqual([
			{
				method: "POST",
				path: "/api/claude/timeline/p1/snap-to-frames",
				body: {
					trackIds: ["main"],
					elementIds: ["a", "b", "c"],
					frameAlign: "all",
					dryRun: true,
				},
			},
		]);
	});

	it("needs no clip named: every clip that is seen is the default", async () => {
		const { calls, result } = run({
			command: "editor:timeline:snap",
			to: "frames",
		});
		expect((await result).success).toBe(true);
		expect(calls[0].body).toEqual({});
	});

	it("refuses a frame-align it has no meaning for, and another --to", async () => {
		const none = run({
			command: "editor:timeline:snap",
			to: "frames",
			frameAlign: "none",
		});
		expect(await none.result).toEqual({
			success: false,
			error: "--frame-align must be visual or all with --to frames",
		});
		expect(none.calls).toEqual([]);
		const grid = run({ command: "editor:timeline:snap", to: "grid" });
		expect(await grid.result).toEqual({
			success: false,
			error: "--to must be beats or frames",
		});
	});
});

describe("--snap-frames on the commands that take a time", () => {
	it("rounds both ends of a deleted range", async () => {
		const { calls, result } = run({
			command: "editor:editing:delete-range",
			startTime: 48.125,
			endTime: 60.708,
			snapFrames: true,
		});
		expect(await result).toMatchObject({
			success: true,
			data: { snapped: { fps: 24, startTime: 1155 / 24, endTime: 1457 / 24 } },
		});
		expect(calls[1]).toMatchObject({
			method: "DELETE",
			path: "/api/claude/timeline/p1/range",
			body: { startTime: 1155 / 24, endTime: 1457 / 24 },
		});
	});

	it("refuses a range that rounds to nothing", async () => {
		const { calls, result } = run({
			command: "editor:editing:delete-range",
			startTime: 10.001,
			endTime: 10.012,
			snapFrames: true,
		});
		expect((await result).error).toContain("leaves nothing to delete");
		expect(calls.map((call) => call.method)).toEqual(["GET"]);
	});

	it("rounds a split point, a move target and a trim", async () => {
		const split = run({
			command: "editor:timeline:split",
			elementId: "clip",
			splitTime: 52.425_333,
			snapFrames: true,
		});
		expect(await split.result).toMatchObject({
			data: { snapped: { fps: 24, splitTime: 1258 / 24 } },
		});
		expect(split.calls[1].body).toEqual({ splitTime: 1258 / 24 });

		const move = run({
			command: "editor:timeline:move",
			elementId: "clip",
			seekTime: 10.03,
			snapFrames: true,
		});
		expect((await move.result).success).toBe(true);
		expect(move.calls[1].body).toEqual({ newStartTime: 241 / 24 });

		const trim = run({
			command: "editor:timeline:trim",
			elementId: "clip",
			startTime: 1.01,
			endTime: 3.99,
			snapFrames: true,
		});
		expect((await trim.result).success).toBe(true);
		expect(trim.calls[1].body).toEqual({ startTime: 1, endTime: 4 });
	});

	it("sends the times as given, and asks for no frame rate, without the flag", async () => {
		const { calls, result } = run({
			command: "editor:editing:delete-range",
			startTime: 48.125,
			endTime: 60.708,
		});
		expect(await result).toEqual({
			success: true,
			data: { answered: "/api/claude/timeline/p1/range" },
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].body).toMatchObject({ startTime: 48.125, endTime: 60.708 });
	});

	it("says so when the project gives no frame rate", async () => {
		const { result } = run(
			{
				command: "editor:timeline:split",
				elementId: "clip",
				splitTime: 5.01,
				snapFrames: true,
			},
			{ fps: null }
		);
		expect(await result).toMatchObject({
			success: false,
			error: expect.stringContaining(
				"Project p1 gave no frame rate to snap to (fps: null)"
			),
		});
	});
});

describe("summarizeFrameAlignment", () => {
	const clip = (id: string, start: number, end: number) => ({
		id,
		startTime: start / 24,
		endTime: end / 24,
	});

	it("counts the clips with an edge between frames, the main track's among them", () => {
		expect(
			summarizeFrameAlignment({
				timeline: {
					fps: 24,
					tracks: [
						{ elements: [clip("title", 12, 60.5)] },
						{
							isMain: true,
							elements: [
								clip("a", 0, 126.2),
								clip("b", 126.2, 240),
								clip("c", 240, 300),
							],
						},
					],
				},
			})
		).toEqual({
			fps: 24,
			offFrameClips: 3,
			mainTrackOffFrameClips: 2,
			elementIds: ["title", "a", "b"],
		});
	});

	it("reads float noise as on the frame, and lists at most twenty clips", () => {
		expect(
			summarizeFrameAlignment({
				timeline: {
					fps: 24,
					tracks: [
						{
							isMain: true,
							elements: [{ id: "a", startTime: 52.416_666_7, endTime: 60 }],
						},
					],
				},
			})
		).toMatchObject({ offFrameClips: 0, elementIds: [] });
		const many = summarizeFrameAlignment({
			timeline: {
				fps: 24,
				tracks: [
					{
						elements: Array.from({ length: 30 }, (_, index) =>
							clip(`c${index}`, index * 10 + 0.5, index * 10 + 9)
						),
					},
				],
			},
		});
		expect(many?.offFrameClips).toBe(30);
		expect(many?.elementIds).toHaveLength(20);
	});

	it("says nothing of a timeline that gives no frame rate", () => {
		expect(
			summarizeFrameAlignment({ timeline: { tracks: [] } })
		).toBeUndefined();
	});
});
