import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAudioMeasurementProcess } from "../ffmpeg/audio-measurement-process.js";
import {
	measureFileTruePeak,
	measureFileTruePeakBlocks,
	parseTruePeakBlockLine,
	parseTruePeakSummary,
} from "../ffmpeg/audio-true-peak.js";

vi.mock("../ffmpeg/audio-measurement-process.js", () => ({
	runAudioMeasurementProcess: vi.fn(),
}));
vi.mock("../ffmpeg/utils.js", () => ({
	getFFmpegPath: () => "/ffmpeg",
	getFFprobePath: async () => "/ffprobe",
}));

beforeEach(() => {
	vi.mocked(runAudioMeasurementProcess).mockReset();
});

function reply({
	stdout = "",
	stderr = "",
}: {
	stdout?: string;
	stderr?: string;
}) {
	vi.mocked(runAudioMeasurementProcess).mockResolvedValueOnce({
		stdout,
		stderr,
	});
}

describe("true-peak summary", () => {
	it("reads the final summary rather than running peak logs", () => {
		expect(
			parseTruePeakSummary({
				stderr:
					"Summary:\nPeak: 5.0 dBFS\nSummary:\nTrue peak:\nPeak: -0.9 dBFS",
			})
		).toBe(-0.9);
	});
	it("preserves digital silence until it reaches the JSON contract", () => {
		expect(parseTruePeakSummary({ stderr: "Summary:\nPeak: -inf dBFS" })).toBe(
			Number.NEGATIVE_INFINITY
		);
	});
	it.each([
		"",
		"Summary: no audio",
		"Summary:\nPeak: NaN dBFS",
		"Summary:\nPeak: 1.2.3 dBFS",
	])("rejects incomplete or invalid output %s", (stderr) => {
		expect(() => parseTruePeakSummary({ stderr })).toThrow("no summary");
	});
});

describe("encoded file measurement", () => {
	it("checks for an audio stream before running the meter", async () => {
		reply({});
		expect(await measureFileTruePeak({ file: "silent-video.mp4" })).toBeNull();
		expect(runAudioMeasurementProcess).toHaveBeenCalledTimes(1);
	});
	it("reads the actual decoded audio with bounded summary-only logs", async () => {
		reply({ stdout: "1\n" });
		reply({ stderr: "Summary:\nPeak: 1.2 dBFS" });
		const controller = new AbortController();
		expect(
			await measureFileTruePeak({ file: "out.mp4", signal: controller.signal })
		).toBe(1.2);
		expect(runAudioMeasurementProcess).toHaveBeenLastCalledWith({
			command: "/ffmpeg",
			args: expect.arrayContaining([
				"-i",
				"out.mp4",
				"-map",
				"0:a:0",
				"ebur128=peak=true:framelog=verbose",
			]),
			signal: controller.signal,
			timeout: 30 * 60_000,
		});
	});
	it("does not launch a process for an already aborted measurement", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			measureFileTruePeak({ file: "out.mp4", signal: controller.signal })
		).rejects.toThrow();
		expect(runAudioMeasurementProcess).not.toHaveBeenCalled();
	});
});

/** A block line as FFmpeg 8's ebur128 logs it; FTPK is that block's own peak. */
function blockLine({ end, peaks }: { end: number; peaks: string }): string {
	return `[Parsed_ebur128_0 @ 0x1] t: ${end}  TARGET:-23 LUFS    M: -10.4 S: -12.9     I: -15.0 LUFS       LRA:   8.9 LU  FTPK: ${peaks} dBFS  TPK:  -2.0  -1.9 dBFS`;
}

describe("true-peak blocks", () => {
	it.each([
		{ peaks: " -3.1  -2.9", peakDb: -2.9 },
		{ peaks: "-18.1", peakDb: -18.1 },
		{ peaks: " -inf  -inf", peakDb: Number.NEGATIVE_INFINITY },
	])("reads a block's own peak from $peaks", ({ peaks, peakDb }) => {
		expect(
			parseTruePeakBlockLine({ line: blockLine({ end: 87.299979, peaks }) })
		).toEqual({ index: 872, peakDb });
	});

	it("ignores lines that are not blocks", () => {
		expect(
			parseTruePeakBlockLine({ line: "    Peak:       -1.7 dBFS" })
		).toBeNull();
		expect(
			parseTruePeakBlockLine({ line: "[out#0/null @ 0x1] video:0KiB" })
		).toBeNull();
	});

	function meter({ lines }: { lines: string[] }) {
		reply({ stdout: "1\n" });
		vi.mocked(runAudioMeasurementProcess).mockImplementationOnce(
			async ({ onStderrLine }) => {
				for (const line of lines) onStderrLine?.(line);
				return { stdout: "", stderr: "" };
			}
		);
	}

	it("keeps the blocks above the level and reads the summary", async () => {
		meter({
			lines: [
				blockLine({ end: 0.0999792, peaks: " -9.0  -8.0" }),
				blockLine({ end: 0.199979, peaks: " -1.2  -1.6" }),
				blockLine({ end: 0.299979, peaks: " -2.0  -2.4" }),
				"[Parsed_ebur128_0 @ 0x1] Summary:",
				"  True peak:",
				"    Peak:       -1.2 dBFS",
			],
		});
		expect(
			await measureFileTruePeakBlocks({ file: "out.mp4", aboveDb: -2.1 })
		).toEqual({
			truePeak: -1.2,
			blocks: [
				{ start: 0.1, end: 0.2, peakDb: -1.2 },
				{ start: 0.2, end: 0.30000000000000004, peakDb: -2 },
			],
		});
		expect(runAudioMeasurementProcess).toHaveBeenLastCalledWith(
			expect.objectContaining({
				args: expect.arrayContaining(["ebur128=peak=true:framelog=info"]),
			})
		);
	});

	it("reports a peak no logged block reaches as the last partial block", async () => {
		meter({
			lines: [
				blockLine({ end: 0.0999792, peaks: " -9.0  -8.0" }),
				"[Parsed_ebur128_0 @ 0x1] Summary:",
				"    Peak:       -0.5 dBFS",
			],
		});
		expect(
			await measureFileTruePeakBlocks({ file: "out.mp4", aboveDb: -1 })
		).toEqual({
			truePeak: -0.5,
			blocks: [{ start: 0.1, end: Number.POSITIVE_INFINITY, peakDb: -0.5 }],
		});
	});

	it("checks for an audio stream before running the meter", async () => {
		reply({});
		expect(
			await measureFileTruePeakBlocks({ file: "silent-video.mp4", aboveDb: -1 })
		).toEqual({ truePeak: null, blocks: [] });
		expect(runAudioMeasurementProcess).toHaveBeenCalledTimes(1);
	});
});
