import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderTruePeakLimitedExport } from "../claude/handlers/claude-export-handler/export-audio-limiter";
import { renderTimelineAudioMix } from "../claude/handlers/claude-export-handler/export-audio-mix-pass";
import type { ResolvedExportSettings } from "../claude/handlers/claude-export-handler/types";
import type { AudioBusEffects, AudioMixConfig } from "../ffmpeg/types";
import { probeHasAudioStream } from "../ffmpeg/utils";

vi.mock("../ffmpeg/utils", () => ({ probeHasAudioStream: vi.fn() }));
vi.mock(
	"../claude/handlers/claude-export-handler/export-audio-limiter",
	() => ({
		renderTruePeakLimitedExport: vi.fn(),
	})
);

type MixPassOptions = Parameters<typeof renderTimelineAudioMix>[0];
const runFFmpegCommand = vi.fn<MixPassOptions["runFFmpegCommand"]>();
const settings: ResolvedExportSettings = {
	engine: "native-cli",
	presetId: "custom",
	width: 16,
	height: 16,
	fps: 24,
	format: "mp4",
	codec: "libx264",
	bitrate: "128k",
	audioBitrate: 192,
	audioSampleRate: 48_000,
	audioChannels: 2,
};
let directory = "";
let outputPath = "";

function effects({ ceilingDb }: { ceilingDb: number }): AudioBusEffects {
	return {
		parametricEqualizer: {
			enabled: false,
			lowCutHz: 20,
			highCutHz: 20_000,
			bands: [],
		},
		compressor: {
			enabled: false,
			thresholdDb: -18,
			ratio: 3,
			attackMs: 10,
			releaseMs: 120,
			makeupGainDb: 0,
		},
		limiter: { enabled: true, ceilingDb, releaseMs: 50 },
	};
}

function mixConfig(): AudioMixConfig {
	return {
		master: {
			id: "master",
			name: "Master",
			gainDb: 0,
			pan: 0,
			muted: false,
			solo: false,
			effects: effects({ ceilingDb: -1 }),
		},
		buses: [
			{
				id: "bus",
				name: "Dialogue",
				gainDb: 0,
				pan: 0,
				muted: false,
				solo: false,
				effects: effects({ ceilingDb: -4 }),
			},
		],
		tracks: [
			{
				trackId: "voice",
				busId: "bus",
				gainDb: 0,
				pan: 0,
				muted: false,
				solo: false,
				effects: effects({ ceilingDb: -7 }),
				ducking: {
					enabled: false,
					sourceTrackIds: [],
					thresholdDb: -30,
					reductionDb: -12,
					attackMs: 80,
					releaseMs: 350,
				},
			},
		],
	};
}

function options({ config }: { config: AudioMixConfig }): MixPassOptions {
	return {
		videoOutputPath: outputPath,
		outputPath,
		tempDir: directory,
		settings,
		segments: [],
		audioFiles: [
			{
				path: "voice.wav",
				trackId: "voice",
				startTime: 0,
				duration: 3,
				volume: 1,
			},
		],
		audioMixConfig: config,
		duration: 3,
		runFFmpegCommand,
	};
}

beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), "qcut-audio-pass-"));
	outputPath = path.join(directory, "result.mp4");
	await writeFile(outputPath, "original picture");
	vi.mocked(probeHasAudioStream).mockReset().mockResolvedValue(false);
	vi.mocked(renderTruePeakLimitedExport)
		.mockReset()
		.mockImplementation(async ({ outputPath: target }) => {
			await writeFile(target, "verified picture and audio");
			return {
				audioValidation: {
					status: "passed",
					ceilingDbtp: -1,
					truePeakDbtp: -1.3,
					limiting: {
						oversampleFactor: 4,
						encodeAttempts: 1,
						correctedSeconds: 0,
						maxCorrectionDb: 0,
					},
				},
			};
		});
	runFFmpegCommand.mockReset().mockImplementation(async ({ args }) => {
		const target = args.at(-1);
		if (!target) throw new Error("Missing output path");
		await writeFile(target, "rendered mix");
	});
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("native audio mix pass", () => {
	it("defers only the master limiter, keeps track and bus limiting, and leaves project settings intact", async () => {
		const config = mixConfig();
		const original = structuredClone(config);
		const result = await renderTimelineAudioMix(options({ config }));
		expect(config).toEqual(original);
		expect(result).toMatchObject({
			finalized: true,
			audioValidation: { status: "passed" },
		});
		expect(runFFmpegCommand).toHaveBeenCalledOnce();
		const { args } = runFFmpegCommand.mock.calls[0][0];
		const filter = args[args.indexOf("-filter_complex") + 1];
		expect(filter.match(/alimiter=/g)).toHaveLength(2);
		expect(filter).toContain("alimiter=limit=0.446684");
		expect(filter).toContain("alimiter=limit=0.630957");
		expect(filter).not.toContain("alimiter=limit=0.891251");
		expect(args[args.indexOf("-c:a") + 1]).toBe("pcm_f32le");
		expect(args[args.indexOf("-rf64") + 1]).toBe("auto");
		expect(renderTruePeakLimitedExport).toHaveBeenCalledWith(
			expect.objectContaining({
				limiter: original.master.effects.limiter,
				sampleRate: 48_000,
				channels: 2,
				bitrateKbps: 192,
				duration: 3,
				sourceAudioPath: args.at(-1),
				outputPath,
			})
		);
	});

	it("hands the export's peak correction to the limiter and returns its warnings", async () => {
		vi.mocked(renderTruePeakLimitedExport).mockImplementationOnce(
			async ({ outputPath: target }) => {
				await writeFile(target, "checked picture and audio");
				return {
					audioValidation: { status: "exceeded", ceilingDbtp: -1 },
					warnings: ["over the ceiling"],
				};
			}
		);
		const result = await renderTimelineAudioMix({
			...options({ config: mixConfig() }),
			settings: { ...settings, peakCorrection: "check" },
		});
		expect(renderTruePeakLimitedExport).toHaveBeenCalledWith(
			expect.objectContaining({ peakCorrection: "check" })
		);
		expect(result).toEqual({
			finalized: true,
			audioValidation: { status: "exceeded", ceilingDbtp: -1 },
			warnings: ["over the ceiling"],
		});
	});

	it("keeps the existing AAC mix path when the master limiter is disabled", async () => {
		const config = mixConfig();
		config.master.effects.limiter.enabled = false;
		const result = await renderTimelineAudioMix(options({ config }));
		expect(result).toEqual({ finalized: false });
		expect(renderTruePeakLimitedExport).not.toHaveBeenCalled();
		expect(runFFmpegCommand).toHaveBeenCalledOnce();
		const { args } = runFFmpegCommand.mock.calls[0][0];
		expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
		expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
		expect(args).not.toContain("-rf64");
		expect(args.at(-1)).toBe(outputPath);
		expect(await readFile(outputPath, "utf8")).toBe("rendered mix");
	});

	it("remuxes a video with no-audio metadata without inventing an audio stream", async () => {
		const onPublished = vi.fn();
		const result = await renderTimelineAudioMix({
			...options({ config: mixConfig() }),
			audioFiles: [],
			onPublished,
		});
		expect(result).toEqual({
			finalized: true,
			audioValidation: { status: "no-audio", ceilingDbtp: -1 },
		});
		expect(await readFile(outputPath, "utf8")).toBe("rendered mix");
		expect(runFFmpegCommand).toHaveBeenCalledOnce();
		const args = runFFmpegCommand.mock.calls[0][0].args;
		expect(args[args.indexOf("-f") + 1]).toBe("mp4");
		expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
		expect(args).toContain("-an");
		expect(path.dirname(path.dirname(args.at(-1) as string))).toBe(
			path.dirname(outputPath)
		);
		expect(onPublished).toHaveBeenCalledOnce();
		expect(renderTruePeakLimitedExport).not.toHaveBeenCalled();
	});

	it.each([
		"cancel",
		"failure",
	] as const)("preserves the old destination when video-only remux ends in %s", async (termination) => {
		const videoOutputPath = path.join(directory, "private-video.mp4");
		await writeFile(videoOutputPath, "private picture");
		const controller = new AbortController();
		const onPublished = vi.fn();
		runFFmpegCommand.mockImplementationOnce(async ({ args }) => {
			await writeFile(args.at(-1) as string, "partial candidate");
			if (termination === "cancel") {
				controller.abort(new Error("cancel remux"));
				return;
			}
			throw new Error("disk full during remux");
		});
		await expect(
			renderTimelineAudioMix({
				...options({ config: mixConfig() }),
				videoOutputPath,
				audioFiles: [],
				signal: controller.signal,
				onPublished,
			})
		).rejects.toThrow(
			termination === "cancel" ? "Export cancelled" : "disk full"
		);
		expect(await readFile(outputPath, "utf8")).toBe("original picture");
		expect(onPublished).not.toHaveBeenCalled();
		expect(
			(await readdir(directory)).some((name) =>
				name.startsWith(".qcut-video-only-")
			)
		).toBe(false);
	});

	it("reports video-only publication before final cancellation", async () => {
		const videoOutputPath = path.join(directory, "private-video.mp4");
		await writeFile(videoOutputPath, "private picture");
		const controller = new AbortController();
		const onPublished = vi.fn(() =>
			controller.abort(new Error("cancel published video"))
		);
		await expect(
			renderTimelineAudioMix({
				...options({ config: mixConfig() }),
				videoOutputPath,
				audioFiles: [],
				signal: controller.signal,
				onPublished,
			})
		).rejects.toThrow("Export cancelled");
		expect(await readFile(outputPath, "utf8")).toBe("rendered mix");
		expect(onPublished).toHaveBeenCalledOnce();
	});

	it("does not bypass format validation for an audio-less export", async () => {
		await expect(
			renderTimelineAudioMix({
				...options({ config: mixConfig() }),
				audioFiles: [],
				settings: { ...settings, format: "webm" },
			})
		).rejects.toThrow("does not support webm");
		expect(await readFile(outputPath, "utf8")).toBe("original picture");
		expect(runFFmpegCommand).not.toHaveBeenCalled();
	});

	it("rejects an audio-less MP3 export", async () => {
		const mp3Path = path.join(directory, "result.mp3");
		await expect(
			renderTimelineAudioMix({
				...options({ config: mixConfig() }),
				outputPath: mp3Path,
				settings: { ...settings, format: "mp3" },
				audioFiles: [],
			})
		).rejects.toThrow("timeline has no audio");
		expect(existsSync(mp3Path)).toBe(false);
		expect(runFFmpegCommand).not.toHaveBeenCalled();
		expect(renderTruePeakLimitedExport).not.toHaveBeenCalled();
	});

	it("does not restore an unverified final file after limiter verification fails", async () => {
		vi.mocked(renderTruePeakLimitedExport).mockRejectedValueOnce(
			new Error("Encoded true peak is unverified")
		);
		await expect(
			renderTimelineAudioMix(options({ config: mixConfig() }))
		).rejects.toThrow("Encoded true peak is unverified");
		expect(existsSync(outputPath)).toBe(false);
		expect(
			await readFile(path.join(directory, "video-before-audio-mix.mp4"), "utf8")
		).toBe("original picture");
	});
});
