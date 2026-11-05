import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { expect } from "@playwright/test";

export const exportFfmpeg = path.resolve(
	`electron/resources/ffmpeg/${process.platform}-${process.arch}/ffmpeg${process.platform === "win32" ? ".exe" : ""}`
);
const ffprobe = path.join(
	path.dirname(exportFfmpeg),
	process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
);

export function createDesktopExportSource({
	file,
	width,
	height,
}: {
	file: string;
	width: number;
	height: number;
}) {
	execFileSync(exportFfmpeg, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=0x202020:s=${width}x${height}:r=24`,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:sample_rate=48000",
		"-t",
		"3",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-ac",
		"2",
		file,
	]);
}

interface StreamProbe {
	codec_type: string;
	width?: number;
	height?: number;
	duration?: string;
	start_time?: string;
	nb_frames?: string;
}

export function verifyDesktopExport({
	file,
	width,
	height,
	projectWidth,
	projectHeight,
}: {
	file: string;
	width: number;
	height: number;
	projectWidth: number;
	projectHeight: number;
}) {
	const probe = JSON.parse(
		execFileSync(
			ffprobe,
			["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
			{ encoding: "utf8" }
		)
	) as { streams: StreamProbe[]; format: { duration: string } };
	const video = probe.streams.find((stream) => stream.codec_type === "video");
	const audio = probe.streams.find((stream) => stream.codec_type === "audio");
	expect(video, "video stream").toBeDefined();
	expect(audio, "audio stream").toBeDefined();
	expect([video?.width, video?.height]).toEqual([width, height]);
	expect(Math.abs(Number(video?.duration) - 3), "video duration").toBeLessThan(
		0.05
	);
	expect(Math.abs(Number(audio?.duration) - 3), "audio duration").toBeLessThan(
		0.08
	);
	expect(
		Math.abs(Number(video?.start_time)),
		"video starts at zero"
	).toBeLessThan(0.002);
	execFileSync(
		exportFfmpeg,
		["-v", "error", "-xerror", "-i", file, "-f", "null", "-"],
		{ timeout: 60_000 }
	);
	const pcm = execFileSync(
		exportFfmpeg,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vn",
			"-ar",
			"48000",
			"-ac",
			"2",
			"-f",
			"f32le",
			"-",
		],
		{ maxBuffer: 8 * 1024 * 1024 }
	);
	const channelRms = [0, 1].map((channel) => {
		let energy = 0;
		let count = 0;
		for (let sample = 48_000 * 2 + channel; sample < 48_000 * 5; sample += 2) {
			const value = pcm.readFloatLE(sample * 4);
			energy += value * value;
			count += 1;
		}
		return Math.sqrt(energy / count);
	});
	for (const rms of channelRms) {
		expect(
			Math.abs(rms - 0.0625),
			"stereo tone retains its expected RMS through AAC encoding"
		).toBeLessThanOrEqual(0.003);
	}
	const rgb = execFileSync(
		exportFfmpeg,
		[
			"-v",
			"error",
			"-ss",
			"1.5",
			"-i",
			file,
			"-frames:v",
			"1",
			"-vf",
			`scale=${projectWidth}:${projectHeight}`,
			"-pix_fmt",
			"rgb24",
			"-f",
			"rawvideo",
			"-",
		],
		{ maxBuffer: 32 * 1024 * 1024 }
	);
	execFileSync(exportFfmpeg, [
		"-y",
		"-v",
		"error",
		"-ss",
		"1.5",
		"-i",
		file,
		"-frames:v",
		"1",
		"-vf",
		`scale=${projectWidth}:${projectHeight}`,
		`${file}.png`,
	]);
	return {
		probe,
		channelRms,
		pcmSha256: createHash("sha256").update(pcm).digest("hex"),
		...measureDesktopFrame({ rgb, projectWidth, projectHeight }),
		fullDecode: true,
	};
}

function measureDesktopFrame({
	rgb,
	projectWidth,
	projectHeight,
}: {
	rgb: Buffer;
	projectWidth: number;
	projectHeight: number;
}) {
	expect(rgb.length).toBe(projectWidth * projectHeight * 3);
	const bounds = ({
		kind,
	}: {
		kind: "text" | "background" | "stackedBackground";
	}) => {
		let left = projectWidth;
		let top = projectHeight;
		let right = -1;
		let bottom = -1;
		let count = 0;
		for (let y = 0; y < projectHeight; y += 1) {
			for (let x = 0; x < projectWidth; x += 1) {
				const offset = (y * projectWidth + x) * 3;
				const [r, g, b] = rgb.subarray(offset, offset + 3);
				const matches =
					(kind === "text" && r > 170 && g > 170 && b < 100) ||
					(kind === "background" && g > r + 45 && b > r + 45) ||
					(kind === "stackedBackground" && r > g + 80 && b > g + 80);
				if (!matches) continue;
				left = Math.min(left, x);
				top = Math.min(top, y);
				right = Math.max(right, x);
				bottom = Math.max(bottom, y);
				count += 1;
			}
		}
		expect(count, `${kind} has visible pixels`).toBeGreaterThan(100);
		return { left, top, right, bottom, count };
	};
	const background = bounds({ kind: "background" });
	const stackedBackground = bounds({ kind: "stackedBackground" });
	expect(
		background.bottom - background.top,
		"the first caption includes automatically wrapped secondary rows"
	).toBeGreaterThan(140);
	expect(
		stackedBackground.bottom,
		"the later caption stays above the complete wrapped caption box"
	).toBeLessThanOrEqual(background.top + 1);
	const backgroundFill = [0, 1, 2].map((channel) => {
		let total = 0;
		for (let y = background.top + 5; y < background.top + 10; y += 1) {
			for (let x = background.left + 5; x < background.left + 10; x += 1) {
				total += rgb[(y * projectWidth + x) * 3 + channel];
			}
		}
		return total / 25;
	});
	for (const [channel, expected] of [10, 188, 188].entries()) {
		expect(
			Math.abs(backgroundFill[channel] - expected),
			`70% cyan caption background channel ${channel}`
		).toBeLessThanOrEqual(6);
	}
	return {
		text: bounds({ kind: "text" }),
		background,
		stackedBackground,
		backgroundFill,
	};
}

export function verifyDesktopPreview({
	file,
	projectWidth,
	projectHeight,
}: {
	file: string;
	projectWidth: number;
	projectHeight: number;
}) {
	const rgb = execFileSync(
		exportFfmpeg,
		[
			"-v",
			"error",
			"-i",
			file,
			"-frames:v",
			"1",
			"-vf",
			`scale=${projectWidth}:${projectHeight}`,
			"-pix_fmt",
			"rgb24",
			"-f",
			"rawvideo",
			"-",
		],
		{ maxBuffer: 32 * 1024 * 1024, timeout: 30_000 }
	);
	return measureDesktopFrame({ rgb, projectWidth, projectHeight });
}
