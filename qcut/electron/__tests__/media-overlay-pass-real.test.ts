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
import { probeJoinedPictureColor } from "../claude/handlers/claude-export-handler/joined-picture";
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

async function composite(
	name: string,
	overlays: ExportSegment[],
	basePath = source("base.mp4")
) {
	const outputPath = path.join(tempDir, `${name}.mp4`);
	const pass = buildMediaOverlayPassArgs({
		inputPath: basePath,
		outputPath,
		overlays: await probeMediaOverlayInputs({ overlays }),
		settings: SETTINGS,
		duration: BASE_SECONDS,
		baseColor: await probeJoinedPictureColor({ path: basePath }),
	});
	run(pass.args);
	return outputPath;
}

const YUV_FRAME_BYTES = (W * H * 3) / 2;

/** Every frame of `file` as raw yuv420p, as its decoder gives them. */
function decodeYuv(file: string): Buffer[] {
	const result = spawnSync(
		ffmpegPath,
		["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"],
		{ maxBuffer: 256 * 1024 * 1024 }
	);
	expect(result.status, result.stderr?.toString()).toBe(0);
	return splitYuvFrames(result.stdout);
}

function splitYuvFrames(bytes: Buffer): Buffer[] {
	const frames: Buffer[] = [];
	for (
		let offset = 0;
		offset + YUV_FRAME_BYTES <= bytes.length;
		offset += YUV_FRAME_BYTES
	) {
		frames.push(bytes.subarray(offset, offset + YUV_FRAME_BYTES));
	}
	return frames;
}

/**
 * The frames the pass composites, as raw yuv420p: its inputs and filter
 * graph with the lossy encode left off, so bytes can be compared.
 */
async function compositeRaw(
	overlays: ExportSegment[],
	basePath: string,
	seconds: number
): Promise<Buffer[]> {
	const pass = buildMediaOverlayPassArgs({
		inputPath: basePath,
		outputPath: "unused.mp4",
		overlays: await probeMediaOverlayInputs({ overlays }),
		settings: SETTINGS,
		duration: seconds,
		baseColor: await probeJoinedPictureColor({ path: basePath }),
	});
	const result = spawnSync(
		ffmpegPath,
		[
			"-v",
			"error",
			// Through the picture's `-map`; the encoder options follow it.
			...pass.args.slice(0, pass.args.indexOf("-map") + 2),
			"-t",
			String(seconds),
			"-f",
			"rawvideo",
			"-pix_fmt",
			"yuv420p",
			"-",
		],
		{ maxBuffer: 256 * 1024 * 1024 }
	);
	expect(result.status, result.stderr?.toString()).toBe(0);
	return splitYuvFrames(result.stdout);
}

function luma(frame: Buffer, x: number, y: number): number {
	return frame[y * W + x];
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
		// Twelve frames whose last one is fully clear, as a card that has faded out.
		run([
			"-f",
			"lavfi",
			"-i",
			`color=c=black@0:s=${W}x${H}:r=${FPS}:d=0.5,format=rgba,` +
				"drawbox=x=40:y=40:w=80:h=60:color=red@1:t=fill:replace=1:enable='lt(n,11)'",
			"-c:v",
			"qtrle",
			"-pix_fmt",
			"argb",
			source("fade.mov"),
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

	it("holds a file's own last frame when the clip outlasts the file", async () => {
		// A 0.75 s clip of a 0.5 s file: twelve frames, then the last one held.
		const output = await composite("fade", [
			overlay(source("fade.mov"), 1, { duration: 0.75 }),
		]);
		const { frames } = decode(output);
		for (let index = 24; index <= 34; index += 1) {
			expectNear(
				pixel(frames[index], RED_BOX.x, RED_BOX.y),
				[255, 0, 0],
				24,
				`frame ${index}`
			);
		}
		// The file's last frame is clear, so the box is gone from there on.
		for (const index of [35, 38, 41]) {
			expectNear(
				pixel(frames[index], RED_BOX.x, RED_BOX.y),
				BASE,
				8,
				`frame ${index}`
			);
		}
	}, 60_000);

	/**
	 * The joined picture is copied from the segments, so its colour tags
	 * change where a clip from a tagged file follows an untagged one. FFmpeg
	 * rebuilt the whole graph there and every overlay lost the frames the old
	 * graph had read ahead: one that appeared later started 2–5 frames into
	 * its own picture and held its last frame to make up the length.
	 */
	it("starts an overlay on its own first frame after the picture's colour tags change", async () => {
		const colour = `color=c=0x3c8c3c:s=${W}x${H}:r=${FPS}:d=1.5`;
		run([
			"-f",
			"lavfi",
			"-i",
			colour,
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			source("untagged.mov"),
		]);
		run([
			"-f",
			"lavfi",
			"-i",
			colour,
			"-vf",
			"setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-color_range",
			"tv",
			"-colorspace",
			"bt709",
			"-color_primaries",
			"bt709",
			"-color_trc",
			"bt709",
			source("tagged.mov"),
		]);
		fs.writeFileSync(
			source("mixed-tags.txt"),
			["untagged.mov", "tagged.mov"]
				.map((name) => `file '${source(name)}'`)
				.join("\n")
		);
		run([
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			source("mixed-tags.txt"),
			"-c",
			"copy",
			source("mixed-tags.mp4"),
		]);
		// Twelve opaque frames, each as bright as its own number says.
		run([
			"-f",
			"lavfi",
			"-i",
			`color=c=black:s=${W}x${H}:r=${FPS}:d=0.5,geq=lum='36+16*N':cb=128:cr=128`,
			"-c:v",
			"libx264",
			"-qp",
			"0",
			"-pix_fmt",
			"yuv420p",
			source("numbered.mp4"),
		]);

		// Half a second into the tagged part of the picture.
		const output = await composite(
			"over-mixed-tags",
			[overlay(source("numbered.mp4"), 2)],
			source("mixed-tags.mp4")
		);
		const frames = decodeYuv(output);
		expect(frames).toHaveLength(BASE_SECONDS * FPS);
		const shown = frames
			.slice(47, 61)
			.map((frame) => (luma(frame, 160, 90) - 36) / 16);
		// The picture's own luma (108) on either side, then frames 0 to 11.
		expect(Math.abs(shown[0] - 4.5)).toBeLessThan(0.2);
		expect(Math.abs(shown[13] - 4.5)).toBeLessThan(0.2);
		for (let number = 0; number < 12; number += 1) {
			expect(
				Math.abs(shown[number + 1] - number),
				`output frame ${48 + number} shows ${shown[number + 1]}`
			).toBeLessThan(0.2);
		}
	}, 60_000);

	/**
	 * A blend mode works in RGB, so the picture under the clip is converted
	 * and converted back. The graph is no longer rebuilt at a change of
	 * colour tags, and FFmpeg would read each frame by its own tags while
	 * writing it back by the first frame's: the picture under a blended clip
	 * shifted in colour from the change on (12 levels of green here).
	 */
	it("keeps the picture's colours under a blend mode after its colour tags change", async () => {
		expect(
			await probeJoinedPictureColor({ path: source("mixed-tags.mp4") })
		).toEqual({ range: "unknown", space: "unknown" });
		expect(
			await probeJoinedPictureColor({ path: source("tagged.mov") })
		).toEqual({ range: "tv", space: "bt709" });
		// White multiplies to the picture itself.
		const output = await composite(
			"multiply-over-mixed-tags",
			[overlay(source("opaque.mp4"), 2, { blendMode: "multiply" })],
			source("mixed-tags.mp4")
		);
		const { frames } = decode(output);
		for (const index of [40, 48, 54, 59, 66]) {
			expectNear(pixel(frames[index], 160, 90), BASE, 6, `frame ${index}`);
		}
	}, 60_000);

	/**
	 * Overlays used to be drawn in RGBA, and FFmpeg then took the picture
	 * under them to RGBA and back as well: a timeline with any overlay on it
	 * exported 1.2–1.6 levels darker from end to end.
	 */
	it("leaves the picture as it is wherever no overlay covers it", async () => {
		run([
			"-f",
			"lavfi",
			"-i",
			`testsrc2=s=${W}x${H}:r=${FPS}:d=1`,
			"-c:v",
			"libx264",
			"-qp",
			"0",
			"-pix_fmt",
			"yuv420p",
			source("picture.mp4"),
		]);
		const before = decodeYuv(source("picture.mp4"));
		// A quarter-size clip in the middle of the frame, frames 6 to 17.
		const after = await compositeRaw(
			[
				overlay(source("opaque.mp4"), 0.25, {
					transform: {
						x: 0,
						y: 0,
						rotationDegrees: 0,
						scaleX: 0.25,
						scaleY: 0.25,
						opacity: 1,
					},
				}),
			],
			source("picture.mp4"),
			1
		);
		expect(after).toHaveLength(FPS);
		// No overlay on screen: the frame is the picture's, byte for byte.
		expect(after[2].equals(before[2])).toBe(true);
		expect(after[20].equals(before[20])).toBe(true);
		// With it on screen, everything around it still is (the clip covers
		// x 120–200, y 68–112; checked with a margin for the chroma planes).
		const frame = 12;
		expect(luma(after[frame], 160, 90)).toBeGreaterThan(230);
		let differing = 0;
		for (let y = 0; y < H; y += 1) {
			for (let x = 0; x < W; x += 1) {
				if (x >= 112 && x < 208 && y >= 60 && y < 120) continue;
				if (luma(after[frame], x, y) !== luma(before[frame], x, y)) {
					differing += 1;
				}
			}
		}
		expect(differing).toBe(0);
		const chromaWidth = W / 2;
		const chromaRows = H; // U then V, H / 2 rows each
		for (let row = 0; row < chromaRows; row += 1) {
			const y = (row % (H / 2)) * 2;
			for (let column = 0; column < chromaWidth; column += 1) {
				const x = column * 2;
				if (x >= 112 && x < 208 && y >= 60 && y < 120) continue;
				const index = W * H + row * chromaWidth + column;
				if (after[frame][index] !== before[frame][index]) differing += 1;
			}
		}
		expect(differing).toBe(0);
	}, 60_000);

	/**
	 * A clip drawn as an overlay goes to RGBA for its own chain and back to
	 * the picture's format; FFmpeg's default rounding in those conversions
	 * darkened it as well (0.2 of a level on this smooth picture).
	 */
	it("draws an opaque clip at its own levels", async () => {
		run([
			"-f",
			"lavfi",
			"-i",
			`testsrc2=s=${W}x${H}:r=${FPS}:d=1,gblur=sigma=12`,
			"-c:v",
			"libx264",
			"-qp",
			"0",
			"-pix_fmt",
			"yuv420p",
			source("clip.mp4"),
		]);
		const clip = decodeYuv(source("clip.mp4"));
		const after = await compositeRaw(
			[overlay(source("clip.mp4"), 0, { duration: 1 })],
			source("base.mp4"),
			1
		);
		let total = 0;
		let largest = 0;
		for (let index = 0; index < W * H; index += 1) {
			const difference = after[6][index] - clip[6][index];
			total += difference;
			largest = Math.max(largest, Math.abs(difference));
		}
		// On average the clip is neither darker nor brighter than its file.
		expect(Math.abs(total / (W * H))).toBeLessThan(0.1);
		expect(largest).toBeLessThanOrEqual(4);
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
