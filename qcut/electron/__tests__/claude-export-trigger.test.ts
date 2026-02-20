import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const { mockSpawn, mockGetFFmpegPath, mockParseProgress, mockFsPromises } =
	vi.hoisted(() => {
		const mockGetFFmpegPath = vi.fn(() => "/mock/ffmpeg");
		const mockParseProgress = vi.fn(() => null);

		const mockFsPromises = {
			mkdir: vi.fn(async () => {}),
			mkdtemp: vi.fn(async () => "/tmp/qcut-claude-export-test"),
			writeFile: vi.fn(async () => {}),
			stat: vi.fn(async () => ({ size: 4096 })),
			rm: vi.fn(async () => {}),
		};

		const mockSpawn = vi.fn();

		return {
			mockSpawn,
			mockGetFFmpegPath,
			mockParseProgress,
			mockFsPromises,
		};
	});

let spawnMode: "success" | "hang" = "success";

vi.mock("node:child_process", () => {
	const mod = { spawn: (...args: unknown[]) => mockSpawn(...args) };
	return { ...mod, default: mod };
});

vi.mock("node:fs/promises", () => ({
	default: mockFsPromises,
	...mockFsPromises,
}));

vi.mock("../ffmpeg/utils.js", () => ({
	getFFmpegPath: () => mockGetFFmpegPath(),
	parseProgress: (...args: unknown[]) => mockParseProgress(...args),
}));

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
	},
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
	startExportJob,
	getExportJobStatus,
	clearExportJobsForTests,
} from "../claude/claude-export-handler";

const testTimeline = {
	name: "Test Timeline",
	duration: 10,
	width: 1920,
	height: 1080,
	fps: 30,
	tracks: [
		{
			index: 0,
			name: "Track 1",
			type: "media",
			elements: [
				{
					id: "el_1",
					trackIndex: 0,
					startTime: 0,
					endTime: 5,
					duration: 5,
					type: "media" as const,
					sourceId: "media_1",
				},
			],
		},
	],
};

const testMediaFiles = [
	{
		id: "media_1",
		name: "clip.mp4",
		type: "video" as const,
		path: "/tmp/clip.mp4",
		size: 1024,
		duration: 5,
		createdAt: Date.now(),
		modifiedAt: Date.now(),
	},
];

function createMockProcess({
	shouldClose,
}: {
	shouldClose: boolean;
}): EventEmitter {
	const proc = new EventEmitter() as EventEmitter & {
		stderr: EventEmitter;
		stdout: EventEmitter;
	};
	proc.stderr = new EventEmitter();
	proc.stdout = new EventEmitter();

	if (shouldClose) {
		setTimeout(() => {
			proc.emit("close", 0);
		}, 0);
	}

	return proc;
}

describe("Claude export trigger", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearExportJobsForTests();
		spawnMode = "success";

		mockSpawn.mockImplementation(() =>
			createMockProcess({ shouldClose: spawnMode === "success" })
		);
	});

	it("starts export with valid preset", async () => {
		const result = await startExportJob({
			projectId: "project_1",
			request: {
				preset: "youtube-1080p",
				outputPath: "/tmp/export-preset.mp4",
			},
			timeline: testTimeline,
			mediaFiles: testMediaFiles,
		});

		expect(result.jobId).toMatch(/^export_/);
		expect(result.status).toBe("queued");
	});

	it("starts export with custom settings", async () => {
		const result = await startExportJob({
			projectId: "project_2",
			request: {
				preset: "youtube-1080p",
				settings: {
					width: 1280,
					height: 720,
					fps: 24,
					bitrate: "4Mbps",
					codec: "libx264",
				},
				outputPath: "/tmp/export-custom.mp4",
			},
			timeline: testTimeline,
			mediaFiles: testMediaFiles,
		});

		const job = getExportJobStatus(result.jobId);
		expect(job?.presetId).toBe("youtube-1080p");
		expect(["queued", "exporting", "completed"]).toContain(job?.status);
	});

	it("returns job ID immediately", async () => {
		spawnMode = "hang";

		const result = await startExportJob({
			projectId: "project_3",
			request: {
				preset: "youtube-1080p",
				outputPath: "/tmp/export-immediate.mp4",
			},
			timeline: testTimeline,
			mediaFiles: testMediaFiles,
		});

		expect(result.jobId).toMatch(/^export_/);
		expect(result.status).toBe("queued");

		const job = getExportJobStatus(result.jobId);
		expect(job).toBeTruthy();
		expect(["queued", "exporting"]).toContain(job?.status);
	});

	it("rejects invalid preset ID", async () => {
		await expect(
			startExportJob({
				projectId: "project_4",
				request: {
					preset: "invalid-preset",
				},
				timeline: testTimeline,
				mediaFiles: testMediaFiles,
			})
		).rejects.toThrow("Invalid preset ID");
	});

	it("rejects export when timeline is empty", async () => {
		await expect(
			startExportJob({
				projectId: "project_5",
				request: {
					preset: "youtube-1080p",
				},
				timeline: {
					...testTimeline,
					tracks: [
						{
							index: 0,
							name: "Track 1",
							type: "media",
							elements: [],
						},
					],
				},
				mediaFiles: testMediaFiles,
			})
		).rejects.toThrow("empty timeline");
	});

	it("rejects concurrent export requests for same project", async () => {
		spawnMode = "hang";

		await startExportJob({
			projectId: "project_6",
			request: {
				preset: "youtube-1080p",
				outputPath: "/tmp/export-1.mp4",
			},
			timeline: testTimeline,
			mediaFiles: testMediaFiles,
		});

		await expect(
			startExportJob({
				projectId: "project_6",
				request: {
					preset: "youtube-1080p",
					outputPath: "/tmp/export-2.mp4",
				},
				timeline: testTimeline,
				mediaFiles: testMediaFiles,
			})
		).rejects.toThrow("already in progress");
	});
});
