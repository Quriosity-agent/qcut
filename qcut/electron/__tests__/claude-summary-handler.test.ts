import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
}));

import { generateProjectSummary } from "../claude/handlers/claude-summary-handler";

const settings = {
	name: "My Video",
	width: 1920,
	height: 1080,
	fps: 30,
	aspectRatio: "16:9",
	backgroundColor: "#000000",
	exportFormat: "mp4",
	exportQuality: "high",
};

const timeline = {
	name: "Timeline A",
	duration: 45,
	width: 1920,
	height: 1080,
	fps: 30,
	tracks: [
		{
			index: 0,
			name: "Main",
			type: "media",
			elements: [
				{
					id: "el_1",
					trackIndex: 0,
					startTime: 0,
					endTime: 20,
					duration: 20,
					type: "media" as const,
					sourceId: "media_video_1",
				},
				{
					id: "el_2",
					trackIndex: 0,
					startTime: 20,
					endTime: 45,
					duration: 25,
					type: "media" as const,
					sourceId: "media_video_2",
				},
			],
		},
		{
			index: 1,
			name: "Titles",
			type: "text",
			elements: [
				{
					id: "el_3",
					trackIndex: 1,
					startTime: 0,
					endTime: 5,
					duration: 5,
					type: "text" as const,
					content: "Intro",
				},
			],
		},
	],
};

const mediaFiles = [
	{
		id: "media_video_1",
		name: "clip-1.mp4",
		type: "video" as const,
		path: "/tmp/clip-1.mp4",
		size: 1234,
		duration: 20,
		createdAt: 1,
		modifiedAt: 1,
	},
	{
		id: "media_video_2",
		name: "clip-2.mp4",
		type: "video" as const,
		path: "/tmp/clip-2.mp4",
		size: 5678,
		duration: 25,
		createdAt: 1,
		modifiedAt: 1,
	},
	{
		id: "media_audio_1",
		name: "music.mp3",
		type: "audio" as const,
		path: "/tmp/music.mp3",
		size: 2222,
		duration: 45,
		createdAt: 1,
		modifiedAt: 1,
	},
];

const exportJobs = [
	{
		jobId: "export_1",
		projectId: "proj_1",
		status: "completed" as const,
		progress: 1,
		outputPath: "/tmp/out.mp4",
		startedAt: Date.now() - 2000,
		completedAt: Date.now() - 1000,
		fileSize: 52_428_800,
		presetId: "youtube-1080p",
	},
];

describe("generateProjectSummary", () => {
	it("generates valid markdown for populated project", () => {
		const summary = generateProjectSummary({
			timeline,
			mediaFiles,
			exportJobs,
			settings,
		});

		expect(summary.markdown).toContain("## Project: My Video");
		expect(summary.markdown).toContain("### Settings");
		expect(summary.markdown).toContain("### Timeline");
		expect(summary.markdown).toContain("### Exports");
	});

	it("includes all track summaries", () => {
		const summary = generateProjectSummary({
			timeline,
			mediaFiles,
			exportJobs,
			settings,
		});

		expect(summary.markdown).toContain("Main (media)");
		expect(summary.markdown).toContain("Titles (text)");
	});

	it("includes media library counts", () => {
		const summary = generateProjectSummary({
			timeline,
			mediaFiles,
			exportJobs,
			settings,
		});

		expect(summary.markdown).toContain("Videos: 2");
		expect(summary.markdown).toContain("Audio: 1");
		expect(summary.markdown).toContain("Total Files: 3");
	});

	it("includes export history", () => {
		const summary = generateProjectSummary({
			timeline,
			mediaFiles,
			exportJobs,
			settings,
		});

		expect(summary.markdown).toContain("youtube-1080p");
		expect(summary.markdown).toContain("50.0MB");
	});

	it("handles empty project gracefully", () => {
		const summary = generateProjectSummary({
			timeline: {
				...timeline,
				tracks: [],
				duration: 0,
			},
			mediaFiles: [],
			exportJobs: [],
			settings,
		});

		expect(summary.markdown).toContain("No tracks available");
		expect(summary.markdown).toContain("No completed exports");
		expect(summary.stats.trackCount).toBe(0);
	});

	it("returns stats matching timeline data", () => {
		const summary = generateProjectSummary({
			timeline,
			mediaFiles,
			exportJobs,
			settings,
		});

		expect(summary.stats.totalDuration).toBe(45);
		expect(summary.stats.trackCount).toBe(2);
		expect(summary.stats.elementCount).toBe(3);
		expect(summary.stats.mediaFileCount).toBe(3);
		expect(summary.stats.exportCount).toBe(1);
		expect(summary.stats.totalSourceDuration).toBe(90);
	});
});
