import { resolveAutorotatedVideoDimensions } from "../jianying-person-cutout/video-display-dimensions.js";
import { buildVideoLabFilter } from "./video-lab-filter.js";

const TRANSPARENT_PIXEL_FORMAT = /^(?:yuva|gbrap|rgba|bgra|argb|abgr|ya)/;

export interface LocalDeflickerMetadata {
	width: number;
	height: number;
	fps: number;
	frameCount: number;
	durationSeconds: number;
	durationBasis?: "video" | "container";
	containerDurationSeconds?: number;
	audioStreams: number;
}

interface ProbeStream {
	codec_type?: string;
	width?: number;
	height?: number;
	nb_read_frames?: string;
	avg_frame_rate?: string;
	duration?: string;
	color_transfer?: string;
	pix_fmt?: string;
	field_order?: string;
	side_data_list?: Array<{ rotation?: unknown }>;
	tags?: { rotate?: unknown; alpha_mode?: unknown };
}

export function parseLocalDeflickerMetadata({
	json,
}: {
	json: string;
}): LocalDeflickerMetadata {
	const probe = JSON.parse(json) as {
		streams?: ProbeStream[];
		format?: { duration?: string };
	};
	if (!probe || !Array.isArray(probe.streams))
		throw new Error("Invalid video probe metadata");
	const video = probe.streams?.find((stream) => stream.codec_type === "video");
	if (!video) throw new Error("Input has no video stream");
	const { width, height } = resolveAutorotatedVideoDimensions({
		width: video.width ?? 0,
		height: video.height ?? 0,
		sideDataList: video.side_data_list,
		tags: video.tags,
	});
	if (
		![width, height].every(
			(value) => Number.isSafeInteger(value) && value > 0
		) ||
		width > 4096 ||
		height > 4096 ||
		width * height > 8_847_360 ||
		width % 2 !== 0 ||
		height % 2 !== 0
	)
		throw new Error("Local deflicker requires even video dimensions up to 4K");
	if (
		![
			"",
			"unknown",
			"unspecified",
			"bt709",
			"gamma22",
			"gamma28",
			"smpte170m",
			"smpte240m",
			"iec61966-2-1",
			"bt1361e",
			"bt2020-10",
			"bt2020-12",
		].includes(video.color_transfer ?? "")
	) {
		throw new Error("Local deflicker currently supports SDR video only");
	}
	if (
		TRANSPARENT_PIXEL_FORMAT.test(video.pix_fmt ?? "") ||
		Number(video.tags?.alpha_mode) > 0
	) {
		throw new Error("Local deflicker does not support transparent video");
	}
	if (
		![
			"yuv420p",
			"yuv422p",
			"yuv444p",
			"yuvj420p",
			"yuvj422p",
			"yuvj444p",
			"nv12",
			"nv21",
			"gray",
		].includes(video.pix_fmt ?? "")
	) {
		throw new Error(
			"Local deflicker requires a known 8-bit YUV or grayscale pixel format"
		);
	}
	if (
		video.field_order &&
		!["unknown", "progressive"].includes(video.field_order)
	) {
		throw new Error("Local deflicker requires progressive video");
	}
	const [numerator, denominator, extra] = (video.avg_frame_rate ?? "")
		.split("/")
		.map(Number);
	const fps = numerator / denominator;
	const frameCount = Number(video.nb_read_frames);
	const streamDurationSeconds = Number(video.duration);
	const containerDurationSeconds = Number(probe.format?.duration);
	const hasVideoDuration =
		Number.isFinite(streamDurationSeconds) && streamDurationSeconds > 0;
	const durationSeconds = hasVideoDuration
		? streamDurationSeconds
		: containerDurationSeconds;
	if (
		extra !== undefined ||
		!Number.isFinite(fps) ||
		fps <= 0 ||
		fps > 240 ||
		!Number.isSafeInteger(frameCount) ||
		frameCount < 2 ||
		!Number.isFinite(durationSeconds) ||
		durationSeconds <= 0
	) {
		throw new Error(
			"Local deflicker requires at least two decodable frames and valid video timing"
		);
	}
	return {
		width,
		height,
		fps,
		frameCount,
		durationSeconds,
		durationBasis: hasVideoDuration ? "video" : "container",
		containerDurationSeconds:
			Number.isFinite(containerDurationSeconds) && containerDurationSeconds > 0
				? containerDurationSeconds
				: undefined,
		audioStreams:
			probe.streams?.filter((stream) => stream.codec_type === "audio").length ??
			0,
	};
}

export function buildLocalDeflickerArgs({
	sourcePath,
	outputPath,
	strength,
	metadata,
}: {
	sourcePath: string;
	outputPath: string;
	strength: number;
	metadata: LocalDeflickerMetadata;
}): string[] {
	if (!Number.isInteger(strength) || strength < 1 || strength > 100) {
		throw new Error("--strength must be an integer from 1 to 100");
	}
	const filter = buildVideoLabFilter({
		settings: { deflicker: strength },
		width: metadata.width,
		height: metadata.height,
		fps: metadata.fps,
	});
	return [
		"-hide_banner",
		"-loglevel",
		"error",
		"-nostdin",
		"-n",
		"-i",
		sourcePath,
		"-map",
		"0:v:0",
		"-map",
		"0:a?",
		"-map_metadata",
		"0",
		"-map_chapters",
		"0",
		"-vf",
		filter,
		"-c:v",
		"libx264",
		"-preset",
		"medium",
		"-crf",
		"18",
		"-pix_fmt",
		"yuv420p",
		"-fps_mode",
		"passthrough",
		"-c:a",
		"copy",
		"-metadata:s:v:0",
		"rotate=0",
		"-movflags",
		"+faststart",
		outputPath,
	];
}

export function verifyLocalDeflickerOutput({
	source,
	output,
}: {
	source: LocalDeflickerMetadata;
	output: LocalDeflickerMetadata;
}): void {
	// A container can include audio that extends beyond its video stream.
	const outputDuration =
		source.durationBasis === "container"
			? output.containerDurationSeconds
			: output.durationSeconds;
	const durationMatches =
		outputDuration !== undefined &&
		Number.isFinite(outputDuration) &&
		Math.abs(source.durationSeconds - outputDuration) <=
			Math.max(0.05, 1 / source.fps);
	if (
		source.width !== output.width ||
		source.height !== output.height ||
		source.frameCount !== output.frameCount ||
		source.audioStreams !== output.audioStreams ||
		!durationMatches
	) {
		throw new Error(
			"Deflicker output failed dimensions, frame count, audio or duration verification"
		);
	}
}
