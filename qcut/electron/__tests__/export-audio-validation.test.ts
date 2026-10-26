import { beforeEach, describe, expect, it, vi } from "vitest";
import { measureFileTruePeak } from "../ffmpeg/audio-true-peak.js";
import { validateExportAudioPeak } from "../claude/handlers/claude-export-handler/export-audio-validation.js";
import { ExportCancelledError } from "../claude/handlers/claude-export-handler/export-cancel.js";

vi.mock("../ffmpeg/audio-true-peak.js", () => ({
	measureFileTruePeak: vi.fn(),
}));

const limiter = { enabled: true, ceilingDb: -1 };
const outputPath = "/tmp/encoded.mp4";
beforeEach(() => {
	vi.mocked(measureFileTruePeak).mockReset();
});

describe("encoded export true-peak validation", () => {
	it("does not measure when the master limiter is off or missing", async () => {
		expect(await validateExportAudioPeak({ outputPath })).toEqual({});
		expect(
			await validateExportAudioPeak({
				outputPath,
				limiter: { ...limiter, enabled: false },
			})
		).toEqual({});
		expect(measureFileTruePeak).not.toHaveBeenCalled();
	});

	it.each([
		-3, -1, -0.96,
	])("passes a measured %s dBTP within meter rounding", async (peak) => {
		vi.mocked(measureFileTruePeak).mockResolvedValue(peak);
		expect(await validateExportAudioPeak({ outputPath, limiter })).toEqual({
			audioValidation: {
				status: "passed",
				ceilingDbtp: -1,
				truePeakDbtp: peak,
			},
		});
	});

	it.each([
		-0.9, 1.2,
	])("warns about %s dBTP without pretending the encoded ceiling holds", async (peak) => {
		vi.mocked(measureFileTruePeak).mockResolvedValue(peak);
		const result = await validateExportAudioPeak({ outputPath, limiter });
		expect(result.audioValidation).toEqual({
			status: "exceeded",
			ceilingDbtp: -1,
			truePeakDbtp: peak,
		});
		expect(result.warnings?.[0]).toContain(`${peak.toFixed(1)} dBTP`);
		expect(result.warnings?.[0]).toContain("master limiter ceiling of -1.0");
	});

	it("distinguishes silent audio from a file with no audio stream", async () => {
		vi.mocked(measureFileTruePeak)
			.mockResolvedValueOnce(Number.NEGATIVE_INFINITY)
			.mockResolvedValueOnce(null);
		const silent = await validateExportAudioPeak({ outputPath, limiter });
		expect(JSON.parse(JSON.stringify(silent))).toEqual({
			audioValidation: {
				status: "passed",
				ceilingDbtp: -1,
				truePeakDbtp: null,
			},
		});
		expect(await validateExportAudioPeak({ outputPath, limiter })).toEqual({
			audioValidation: { status: "no-audio", ceilingDbtp: -1 },
		});
	});

	it("reports a failed meter without marking an exported file safe", async () => {
		vi.mocked(measureFileTruePeak).mockRejectedValue(
			new Error("meter unavailable")
		);
		const result = await validateExportAudioPeak({ outputPath, limiter });
		expect(result.audioValidation).toEqual({
			status: "unavailable",
			ceilingDbtp: -1,
		});
		expect(result.warnings?.[0]).toContain("meter unavailable");
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects invalid meter output %s", async (peak) => {
		vi.mocked(measureFileTruePeak).mockResolvedValue(peak);
		expect(
			(await validateExportAudioPeak({ outputPath, limiter })).audioValidation
				?.status
		).toBe("unavailable");
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("serializes an invalid ceiling %s as unavailable", async (ceilingDb) => {
		const result = await validateExportAudioPeak({
			outputPath,
			limiter: { ...limiter, ceilingDb },
		});
		expect(JSON.parse(JSON.stringify(result)).audioValidation).toEqual({
			status: "unavailable",
			ceilingDbtp: null,
		});
		expect(measureFileTruePeak).not.toHaveBeenCalled();
	});

	it("cancels before launching a meter", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			validateExportAudioPeak({
				outputPath,
				limiter,
				signal: controller.signal,
			})
		).rejects.toBeInstanceOf(ExportCancelledError);
		expect(measureFileTruePeak).not.toHaveBeenCalled();
	});

	it("does not turn cancellation during measurement into a warning or success", async () => {
		const controller = new AbortController();
		vi.mocked(measureFileTruePeak).mockImplementation(async ({ signal }) => {
			expect(signal).toBe(controller.signal);
			controller.abort();
			throw new Error("measurement terminated");
		});
		await expect(
			validateExportAudioPeak({
				outputPath,
				limiter,
				signal: controller.signal,
			})
		).rejects.toBeInstanceOf(ExportCancelledError);
	});
});
