import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderTruePeakLimitedExport } from "../claude/handlers/claude-export-handler/export-audio-limiter";
import { measureFileTruePeak } from "../ffmpeg/audio-true-peak";
import { getFFmpegPath, getFFprobePath } from "../ffmpeg/paths";

vi.mock("electron", () => ({
	app: { getPath: () => tmpdir(), isPackaged: false },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

const ffmpeg = getFFmpegPath();
const duration = 3;
let directory = "";
let video = "";
let phase = "";
let noise = "";
let silence = "";
let quiet = "";

function run({ args }: { args: string[] }): string {
	const result = spawnSync(
		ffmpeg,
		["-hide_banner", "-nostdin", "-nostats", "-v", "error", "-y", ...args],
		{ encoding: "utf8", timeout: 30_000, windowsHide: true }
	);
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stdout;
}

function fixture({ name, source }: { name: string; source: string }): string {
	const output = path.join(directory, `${name}.wav`);
	run({ args: ["-f", "lavfi", "-i", source, "-c:a", "pcm_f32le", output] });
	return output;
}

async function probe({ file }: { file: string }) {
	const result = spawnSync(
		await getFFprobePath(),
		["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
		{ encoding: "utf8", timeout: 30_000, windowsHide: true }
	);
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr);
	return JSON.parse(result.stdout) as {
		streams: Array<{
			codec_type: string;
			codec_name: string;
			sample_rate?: string;
			channels?: number;
			start_time?: string;
			duration?: string;
		}>;
		format: { duration: string };
	};
}

function videoDigest({ file }: { file: string }): string {
	return run({
		args: ["-i", file, "-map", "0:v:0", "-c:v", "copy", "-f", "hash", "-"],
	}).trim();
}

function pcm({ file, name }: { file: string; name: string }): Float32Array {
	const output = path.join(directory, `${name}.f32`);
	run({
		args: [
			"-i",
			file,
			"-map",
			"0:a:0",
			"-ac",
			"1",
			"-ar",
			"48000",
			"-f",
			"f32le",
			output,
		],
	});
	const bytes = readFileSync(output);
	return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function peakIndex({ samples }: { samples: Float32Array }): number {
	let peak = 0;
	let index = 0;
	for (const [offset, sample] of samples.entries()) {
		if (Math.abs(sample) <= peak) continue;
		peak = Math.abs(sample);
		index = offset;
	}
	return index;
}

describe.skipIf(!existsSync(ffmpeg))(
	"automatic true-peak limiting (real FFmpeg)",
	() => {
		beforeAll(() => {
			directory = mkdtempSync(path.join(tmpdir(), "qcut-limit-real-"));
			video = path.join(directory, "video.mp4");
			run({
				args: [
					"-f",
					"lavfi",
					"-i",
					"color=c=blue:s=32x32:r=24:d=3",
					"-an",
					"-c:v",
					"libx264",
					video,
				],
			});
			const expression = "1.78*(sin(2*PI*12000*t)+cos(2*PI*12000*t))";
			phase = fixture({
				name: "phase",
				source: `aevalsrc=${expression}|-${expression}:s=48000:d=3`,
			});
			noise = fixture({
				name: "noise",
				source:
					"anoisesrc=color=white:seed=410:amplitude=1:sample_rate=48000:duration=3,volume=2",
			});
			silence = fixture({
				name: "silence",
				source: "anullsrc=r=48000:cl=stereo:d=3",
			});
			quiet = fixture({
				name: "quiet",
				source:
					"aevalsrc='0.01*exp(-pow((t-1)/0.01,2))*cos(2*PI*1000*(t-1))+0.008*exp(-pow((t-2.997)/0.001,2))*cos(2*PI*1000*(t-2.997))':s=48000:d=3",
			});
		}, 60_000);

		afterAll(() => {
			if (directory) rmSync(directory, { recursive: true, force: true });
		});

		it.each([
			{
				name: "phase-aac",
				format: "mp4",
				rate: 48_000,
				channels: 2,
				ceiling: -1,
				source: "phase",
			},
			{
				name: "noise-aac",
				format: "mp4",
				rate: 48_000,
				channels: 2,
				ceiling: -1,
				source: "noise",
			},
			{
				name: "noise-mp3",
				format: "mp3",
				rate: 44_100,
				channels: 1,
				ceiling: -1,
				source: "noise",
			},
			{
				name: "phase-resample",
				format: "mov",
				rate: 44_100,
				channels: 2,
				ceiling: -1,
				source: "phase",
			},
			{
				name: "minimum-ceiling",
				format: "mp4",
				rate: 48_000,
				channels: 1,
				ceiling: -24,
				source: "noise",
			},
		] as const)("limits $name and preserves the original video packets", async ({
			name,
			format,
			rate,
			channels,
			ceiling,
			source,
		}) => {
			const input = source === "phase" ? phase : noise;
			const hashBefore = createHash("sha256")
				.update(readFileSync(input))
				.digest("hex");
			const output = path.join(directory, `${name}.${format}`);
			const result = await renderTruePeakLimitedExport({
				sourceAudioPath: input,
				sourceVideoPath: video,
				outputPath: output,
				tempDir: directory,
				duration,
				limiter: { ceilingDb: ceiling, releaseMs: 50 },
				sampleRate: rate,
				channels,
				bitrateKbps: 192,
				format,
			});
			const finalPeak = await measureFileTruePeak({ file: output });
			expect(finalPeak).not.toBeNull();
			expect((finalPeak as number) + 0.05).toBeLessThanOrEqual(ceiling);
			expect(result.audioValidation.truePeakDbtp).toBe(finalPeak);
			expect(result.audioValidation.status).toBe("passed");
			expect(
				result.audioValidation.limiting?.encodeAttempts
			).toBeLessThanOrEqual(4);
			if (name === "noise-aac") {
				expect(result.audioValidation.limiting?.encodeAttempts).toBeGreaterThan(
					1
				);
				expect(result.audioValidation.limiting?.attenuationDb).toBeGreaterThan(
					0
				);
			}
			const metadata = await probe({ file: output });
			const audio = metadata.streams.find(
				(stream) => stream.codec_type === "audio"
			);
			expect(audio?.sample_rate).toBe(String(rate));
			expect(audio?.channels).toBe(channels);
			expect(audio?.codec_name).toBe(format === "mp3" ? "mp3" : "aac");
			expect(
				Math.abs(Number(metadata.format.duration) - duration)
			).toBeLessThan(0.08);
			if (format !== "mp3") {
				expect(videoDigest({ file: output })).toBe(
					videoDigest({ file: video })
				);
				expect(Number(audio?.start_time)).toBe(0);
				expect(Number(audio?.duration)).toBeCloseTo(duration, 2);
			}
			expect(
				createHash("sha256").update(readFileSync(input)).digest("hex")
			).toBe(hashBefore);
		}, 60_000);

		it("keeps quiet sound at the same time and level even at the -24 dB ceiling", async () => {
			const output = path.join(directory, "quiet.mp4");
			const result = await renderTruePeakLimitedExport({
				sourceAudioPath: quiet,
				sourceVideoPath: video,
				outputPath: output,
				tempDir: directory,
				duration,
				limiter: { ceilingDb: -24, releaseMs: 50 },
				sampleRate: 48_000,
				channels: 1,
				bitrateKbps: 192,
				format: "mp4",
			});
			expect(result.audioValidation.limiting?.attenuationDb).toBe(0);
			expect(result.audioValidation.limiting?.encodeAttempts).toBe(1);
			const original = pcm({ file: quiet, name: "quiet-original" });
			const decoded = pcm({ file: output, name: "quiet-decoded" });
			expect(
				Math.abs(
					peakIndex({ samples: original }) - peakIndex({ samples: decoded })
				)
			).toBeLessThanOrEqual(1);
			expect(decoded.length).toBeGreaterThanOrEqual(original.length);
			expect(decoded.length - original.length).toBeLessThan(1024);
			const tailStart = Math.floor(2.985 * 48_000);
			const originalTail = original.subarray(tailStart);
			const decodedTail = decoded.subarray(tailStart, original.length);
			expect(
				Math.abs(
					peakIndex({ samples: originalTail }) -
						peakIndex({ samples: decodedTail })
				)
			).toBeLessThanOrEqual(1);
			const tailPeak = decodedTail[peakIndex({ samples: decodedTail })];
			expect(Math.abs(tailPeak)).toBeGreaterThan(0.007);
			const before = await measureFileTruePeak({ file: quiet });
			const after = await measureFileTruePeak({ file: output });
			expect(
				Math.abs((after as number) - (before as number))
			).toBeLessThanOrEqual(0.2);
		}, 60_000);

		it("passes silent MP3 without converting silence into a finite peak", async () => {
			const output = path.join(directory, "silence.mp3");
			const result = await renderTruePeakLimitedExport({
				sourceAudioPath: silence,
				outputPath: output,
				tempDir: directory,
				duration,
				limiter: { ceilingDb: -1, releaseMs: 50 },
				sampleRate: 44_100,
				channels: 1,
				bitrateKbps: 192,
				format: "mp3",
			});
			expect(result.audioValidation.truePeakDbtp).toBeNull();
			expect(result.audioValidation.limiting?.encodeAttempts).toBe(1);
			expect(await measureFileTruePeak({ file: output })).toBe(-Infinity);
		}, 60_000);
	}
);
