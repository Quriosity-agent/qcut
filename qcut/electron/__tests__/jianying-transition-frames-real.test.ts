// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveJianyingTransition } from "../jianying-transition/jianying-transition-contract";
import { renderJianyingTimelineTransitions } from "../jianying-transition/render";
import { inspectJianyingTransitionRuntime } from "../jianying-transition/runtime-discovery";

/**
 * Every frame of a transition the local runtime draws, not a sample of them.
 *
 * The engine draws on a Metal queue of its own. The bridge used to read each
 * frame back the moment the seek returned, and got whatever the output
 * texture's pooled storage held: one of the inputs alone, an earlier frame,
 * half of this one. It takes another job on the GPU to lose that race: with
 * a Cycles render running on Metal, up to a third of the frames of a
 * transition were wrong; with only the CPU busy, or nothing else running,
 * none were, which is why three sample points in an export test passed.
 *
 * Needs the local runtime and its 叠化 package, so it runs only when asked:
 *
 *   QCUT_JIANYING_TRANSITION_REAL=1 bun x vitest run \
 *     electron/__tests__/jianying-transition-frames-real.test.ts
 *
 * `QCUT_JIANYING_TRANSITION_REAL_RUNS` sets how many times the transition is
 * rendered (5 by default). To see it fail on a bridge without the wait,
 * keep the GPU busy meanwhile (`blender -b` rendering with Cycles on the
 * GPU does).
 */

const DISSOLVE_ID = "jianying-local-6724845717472416269";
const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const CLIP_SECONDS = 1.2;
const TRANSITION_SECONDS = 0.8;
/** The two clips: flat colours, far apart, so a blend reads as a position. */
const FROM = [200, 60, 40] as const;
const TO = [30, 90, 250] as const;
const RUNS = Number(process.env.QCUT_JIANYING_TRANSITION_REAL_RUNS ?? 5);
const asked =
	process.platform === "darwin" &&
	process.env.QCUT_JIANYING_TRANSITION_REAL === "1" &&
	fs.existsSync(ffmpegPath);

function ffmpeg(args: string[]): Buffer {
	const result = spawnSync(ffmpegPath, ["-v", "error", "-y", ...args], {
		maxBuffer: 64 * 1024 * 1024,
	});
	expect(result.status, result.stderr.toString()).toBe(0);
	return result.stdout;
}

const hex = (colour: readonly number[]) =>
	`0x${colour.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

/** The mean colour of each frame of `file`. */
function frameColours({ file }: { file: string }): number[][] {
	const raw = ffmpeg([
		"-i",
		file,
		"-vf",
		"scale=8:8:flags=area",
		"-pix_fmt",
		"rgb24",
		"-f",
		"rawvideo",
		"-",
	]);
	const frameBytes = 8 * 8 * 3;
	const colours: number[][] = [];
	for (
		let offset = 0;
		offset + frameBytes <= raw.length;
		offset += frameBytes
	) {
		colours.push(
			[0, 1, 2].map((channel) => {
				let sum = 0;
				for (
					let pixel = offset + channel;
					pixel < offset + frameBytes;
					pixel += 3
				) {
					sum += raw[pixel];
				}
				return sum / 64;
			})
		);
	}
	return colours;
}

/**
 * Where `colour` sits between `from` and `to` (0 to 1), and how far off the
 * line between them it is.
 */
function position({
	colour,
	from,
	to,
}: {
	colour: number[];
	from: number[];
	to: number[];
}): { along: number; off: number } {
	const line = to.map((value, channel) => value - from[channel]);
	const lineLength = line.reduce((sum, value) => sum + value * value, 0);
	const offset = colour.map((value, channel) => value - from[channel]);
	const along =
		offset.reduce((sum, value, channel) => sum + value * line[channel], 0) /
		lineLength;
	const off = Math.sqrt(
		offset.reduce(
			(sum, value, channel) => sum + (value - along * line[channel]) ** 2,
			0
		)
	);
	return { along, off };
}

describe.skipIf(!asked)(
	"frames of a local runtime transition (real runtime)",
	() => {
		let directory = "";
		let inputPath = "";

		beforeAll(() => {
			directory = fs.mkdtempSync(
				path.join(os.tmpdir(), "qcut-transition-real-")
			);
			inputPath = path.join(directory, "cut.mp4");
			const clip = (colour: readonly number[]) =>
				`color=c=${hex(colour)}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${CLIP_SECONDS}`;
			ffmpeg([
				"-f",
				"lavfi",
				"-i",
				clip(FROM),
				"-f",
				"lavfi",
				"-i",
				clip(TO),
				"-filter_complex",
				"[0:v][1:v]concat=n=2:v=1:a=0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709",
				"-c:v",
				"libx264",
				"-crf",
				"10",
				"-colorspace",
				"bt709",
				"-color_primaries",
				"bt709",
				"-color_trc",
				"bt709",
				"-color_range",
				"tv",
				inputPath,
			]);
		}, 60_000);

		afterAll(() => {
			if (directory) fs.rmSync(directory, { recursive: true, force: true });
		});

		it("draws every frame of the window at its own moment, each time", async () => {
			const dissolve = resolveJianyingTransition({ value: DISSOLVE_ID });
			const inspection = await inspectJianyingTransitionRuntime();
			expect(inspection.bridgePath, inspection.status.message).toBeTruthy();
			expect(
				dissolve && inspection.packagePaths.has(dissolve.id),
				"the 叠化 package is cached on this machine"
			).toBe(true);

			const windowFrames = Math.round(TRANSITION_SECONDS * FPS);
			const firstFrame = Math.round(CLIP_SECONDS * FPS) - windowFrames / 2;
			const wrong: string[] = [];
			for (let run = 0; run < RUNS; run += 1) {
				const outputPath = path.join(directory, `out-${run}.mp4`);
				await renderJianyingTimelineTransitions({
					request: {
						inputPath,
						outputPath,
						width: WIDTH,
						height: HEIGHT,
						fps: FPS,
						transitions: [
							{
								presetId: DISSOLVE_ID,
								cutTime: CLIP_SECONDS,
								duration: TRANSITION_SECONDS,
								packageHash: dissolve?.metadataMd5,
							},
						],
					},
				});
				const colours = frameColours({ file: outputPath });
				expect(colours, `run ${run}`).toHaveLength(
					Math.round(CLIP_SECONDS * 2 * FPS)
				);
				// The two clips as this file holds them, outside the window:
				// the encode moves a flat colour a few levels.
				const from = colours[0];
				const to = colours[colours.length - 1];
				for (let index = 0; index < windowFrames; index += 1) {
					const { along, off } = position({
						colour: colours[firstFrame + index],
						from,
						to,
					});
					// A dissolve runs evenly: frame k of the window is k/n of the way.
					const wanted = index / windowFrames;
					if (off > 6 || Math.abs(along - wanted) > 0.05) {
						wrong.push(
							`run ${run} frame ${firstFrame + index}: ${along.toFixed(2)} along (wanted ${wanted.toFixed(2)}), ${off.toFixed(0)} off the line`
						);
					}
				}
			}
			expect(wrong, wrong.slice(0, 12).join("\n")).toEqual([]);
		}, 600_000);
	}
);
