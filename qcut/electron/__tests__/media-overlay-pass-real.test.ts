/**
 * The native export's media overlay pass, run with the bundled FFmpeg on
 * transparent sources in every format the editor accepts: VP9 with
 * `alpha_mode=1` (alpha only through libvpx), ProRes 4444, QuickTime
 * Animation and PNG in MOV, and a PNG still; plus an opaque clip drawn as
 * picture-in-picture. Each source is a transparent frame holding an opaque
 * red box and a half-transparent blue band.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildMediaOverlayPassArgs,
	probeMediaOverlayInputs,
} from "../claude/handlers/claude-export-handler/media-overlay-pass";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const ffprobePath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffprobe"
);
const tempDir = path.resolve(__dirname, "../../.tmp/media-overlay-pass-test");
const W = 320;
const H = 180;
const FPS = 24;
const BASE_SECONDS = 3;
/** The base picture's colour. */
const BASE = [60, 140, 60];
const SETTINGS = {
	width: W,
	height: H,
	fps: FPS,
	codec: "libx264",
	bitrate: "8000k",
};
const SOURCE_FRAME =
	`color=c=black@0:s=${W}x${H}:r=${FPS}:d=1,format=rgba,` +
	"drawbox=x=40:y=40:w=80:h=60:color=red@1:t=fill:replace=1," +
	`drawbox=x=0:y=150:w=${W}:h=20:color=blue@0.5:t=fill:replace=1`;

function run(args: string[]) {
	const result = spawnSync(ffmpegPath, ["-v", "error", "-y", ...args], {
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
}

function source(name: string) {
	return path.join(tempDir, name);
}

function overlay(
	sourcePath: string,
	startTime: number,
	extra: Partial<ExportSegment> = {}
): ExportSegment {
	return {
		elementId: path.basename(sourcePath),
		trackId: "overlay-track",
		trackOrder: 0,
		elementOrder: 0,
		sourcePath,
		startTime,
		duration: 0.5,
		trimStart: 0,
		sourceId: path.basename(sourcePath),
		fitMode: "cover",
		...extra,
	};
}

/** Every frame of `file` as RGB bytes, plus the frame count. */
function decode(file: string): { frames: Buffer[] } {
	const result = spawnSync(
		ffmpegPath,
		["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
		{ maxBuffer: 256 * 1024 * 1024 }
	);
	expect(result.status, result.stderr?.toString()).toBe(0);
	const size = W * H * 3;
	const frames: Buffer[] = [];
	for (let offset = 0; offset + size <= result.stdout.length; offset += size) {
		frames.push(result.stdout.subarray(offset, offset + size));
	}
	return { frames };
}

function pixel(frame: Buffer, x: number, y: number): number[] {
	const index = (y * W + x) * 3;
	return [frame[index], frame[index + 1], frame[index + 2]];
}

function expectNear(
	actual: number[],
	expected: number[],
	tolerance: number,
	label = ""
) {
	for (const [channel, value] of expected.entries()) {
		expect(
			Math.abs(actual[channel] - value),
			`${label} channel ${channel}: ${actual} vs ${expected}`
		).toBeLessThanOrEqual(tolerance);
	}
}

async function composite(name: string, overlays: ExportSegment[]) {
	const outputPath = path.join(tempDir, `${name}.mp4`);
	const pass = buildMediaOverlayPassArgs({
		inputPath: source("base.mp4"),
		outputPath,
		overlays: await probeMediaOverlayInputs({ overlays }),
		settings: SETTINGS,
		duration: BASE_SECONDS,
	});
	run(pass.args);
	return outputPath;
}

const RED_BOX = { x: 80, y: 70 };
const CLEAR = { x: 220, y: 100 };
const BLUE_BAND = { x: 160, y: 160 };
const HALF_BLUE = [BASE[0] / 2, BASE[1] / 2, (BASE[2] + 255) / 2];

describe.skipIf(!fs.existsSync(ffmpegPath))("media overlay pass", () => {
	beforeAll(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.mkdirSync(tempDir, { recursive: true });
		run([
			"-f",
			"lavfi",
			"-i",
			`color=c=0x3c8c3c:s=${W}x${H}:r=${FPS}:d=${BASE_SECONDS}`,
			"-f",
			"lavfi",
			"-i",
			`sine=frequency=440:sample_rate=48000:duration=${BASE_SECONDS}`,
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			source("base.mp4"),
		]);
		const encodings: Array<[string, string[]]> = [
			[
				"vp9.webm",
				[
					"-c:v",
					"libvpx-vp9",
					"-pix_fmt",
					"yuva420p",
					"-crf",
					"10",
					"-b:v",
					"0",
					"-auto-alt-ref",
					"0",
				],
			],
			[
				"prores.mov",
				["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le"],
			],
			["qtrle.mov", ["-c:v", "qtrle", "-pix_fmt", "argb"]],
			["png.mov", ["-c:v", "png", "-pix_fmt", "rgba"]],
		];
		for (const [name, codec] of encodings) {
			run(["-f", "lavfi", "-i", SOURCE_FRAME, ...codec, source(name)]);
		}
		run([
			"-f",
			"lavfi",
			"-i",
			SOURCE_FRAME,
			"-frames:v",
			"1",
			source("still.png"),
		]);
		run([
			"-f",
			"lavfi",
			"-i",
			`color=c=white:s=${W}x${H}:r=${FPS}:d=1`,
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			source("opaque.mp4"),
		]);
	}, 60_000);

	afterAll(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("reads the VP9 source's alpha through libvpx", async () => {
		const [vp9] = await probeMediaOverlayInputs({
			overlays: [overlay(source("vp9.webm"), 0)],
		});
		expect(vp9.alpha).toMatchObject({
			codec: "vp9",
			alphaMode: 1,
			hasAlpha: true,
			decoder: "libvpx-vp9",
		});
	});

	it("draws each transparent format over the picture, only in its own frames", async () => {
		const starts = {
			"vp9.webm": 0.25,
			"prores.mov": 0.875,
			"qtrle.mov": 1.5,
			"png.mov": 2.125,
		};
		const output = await composite(
			"formats",
			Object.entries(starts).map(([name, start], elementOrder) =>
				overlay(source(name), start, { elementOrder })
			)
		);
		const { frames } = decode(output);
		expect(frames).toHaveLength(BASE_SECONDS * FPS);
		for (const [name, start] of Object.entries(starts)) {
			const first = Math.round(start * FPS);
			const last = first + 0.5 * FPS - 1;
			for (const index of [first, first + 6, last]) {
				const frame = frames[index];
				const label = `${name} frame ${index}`;
				expectNear(pixel(frame, RED_BOX.x, RED_BOX.y), [255, 0, 0], 24, label);
				expectNear(pixel(frame, CLEAR.x, CLEAR.y), BASE, 8, label);
				expectNear(
					pixel(frame, BLUE_BAND.x, BLUE_BAND.y),
					HALF_BLUE,
					16,
					label
				);
			}
			for (const index of [first - 1, last + 1]) {
				const label = `${name} frame ${index}`;
				expectNear(pixel(frames[index], RED_BOX.x, RED_BOX.y), BASE, 8, label);
			}
		}
	}, 60_000);

	it("covers the picture with an opaque clip as picture-in-picture, scaled and moved", async () => {
		const output = await composite("pip", [
			overlay(source("opaque.mp4"), 1, {
				transform: {
					x: 40,
					y: 0,
					rotationDegrees: 0,
					scaleX: 0.5,
					scaleY: 0.5,
					opacity: 1,
				},
			}),
		]);
		const frame = decode(output).frames[30];
		// A half-size frame centred 40 px right of the canvas centre: x 120–280.
		expectNear(pixel(frame, 200, 90), [255, 255, 255], 8);
		expectNear(pixel(frame, 270, 90), [255, 255, 255], 8);
		expectNear(pixel(frame, 100, 90), BASE, 8);
		expectNear(pixel(frame, 290, 90), BASE, 8);
		expectNear(pixel(frame, 200, 30), BASE, 8);
	}, 60_000);

	it("scales a still's own alpha by the clip's opacity", async () => {
		const output = await composite("still-opacity", [
			overlay(source("still.png"), 1, {
				isImage: true,
				transform: {
					x: 0,
					y: 0,
					rotationDegrees: 0,
					scaleX: 1,
					scaleY: 1,
					opacity: 0.5,
				},
			}),
		]);
		const { frames } = decode(output);
		const frame = frames[30];
		expectNear(
			pixel(frame, RED_BOX.x, RED_BOX.y),
			[(BASE[0] + 255) / 2, BASE[1] / 2, BASE[2] / 2],
			16
		);
		expectNear(pixel(frame, CLEAR.x, CLEAR.y), BASE, 8);
		// A quarter blue: the band's half alpha times the clip's half opacity.
		expectNear(
			pixel(frame, BLUE_BAND.x, BLUE_BAND.y),
			[BASE[0] * 0.75, BASE[1] * 0.75, BASE[2] * 0.75 + 255 * 0.25],
			16
		);
		expectNear(pixel(frames[23], RED_BOX.x, RED_BOX.y), BASE, 8);
		expectNear(pixel(frames[36], RED_BOX.x, RED_BOX.y), BASE, 8);
	}, 60_000);

	it("multiplies a clip with the multiply blend mode, inside its alpha only", async () => {
		const output = await composite("multiply", [
			overlay(source("png.mov"), 1, { blendMode: "multiply" }),
		]);
		const frame = decode(output).frames[30];
		// Red × base keeps the base's red channel and zeroes the rest.
		expectNear(pixel(frame, RED_BOX.x, RED_BOX.y), [BASE[0], 0, 0], 16);
		expectNear(pixel(frame, CLEAR.x, CLEAR.y), BASE, 8);
	}, 60_000);

	it("keeps the picture's length and copies its sound", async () => {
		const output = await composite("sound", [overlay(source("png.mov"), 2.75)]);
		const probe = spawnSync(
			ffprobePath,
			[
				"-v",
				"error",
				"-show_entries",
				"stream=codec_type,codec_name",
				"-of",
				"csv=p=0",
				output,
			],
			{ encoding: "utf8" }
		);
		expect(probe.stdout).toContain("audio");
		// An overlay that would run past the picture is cut at its end.
		expect(decode(output).frames).toHaveLength(BASE_SECONDS * FPS);
	}, 60_000);
});
