// Location: apps/web/src/lib/remotion/__tests__/player-wrapper-trim.test.ts
//
// Tests for Remotion trim-aware preview (Task 4 of remotion-first-class-timeline-plan.md)
// Validates frame offset computation for trimmed/split Remotion elements

import { describe, it, expect } from "vitest";

/**
 * Mirrors the frame computation logic from preview-element-renderer.tsx
 * for the remotion element type. Extracted here for unit testing.
 */
function computeRemotionFrame(
	currentTime: number,
	elementStartTime: number,
	trimStart: number,
	fps: number
): number {
	const localTime = currentTime - elementStartTime;
	return Math.max(0, Math.floor((localTime + trimStart) * fps));
}

describe("Remotion trim-aware frame computation", () => {
	const fps = 30;

	it("starts at frame 0 when no trim", () => {
		// Element starts at t=0, no trim, playhead at t=0
		const frame = computeRemotionFrame(0, 0, 0, fps);
		expect(frame).toBe(0);
	});

	it("offsets by trimStart when element is trimmed", () => {
		// Element starts at t=5, trimStart=2s, playhead at t=5
		// Should start at frame 60 (2s * 30fps)
		const frame = computeRemotionFrame(5, 5, 2, fps);
		expect(frame).toBe(60);
	});

	it("advances frames correctly during playback with trim", () => {
		// Element starts at t=5, trimStart=2s, playhead at t=6 (1s into visible portion)
		// Should be at frame 90 (3s * 30fps = trimStart + 1s elapsed)
		const frame = computeRemotionFrame(6, 5, 2, fps);
		expect(frame).toBe(90);
	});

	it("handles split element (first half)", () => {
		// Original 10s element split at t=5
		// First half: startTime=0, duration=10, trimStart=0, trimEnd=5
		// At playhead t=3: localTime=3, frame=3*30=90
		const frame = computeRemotionFrame(3, 0, 0, fps);
		expect(frame).toBe(90);
	});

	it("handles split element (second half)", () => {
		// Original 10s element split at t=5
		// Second half: startTime=5, duration=10, trimStart=5, trimEnd=0
		// At playhead t=5: localTime=0, frame=(0+5)*30=150
		const frame = computeRemotionFrame(5, 5, 5, fps);
		expect(frame).toBe(150);

		// At playhead t=7: localTime=2, frame=(2+5)*30=210
		const frame2 = computeRemotionFrame(7, 5, 5, fps);
		expect(frame2).toBe(210);
	});

	it("clamps to frame 0 when before element start", () => {
		// Playhead before element starts — should clamp to 0
		const frame = computeRemotionFrame(0, 5, 0, fps);
		expect(frame).toBe(0);
	});

	it("works with non-integer trim values", () => {
		// trimStart=1.5s, playhead at element start
		const frame = computeRemotionFrame(0, 0, 1.5, fps);
		expect(frame).toBe(45); // 1.5 * 30 = 45
	});

	it("works with 60fps", () => {
		const frame = computeRemotionFrame(2, 0, 1, 60);
		// (2 + 1) * 60 = 180
		expect(frame).toBe(180);
	});
});
