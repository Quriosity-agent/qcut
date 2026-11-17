import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawn, mockFsPromises } = vi.hoisted(() => ({
	mockSpawn: vi.fn(),
	mockFsPromises: {
		access: vi.fn(async () => {}),
		mkdir: vi.fn(async () => {}),
		mkdtemp: vi.fn(async () => "/tmp/qcut-claude-export-test"),
		rename: vi.fn(async () => {}),
		writeFile: vi.fn(async () => {}),
		stat: vi.fn(async () => ({ isFile: () => true, size: 4096 })),
		rm: vi.fn(async () => {}),
	},
}));

vi.mock("node:child_process", () => {
	const mod = { spawn: (...args: unknown[]) => mockSpawn(...args) };
	return { ...mod, default: mod };
});

vi.mock("node:fs/promises", () => ({
	default: mockFsPromises,
	...mockFsPromises,
}));

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>();
	const existsSync = () => true;
	return { ...actual, default: { ...actual, existsSync }, existsSync };
});

vi.mock("../ffmpeg/utils.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../ffmpeg/utils.js")>();
	return {
		...actual,
		getFFmpegPath: () => "/mock/ffmpeg",
		parseProgress: () => null,
		probeHasAudioStream: vi.fn(async () => false),
	};
});

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/tmp") },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock("electron-log", () => ({
	default: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		log: vi.fn(),
	},
}));

import {
	clearExportJobsForTests,
	getExportJobStatus,
	startExportJob,
} from "../claude/handlers/claude-export-handler";
import {
	collectExportSegments,
	collectTimelineAudioFiles,
} from "../claude/handlers/claude-export-handler/export-engine";
import {
	ClipMediaMissingError,
	type MissingClipMedia,
	describeMissingClipMedia,
} from "../claude/handlers/claude-export-handler/missing-clip-media";
import type { ClaudeTimeline } from "../types/claude-api";

const mediaFiles = [
	{
		id: "media_here",
		name: "here.mp4",
		type: "video" as const,
		path: "/tmp/here.mp4",
		size: 1024,
		duration: 8,
		createdAt: 1,
		modifiedAt: 1,
	},
	{
		id: "media_sound",
		name: "sound.wav",
		type: "audio" as const,
		path: "/tmp/sound.wav",
		size: 1024,
		duration: 8,
		createdAt: 1,
		modifiedAt: 1,
	},
];

function clip({
	id,
	sourceId,
	startTime,
	...rest
}: {
	id: string;
	sourceId?: string;
	startTime: number;
	[key: string]: unknown;
}) {
	return {
		id,
		trackIndex: 0,
		startTime,
		endTime: startTime + 2,
		duration: 2,
		type: "media" as const,
		...(sourceId ? { sourceId } : {}),
		...rest,
	};
}

/**
 * A film whose shake overlay was renamed in the project folder: its clip
 * still asks for the id the file had before.
 */
function timelineWith({
	overlay,
	sound,
	extraTracks = [],
}: {
	overlay: Record<string, unknown>;
	sound: Record<string, unknown>;
	extraTracks?: unknown[];
}): ClaudeTimeline {
	return {
		name: "Film",
		duration: 8,
		width: 1920,
		height: 1080,
		fps: 24,
		tracks: [
			{ index: 0, name: "动效 · 震屏", type: "media", elements: [overlay] },
			{
				index: 1,
				name: "主轨道",
				type: "media",
				elements: [
					clip({ id: "main-1", sourceId: "media_here", startTime: 0 }),
					clip({ id: "main-2", sourceId: "media_here", startTime: 2 }),
				],
			},
			{ index: 2, name: "音效", type: "audio", elements: [sound] },
			...extraTracks,
		],
	} as unknown as ClaudeTimeline;
}

const RENAMED_SHAKE = clip({
	id: "shake-1",
	sourceId: "media_c2hha2UubXA0",
	startTime: 1.5,
	name: "震屏01",
});
const GONE_SOUND = clip({
	id: "hit-1",
	sourceId: "media_gone_sound",
	startTime: 3.25,
});
const SOUND = clip({ id: "hit-1", sourceId: "media_sound", startTime: 3.25 });

describe("a native export of clips whose media is not in the project", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearExportJobsForTests();
		mockSpawn.mockImplementation(() => {
			const proc = new EventEmitter() as EventEmitter & {
				stderr: EventEmitter;
				stdout: EventEmitter;
				kill: () => boolean;
			};
			proc.stderr = new EventEmitter();
			proc.stdout = new EventEmitter();
			proc.kill = () => true;
			setTimeout(() => proc.emit("close", 0), 0);
			return proc;
		});
	});

	it("names every such clip, picture and sound, and exports nothing", async () => {
		const start = startExportJob({
			projectId: "project_1",
			request: { outputPath: "/tmp/missing-media.mp4" },
			timeline: timelineWith({ overlay: RENAMED_SHAKE, sound: GONE_SOUND }),
			mediaFiles,
		});
		await expect(start).rejects.toBeInstanceOf(ClipMediaMissingError);
		const error = (await start.catch(
			(caught) => caught
		)) as ClipMediaMissingError;
		expect(error.missing).toEqual([
			{
				elementId: "shake-1",
				name: "震屏01",
				trackName: "动效 · 震屏",
				startTime: 1.5,
				wanted: "media_c2hha2UubXA0",
			},
			{
				elementId: "hit-1",
				trackName: "音效",
				startTime: 3.25,
				wanted: "media_gone_sound",
			},
		]);
		expect(error.message).toBe(
			'2 clips play media that is not in the project, and the export would leave them out: "震屏01" (shake-1) at 1.5 s on track "动效 · 震屏" asks for media_c2hha2UubXA0; hit-1 at 3.25 s on track "音效" asks for media_gone_sound. Nothing was exported. Import the media again or give the clips another file (editor:timeline:replace-media), delete them, or leave their tracks out with --exclude-tracks.'
		);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("exports when the clip is hidden, or its track is hidden or muted", async () => {
		const result = await startExportJob({
			projectId: "project_1",
			request: { outputPath: "/tmp/hidden-missing-media.mp4" },
			timeline: timelineWith({
				overlay: { ...RENAMED_SHAKE, hidden: true },
				sound: { ...GONE_SOUND, hidden: true },
				extraTracks: [
					{
						index: 3,
						name: "Hidden",
						type: "media",
						hidden: true,
						elements: [clip({ id: "h-1", sourceId: "media_x", startTime: 0 })],
					},
					{
						index: 4,
						name: "Muted",
						type: "audio",
						muted: true,
						elements: [clip({ id: "m-1", sourceId: "media_y", startTime: 0 })],
					},
				],
			}),
			mediaFiles,
		});
		expect(result.status).toBe("queued");
		await vi.waitFor(() => {
			expect(getExportJobStatus(result.jobId)?.status).toBe("completed");
		});
	});

	it("does not count a clip that names no media as missing one", async () => {
		const missingMedia: MissingClipMedia[] = [];
		const segments = await collectExportSegments({
			timeline: timelineWith({
				overlay: clip({ id: "blank-1", startTime: 1 }),
				sound: SOUND,
			}),
			mediaFiles,
			missingMedia,
		});
		expect(missingMedia).toEqual([]);
		expect(segments.map((segment) => segment.elementId)).toEqual([
			"main-1",
			"main-2",
		]);
	});

	it("still collects the other clips for a caller that does not ask what is missing", async () => {
		const timeline = timelineWith({
			overlay: RENAMED_SHAKE,
			sound: GONE_SOUND,
		});
		const segments = await collectExportSegments({ timeline, mediaFiles });
		expect(segments.map((segment) => segment.elementId)).toEqual([
			"main-1",
			"main-2",
		]);
		expect(await collectTimelineAudioFiles({ timeline, mediaFiles })).toEqual(
			[]
		);
	});

	it("says it of one clip in the singular, and counts those it does not list", () => {
		const one: MissingClipMedia = {
			elementId: "c1",
			trackName: "Main",
			startTime: 41.7,
			wanted: "V2_震屏01_踹盾.mp4",
		};
		expect(describeMissingClipMedia({ missing: [one] })).toBe(
			'1 clip plays media that is not in the project, and the export would leave it out: c1 at 41.7 s on track "Main" asks for V2_震屏01_踹盾.mp4. Nothing was exported. Import the media again or give the clip another file (editor:timeline:replace-media), delete it, or leave its track out with --exclude-tracks.'
		);
		const many = Array.from({ length: 12 }, (_, index) => ({
			...one,
			elementId: `c${index}`,
		}));
		const text = describeMissingClipMedia({ missing: many });
		expect(text).toContain("12 clips play media");
		expect(text).toContain("c9 at 41.7 s");
		expect(text).not.toContain("c10 at");
		expect(text).toContain("; and 2 more.");
	});
});
