// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	audioEffectsNotAppliedWarning,
	buildTimelineAudioFile,
	readClipAudioSettings,
	segmentAudioFields,
	timelineClipGain,
} from "../claude/handlers/claude-export-handler/timeline-audio-file.js";
import type { AudioSettings } from "../ffmpeg/audio-settings.js";
import type { ClaudeElement } from "../types/claude-api.js";

function element(fields: Record<string, unknown>): ClaudeElement {
	return {
		id: "clip",
		trackIndex: 0,
		type: "media",
		startTime: 0,
		endTime: 4,
		duration: 4,
		...fields,
	} as unknown as ClaudeElement;
}

/** 问题记录 Q7/问题 2: the editor-API export used the stale legacy volume. */
describe("timeline clip gain for the editor-API native export", () => {
	it("prefers audio.volumeDb over a stale legacy volume", () => {
		const file = buildTimelineAudioFile({
			element: element({
				volume: 0.501,
				audio: { enabled: true, volumeDb: 2 },
			}),
			trackId: "track",
			mediaPath: "/tmp/a.wav",
		});
		expect(file?.volume).toBeCloseTo(10 ** (2 / 20), 6);
	});

	it("keeps the legacy volume for an element without audio settings", () => {
		const file = buildTimelineAudioFile({
			element: element({ volume: 0.501 }),
			trackId: "track",
			mediaPath: "/tmp/a.wav",
		});
		expect(file?.volume).toBeCloseTo(0.501, 6);
	});

	it("mutes a clip whose audio settings are disabled", () => {
		expect(
			timelineClipGain({
				audio: { enabled: false, volumeDb: 2 },
				fallback: 1,
			})
		).toBe(0);
	});

	it("applies the −60 dB silence floor the renderer graph uses", () => {
		expect(timelineClipGain({ audio: { volumeDb: -60 }, fallback: 1 })).toBe(0);
		expect(
			timelineClipGain({ audio: { volumeDb: -6 }, fallback: 1 })
		).toBeCloseTo(0.501187, 5);
	});

	it("falls back when the audio payload is not settings-shaped", () => {
		expect(timelineClipGain({ audio: "loud", fallback: 0.7 })).toBe(0.7);
		expect(timelineClipGain({ audio: { volumeDb: "x" }, fallback: 0.7 })).toBe(
			0.7
		);
	});
});

/** The editor's default clip settings, as `timeline export` gives them. */
function settings(overrides: Partial<AudioSettings> = {}): AudioSettings {
	return {
		enabled: true,
		volumeDb: 0,
		fadeIn: 0,
		fadeOut: 0,
		panEnabled: false,
		pan: 0,
		loudness: {
			enabled: false,
			targetLufs: -16,
			truePeakDb: -1.5,
			loudnessRange: 11,
		},
		denoise: { enabled: false, amount: 0, noiseFloorDb: -50 },
		voiceEnhance: { enabled: false, clarity: 0, warmth: 0, presence: 0 },
		pitch: { enabled: false, semitones: 0, preserveFormants: true },
		equalizer: { enabled: false, lowGainDb: 0, midGainDb: 0, highGainDb: 0 },
		compressor: {
			enabled: false,
			thresholdDb: -18,
			ratio: 3,
			attackMs: 10,
			releaseMs: 120,
			makeupGainDb: 0,
		},
		limiter: { enabled: false, ceilingDb: -1, releaseMs: 50 },
		reverb: { enabled: false, mix: 20, roomSize: 40, damping: 50 },
		echo: { enabled: false, mix: 15, delayMs: 220, feedback: 25 },
		telephone: { enabled: false, mix: 100 },
		...overrides,
	};
}

/**
 * N16 (2026-10-28 trailer report): a main-track clip's own volume, mute and
 * volume keyframes changed nothing in the native export.
 */
describe("a joined clip's own sound in the native export", () => {
	const fields = (audio: unknown, extra: Record<string, unknown> = {}) =>
		segmentAudioFields({
			element: element({ audio, ...extra }),
			duration: 4,
			fps: 30,
		});

	it("changes nothing for the default settings", () => {
		expect(fields(settings())).toEqual({});
	});

	it("mutes a disabled clip", () => {
		expect(
			fields(settings({ enabled: false, volumeDb: -60 }), { volume: 0 })
		).toEqual({ audioEnvelope: "volume=0" });
	});

	it("follows the volume keyframes on the clip's own clock", () => {
		const { audioEnvelope } = fields(
			settings({
				keyframes: {
					volumeDb: [
						{ id: "a", frame: 0, value: -60, easing: "linear" },
						{ id: "b", frame: 45, value: -60, easing: "linear" },
						{ id: "c", frame: 46, value: 0, easing: "linear" },
					],
				},
			})
		);
		expect(audioEnvelope).toMatch(/^volume='.*':eval=frame$/);
		// 45 frames at 30 fps: the curve turns at 1.5 s.
		expect(audioEnvelope).toContain("lt(t,1.5)");
		expect(audioEnvelope).toContain("-60");
	});

	it("reads a partial audio record and the legacy volume for their gain", () => {
		expect(fields({ volumeDb: -6 }).audioEnvelope).toMatch(/^volume=0\.501/);
		expect(fields(undefined, { volume: 0.5 })).toEqual({
			audioEnvelope: "volume=0.5",
		});
	});

	it("says when a clip has effects only the mix applies", () => {
		expect(
			fields(
				settings({
					equalizer: {
						enabled: true,
						lowGainDb: 3,
						midGainDb: 0,
						highGainDb: 0,
					},
				})
			)
		).toEqual({ audioEffectsNotApplied: true });
	});

	it("names those clips in the export's warning", () => {
		expect(
			audioEffectsNotAppliedWarning([
				{ elementId: "plain" },
				{ elementId: "eq", audioEffectsNotApplied: true },
			])
		).toContain("main-track clip(s) eq, but not their other audio effects");
		expect(audioEffectsNotAppliedWarning([{ elementId: "plain" }])).toBeNull();
	});

	it("gives a mix input the full settings, and only full ones", () => {
		const audio = settings({ volumeDb: -3 });
		expect(readClipAudioSettings(audio)).toBe(audio);
		expect(
			readClipAudioSettings({ enabled: true, volumeDb: 0 })
		).toBeUndefined();
		expect(
			buildTimelineAudioFile({
				element: element({ audio }),
				trackId: "track",
				mediaPath: "/tmp/a.wav",
			})?.audio
		).toBe(audio);
	});
});
