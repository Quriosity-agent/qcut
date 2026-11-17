/**
 * An adjustment layer between media overlays, run with the bundled FFmpeg.
 *
 * The stack, top to bottom: a red card (an overlay), the adjustment layer,
 * a green card (an overlay on a lower track), the film. The layer takes the
 * colour out of what is below it, the film and the green card, and leaves
 * the red card above it alone, as the preview stacks them. Graded over the
 * finished picture, as a layer above every overlay is, the red card would
 * lose its colour too.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdjustmentLayer } from "../claude/handlers/claude-export-handler/adjustment-layer-pass";
import { buildAdjustmentLayerPass } from "../claude/handlers/claude-export-handler/adjustment-layer-pass";
import { probeJoinedPictureColor } from "../claude/handlers/claude-export-handler/joined-picture";
import {
	buildMediaOverlayPassArgs,
	probeMediaOverlayInputs,
} from "../claude/handlers/claude-export-handler/media-overlay-pass";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";
import { DEFAULT_VIDEO_COLOR_SETTINGS } from "../ffmpeg/color-settings";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const tempDir = path.resolve(
	__dirname,
	"../../.tmp/media-overlay-adjustment-test"
);
const W = 320;
const H = 180;
const FPS = 24;
const SECONDS = 3;
const SETTINGS = {
	width: W,
	height: H,
	fps: FPS,
	codec: "libx264",
	bitrate: "8000k",
};

/** The film is one blue; each card is a box of one colour on a clear frame. */
const FILM = { x: 160, y: 20 };
const RED_CARD = { x: 60, y: 90 };
const GREEN_CARD = { x: 260, y: 90 };

function run(args: string[]) {
	const result = spawnSync(ffmpegPath, ["-v", "error", "-y", ...args], {
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
}

function file(name: string) {
	return path.join(tempDir, name);
}

function card({
	name,
	trackOrder,
}: {
	name: string;
	trackOrder: number;
}): ExportSegment {
	return {
		elementId: name,
		trackId: `track-${trackOrder}`,
		trackOrder,
		elementOrder: 0,
		sourcePath: file(name),
		startTime: 0,
		duration: SECONDS,
		trimStart: 0,
		sourceId: name,
		isImage: true,
		fitMode: "cover",
	};
}

/** RGB of one pixel of the frame at `time`. */
function pixelAt({
	video,
	time,
	x,
	y,
}: {
	video: string;
	time: number;
	x: number;
	y: number;
}): number[] {
	const result = spawnSync(
		ffmpegPath,
		[
			"-v",
			"error",
			"-i",
			video,
			"-vf",
			`select='eq(n,${Math.round(time * FPS)})',crop=4:4:${x}:${y},scale=1:1:flags=area`,
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: 1024 * 1024 }
	);
	expect(result.status, result.stderr?.toString()).toBe(0);
	return [...result.stdout.subarray(0, 3)];
}

/** How far a colour is from grey: 0 for grey, large for a saturated colour. */
function chroma([r, g, b]: number[]): number {
	return Math.max(r, g, b) - Math.min(r, g, b);
}

function desaturate({
	trackOrder,
	startTime,
	endTime,
}: {
	trackOrder: number;
	startTime: number;
	endTime: number;
}): AdjustmentLayer {
	const color = structuredClone(DEFAULT_VIDEO_COLOR_SETTINGS);
	color.enabled = true;
	color.basic = { ...color.basic, enabled: true, saturation: -100 };
	return {
		elementId: "grade",
		trackOrder,
		startTime,
		endTime,
		color,
		opacity: 1,
		aboveOverlays: false,
	};
}

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"an adjustment layer between media overlays (real FFmpeg)",
	() => {
		const overlays = [
			card({ name: "red.png", trackOrder: 0 }),
			card({ name: "green.png", trackOrder: 2 }),
		];
		/** Inside the layer's window, and outside it. */
		const INSIDE = 1.5;
		const OUTSIDE = 0.5;

		async function overlayPass({
			name,
			adjustmentLayers,
		}: {
			name: string;
			adjustmentLayers: AdjustmentLayer[];
		}): Promise<string> {
			const outputPath = file(`${name}.mp4`);
			const pass = buildMediaOverlayPassArgs({
				inputPath: file("film.mp4"),
				outputPath,
				overlays: await probeMediaOverlayInputs({ overlays }),
				adjustmentLayers,
				settings: SETTINGS,
				duration: SECONDS,
				baseColor: await probeJoinedPictureColor({ path: file("film.mp4") }),
			});
			run(pass.args);
			return outputPath;
		}

		beforeAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
			fs.mkdirSync(tempDir, { recursive: true });
			run([
				"-f",
				"lavfi",
				"-i",
				`color=c=0x4080c0:s=${W}x${H}:r=${FPS}:d=${SECONDS},format=yuv420p`,
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				file("film.mp4"),
			]);
			for (const [name, box] of [
				["red.png", "drawbox=x=20:y=60:w=80:h=60:color=0xd02020@1:t=fill"],
				["green.png", "drawbox=x=220:y=60:w=80:h=60:color=0x20c020@1:t=fill"],
			]) {
				run([
					"-f",
					"lavfi",
					"-i",
					`color=c=black@0:s=${W}x${H}:d=1,format=rgba,${box}:replace=1`,
					"-frames:v",
					"1",
					file(name),
				]);
			}
		}, 120_000);

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		it("grades the film and the card below it, and leaves the card above it in colour", async () => {
			const video = await overlayPass({
				name: "between",
				adjustmentLayers: [
					desaturate({ trackOrder: 1, startTime: 1, endTime: 2 }),
				],
			});
			const at = (time: number, spot: { x: number; y: number }) =>
				pixelAt({ video, time, ...spot });

			// Outside the layer's window everything keeps its colour.
			expect(chroma(at(OUTSIDE, FILM))).toBeGreaterThan(80);
			expect(chroma(at(OUTSIDE, GREEN_CARD))).toBeGreaterThan(120);
			expect(chroma(at(OUTSIDE, RED_CARD))).toBeGreaterThan(120);

			// Inside it, what lies below the layer is grey.
			expect(chroma(at(INSIDE, FILM))).toBeLessThan(12);
			expect(chroma(at(INSIDE, GREEN_CARD))).toBeLessThan(12);
			// The card above the layer is as red as it was.
			const red = at(INSIDE, RED_CARD);
			expect(chroma(red)).toBeGreaterThan(120);
			expect(red[0]).toBeGreaterThan(red[1] + 100);
		}, 120_000);

		it("differs from grading the finished picture exactly at the card above the layer", async () => {
			const stacked = await overlayPass({
				name: "plain",
				adjustmentLayers: [],
			});
			const after = file("graded-after.mp4");
			const pass = buildAdjustmentLayerPass({
				inputPath: stacked,
				outputPath: after,
				layers: [desaturate({ trackOrder: 1, startTime: 1, endTime: 2 })],
				codec: "libx264",
				bitrate: "8000k",
			});
			expect(pass).not.toBeNull();
			run((pass?.args ?? []).slice(1));
			// The way a layer above every overlay is graded takes the red too.
			expect(
				chroma(pixelAt({ video: after, time: INSIDE, ...RED_CARD }))
			).toBeLessThan(12);
			expect(
				chroma(pixelAt({ video: after, time: INSIDE, ...FILM }))
			).toBeLessThan(12);
		}, 120_000);

		it("grades everything when the layer is the top of the stack", async () => {
			const video = await overlayPass({
				name: "top",
				adjustmentLayers: [
					desaturate({ trackOrder: -1, startTime: 1, endTime: 2 }),
				],
			});
			for (const spot of [FILM, GREEN_CARD, RED_CARD]) {
				expect(chroma(pixelAt({ video, time: INSIDE, ...spot }))).toBeLessThan(
					12
				);
				expect(
					chroma(pixelAt({ video, time: OUTSIDE, ...spot }))
				).toBeGreaterThan(80);
			}
		}, 120_000);
	}
);
