import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAudioMeasurementProcess } from "../ffmpeg/audio-measurement-process.js";
import {
	measureFileTruePeak,
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
