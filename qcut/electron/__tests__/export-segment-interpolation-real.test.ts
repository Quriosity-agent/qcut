import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp", isPackaged: false },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

import { buildExportSegmentScaleFilter } from "../claude/handlers/claude-export-handler/export-engine";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
	planSegmentPictureRead,
} from "../claude/handlers/claude-export-handler/export-segment-encode";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";

/**
 * What each frame of a segment with frame interpolation shows: the picture
 * between two source frames at that frame's own time, from the clip's
 * in-point (on a source frame or between two) to its last source frame.
 *
 * The source is opened ahead of the in-point and put on the clock of the
 * clip's first output frame, so minterpolate is handed frames before zero.
 * It reads them like any others, and has the frames it needs by the time
 * the clip starts. At the other end it writes the stretch after a frame
 * only once two more have followed: with one, the clip never reached its
 * last source frame and held the blend before it.
 */

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const tempDir = path.resolve(
	__dirname,
	"../../.tmp/export-segment-interpolation-test"
);
const FPS = 24;
const WIDTH = 160;
const HEIGHT = 90;
/** Source frame n is a flat grey of this level, so a blend reads as a position. */
const LEVEL = { base: 40, step: 6 };
const CLIP_SECONDS = 0.5;

function run(args: string[]): Buffer {
	const result = spawnSync(ffmpegPath, ["-v", "error", "-y", ...args], {
		maxBuffer: 64 * 1024 * 1024,
	});
	expect(result.status, result.stderr.toString()).toBe(0);
	return result.stdout;
}

function makeSource({ file, fps }: { file: string; fps: number }): void {
	run([
		"-f",
		"lavfi",
		"-i",
		`color=c=gray:s=${WIDTH}x${HEIGHT}:r=${fps}:d=2.5,format=yuv420p,geq=lum='${LEVEL.base}+${LEVEL.step}*N':cb=128:cr=128`,
		"-c:v",
		"libx264",
		"-crf",
		"8",
		"-g",
		"12",
		"-pix_fmt",
		"yuv420p",
		file,
	]);
}

/** The source position (in source frames) each frame of `file` shows. */
function shownPositions({ file }: { file: string }): number[] {
	const raw = run(["-i", file, "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"]);
	const lumaBytes = WIDTH * HEIGHT;
	const frameBytes = (lumaBytes * 3) / 2;
	const positions: number[] = [];
	for (
		let offset = 0;
		offset + frameBytes <= raw.length;
		offset += frameBytes
	) {
		let sum = 0;
		for (let index = 0; index < lumaBytes; index += 1) {
			sum += raw[offset + index];
		}
		positions.push((sum / lumaBytes - LEVEL.base) / LEVEL.step);
	}
	return positions;
}

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"a segment with frame interpolation (real ffmpeg)",
	() => {
		const sources = { 12: "", 10: "" } as Record<number, string>;

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			for (const fps of [12, 10]) {
				sources[fps] = path.join(tempDir, `grey-${fps}.mov`);
				makeSource({ file: sources[fps], fps });
			}
		}, 60_000);

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		function encode({
			mode,
			sourceFps,
			trimStart,
		}: {
			mode: "blend" | "motion-compensated";
			sourceFps: number;
			trimStart: number;
		}): number[] {
			const segment: ExportSegment = {
				elementId: "clip-1",
				trackId: "track-1",
				trackOrder: 0,
				elementOrder: 0,
				sourcePath: sources[sourceFps],
				startTime: 0,
				duration: CLIP_SECONDS,
				trimStart,
				sourceId: "media-1",
				fitMode: "cover",
				frameInterpolation: mode,
			};
			const read = planSegmentPictureRead({ segment });
			const outputPath = path.join(
				tempDir,
				`${mode}-${sourceFps}-${trimStart}.mov`
			);
			run(
				buildExportSegmentEncodeArgs({
					inputArgs: buildExportSegmentInputArgs({ segment, read }),
					scaleFilter: buildExportSegmentScaleFilter({
						segment,
						settings: { width: WIDTH, height: HEIGHT, fps: FPS },
					}),
					segment,
					settings: {
						width: WIDTH,
						height: HEIGHT,
						fps: FPS,
						codec: "libx264",
						bitrate: "4000k",
					},
					audio: null,
					outputPath,
					read,
				}).slice(1)
			);
			return shownPositions({ file: outputPath });
		}

		it.each([
			"blend",
			"motion-compensated",
		] as const)("%s: every frame shows the picture at its own time, in-point to last frame", (mode) => {
			for (const { sourceFps, trimStart } of [
				// On a source frame, between two, and at no round place.
				{ sourceFps: 12, trimStart: 0.5 },
				{ sourceFps: 12, trimStart: 6.5 / 12 },
				{ sourceFps: 12, trimStart: 0.52 },
				// A rate whose frames do not fall on the timeline's.
				{ sourceFps: 10, trimStart: 0.57 },
			]) {
				const shown = encode({ mode, sourceFps, trimStart });
				const label = `${sourceFps} fps from ${trimStart.toFixed(4)} s`;
				expect(shown, label).toHaveLength(CLIP_SECONDS * FPS);
				// The clip's last source frame: the last one before its end.
				// FFmpeg bounds what it reads by decode order, so a frame or two
				// past the end may be read as well, and the last frames then go
				// on towards it; without it they hold the last frame.
				const lastFrame =
					Math.ceil((trimStart + CLIP_SECONDS) * sourceFps - 1e-9) - 1;
				for (const [frame, position] of shown.entries()) {
					const atItsTime = (trimStart + frame / FPS) * sourceFps;
					const held = Math.min(atItsTime, lastFrame);
					// A tenth of a source frame is 8 ms here. The first frame
					// used to be up to a whole source frame ahead, and the last
					// ones half a frame short of the last source frame.
					expect(
						position,
						`${label}, frame ${frame}: ${position.toFixed(2)} for ${held.toFixed(2)} to ${atItsTime.toFixed(2)}`
					).toBeGreaterThan(held - 0.15);
					expect(
						position,
						`${label}, frame ${frame}: ${position.toFixed(2)} for ${held.toFixed(2)} to ${atItsTime.toFixed(2)}`
					).toBeLessThan(atItsTime + 0.15);
				}
			}
		}, 120_000);
	}
);
