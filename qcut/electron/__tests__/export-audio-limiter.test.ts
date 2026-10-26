import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	renderTruePeakLimitedExport,
	type TruePeakLimitedExportOptions,
} from "../claude/handlers/claude-export-handler/export-audio-limiter";
import { runAudioMeasurementProcess } from "../ffmpeg/audio-measurement-process";
import { measureFileTruePeak } from "../ffmpeg/audio-true-peak";

vi.mock("../ffmpeg/audio-measurement-process", () => ({
	runAudioMeasurementProcess: vi.fn(),
}));
vi.mock("../ffmpeg/audio-true-peak", () => ({ measureFileTruePeak: vi.fn() }));
vi.mock("../ffmpeg/utils", () => ({ getFFmpegPath: () => "ffmpeg" }));

let directory = "";
let options: TruePeakLimitedExportOptions;
const processMock = vi.mocked(runAudioMeasurementProcess);
const meterMock = vi.mocked(measureFileTruePeak);

beforeEach(async () => {
	vi.resetAllMocks();
	directory = await fs.mkdtemp(path.join(tmpdir(), "qcut-limiter-unit-"));
	options = {
		sourceAudioPath: path.join(directory, "source.wav"),
		sourceVideoPath: path.join(directory, "source.mp4"),
		outputPath: path.join(directory, "output.mp4"),
		tempDir: directory,
		duration: 3,
		limiter: { ceilingDb: -1, releaseMs: 50 },
		sampleRate: 48_000,
		channels: 2,
		bitrateKbps: 192,
		format: "mp4",
	};
	await fs.writeFile(options.outputPath, "existing output");
	processMock.mockImplementation(async ({ args }) => {
		await fs.writeFile(args.at(-1) as string, "new measured output");
		return { stdout: "", stderr: "" };
	});
	meterMock.mockResolvedValue(-1.4);
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

async function expectOriginalPreserved() {
	expect(await fs.readFile(options.outputPath, "utf8")).toBe("existing output");
	expect(await fs.readdir(directory)).toEqual(["output.mp4"]);
}

describe("verified true-peak export", () => {
	it("encodes corrections from one lossless source and publishes only the passing candidate", async () => {
		meterMock.mockResolvedValueOnce(0.7).mockResolvedValueOnce(-1.3);
		const result = await renderTruePeakLimitedExport(options);
		expect(result.audioValidation).toEqual({
			status: "passed",
			ceilingDbtp: -1,
			truePeakDbtp: -1.3,
			limiting: { oversampleFactor: 4, encodeAttempts: 2, attenuationDb: 2 },
		});
		const [limit, first, second] = processMock.mock.calls.map(([call]) => call);
		expect(limit.args).toContain("pcm_f32le");
		expect(limit.args).toContain("auto");
		const source = limit.args.at(-1);
		expect(first.args).toContain(source);
		expect(second.args).toContain(source);
		expect(first.args).toContain("volume=0dB:precision=double");
		expect(second.args).toContain("volume=-2dB:precision=double");
		expect(first.args).toContain("copy");
		expect(await fs.readFile(options.outputPath, "utf8")).toBe(
			"new measured output"
		);
		expect(await fs.readdir(directory)).toEqual(["output.mp4"]);
	});

	it("corrects a rounded reading at the ceiling instead of accepting hidden overshoot", async () => {
		meterMock.mockResolvedValueOnce(-1).mockResolvedValueOnce(-1.3);
		const result = await renderTruePeakLimitedExport(options);
		expect(result.audioValidation.limiting?.encodeAttempts).toBe(2);
		expect(result.audioValidation.limiting?.attenuationDb).toBeCloseTo(0.3);
	});

	it("retains quiet audio and serializes silence without infinity", async () => {
		meterMock.mockResolvedValue(-Infinity);
		const result = await renderTruePeakLimitedExport(options);
		expect(
			JSON.parse(JSON.stringify(result)).audioValidation.truePeakDbtp
		).toBeNull();
		expect(result.audioValidation.limiting?.attenuationDb).toBe(0);
		expect(result.audioValidation.limiting?.encodeAttempts).toBe(1);
	});

	it("converts channels before limiting and keeps extra headroom below the filter's minimum", async () => {
		meterMock.mockResolvedValue(-24.3);
		await renderTruePeakLimitedExport({
			...options,
			channels: 1,
			sampleRate: 44_100,
			limiter: { ...options.limiter, ceilingDb: -24 },
		});
		const args = processMock.mock.calls[0][0].args;
		const filter = args[args.indexOf("-af") + 1];
		expect(filter.indexOf("channel_layouts=mono")).toBeLessThan(
			filter.indexOf("alimiter=")
		);
		expect(filter).toContain("aresample=176400");
		expect(filter).toContain("alimiter=limit=0.0625");
		expect(filter).toContain("level=0:latency=1");
		const gains = [...filter.matchAll(/volume=([-\d.]+)dB/g)].map((match) =>
			Number(match[1])
		);
		expect(gains).toHaveLength(2);
		expect(gains[0] + gains[1]).toBe(0);
	});

	it("encodes MP3 directly from PCM without an AAC intermediate or video map", async () => {
		await renderTruePeakLimitedExport({ ...options, format: "mp3" });
		const args = processMock.mock.calls[1][0].args;
		expect(args).toContain("libmp3lame");
		expect(args).not.toContain("aac");
		expect(args).not.toContain(options.sourceVideoPath);
		expect(args).toContain("0:a:0");
	});

	it.each([
		null,
		NaN,
		Infinity,
	])("fails closed for an invalid measurement %s", async (peak) => {
		meterMock.mockResolvedValue(peak);
		await expect(renderTruePeakLimitedExport(options)).rejects.toThrow(
			"no measurable audio"
		);
		await expectOriginalPreserved();
	});

	it("fails closed when the meter cannot run", async () => {
		meterMock.mockRejectedValue(new Error("meter unavailable"));
		await expect(renderTruePeakLimitedExport(options)).rejects.toThrow(
			"meter unavailable"
		);
		await expectOriginalPreserved();
	});

	it("bounds correction attempts and retains the old destination when all exceed", async () => {
		meterMock.mockResolvedValue(0);
		await expect(renderTruePeakLimitedExport(options)).rejects.toThrow(
			"after 4 encodes"
		);
		expect(meterMock).toHaveBeenCalledTimes(4);
		expect(processMock).toHaveBeenCalledTimes(5);
		await expectOriginalPreserved();
	});

	it("preserves the destination when the encoder fails", async () => {
		processMock.mockRejectedValue(new Error("encoder failed"));
		await expect(renderTruePeakLimitedExport(options)).rejects.toThrow(
			"encoder failed"
		);
		await expectOriginalPreserved();
	});

	it("does not start work after cancellation", async () => {
		const controller = new AbortController();
		controller.abort(new Error("cancelled"));
		await expect(
			renderTruePeakLimitedExport({ ...options, signal: controller.signal })
		).rejects.toThrow("cancelled");
		expect(processMock).not.toHaveBeenCalled();
		await expectOriginalPreserved();
	});

	it("does not publish a passing measurement when cancellation arrives during metering", async () => {
		const controller = new AbortController();
		const onPublished = vi.fn();
		meterMock.mockImplementation(async () => {
			controller.abort(new Error("cancel meter"));
			return -1.3;
		});
		await expect(
			renderTruePeakLimitedExport({
				...options,
				signal: controller.signal,
				onPublished,
			})
		).rejects.toThrow("cancel meter");
		expect(onPublished).not.toHaveBeenCalled();
		await expectOriginalPreserved();
	});

	it("reports publication before a cancellation can request final-file cleanup", async () => {
		const controller = new AbortController();
		const onPublished = vi.fn(() =>
			controller.abort(new Error("cancel after publish"))
		);
		await expect(
			renderTruePeakLimitedExport({
				...options,
				signal: controller.signal,
				onPublished,
			})
		).rejects.toThrow("cancel after publish");
		expect(onPublished).toHaveBeenCalledTimes(1);
		expect(await fs.readFile(options.outputPath, "utf8")).toBe(
			"new measured output"
		);
		expect(await fs.readdir(directory)).toEqual(["output.mp4"]);
	});

	it.each([
		{ format: "webm" },
		{ limiter: { ceilingDb: NaN, releaseMs: 50 } },
		{ duration: 0 },
		{ sampleRate: 0 },
	])("rejects invalid options before writing files: %j", async (override) => {
		await expect(
			renderTruePeakLimitedExport({ ...options, ...override })
		).rejects.toThrow();
		expect(processMock).not.toHaveBeenCalled();
		await expectOriginalPreserved();
	});
});
