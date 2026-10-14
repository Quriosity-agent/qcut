/**
 * Audio/video sync evidence for exported files.
 *
 * The fixture is black video with a white flash starting exactly on each
 * marker second and a 1 kHz burst starting at the same instant, so in any
 * file made from it the audio onset minus the first white frame's PTS is
 * the sync error. Both are read with the app's bundled FFmpeg, which applies
 * the container's edit lists the way players do.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	getFFmpegPath,
	getFFprobePath,
} from "../../../../../../electron/ffmpeg/paths";

const execFileAsync = promisify(execFile);

export const SYNC_MARKER_SECONDS = [1, 2, 3] as const;
const SAMPLE_RATE = 48_000;
const FLASH_SECONDS = 0.2;
const BURST_SECONDS = 0.05;
const BURST_AMPLITUDE = 0.5;
// Well above AAC pre-echo before a sharp onset, and reached within two
// samples of the burst's first sample.
const ONSET_THRESHOLD = 0.1;
const FLASH_LUMA_THRESHOLD = 128;
const SEARCH_BEFORE_SECONDS = 0.2;
const SEARCH_AFTER_SECONDS = 0.3;

function markerExpression({ seconds }: { seconds: number }): string {
	return SYNC_MARKER_SECONDS.map(
		(marker) => `between(t,${marker},${marker + seconds})`
	).join("+");
}

/** Writes an H.264 + AAC MP4 whose flashes and bursts start together. */
export async function generateSyncMarkerClip({
	filePath,
	seconds,
	fps,
	width,
	height,
}: {
	filePath: string;
	seconds: number;
	fps: number;
	width: number;
	height: number;
}): Promise<void> {
	// The flash ends one microsecond early so it covers whole frames only.
	const flash = markerExpression({ seconds: FLASH_SECONDS - 1e-6 });
	const burst = markerExpression({ seconds: BURST_SECONDS });
	await execFileAsync(getFFmpegPath(), [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=${width}x${height}:r=${fps}:d=${seconds},drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='${flash}'`,
		"-f",
		"lavfi",
		"-i",
		`aevalsrc=exprs='${BURST_AMPLITUDE}*sin(2*PI*1000*t)*(${burst})':s=${SAMPLE_RATE}:d=${seconds}`,
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-g",
		String(fps),
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-ac",
		"2",
		"-shortest",
		filePath,
	]);
}

interface StreamTiming {
	audioStartSeconds: number;
	audioDurationSeconds: number;
	videoDurationSeconds: number;
}

async function probeStreamTiming({
	filePath,
}: {
	filePath: string;
}): Promise<StreamTiming> {
	const { stdout } = await execFileAsync(await getFFprobePath(), [
		"-v",
		"error",
		"-show_entries",
		"stream=codec_type,start_time,duration",
		"-of",
		"json",
		filePath,
	]);
	const streams =
		(
			JSON.parse(stdout) as {
				streams?: Array<{
					codec_type?: string;
					start_time?: string;
					duration?: string;
				}>;
			}
		).streams ?? [];
	const audio = streams.find((stream) => stream.codec_type === "audio");
	const video = streams.find((stream) => stream.codec_type === "video");
	if (!audio || !video) {
		throw new Error(`${filePath} needs one audio and one video stream`);
	}
	return {
		audioStartSeconds: Number(audio.start_time ?? 0),
		audioDurationSeconds: Number(audio.duration),
		videoDurationSeconds: Number(video.duration),
	};
}

async function audioOnsets({
	filePath,
	audioStartSeconds,
}: {
	filePath: string;
	audioStartSeconds: number;
}): Promise<number[]> {
	const { stdout } = await execFileAsync(
		getFFmpegPath(),
		[
			"-v",
			"error",
			"-i",
			filePath,
			"-map",
			"0:a:0",
			"-ac",
			"1",
			"-ar",
			String(SAMPLE_RATE),
			"-f",
			"f32le",
			"-",
		],
		{ encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }
	);
	const samples = new Float32Array(
		stdout.buffer,
		stdout.byteOffset,
		Math.floor(stdout.byteLength / 4)
	);
	return SYNC_MARKER_SECONDS.map((marker) => {
		const from = Math.max(
			0,
			Math.floor(
				(marker - SEARCH_BEFORE_SECONDS - audioStartSeconds) * SAMPLE_RATE
			)
		);
		const to = Math.min(
			samples.length,
			Math.ceil(
				(marker + SEARCH_AFTER_SECONDS - audioStartSeconds) * SAMPLE_RATE
			)
		);
		for (let index = from; index < to; index += 1) {
			if (Math.abs(samples[index]) > ONSET_THRESHOLD) {
				return audioStartSeconds + index / SAMPLE_RATE;
			}
		}
		throw new Error(`No audio burst near ${marker}s in ${filePath}`);
	});
}

async function videoFlashes({
	filePath,
}: {
	filePath: string;
}): Promise<number[]> {
	const { stderr } = await execFileAsync(
		getFFmpegPath(),
		[
			"-v",
			"info",
			"-i",
			filePath,
			"-map",
			"0:v:0",
			"-vf",
			"scale=32:18,format=gray,showinfo",
			"-f",
			"null",
			"-",
		],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	const frames: Array<{ time: number; luma: number }> = [];
	for (const match of stderr.matchAll(
		/pts_time:\s*([-\d.]+).*?mean:\[(\d+)/g
	)) {
		frames.push({ time: Number(match[1]), luma: Number(match[2]) });
	}
	if (frames.length === 0) throw new Error(`No frames read from ${filePath}`);
	return SYNC_MARKER_SECONDS.map((marker) => {
		const flash = frames.find(
			(frame) =>
				frame.time >= marker - SEARCH_BEFORE_SECONDS &&
				frame.time <= marker + SEARCH_AFTER_SECONDS &&
				frame.luma > FLASH_LUMA_THRESHOLD
		);
		if (!flash)
			throw new Error(`No white flash near ${marker}s in ${filePath}`);
		return flash.time;
	});
}

export interface AudioSyncMeasurement {
	/** Audio onset minus white-frame PTS for each marker, in milliseconds. */
	offsetsMs: number[];
	audioOnsetsSeconds: number[];
	videoFlashesSeconds: number[];
	timing: StreamTiming;
}

export async function measureAudioSync({
	filePath,
}: {
	filePath: string;
}): Promise<AudioSyncMeasurement> {
	const timing = await probeStreamTiming({ filePath });
	const audioOnsetsSeconds = await audioOnsets({
		filePath,
		audioStartSeconds: timing.audioStartSeconds,
	});
	const videoFlashesSeconds = await videoFlashes({ filePath });
	return {
		offsetsMs: audioOnsetsSeconds.map(
			(onset, index) => (onset - videoFlashesSeconds[index]) * 1000
		),
		audioOnsetsSeconds,
		videoFlashesSeconds,
		timing,
	};
}
