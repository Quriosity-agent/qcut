import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { fingerprintPortraitAuditFiles } from "./jianying-portrait-session-process";

const execute = promisify(execFile);
export const MINUTE_SECONDS = 60;
export const MAX_FRAMES = 3601;
export const rgbaHash = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");

export interface MinuteFrame {
	index: number;
	time: number;
	sha256?: string;
}
export interface MinutePlan {
	width: number;
	height: number;
	containerDuration: number;
	frames: MinuteFrame[];
	spanSeconds: number;
}

export function planMinuteFrames({
	metadata,
}: {
	metadata: unknown;
}): MinutePlan {
	const value = metadata as {
		format?: { duration?: string };
		streams?: {
			width: number;
			height: number;
			sample_aspect_ratio?: string;
			side_data_list?: { rotation?: number }[];
		}[];
		frames?: { best_effort_timestamp_time?: string }[];
	};
	assert(
		value && value.streams?.length === 1,
		"Exactly one selected video stream required"
	);
	const {
		width,
		height,
		sample_aspect_ratio: sar,
		side_data_list: sideData,
	} = value.streams[0];
	assert(
		Number.isSafeInteger(width) &&
			Number.isSafeInteger(height) &&
			width > 0 &&
			height > 0 &&
			width * height <= 2_100_000,
		"Use a pre-sized positive <=2.1MP video"
	);
	assert(!sar || ["1:1", "0:1"].includes(sar), "Non-square pixels unsupported");
	assert(
		!sideData?.some(({ rotation }) => rotation),
		"Rotated stream unsupported"
	);
	const containerDuration = Number(value.format?.duration);
	assert(
		Number.isFinite(containerDuration) && containerDuration >= MINUTE_SECONDS,
		"Container is shorter than 60 seconds; do not loop or stretch it"
	);
	assert(
		Array.isArray(value.frames) && value.frames.length <= MAX_FRAMES,
		"Bounded decoded timestamps required"
	);
	const all = value.frames.map((frame, index) => ({
		index,
		time: Number(frame.best_effort_timestamp_time),
	}));
	assert(all.length >= 2, "Missing decoded video frames");
	assert(
		all.every(
			({ time }, index) =>
				Number.isFinite(time) &&
				time >= 0 &&
				(index === 0 ||
					(time > all[index - 1].time && time - all[index - 1].time <= 1))
		),
		"Decoded timestamps must increase without gaps over one second"
	);
	const last = all.findIndex(
		({ time }) => time - all[0].time >= MINUTE_SECONDS
	);
	assert(last >= 1, "Decoded frame span is shorter than 60 seconds");
	const frames = all.slice(0, last + 1);
	assert(
		width * height * 4 * frames.length <= 8 * 1024 ** 3,
		"Raw decode exceeds 8 GiB bound"
	);
	return {
		width,
		height,
		containerDuration,
		frames,
		spanSeconds: frames.at(-1)!.time - frames[0].time,
	};
}

export function verifyMinuteMotion({ frames }: { frames: MinuteFrame[] }) {
	assert(
		frames.length >= 2 &&
			frames.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256 ?? "")),
		"Every decoded frame needs a hash"
	);
	const uniqueFrames = new Set(frames.map(({ sha256 }) => sha256)).size;
	assert(
		uniqueFrames >= Math.max(3, Math.ceil(frames.length / 2)),
		"Repeated still/loop fixture: fewer than half the decoded frames are unique"
	);
	return {
		uniqueFrames,
		repeatedFrames: frames.length - uniqueFrames,
		motionScope:
			"decoded pixel diversity only; not proof of uninterrupted face motion or identity tracking",
	};
}

export async function probeMinuteVideo({ source }: { source: string }) {
	const identity = await fingerprintPortraitAuditFiles({ paths: [source] });
	assert(identity[0].bytes <= 256 * 1024 ** 2, "Source exceeds 256 MiB bound");
	const result = await execute(
		"ffprobe",
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-read_intervals",
			`%+#${MAX_FRAMES}`,
			"-show_streams",
			"-show_frames",
			"-show_format",
			"-show_entries",
			"format=duration:stream=width,height,sample_aspect_ratio:stream_side_data=rotation:frame=best_effort_timestamp_time",
			"-of",
			"json",
			source,
		],
		{ timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 ** 2 }
	);
	return {
		plan: planMinuteFrames({ metadata: JSON.parse(result.stdout) }),
		identity,
	};
}

export async function decodeMinuteVideo({
	source,
	file,
	plan,
}: {
	source: string;
	file: string;
	plan: MinutePlan;
}) {
	await execute(
		"ffmpeg",
		[
			"-v",
			"error",
			"-nostdin",
			"-hwaccel",
			"none",
			"-threads",
			"1",
			"-noautorotate",
			"-i",
			source,
			"-map",
			"0:v:0",
			"-an",
			"-sn",
			"-dn",
			"-fps_mode",
			"passthrough",
			"-frames:v",
			String(plan.frames.length),
			"-threads",
			"1",
			"-pix_fmt",
			"rgba",
			"-f",
			"rawvideo",
			"-n",
			file,
		],
		{ timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 1024 ** 2 }
	);
	assert.equal(
		(await stat(file)).size,
		plan.width * plan.height * 4 * plan.frames.length,
		"Incomplete chronological RGBA decode"
	);
}

export async function openMinuteFrames({
	file,
	plan,
}: {
	file: string;
	plan: MinutePlan;
}) {
	const handle = await open(file, "r");
	const size = plan.width * plan.height * 4;
	return {
		close: () => handle.close(),
		read: async ({ index }: { index: number }) => {
			assert(
				Number.isSafeInteger(index) && index >= 0 && index < plan.frames.length,
				"Frame index out of range"
			);
			const bytes = Buffer.alloc(size);
			const { bytesRead } = await handle.read(bytes, 0, size, index * size);
			assert.equal(bytesRead, size, "Truncated decoded frame");
			return new Uint8Array(bytes);
		},
	};
}
