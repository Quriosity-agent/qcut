// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	buildTimelineAudioFile,
	timelineClipGain,
} from "../claude/handlers/claude-export-handler/timeline-audio-file.js";
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
