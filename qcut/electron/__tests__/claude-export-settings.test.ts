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

describe("export peak correction", () => {
	it("hands a requested peak correction to the native engine", () => {
		expect(
			resolveExportSettings({ request: { peakCorrection: "whole" } })
				.peakCorrection
		).toBe("whole");
		expect(resolveExportSettings({ request: {} })).not.toHaveProperty(
			"peakCorrection"
		);
	});

	it("refuses a peak correction it does not know", () => {
		expect(() =>
			resolveExportSettings({
				request: { peakCorrection: "loud" as never },
			})
		).toThrow("Peak correction must be one of local, whole, check");
	});
});

describe("export without a named preset", () => {
	const trailer = { width: 1470, height: 630, fps: 24 };

	it("takes the project's size and frame rate", () => {
		expect(
			resolveExportSettings({ request: {}, project: trailer })
		).toMatchObject({
			presetId: "project",
			width: 1470,
			height: 630,
			fps: 24,
			format: "mp4",
			bitrate: "8Mbps",
			codec: "libx264",
		});
	});

	it("lets a named preset win over the project", () => {
		expect(
			resolveExportSettings({
				request: { preset: "youtube-720p" },
				project: trailer,
			})
		).toMatchObject({
			presetId: "youtube-720p",
			width: 1280,
			height: 720,
			fps: 30,
		});
	});

	it("reports values that differ from the project as custom", () => {
		expect(
			resolveExportSettings({
				request: { settings: { fps: 30 } },
				project: trailer,
			})
		).toMatchObject({ presetId: "custom", width: 1470, height: 630, fps: 30 });
	});

	it("keeps the project label when the request repeats the project's values", () => {
		expect(
			resolveExportSettings({
				request: { width: 1470, height: 630, fps: 24, format: "mp4" },
				project: trailer,
			}).presetId
		).toBe("project");
	});

	it("rounds odd sides down to even ones the encoder takes", () => {
		expect(
			resolveExportSettings({
				request: {},
				project: { width: 1471, height: 631, fps: 25 },
			})
		).toMatchObject({ width: 1470, height: 630, fps: 25 });
	});

	it.each([
		{ width: 1280, height: 720, bitrate: "5Mbps" },
		{ width: 960, height: 540, bitrate: "5Mbps" },
		{ width: 1470, height: 630, bitrate: "8Mbps" },
		{ width: 1080, height: 1920, bitrate: "8Mbps" },
		{ width: 2560, height: 1440, bitrate: "45Mbps" },
		{ width: 7680, height: 4320, bitrate: "45Mbps" },
	])("encodes $width×$height at the rate of the YouTube preset of its size", ({
		width,
		height,
		bitrate,
	}) => {
		expect(
			resolveExportSettings({
				request: {},
				project: { width, height, fps: 30 },
			}).bitrate
		).toBe(bitrate);
	});

	it.each([
		{ width: 0, height: 630, fps: 24 },
		{ width: 1470, height: Number.NaN, fps: 24 },
		{ width: 1470, height: 630, fps: 0 },
	])("falls back to YouTube 1080p when the project gives no usable picture", (project) => {
		expect(resolveExportSettings({ request: {}, project })).toMatchObject({
			presetId: "youtube-1080p",
			width: 1920,
			height: 1080,
			fps: 30,
		});
	});
});

describe("the picture's bitrate", () => {
	it.each([
		["24Mbps", "24Mbps"],
		["24M", "24Mbps"],
		["24000k", "24Mbps"],
		["24000kbps", "24Mbps"],
		[" 2.5 mbps ", "2500kbps"],
		["6500k", "6500kbps"],
	])("reads %s as %s", (given, expected) => {
		expect(
			resolveExportSettings({ request: { settings: { bitrate: given } } })
				.bitrate
		).toBe(expected);
	});

	// What the engine could not read used to export at 8 Mbps without a word.
	it.each([
		[24_000_000],
		["24"],
		["fast"],
		["0Mbps"],
		[""],
	])("refuses %j instead of falling back to 8 Mbps", (given) => {
		expect(() =>
			resolveExportSettings({
				request: { settings: { bitrate: given as unknown as string } },
			})
		).toThrow(/Bitrate must be a string such as "24Mbps" or "8000k"/);
	});

	it("reads a null rate as none given", () => {
		expect(
			resolveExportSettings({
				request: { settings: { bitrate: null as unknown as string } },
			}).bitrate
		).toBe("8Mbps");
	});

	it("still matches a preset when its own rate is written another way", () => {
		expect(
			resolveExportSettings({
				request: { preset: "youtube-1080p", settings: { bitrate: "8000k" } },
			})
		).toMatchObject({ presetId: "youtube-1080p", bitrate: "8Mbps" });
	});

	it("goes with the size given in the request when no preset is named", () => {
		const project = { width: 1920, height: 1080, fps: 24 };
		expect(
			resolveExportSettings({
				request: { settings: { width: 3840, height: 2160 } },
				project,
			})
		).toMatchObject({ width: 3840, height: 2160, bitrate: "45Mbps" });
		expect(
			resolveExportSettings({
				request: { settings: { width: 1280, height: 720 } },
				project,
			})
		).toMatchObject({ bitrate: "5Mbps" });
		// The project's own size, and a rate given outright, are as before.
		expect(resolveExportSettings({ request: {}, project }).bitrate).toBe(
			"8Mbps"
		);
		expect(
			resolveExportSettings({
				request: { settings: { width: 3840, height: 2160, bitrate: "20M" } },
				project,
			}).bitrate
		).toBe("20Mbps");
	});

	it("keeps a named preset's rate when only the size is changed", () => {
		expect(
			resolveExportSettings({
				request: {
					preset: "youtube-1080p",
					settings: { width: 3840, height: 2160 },
				},
			}).bitrate
		).toBe("8Mbps");
	});
});

describe("keeping the intermediate files", () => {
	it("is off unless the request asks", () => {
		expect(
			resolveExportSettings({ request: {} }).keepTempFiles
		).toBeUndefined();
		expect(
			resolveExportSettings({ request: { keepTemp: true } }).keepTempFiles
		).toBe(true);
	});
});
