import { describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import {
	beatsMark,
	timelineSnap,
} from "../native-pipeline/editor/editor-handlers-beats.js";

/**
 * `editor beats mark` resolves the clip's media, runs the main-process
 * detection and hands the result to the editor; `timeline snap --to beats`
 * sends the clips and options as one request.
 */

function options(extra: Partial<CLIRunOptions>): CLIRunOptions {
	return {
		command: "editor:beats:mark",
		projectId: "project-1",
		outputDir: "./output",
		json: true,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		...extra,
	} as CLIRunOptions;
}

function makeClient() {
	const detection = {
		bpm: 142.4,
		confidence: 0.75,
		duration: 98.7,
		beats: [{ timestamp: 4.04, strength: 1, index: 0, isDownbeat: true }],
		downbeats: [4.04],
	};
	const get = vi.fn(async (url: string) => {
		if (url === "/api/claude/timeline/project-1") {
			return {
				tracks: [
					{
						id: "music",
						elements: [
							{ id: "song", type: "media", sourceId: "media-9" },
							{ id: "title", type: "text" },
							{
								id: "hit",
								type: "media",
								sourceId: "media-7",
								trimStart: 0.5,
								playbackRate: 2,
							},
						],
					},
				],
			};
		}
		throw new Error(`unexpected GET ${url}`);
	});
	const post = vi.fn(async (url: string, body: Record<string, unknown>) => {
		if (url === "/api/claude/analyze/project-1/beats") return detection;
		if (url === "/api/claude/analyze/project-1/onset") {
			return {
				mediaId: body.mediaId,
				time: body.mediaId === "media-7" ? 0.9 : 0.8,
				strength: 1,
				threshold: body.threshold ?? 0.5,
				duration: 2,
			};
		}
		if (url === "/api/claude/timeline/project-1/beats/mark") {
			return {
				projectId: "project-1",
				elementId: body.elementId,
				trackId: "music",
				bpm: 142.4,
				onTimeline: 1,
				bookmarksAdded: body.bookmarks === "downbeats" ? 1 : 0,
			};
		}
		if (url === "/api/claude/timeline/project-1/snap-to-beats") {
			return { projectId: "project-1", moved: 2, results: [] };
		}
		throw new Error(`unexpected POST ${url}`);
	});
	return {
		client: { get, post } as unknown as EditorApiClient,
		get,
		post,
		detection,
	};
}

describe("editor beats mark", () => {
	it("analyses the clip's media and marks the beats, with bookmarks when asked", async () => {
		const { client, post, detection } = makeClient();
		const result = await beatsMark(
			client,
			options({ elementId: "song", bookmarks: "downbeats" })
		);
		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/analyze/project-1/beats",
			{ mediaId: "media-9" },
			{ timeout: 300_000 }
		);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/timeline/project-1/beats/mark",
			{ elementId: "song", result: detection, bookmarks: "downbeats" },
			{ timeout: 180_000 }
		);
		expect(result.data).toMatchObject({
			mediaId: "media-9",
			bpm: 142.4,
			bookmarksAdded: 1,
		});
	});

	it("refuses a text element and an unknown bookmarks choice", async () => {
		const { client } = makeClient();
		await expect(
			beatsMark(client, options({ elementId: "title" }))
		).rejects.toThrow("Element title is not a media clip");
		const refused = await beatsMark(
			client,
			options({ elementId: "song", bookmarks: "some" })
		);
		expect(refused.success).toBe(false);
		expect(refused.error).toContain("--bookmarks must be one of");
	});
});

describe("editor timeline snap --to beats", () => {
	it("sends the clips and options as one request", async () => {
		const { client, post } = makeClient();
		const result = await timelineSnap(
			client,
			options({
				command: "editor:timeline:snap",
				to: "beats",
				// The CLI keeps each --element-ids occurrence; one may hold a list.
				elementIds: ["a, b"],
				beatsFrom: "song",
				edge: "end",
				maxDistance: 0.25,
				downbeatsOnly: true,
				dryRun: true,
			})
		);
		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/timeline/project-1/snap-to-beats",
			{
				elementIds: ["a", "b"],
				beatsElementId: "song",
				edge: "end",
				maxDistance: 0.25,
				downbeatsOnly: true,
				dryRun: true,
			}
		);
	});

	it("checks its flags before sending anything", async () => {
		const { client, post } = makeClient();
		const noClips = await timelineSnap(
			client,
			options({ command: "editor:timeline:snap", to: "beats" })
		);
		expect(noClips.error).toContain("Missing --element-ids");
		const badEdge = await timelineSnap(
			client,
			options({
				command: "editor:timeline:snap",
				elementIds: ["a"],
				edge: "middle",
			})
		);
		expect(badEdge.error).toBe("--edge must be start, end or onset");
		const badAlign = await timelineSnap(
			client,
			options({
				command: "editor:timeline:snap",
				elementIds: ["a"],
				frameAlign: "sideways",
			})
		);
		expect(badAlign.error).toBe("--frame-align must be visual, all or none");
		const badThreshold = await timelineSnap(
			client,
			options({
				command: "editor:timeline:snap",
				elementIds: ["a"],
				edge: "onset",
				onsetThreshold: 2,
			})
		);
		expect(badThreshold.error).toContain("--onset-threshold");
		expect(post).not.toHaveBeenCalled();
	});

	it("with --edge onset finds each clip's attack through its trims and speed first", async () => {
		const { client, post } = makeClient();
		const result = await timelineSnap(
			client,
			options({
				command: "editor:timeline:snap",
				to: "beats",
				elementIds: ["song,hit,title"],
				edge: "onset",
				frameAlign: "none",
				onsetThreshold: 0.6,
			})
		);
		expect(result.success).toBe(true);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/analyze/project-1/onset",
			{ mediaId: "media-9", threshold: 0.6 },
			expect.any(Object)
		);
		expect(post).toHaveBeenCalledWith(
			"/api/claude/timeline/project-1/snap-to-beats",
			{
				elementIds: ["song", "hit", "title"],
				edge: "onset",
				// hit: (0.9 − trimStart 0.5) / rate 2 = 0.2; the title has none.
				edgeOffsets: { song: 0.8, hit: 0.2 },
				frameAlign: "none",
			}
		);
		expect(result.data).toMatchObject({
			onsets: {
				song: { mediaId: "media-9", sourceTime: 0.8, offset: 0.8 },
				hit: { mediaId: "media-7", sourceTime: 0.9, offset: 0.2 },
				title: {
					sourceTime: null,
					reason: expect.stringContaining("not a media clip"),
				},
			},
		});
	});
});
