import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { validateExportAudioPeak } from "../claude/handlers/claude-export-handler/export-audio-validation";
import { executeExportJob } from "../claude/handlers/claude-export-handler/export-engine";
import {
	clearExportJobsForTests,
	exportJobs,
	getExportJobStatus,
} from "../claude/handlers/claude-export-handler/job-manager";
import type { ResolvedExportSettings } from "../claude/handlers/claude-export-handler/types";
import { buildTimelineAudioFilters } from "../ffmpeg/audio-filter-graph";
import { getFFmpegPath, getFFprobePath } from "../ffmpeg/paths";
import type { AudioMixConfig } from "../ffmpeg/types";

vi.mock("electron", () => ({
	app: { getPath: () => tmpdir(), isPackaged: false },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock("../claude/handlers/claude-events-handler", () => ({
	emitClaudeEvent: vi.fn(),
}));
vi.mock("../claude/utils/logger", () => ({
	claudeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ffmpeg = getFFmpegPath();
const limiter = { enabled: true, ceilingDb: -1, releaseMs: 50 };
let workDir = "";
let ffprobe = "";
let limitedPcm = "";
let limitedAac = "";
let safeAac = "";
let silentAac = "";
let videoOnly = "";

function run({ args }: { args: string[] }): string {
	const result = spawnSync(
		ffmpeg,
		["-hide_banner", "-nostdin", "-nostats", "-y", ...args],
		{ encoding: "utf8", timeout: 30_000, windowsHide: true }
	);
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stderr;
}

function mixConfig({ gainDb }: { gainDb: number }): AudioMixConfig {
	return {
		master: {
			id: "master",
			name: "Master",
			gainDb,
			pan: 0,
			muted: false,
			solo: false,
			effects: {
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
				limiter,
			},
		},
		buses: [],
		tracks: [],
	};
}

function renderMix({
	source,
	name,
	codec = "aac",
	gainDb = 0,
}: {
	source: string;
	name: string;
	codec?: "aac" | "pcm_f32le";
	gainDb?: number;
}): string {
	const outputPath = path.join(workDir, name);
	const graph = buildTimelineAudioFilters({
		audioFiles: [{ path: source, trackId: "audio", startTime: 0, volume: 1 }],
		audioStartIndex: 0,
		fps: 24,
		audioMixConfig: mixConfig({ gainDb }),
	});
	if (!graph.mapAudio) throw new Error("The test mix has no audio output");
	run({
		args: [
			"-i",
			source,
			"-filter_complex",
			graph.filterSteps.join(";"),
			"-map",
			graph.mapAudio,
			"-c:a",
			codec,
			...(codec === "aac" ? ["-b:a", "192k"] : []),
			"-ar",
			"48000",
			"-ac",
			"2",
			outputPath,
		],
	});
	return outputPath;
}

function digest({ file }: { file: string }): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function validateWithoutChangingFile({ file }: { file: string }) {
	const before = digest({ file });
	const result = await validateExportAudioPeak({ outputPath: file, limiter });
	expect(digest({ file })).toBe(before);
	return result;
}

describe.skipIf(!existsSync(ffmpeg))(
	"encoded export true peak (real FFmpeg)",
	() => {
		beforeAll(async () => {
			ffprobe = await getFFprobePath();
			workDir = mkdtempSync(path.join(tmpdir(), "qcut-export-peak-"));
			const source = path.join(workDir, "intersample.wav");
			// A phase-shifted 12 kHz tone has reconstructed peaks between its samples.
			const expression = "1.78*(sin(2*PI*12000*t)+cos(2*PI*12000*t))";
			run({
				args: [
					"-f",
					"lavfi",
					"-i",
					`aevalsrc=${expression}|${expression}:s=48000:d=3`,
					"-c:a",
					"pcm_f32le",
					source,
				],
			});
			limitedPcm = renderMix({
				source,
				name: "limited.wav",
				codec: "pcm_f32le",
			});
			limitedAac = renderMix({ source, name: "limited.m4a" });
			safeAac = renderMix({ source, name: "safe.m4a", gainDb: -24 });
			const silence = path.join(workDir, "silence.wav");
			run({
				args: [
					"-f",
					"lavfi",
					"-i",
					"anullsrc=r=48000:cl=stereo:d=3",
					"-c:a",
					"pcm_f32le",
					silence,
				],
			});
			silentAac = renderMix({ source: silence, name: "silent.m4a" });
			videoOnly = path.join(workDir, "video-only.mkv");
			run({
				args: [
					"-f",
					"lavfi",
					"-i",
					"color=c=black:s=16x16:r=10:d=3",
					"-an",
					"-c:v",
					"ffv1",
					videoOnly,
				],
			});
		}, 60_000);

		afterAll(() => {
			clearExportJobsForTests();
			if (workDir) rmSync(workDir, { recursive: true, force: true });
		});

		it.each([
			{ format: "mp4", sampleRate: 48_000, channels: 2, codec: "aac" },
			{ format: "mp3", sampleRate: 44_100, channels: 1, codec: "mp3" },
		] as const)("limits a native $format export and preserves $sampleRate Hz / $channels channel output", async ({
			format,
			sampleRate,
			channels,
			codec,
		}) => {
			const outputPath = path.join(workDir, `native-export.${format}`);
			const jobId = `peak-validation-native-${format}`;
			const projectId = "peak-validation-project";
			const settings: ResolvedExportSettings = {
				engine: "native-cli",
				presetId: "custom",
				width: 32,
				height: 32,
				fps: 24,
				format,
				codec: "libx264",
				bitrate: "128k",
				audioBitrate: 192,
				audioSampleRate: sampleRate,
				audioChannels: channels,
			};
			exportJobs.set(jobId, {
				jobId,
				projectId,
				settings,
				presetId: settings.presetId,
				engine: settings.engine,
				status: "queued",
				progress: 0,
				startedAt: Date.now(),
			});
			await executeExportJob({
				jobId,
				projectId,
				settings,
				outputPath,
				segments: [
					{
						elementId: "video",
						trackId: "video-track",
						trackOrder: 0,
						elementOrder: 0,
						sourcePath: videoOnly,
						sourceId: "video-source",
						startTime: 0,
						duration: 3,
						trimStart: 0,
						fitMode: "contain",
					},
				],
				audioFiles: [
					{
						path: limitedPcm,
						trackId: "audio",
						startTime: 0,
						duration: 3,
						volume: 1,
					},
				],
				audioMixConfig: mixConfig({ gainDb: 0 }),
			});
			const result = getExportJobStatus(jobId);
			expect(result, result?.error).toMatchObject({
				status: "completed",
				progress: 1,
				outputPath,
				audioValidation: {
					status: "passed",
					ceilingDbtp: limiter.ceilingDb,
					limiting: {
						oversampleFactor: 4,
						encodeAttempts: expect.any(Number),
						attenuationDb: expect.any(Number),
					},
				},
			});
			expect(result?.audioValidation?.truePeakDbtp).toBeTypeOf("number");
			expect(result?.audioValidation?.truePeakDbtp).toBeLessThanOrEqual(
				limiter.ceilingDb
			);
			expect(existsSync(outputPath)).toBe(true);
			const rechecked = await validateWithoutChangingFile({ file: outputPath });
			expect(result).toMatchObject(rechecked);
			expect(rechecked.audioValidation?.status).toBe("passed");

			const probe = spawnSync(
				ffprobe,
				[
					"-v",
					"error",
					"-show_streams",
					"-show_format",
					"-of",
					"json",
					outputPath,
				],
				{ encoding: "utf8", timeout: 30_000 }
			);
			expect(probe.status, probe.stderr).toBe(0);
			const metadata = JSON.parse(probe.stdout) as {
				streams: Array<{
					codec_type: string;
					codec_name: string;
					sample_rate?: string;
					channels?: number;
					duration?: string;
					start_time?: string;
				}>;
				format: { duration: string };
			};
			const audio = metadata.streams.filter(
				(stream) => stream.codec_type === "audio"
			);
			expect(audio).toHaveLength(1);
			expect(audio[0]).toMatchObject({
				codec_name: codec,
				sample_rate: String(sampleRate),
				channels,
			});
			expect(Math.abs(Number(metadata.format.duration) - 3)).toBeLessThan(0.08);
			const video = metadata.streams.filter(
				(stream) => stream.codec_type === "video"
			);
			expect(video).toHaveLength(format === "mp4" ? 1 : 0);
			if (format === "mp4") {
				expect(Number(video[0].duration)).toBeCloseTo(3, 2);
				expect(Number(audio[0].start_time)).toBeCloseTo(0, 3);
				expect(Number(video[0].start_time)).toBeCloseTo(0, 3);
			}
		}, 30_000);

		it("warns about the final AAC true peak even when the mixer holds PCM sample peaks", async () => {
			const sampleStats = run({
				args: [
					"-i",
					limitedPcm,
					"-af",
					"astats=measure_overall=Peak_level:measure_perchannel=none",
					"-f",
					"null",
					"-",
				],
			});
			const samplePeak = sampleStats.match(/Peak level dB:\s*(-?[\d.]+)/);
			expect(samplePeak).not.toBeNull();
			expect(Number(samplePeak?.[1])).toBeCloseTo(limiter.ceilingDb, 2);

			const result = await validateWithoutChangingFile({ file: limitedAac });
			expect(result.audioValidation).toMatchObject({
				status: "exceeded",
				ceilingDbtp: -1,
			});
			expect(result.audioValidation?.truePeakDbtp).toBeGreaterThan(0);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings?.[0]).toContain("dBTP");
		}, 30_000);

		it("passes a quieter encoded mix without altering the exported bytes", async () => {
			const result = await validateWithoutChangingFile({ file: safeAac });
			expect(result.audioValidation?.status).toBe("passed");
			expect(result.audioValidation?.truePeakDbtp).toBeLessThan(-10);
			expect(result.warnings).toBeUndefined();
		}, 30_000);

		it("distinguishes encoded silence from missing audio and serializes it safely", async () => {
			const result = await validateWithoutChangingFile({ file: silentAac });
			expect(result).toEqual({
				audioValidation: {
					status: "passed",
					ceilingDbtp: -1,
					truePeakDbtp: null,
				},
			});
			expect(JSON.parse(JSON.stringify(result))).toEqual(result);
		}, 30_000);

		it("reports a video-only file without an audio warning or file change", async () => {
			const result = await validateWithoutChangingFile({ file: videoOnly });
			expect(result).toEqual({
				audioValidation: { status: "no-audio", ceilingDbtp: -1 },
			});
		}, 30_000);
	}
);
