import { describe, expect, it } from "vitest";
import {
	buildConcatLists,
	buildSegmentConcatArgs,
	concatSpan,
	firstFrameDelay,
	planConcatSpans,
	spanFileCounts,
	standaloneSpan,
} from "../claude/handlers/claude-export-handler/concat-timing.js";

describe("buildSegmentConcatArgs", () => {
	it("copies the picture from one list and encodes the PCM sound once from the other", () => {
		expect(
			buildSegmentConcatArgs({
				videoListPath: "/tmp/video.txt",
				audioListPath: "/tmp/audio.txt",
				outputPath: "/tmp/out.mp4",
				audio: { sampleRate: 44_100, channels: 1 },
				audioBitrateKbps: 256,
			})
		).toEqual([
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			"/tmp/video.txt",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			"/tmp/audio.txt",
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
			"-c:v",
			"copy",
			"-c:a",
			"aac",
			"-b:a",
			"256k",
			"-ar",
			"44100",
			"-ac",
			"1",
			"-movflags",
			"+faststart",
			"/tmp/out.mp4",
		]);
	});
});

describe("concatSpan", () => {
	it("counts the frames the preview shows in the span, not the span's length rounded up", () => {
		// 1.0333 s at 24 fps is 24.8 frames long; it shows frames 0–24.
		expect(
			concatSpan({ from: 0, to: 31 / 30, fps: 24, sampleRate: 48_000 })
		).toMatchObject({ frames: 25, samples: 49_600 });
		// 1.0167 s from 1.0333 s is 24.4 frames long; it shows frames 25–49.
		expect(
			concatSpan({ from: 31 / 30, to: 2.05, fps: 24, sampleRate: 48_000 })
		).toMatchObject({ frames: 25, samples: 48_800 });
	});

	it("puts an edge within a millisecond after a frame on that frame", () => {
		// A ripple delete leaves cut points a third of a microsecond late.
		expect(
			concatSpan({ from: 1 + 3e-7, to: 2, fps: 24, sampleRate: 48_000 }).frames
		).toBe(24);
	});
});

describe("firstFrameDelay", () => {
	it("is how far into a clip its first output frame falls", () => {
		// A clip that starts 0.6 of a frame before frame 25.
		const startTime = 61 / 60;
		const span = concatSpan({
			from: startTime,
			to: 2 * startTime,
			fps: 24,
			sampleRate: 48_000,
		});
		expect(firstFrameDelay({ span, startTime, fps: 24 })).toBeCloseTo(0.025, 9);
	});

	it("is zero for a clip that starts on a frame, or within a millisecond after one", () => {
		for (const startTime of [2, 2.0004]) {
			const span = concatSpan({
				from: startTime,
				to: startTime + 1,
				fps: 24,
				sampleRate: 48_000,
			});
			expect(firstFrameDelay({ span, startTime, fps: 24 })).toBe(0);
		}
	});

	it("is zero when the span starts before the clip does", () => {
		// The first file fills the timeline from 0, a sliver before its clip.
		const [span] = planConcatSpans({
			inputs: [{ startTime: 0.01, endTime: 1 }],
			fps: 25,
			sampleRate: 48_000,
		});
		expect(firstFrameDelay({ span, startTime: 0.01, fps: 25 })).toBe(0);
	});
});

describe("standaloneSpan", () => {
	it("keeps every frame that starts within a clip placed by its own start time", () => {
		// A transition export: 24.4 frames, wherever on the timeline it sits.
		expect(
			standaloneSpan({
				startTime: 61 / 60,
				endTime: 122 / 60,
				fps: 24,
				sampleRate: 48_000,
			})
		).toMatchObject({ frames: 25, samples: 48_800 });
		expect(
			standaloneSpan({ startTime: 2, endTime: 4, fps: 30, sampleRate: 48_000 })
		).toMatchObject({ frames: 60, samples: 96_000 });
	});
});

describe("spanFileCounts", () => {
	it("gives a file at least a frame and a sample, so FFmpeg can read it", () => {
		expect(spanFileCounts({ span: { frames: 0, samples: 0 } })).toEqual({
			frames: 1,
			samples: 1,
		});
		expect(spanFileCounts({ span: { frames: 24, samples: 48_000 } })).toEqual({
			frames: 24,
			samples: 48_000,
		});
	});
});

describe("planConcatSpans", () => {
	it("adds up to the timeline, so eleven non-whole-frame cuts move nothing", () => {
		// Clips 24.4 frames long, as a ripple delete on bar lines leaves them.
		const inputs = Array.from({ length: 11 }, (_, index) => ({
			startTime: (index * 61) / 60,
			endTime: ((index + 1) * 61) / 60,
		}));
		const spans = planConcatSpans({ inputs, fps: 24, sampleRate: 48_000 });
		let frame = 0;
		for (const [index, span] of spans.entries()) {
			// Each clip's first frame is the one the timeline puts it on.
			expect(frame).toBe(
				Math.max(0, Math.ceil(((index * 61) / 60 - 0.001) * 24))
			);
			frame += span.frames;
		}
		expect(frame).toBe(Math.ceil(((11 * 61) / 60 - 0.001) * 24));
		expect(spans.reduce((sum, span) => sum + span.samples, 0)).toBe(
			Math.round(((11 * 61) / 60) * 48_000)
		);
	});

	it("starts at zero and takes up a hole or an overlap too small for a gap clip where it is", () => {
		const spans = planConcatSpans({
			inputs: [
				{ startTime: 0.01, endTime: 1 },
				{ startTime: 1.01, endTime: 2.02 },
				{ startTime: 2, endTime: 3 },
			],
			fps: 25,
			sampleRate: 48_000,
		});
		expect(spans.map(({ from, to }) => [from, to])).toEqual([
			[0, 1.01],
			[1.01, 2],
			[2, 3],
		]);
		expect(spans.reduce((sum, span) => sum + span.frames, 0)).toBe(75);
	});
});

describe("buildConcatLists", () => {
	it("gives each file its picture's length in one list and its sound's in the other", () => {
		const lists = buildConcatLists({
			files: [
				{
					path: "/t/segment-0000.mov",
					span: concatSpan({
						from: 0,
						to: 31 / 30,
						fps: 24,
						sampleRate: 48_000,
					}),
				},
				{
					path: "/t/it's.mov",
					span: concatSpan({
						from: 31 / 30,
						to: 2.05,
						fps: 24,
						sampleRate: 48_000,
					}),
				},
			],
			fps: 24,
			sampleRate: 48_000,
		});
		expect(lists.video).toBe(
			[
				"file '/t/segment-0000.mov'",
				"duration 1.041667",
				"file '/t/it'\\''s.mov'",
				"duration 1.041666",
			].join("\n")
		);
		expect(lists.audio).toBe(
			[
				"file '/t/segment-0000.mov'",
				"duration 1.033333",
				"file '/t/it'\\''s.mov'",
				"duration 1.016667",
			].join("\n")
		);
	});

	it("cuts each length from the running total, so rounding never adds up", () => {
		const files = Array.from({ length: 300 }, (_, index) => ({
			path: `/t/${index}.mov`,
			span: { from: 0, to: 0, frames: 1, samples: 2000 },
		}));
		const total = (list: string) =>
			list
				.split("\n")
				.filter((line) => line.startsWith("duration "))
				.reduce(
					(sum, line) =>
						sum + Math.round(Number(line.slice("duration ".length)) * 1e6),
					0
				);
		const lists = buildConcatLists({ files, fps: 24, sampleRate: 48_000 });
		expect(total(lists.video)).toBe(Math.round((300 / 24) * 1e6));
		expect(total(lists.audio)).toBe(Math.round(((300 * 2000) / 48_000) * 1e6));
	});

	it("leaves a file whose span holds no frame out of the picture list", () => {
		const lists = buildConcatLists({
			files: [
				{
					path: "/t/a.mov",
					span: { from: 0, to: 1, frames: 24, samples: 48_000 },
				},
				{
					path: "/t/sliver.mov",
					span: { from: 1, to: 1.01, frames: 0, samples: 480 },
				},
			],
			fps: 24,
			sampleRate: 48_000,
		});
		expect(lists.video).not.toContain("sliver");
		expect(lists.audio).toContain("sliver");
	});

	it("leaves a file whose span holds no sample out of the sound list", () => {
		const lists = buildConcatLists({
			files: [
				{
					path: "/t/a.mov",
					span: { from: 0, to: 1, frames: 24, samples: 48_000 },
				},
				{
					path: "/t/empty.mov",
					span: { from: 1, to: 1, frames: 0, samples: 0 },
				},
			],
			fps: 24,
			sampleRate: 48_000,
		});
		expect(lists.video).not.toContain("empty");
		expect(lists.audio).not.toContain("empty");
	});
});
