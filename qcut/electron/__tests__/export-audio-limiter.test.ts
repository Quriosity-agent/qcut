import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	renderTruePeakLimitedExport,
	type TruePeakLimitedExportOptions,
} from "../claude/handlers/claude-export-handler/export-audio-limiter";
import { runAudioMeasurementProcess } from "../ffmpeg/audio-measurement-process";
import {
	measureFileTruePeakBlocks,
	type TruePeakBlock,
} from "../ffmpeg/audio-true-peak";

vi.mock("../ffmpeg/audio-measurement-process", () => ({
	runAudioMeasurementProcess: vi.fn(),
}));
vi.mock("../ffmpeg/audio-true-peak", () => ({
	measureFileTruePeakBlocks: vi.fn(),
}));
vi.mock("../ffmpeg/utils", () => ({ getFFmpegPath: () => "ffmpeg" }));

const SAMPLE_RATE = 48_000;
const LEVEL = 0.5;
let directory = "";
let options: TruePeakLimitedExportOptions;
/** The limited mix as each encode read it. */
let encodedMixes: Float32Array[] = [];
const processMock = vi.mocked(runAudioMeasurementProcess);
const meterMock = vi.mocked(measureFileTruePeakBlocks);

function measured({
	truePeak,
	blocks = [],
}: {
	truePeak: number | null;
	blocks?: TruePeakBlock[];
}) {
	return { truePeak, blocks };
}

beforeEach(async () => {
	vi.resetAllMocks();
	encodedMixes = [];
	directory = await fs.mkdtemp(path.join(tmpdir(), "qcut-limiter-unit-"));
	options = {
		sourceAudioPath: path.join(directory, "source.wav"),
		sourceVideoPath: path.join(directory, "source.mp4"),
		outputPath: path.join(directory, "output.mp4"),
		tempDir: directory,
		duration: 3,
		limiter: { ceilingDb: -1, releaseMs: 50 },
		sampleRate: SAMPLE_RATE,
		channels: 2,
		bitrateKbps: 192,
		format: "mp4",
	};
	await fs.writeFile(options.outputPath, "existing output");
	processMock.mockImplementation(async ({ args }) => {
		const output = args.at(-1) as string;
		if (output.endsWith(".f32")) {
			const mix = new Float32Array(3 * SAMPLE_RATE * 2).fill(LEVEL);
			await fs.writeFile(output, new Uint8Array(mix.buffer));
		} else {
			const mixPath = args.find((arg) => arg.endsWith(".f32"));
			if (mixPath) {
				const bytes = await fs.readFile(mixPath);
				encodedMixes.push(
					new Float32Array(
						bytes.buffer.slice(
							bytes.byteOffset,
							bytes.byteOffset + bytes.length
						)
					)
				);
			}
			await fs.writeFile(output, "new measured output");
		}
		return { stdout: "", stderr: "" };
	});
	meterMock.mockResolvedValue(measured({ truePeak: -1.4 }));
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

async function expectOriginalPreserved() {
	expect(await fs.readFile(options.outputPath, "utf8")).toBe("existing output");
	expect(await fs.readdir(directory)).toEqual(["output.mp4"]);
}

/** The level of the mix at `time` (left channel), in dB below the original. */
function loweredDb({ mix, time }: { mix: Float32Array; time: number }) {
	return -20 * Math.log10(mix[Math.round(time * SAMPLE_RATE) * 2] / LEVEL);
}

/** Whether every sample outside the stretches is exactly as the limiter left it. */
function untouchedOutside({
	mix,
	stretches,
}: {
	mix: Float32Array;
	stretches: Array<[number, number]>;
}): boolean {
	for (let index = 0; index < mix.length; index++) {
		const time = Math.floor(index / 2) / SAMPLE_RATE;
		if (stretches.some(([start, end]) => time >= start && time <= end))
			continue;
		if (mix[index] !== LEVEL) return false;
	}
	return true;
}

describe("verified true-peak export", () => {
	it("lowers only the moment that went over and publishes the passing candidate", async () => {
		meterMock
			.mockResolvedValueOnce(
				measured({
					truePeak: 0.7,
					blocks: [{ start: 1, end: 1.1, peakDb: 0.7 }],
				})
			)
			.mockResolvedValueOnce(measured({ truePeak: -1.3 }));
		const result = await renderTruePeakLimitedExport(options);
		expect(result.audioValidation).toEqual({
			status: "passed",
			ceilingDbtp: -1,
			truePeakDbtp: -1.3,
			limiting: {
				oversampleFactor: 4,
				encodeAttempts: 2,
				correctedSeconds: 0.2,
				maxCorrectionDb: 2.95,
			},
		});
		expect(meterMock).toHaveBeenCalledWith(
			expect.objectContaining({ aboveDb: -1.75 })
		);
		const [limit, first, second] = processMock.mock.calls.map(([call]) => call);
		expect(limit.args).toContain("pcm_f32le");
		const source = limit.args.at(-1);
		expect(first.args).toContain(source);
		expect(second.args).toContain(source);
		for (const encode of [first, second]) {
			expect(encode.args.join(" ")).not.toContain("volume=");
			expect(encode.args).toContain("copy");
		}
		const [before, after] = encodedMixes;
		expect(untouchedOutside({ mix: before, stretches: [] })).toBe(true);
		// The block, one codec window (48 ms) either side, then a 20 ms ramp.
		expect(loweredDb({ mix: after, time: 0.953 })).toBeCloseTo(2.95, 4);
		expect(loweredDb({ mix: after, time: 1.147 })).toBeCloseTo(2.95, 4);
		expect(untouchedOutside({ mix: after, stretches: [[0.931, 1.169]] })).toBe(
			true
		);
		expect(await fs.readFile(options.outputPath, "utf8")).toBe(
			"new measured output"
		);
		expect(await fs.readdir(directory)).toEqual(["output.mp4"]);
	});

	it("lowers a moment just over the ceiling without moving the rest of the mix (N21)", async () => {
		// v19: the second encode measured -2.4 dBTP against -2.5, and the old
		// loop took the whole mix down another 0.4 dB.
		meterMock
			.mockResolvedValueOnce(
				measured({
					truePeak: -1.5,
					blocks: [{ start: 1, end: 1.1, peakDb: -1.5 }],
				})
			)
			.mockResolvedValueOnce(
				measured({
					truePeak: -2.4,
					blocks: [{ start: 2, end: 2.1, peakDb: -2.4 }],
				})
			)
			.mockResolvedValueOnce(measured({ truePeak: -3.6 }));
		const result = await renderTruePeakLimitedExport({
			...options,
			limiter: { ceilingDb: -2.5, releaseMs: 50 },
		});
		expect(result.audioValidation.limiting).toEqual({
			oversampleFactor: 4,
			encodeAttempts: 3,
			correctedSeconds: 0.39,
			maxCorrectionDb: 2.25,
		});
		const mix = encodedMixes[2];
		// Down to 1.25 dB under the ceiling, the next over it 0.5 dB further.
		expect(loweredDb({ mix, time: 1.05 })).toBeCloseTo(2.25, 4);
		expect(loweredDb({ mix, time: 2.05 })).toBeCloseTo(1.85, 4);
		expect(
			untouchedOutside({
				mix,
				stretches: [
					[0.931, 1.169],
					[1.931, 2.169],
				],
			})
		).toBe(true);
	});

	it("corrects a rounded reading at the ceiling instead of accepting hidden overshoot", async () => {
		meterMock
			.mockResolvedValueOnce(
				measured({
					truePeak: -1,
					blocks: [{ start: 0.5, end: 0.6, peakDb: -1 }],
				})
			)
			.mockResolvedValueOnce(measured({ truePeak: -1.3 }));
		const result = await renderTruePeakLimitedExport(options);
		expect(result.audioValidation.limiting?.encodeAttempts).toBe(2);
		expect(result.audioValidation.limiting?.maxCorrectionDb).toBe(1.25);
	});

	it("retains quiet audio and serializes silence without infinity", async () => {
		meterMock.mockResolvedValue(measured({ truePeak: -Infinity }));
		const result = await renderTruePeakLimitedExport(options);
		expect(
			JSON.parse(JSON.stringify(result)).audioValidation.truePeakDbtp
		).toBeNull();
		expect(result.audioValidation.limiting).toEqual({
			oversampleFactor: 4,
			encodeAttempts: 1,
			correctedSeconds: 0,
			maxCorrectionDb: 0,
		});
	});

	it("converts channels before limiting and keeps extra headroom below the filter's minimum", async () => {
		meterMock.mockResolvedValue(measured({ truePeak: -24.3 }));
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
		const encode = processMock.mock.calls[1][0].args;
		const mixInput = encode.indexOf(args.at(-1) as string);
		expect(encode.slice(mixInput - 7, mixInput)).toEqual([
			"-f",
			"f32le",
			"-ar",
			"44100",
			"-ac",
			"1",
			"-i",
		]);
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
		meterMock.mockResolvedValue(measured({ truePeak: peak }));
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
		meterMock.mockResolvedValue(
			measured({ truePeak: 0, blocks: [{ start: 0, end: 0.1, peakDb: 0 }] })
		);
		await expect(renderTruePeakLimitedExport(options)).rejects.toThrow(
			"after 6 encodes"
		);
		expect(meterMock).toHaveBeenCalledTimes(6);
		expect(processMock).toHaveBeenCalledTimes(7);
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
			return measured({ truePeak: -1.3 });
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
