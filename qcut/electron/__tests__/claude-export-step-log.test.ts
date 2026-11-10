import { describe, expect, it } from "vitest";
import {
	exportStepLogFor,
	exportStepScript,
	formatShellArgs,
	graphRebuildReasons,
	graphRebuildWarnings,
	openExportStepLog,
} from "../claude/handlers/claude-export-handler/export-step-log.js";

describe("an export's step log", () => {
	it("is filed under the job's cancellation signal", () => {
		const first = new AbortController();
		const second = new AbortController();
		const log = openExportStepLog({ signal: first.signal });
		expect(exportStepLogFor({ signal: first.signal })).toBe(log);
		expect(exportStepLogFor({ signal: second.signal })).toBeUndefined();
		expect(exportStepLogFor({})).toBeUndefined();
	});
});

describe("graphRebuildReasons", () => {
	it("reads each reason FFmpeg gave once, in its own words", () => {
		const stderr = [
			"frame=   12 fps=0.0 q=28.0 size=       0KiB time=00:00:00.41",
			"[fc#0 @ 0x152809400] Reconfiguring filter graph because video parameters changed to yuv420p(tv, bt709), 1470x630, unspecified alpha",
			"frame= 3600 fps=120 q=28.0",
			"[fc#0 @ 0x152809400] Reconfiguring filter graph because video parameters changed to yuv420p(tv, bt709), 1470x630, unspecified alpha\r",
		].join("\n");
		expect(graphRebuildReasons({ stderr })).toEqual([
			"video parameters changed to yuv420p(tv, bt709), 1470x630, unspecified alpha",
		]);
		expect(graphRebuildReasons({ stderr: "frame= 1 fps=0.0" })).toEqual([]);
	});
});

describe("graphRebuildWarnings", () => {
	const reasons = ["video parameters changed to yuv420p(tv, bt709)"];

	it("warns about a step that read other inputs beside the one that changed", () => {
		expect(
			graphRebuildWarnings({
				log: {
					commands: [],
					rebuilds: [
						{
							args: [
								"-y",
								"-i",
								"/tmp/x/video-before-media-overlays.mp4",
								"-t",
								"2",
								"-i",
								"/media/card.mov",
								"-i",
								"/media/grain.mov",
								"-filter_complex",
								"…",
								"/tmp/x/out.mp4",
							],
							reasons,
						},
					],
				},
			})
		).toEqual([
			"FFmpeg rebuilt a filter graph while it read video-before-media-overlays.mp4 with 2 other input(s) (video parameters changed to yuv420p(tv, bt709)). The frames it had read ahead from them are lost at that point, so what is drawn or mixed over that input can start a few frames into itself there.",
		]);
	});

	it("says nothing of a step with one input, which has read nothing ahead", () => {
		expect(
			graphRebuildWarnings({
				log: {
					commands: [],
					rebuilds: [
						{
							args: [
								"-y",
								"-i",
								"/tmp/x/concat-before-text.mp4",
								"-vf",
								"ass=t.ass",
								"/tmp/x/out.mp4",
							],
							reasons,
						},
					],
				},
			})
		).toEqual([]);
	});
});

describe("the kept commands", () => {
	it("quotes what a shell would split or expand, and nothing else", () => {
		expect(
			formatShellArgs({
				args: [
					"-i",
					"/Volumes/My Drive/it's.mov",
					"-vf",
					"scale=1470:630",
					"-t",
					"2.5",
				],
			})
		).toBe("-i '/Volumes/My Drive/it'\\''s.mov' -vf scale=1470:630 -t 2.5");
		expect(
			formatShellArgs({ args: ["-filter_complex", "[0:v][1:v]overlay[out]"] })
		).toBe("-filter_complex '[0:v][1:v]overlay[out]'");
	});

	it("are one runnable command a line, in the order they ran", () => {
		expect(
			exportStepScript({
				ffmpegPath: "/Applications/QCut.app/ffmpeg",
				log: {
					commands: [
						["-y", "-i", "a.mov", "segment-0000.mov"],
						["-y", "-f", "concat", "-i", "list one.txt", "out.mp4"],
					],
					rebuilds: [],
				},
			})
		).toBe(
			[
				"#!/bin/sh",
				"# The FFmpeg commands of this export, in the order they ran.",
				"/Applications/QCut.app/ffmpeg -y -i a.mov segment-0000.mov",
				"/Applications/QCut.app/ffmpeg -y -f concat -i 'list one.txt' out.mp4",
				"",
			].join("\n")
		);
	});
});
