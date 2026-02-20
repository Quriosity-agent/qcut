import { describe, it, expect } from "vitest";
import { shouldIncludeAudio, mergeAudioSettings } from "@/types/export";
import type { ExportSettings, ExportSettingsWithAudio } from "@/types/export";

// ---------------------------------------------------------------------------
// Minimal base settings factory
// ---------------------------------------------------------------------------

const baseSettings: ExportSettings = {
	format: "mp4",
	quality: "1080p",
	filename: "test-export",
	width: 1920,
	height: 1080,
};

// ---------------------------------------------------------------------------
// shouldIncludeAudio
// ---------------------------------------------------------------------------

describe("shouldIncludeAudio", () => {
	it("returns true for plain ExportSettings (backward compat)", () => {
		expect(shouldIncludeAudio(baseSettings)).toBe(true);
	});

	it("returns true when includeAudio is explicitly true", () => {
		const settings: ExportSettingsWithAudio = {
			...baseSettings,
			includeAudio: true,
		};

		expect(shouldIncludeAudio(settings)).toBe(true);
	});

	it("returns false when includeAudio is explicitly false", () => {
		const settings: ExportSettingsWithAudio = {
			...baseSettings,
			includeAudio: false,
		};

		expect(shouldIncludeAudio(settings)).toBe(false);
	});

	it("returns true when includeAudio is undefined (defaults)", () => {
		const settings: ExportSettingsWithAudio = {
			...baseSettings,
			includeAudio: undefined,
		};

		expect(shouldIncludeAudio(settings)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// mergeAudioSettings
// ---------------------------------------------------------------------------

describe("mergeAudioSettings", () => {
	it("adds default audio options to base settings", () => {
		const merged = mergeAudioSettings(baseSettings);

		expect(merged.includeAudio).toBe(true);
		expect(merged.audioCodec).toBe("aac");
		expect(merged.audioBitrate).toBe(128);
		expect(merged.audioSampleRate).toBe(44_100);
		expect(merged.audioChannels).toBe(2);
	});

	it("respects overrides such as includeAudio: false", () => {
		const merged = mergeAudioSettings(baseSettings, {
			includeAudio: false,
		});

		expect(merged.includeAudio).toBe(false);
	});

	it("result contains both base settings and audio fields", () => {
		const merged = mergeAudioSettings(baseSettings, {
			audioCodec: "opus",
			audioBitrate: 192,
		});

		// base fields preserved
		expect(merged.format).toBe("mp4");
		expect(merged.quality).toBe("1080p");
		expect(merged.filename).toBe("test-export");
		expect(merged.width).toBe(1920);
		expect(merged.height).toBe(1080);

		// audio overrides applied
		expect(merged.audioCodec).toBe("opus");
		expect(merged.audioBitrate).toBe(192);

		// remaining defaults still present
		expect(merged.audioSampleRate).toBe(44_100);
		expect(merged.audioChannels).toBe(2);
	});
});
