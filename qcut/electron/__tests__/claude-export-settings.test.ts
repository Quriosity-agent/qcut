import { describe, expect, it } from "vitest";
import type { ExportJobRequest } from "../types/claude-api";
import { resolveExportSettings } from "../claude/handlers/claude-export-handler/export-settings";
import { PRESETS } from "../claude/handlers/claude-export-handler/presets";

type ExportRequest = ExportJobRequest &
	NonNullable<ExportJobRequest["settings"]>;

describe("export preset metadata", () => {
	it("keeps the default preset when no output settings change", () => {
		expect(resolveExportSettings({ request: {} })).toMatchObject({
			presetId: "youtube-1080p",
			width: 1920,
			height: 1080,
			fps: 30,
			format: "mp4",
			bitrate: "8Mbps",
			codec: "libx264",
		});
	});

	it.each(PRESETS)("preserves the unmodified $id preset", ({ id }) => {
		expect(resolveExportSettings({ request: { preset: id } }).presetId).toBe(
			id
		);
	});

	it("reports the trailer's top-level dimensions as custom", () => {
		const request: ExportRequest = {
			width: 1470,
			height: 630,
			fps: 24,
			format: "mp4",
		};
		expect(resolveExportSettings({ request })).toMatchObject({
			presetId: "custom",
			width: 1470,
			height: 630,
			fps: 24,
			format: "mp4",
			bitrate: "8Mbps",
			codec: "libx264",
		});
	});

	it.each([
		{ label: "width", settings: { width: 1470 } },
		{ label: "height", settings: { height: 630 } },
		{ label: "fps", settings: { fps: 24 } },
		{ label: "format", settings: { format: "webm" } },
		{ label: "bitrate", settings: { bitrate: "4Mbps" } },
	])("reports a $label override as custom", ({ settings }) => {
		expect(
			resolveExportSettings({
				request: { preset: "youtube-1080p", settings },
			})
		).toMatchObject({ presetId: "custom", ...settings });
	});

	it("keeps equal explicit settings attached to their named preset", () => {
		const request: ExportRequest = {
			preset: " youtube-720p ",
			width: 1280,
			height: 720,
			fps: 30,
			bitrate: "5Mbps",
			format: "mp4",
			settings: { fps: 30 },
		};
		expect(resolveExportSettings({ request }).presetId).toBe("youtube-720p");
	});

	it("uses effective nested settings when deciding whether a preset matches", () => {
		const request: ExportRequest = {
			width: 1470,
			height: 630,
			fps: 24,
			format: "webm",
			bitrate: "4Mbps",
			settings: {
				width: 1920,
				height: 1080,
				fps: 30,
				format: "mp4",
				bitrate: "8Mbps",
			},
		};
		expect(resolveExportSettings({ request })).toMatchObject({
			presetId: "youtube-1080p",
			...request.settings,
		});
	});

	it("reports a nested override as custom even when top-level values match", () => {
		const request: ExportRequest = {
			width: 1920,
			height: 1080,
			fps: 30,
			settings: { width: 1470, height: 630, fps: 24 },
		};
		expect(resolveExportSettings({ request })).toMatchObject({
			presetId: "custom",
			width: 1470,
			height: 630,
			fps: 24,
		});
	});

	it("recognizes GIF frame rate overrides without changing GIF settings", () => {
		expect(
			resolveExportSettings({
				request: {
					preset: "gif-medium",
					gifConfig: { frameRate: 15, loop: false, quality: 5 },
				},
			})
		).toMatchObject({
			presetId: "custom",
			format: "gif",
			fps: 15,
			gifLoop: false,
			gifQuality: 5,
		});
	});

	it("keeps settings that are outside the preset independent of its label", () => {
		expect(
			resolveExportSettings({
				request: {
					preset: "youtube-1080p",
					outputPath: "/tmp/custom-name.mp4",
					audioExportConfig: { bitrate: 320, sampleRate: 44_100, channels: 1 },
				},
			})
		).toMatchObject({
			presetId: "youtube-1080p",
			audioBitrate: 320,
			audioSampleRate: 44_100,
			audioChannels: 1,
		});
	});

	it("continues to reject unknown presets instead of silently treating them as custom", () => {
		expect(() =>
			resolveExportSettings({ request: { preset: "not-a-preset" } })
		).toThrow("Invalid preset ID: not-a-preset");
	});
});
