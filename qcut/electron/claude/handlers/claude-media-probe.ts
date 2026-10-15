/**
 * Duration, dimensions and frame rate for project media, read with ffprobe.
 *
 * The media list is a directory scan, so without this a caller sees files with
 * no length or size and has to run ffprobe itself before it can place a clip.
 * Results are cached by path, size and modification time, and a file ffprobe
 * cannot read simply keeps its fields empty: a listing must never fail because
 * one file is odd.
 *
 * @module electron/claude/handlers/claude-media-probe
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFFprobePath } from "../../ffmpeg/utils.js";
import type { MediaFile } from "../../types/claude-api";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_PROBES = 4;
const MAX_CACHED_PROBES = 1000;

export interface MediaProbeFields {
	duration?: number;
	width?: number;
	height?: number;
	fps?: number;
}

interface ProbeStream {
	codec_type?: string;
	width?: number;
	height?: number;
	avg_frame_rate?: string;
	r_frame_rate?: string;
	duration?: string;
}

const probeCache = new Map<string, Promise<MediaProbeFields | null>>();

function positiveNumber(value: unknown): number | undefined {
	const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
		? parsed
		: undefined;
}

/** "24000/1001" → 23.976…; "0/0" and garbage → undefined. */
function parseFrameRate(value: string | undefined): number | undefined {
	if (!value) return;
	const [numerator, denominator = "1"] = value.split("/");
	const rate = Number(numerator) / Number(denominator);
	return positiveNumber(rate);
}

/**
 * Reads ffprobe's JSON. A video's duration comes from its video stream, not
 * the container: the container also spans a longer audio track, and placing
 * a clip by the container length leaves it overhanging its own picture.
 */
export function parseMediaProbe({
	stdout,
	type,
}: {
	stdout: string;
	type: MediaFile["type"];
}): MediaProbeFields {
	const parsed = JSON.parse(stdout) as {
		format?: { duration?: string };
		streams?: ProbeStream[];
	};
	const streams = parsed.streams ?? [];
	const video = streams.find((stream) => stream.codec_type === "video");
	const audio = streams.find((stream) => stream.codec_type === "audio");
	const containerDuration = positiveNumber(parsed.format?.duration);

	if (type === "audio") {
		const duration = positiveNumber(audio?.duration) ?? containerDuration;
		return duration ? { duration } : {};
	}

	const fields: MediaProbeFields = {};
	const width = positiveNumber(video?.width);
	const height = positiveNumber(video?.height);
	if (width && height) {
		fields.width = width;
		fields.height = height;
	}
	if (type === "video") {
		const duration = positiveNumber(video?.duration) ?? containerDuration;
		if (duration) fields.duration = duration;
		const fps =
			parseFrameRate(video?.avg_frame_rate) ??
			parseFrameRate(video?.r_frame_rate);
		if (fps) fields.fps = Number(fps.toFixed(3));
	}
	return fields;
}

async function runProbe({
	path,
	type,
}: {
	path: string;
	type: MediaFile["type"];
}): Promise<MediaProbeFields | null> {
	try {
		const { stdout } = await execFileAsync(
			await getFFprobePath(),
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration",
				"-of",
				"json",
				path,
			],
			{ timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
		);
		return parseMediaProbe({ stdout, type });
	} catch {
		return null;
	}
}

/** Probe one file, reusing the result while the file is unchanged. */
export function probeMediaFile({
	path,
	type,
	size,
	modifiedAt,
}: {
	path: string;
	type: MediaFile["type"];
	size: number;
	modifiedAt: number;
}): Promise<MediaProbeFields | null> {
	const key = `${path}\u0000${size}\u0000${modifiedAt}`;
	const cached = probeCache.get(key);
	if (cached) return cached;
	if (probeCache.size >= MAX_CACHED_PROBES) {
		const oldest = probeCache.keys().next().value;
		if (oldest !== undefined) probeCache.delete(oldest);
	}
	const pending = runProbe({ path, type });
	probeCache.set(key, pending);
	// A failure may be transient (a timeout under load), so let the next
	// listing try again instead of caching the empty result.
	pending.then((result) => {
		if (!result) probeCache.delete(key);
	});
	return pending;
}

function needsProbe(file: MediaFile): boolean {
	if (!file.path) return false;
	if (file.type === "audio") return file.duration === undefined;
	if (file.type === "image") return file.dimensions === undefined;
	return (
		file.duration === undefined ||
		file.dimensions === undefined ||
		file.fps === undefined
	);
}

/** Fill only what the listing does not already know; never overwrite it. */
function withProbe(file: MediaFile, probe: MediaProbeFields | null): MediaFile {
	if (!probe) return file;
	return {
		...file,
		...(file.duration === undefined && probe.duration !== undefined
			? { duration: probe.duration }
			: {}),
		...(file.dimensions === undefined &&
		probe.width !== undefined &&
		probe.height !== undefined
			? { dimensions: { width: probe.width, height: probe.height } }
			: {}),
		...(file.fps === undefined && probe.fps !== undefined
			? { fps: probe.fps }
			: {}),
	};
}

/** Add duration, dimensions and frame rate to a media listing. */
export async function withMediaProbes(
	files: MediaFile[]
): Promise<MediaFile[]> {
	const results = [...files];
	let next = 0;
	const worker = async () => {
		while (next < results.length) {
			const index = next++;
			const file = results[index];
			if (!needsProbe(file)) continue;
			const probe = await probeMediaFile({
				path: file.path,
				type: file.type,
				size: file.size,
				modifiedAt: file.modifiedAt,
			});
			results[index] = withProbe(file, probe);
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(MAX_CONCURRENT_PROBES, results.length) },
			worker
		)
	);
	return results;
}

/** Test hook: forget cached probes. */
export function clearMediaProbeCache(): void {
	probeCache.clear();
}
