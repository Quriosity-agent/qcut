import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAdjustmentLayerPass } from "../claude/handlers/claude-export-handler/adjustment-layer-pass";
import {
	buildCursorDecodeArgs,
	buildCursorEncodeArgs,
} from "../claude/handlers/claude-export-handler/cursor-composite";
import { buildRangePictureArgs } from "../claude/handlers/claude-export-handler/export-range";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
} from "../claude/handlers/claude-export-handler/export-segment-encode";
import { buildGapSegmentEncodeArgs } from "../claude/handlers/claude-export-handler/gap-segments";
import { probeJoinedPictureColor } from "../claude/handlers/claude-export-handler/joined-picture";
import {
	buildMediaOverlayPassArgs,
	probeMediaOverlayInputs,
} from "../claude/handlers/claude-export-handler/media-overlay-pass";
import {
	EXPORT_PICTURE_COLOR_FILTERS,
	probeSourceColor,
	resolveSourceColor,
} from "../claude/handlers/claude-export-handler/source-color";
import { buildStickerOverlayPass } from "../claude/handlers/claude-export-handler/sticker-overlay";
import { buildTextRasterOverlayPassArgs } from "../claude/handlers/claude-export-handler/text-raster-overlay-pass";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";
import { DEFAULT_VIDEO_COLOR_SETTINGS } from "../ffmpeg/color-settings";
import { buildVideoFitFilter } from "../ffmpeg/video-fit-filter";
import { buildFFmpegArgs } from "../ffmpeg-args-builder";

/**
 * Every kind of source leaves the native export's segment encode as BT.709,
 * limited range, tagged on every frame, showing the colours the preview and
 * the in-browser export show for it. Colour bars of known RGB values are
 * decoded back as BT.709: a picture that kept another matrix or range reads
 * 20 to 40 levels off on its saturated bars.
 */

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const ffprobePath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffprobe"
);
const tempDir = path.resolve(__dirname, "../../.tmp/source-color-test");
const W = 1280;
const H = 720;
const FPS = 30;
const SETTINGS = {
	width: W,
	height: H,
	fps: FPS,
	codec: "libx264",
	bitrate: "8000k",
};
const EXPORT_TAGS = "tv,bt709,bt709,bt709";

/** Two rows of eight bars: saturated primaries, then mid tones. */
const BARS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
	[
		[255, 255, 255],
		[255, 255, 0],
		[0, 255, 255],
		[0, 255, 0],
		[255, 0, 255],
		[255, 0, 0],
		[0, 0, 255],
		[0, 0, 0],
	],
	[
		[128, 128, 128],
		[192, 160, 64],
		[31, 189, 95],
		[32, 96, 255],
		[224, 172, 105],
		[60, 120, 180],
		[200, 40, 80],
		[16, 16, 16],
	],
];
const MEASURE_W = 128;
const MEASURE_H = 72;

function run(args: string[]): Buffer {
	const result = spawnSync(ffmpegPath, ["-v", "error", "-y", ...args], {
		maxBuffer: 256 * 1024 * 1024,
	});
	expect(result.status, result.stderr.toString()).toBe(0);
	return result.stdout;
}

function barsPpm({ width, height }: { width: number; height: number }) {
	const pixels = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y += 1) {
		const row = BARS[Math.min(1, Math.floor((y * 2) / height))];
		for (let x = 0; x < width; x += 1) {
			const [r, g, b] = row[Math.min(7, Math.floor((x * 8) / width))];
			pixels.set([r, g, b], (y * width + x) * 3);
		}
	}
	return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]);
}

/** A clip of the bars, coded by `matrix`, saying so or not. */
function makeClip({
	name,
	matrix,
	tagged = true,
	range = "tv",
	width = W,
	height = H,
}: {
	name: string;
	matrix: "bt601" | "bt709";
	tagged?: boolean;
	range?: "tv" | "pc";
	width?: number;
	height?: number;
}): string {
	const file = path.join(tempDir, name);
	const ppm = `${file}.ppm`;
	fs.writeFileSync(ppm, barsPpm({ width, height }));
	const tag = matrix === "bt601" ? "smpte170m" : "bt709";
	const frameTags = tagged
		? `setparams=range=${range}:color_primaries=${tag}:color_trc=${tag}:colorspace=${tag}`
		: "setparams=range=unknown:color_primaries=unknown:color_trc=unknown:colorspace=unknown";
	run([
		"-loop",
		"1",
		"-framerate",
		String(FPS),
		"-t",
		"1",
		"-i",
		ppm,
		"-vf",
		`scale=out_color_matrix=${matrix}:out_range=${range},format=yuv420p,${frameTags}`,
		"-c:v",
		"libx264",
		"-crf",
		"10",
		"-pix_fmt",
		"yuv420p",
		...(tagged
			? [
					"-colorspace",
					tag,
					"-color_primaries",
					tag,
					"-color_trc",
					tag,
					"-color_range",
					range,
				]
			: []),
		"-an",
		file,
	]);
	return file;
}

function makeStill(name: string): string {
	const file = path.join(tempDir, name);
	const ppm = `${file}.ppm`;
	fs.writeFileSync(ppm, barsPpm({ width: W, height: H }));
	run(["-i", ppm, ...(name.endsWith(".jpg") ? ["-q:v", "1"] : []), file]);
	return file;
}

/** The file's own tags, then the distinct tags its frames carry. */
function tagsOf(file: string): { stream: string; frames: string[] } {
	const probe = (entries: string) =>
		spawnSync(
			ffprobePath,
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				entries,
				"-of",
				"csv=p=0",
				file,
			],
			{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
		)
			.stdout.split("\n")
			.map((line) => line.replace(/,+$/, "").trim())
			.filter(Boolean);
	return {
		stream: probe(
			"stream=color_range,color_space,color_primaries,color_transfer"
		)[0],
		frames: [
			...new Set(
				probe("frame=color_range,color_space,color_primaries,color_transfer")
			),
		],
	};
}

/**
 * The worst bar error (largest channel difference, 0 to 255) over the
 * frames of `file`, read as BT.709 limited range, which is what a player
 * goes by for a file tagged so.
 */
function barsError(file: string, window?: [number, number]): number {
	const pixels = run([
		...(window ? ["-ss", String(window[0]), "-t", String(window[1])] : []),
		"-i",
		file,
		"-vf",
		`scale=${MEASURE_W}:${MEASURE_H}:flags=area:in_color_matrix=bt709:in_range=tv`,
		"-pix_fmt",
		"rgb24",
		"-f",
		"rawvideo",
		"-",
	]);
	const frameBytes = MEASURE_W * MEASURE_H * 3;
	expect(pixels.length).toBeGreaterThanOrEqual(frameBytes);
	let worst = 0;
	for (let base = 0; base + frameBytes <= pixels.length; base += frameBytes) {
		for (let row = 0; row < 2; row += 1) {
			for (let column = 0; column < 8; column += 1) {
				const x0 = Math.floor(((column + 0.3) * MEASURE_W) / 8);
				const x1 = Math.floor(((column + 0.7) * MEASURE_W) / 8);
				const y0 = Math.floor(((row + 0.3) * MEASURE_H) / 2);
				const y1 = Math.floor(((row + 0.7) * MEASURE_H) / 2);
				const sum = [0, 0, 0];
				let count = 0;
				for (let y = y0; y < y1; y += 1) {
					for (let x = x0; x < x1; x += 1) {
						const offset = base + (y * MEASURE_W + x) * 3;
						sum[0] += pixels[offset];
						sum[1] += pixels[offset + 1];
						sum[2] += pixels[offset + 2];
						count += 1;
					}
				}
				for (const [channel, expected] of BARS[row][column].entries()) {
					worst = Math.max(
						worst,
						Math.abs(Math.round(sum[channel] / count) - expected)
					);
				}
			}
		}
	}
	return worst;
}

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"one colour description for every source (real ffmpeg)",
	() => {
		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
		});

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		/** The source as a main-track segment, the way the engine encodes it. */
		async function encodeSegment({
			sourcePath,
			isImage = false,
		}: {
			sourcePath: string;
			isImage?: boolean;
		}): Promise<string> {
			const segment: ExportSegment = {
				elementId: "clip-1",
				trackId: "track-1",
				trackOrder: 0,
				elementOrder: 0,
				sourcePath,
				startTime: 0,
				duration: 0.5,
				trimStart: 0,
				sourceId: "media-1",
				fitMode: "cover",
				...(isImage ? { isImage: true } : {}),
			};
			const color = resolveSourceColor({
				probe: await probeSourceColor({ mediaPath: sourcePath }),
			});
			const outputPath = path.join(
				tempDir,
				`segment-${path.basename(sourcePath)}.mov`
			);
			run(
				buildExportSegmentEncodeArgs({
					inputArgs: buildExportSegmentInputArgs({ segment }),
					scaleFilter: `${buildVideoFitFilter({ fitMode: "cover", width: W, height: H })},setsar=1`,
					segment,
					settings: SETTINGS,
					audio: null,
					outputPath,
					color,
				})
			);
			return outputPath;
		}

		it("measures what FFmpeg writes left to itself: a PNG as BT.601 with no tags", () => {
			// What a still on the main track used to become.
			const output = path.join(tempDir, "ffmpeg-own.mov");
			run([
				"-loop",
				"1",
				"-t",
				"0.5",
				"-i",
				makeStill("own.png"),
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				output,
			]);
			expect(tagsOf(output).stream).toBe("unknown,unknown,unknown,unknown");
			expect(barsError(output)).toBeGreaterThan(30);
		});

		it.each([
			{ name: "a BT.709 clip", clip: { name: "hd-709.mp4", matrix: "bt709" } },
			{ name: "a BT.601 clip", clip: { name: "hd-601.mp4", matrix: "bt601" } },
			{
				name: "an untagged HD clip, read as BT.709",
				clip: { name: "hd-untagged.mp4", matrix: "bt709", tagged: false },
			},
			{
				name: "an untagged SD clip, read as BT.601",
				clip: {
					name: "sd-untagged.mp4",
					matrix: "bt601",
					tagged: false,
					width: 640,
					height: 360,
				},
			},
			{
				name: "a full-range clip",
				clip: { name: "hd-full.mp4", matrix: "bt709", range: "pc" },
			},
		] as const)("writes $name as BT.709 limited, showing its colours", async ({
			clip,
		}) => {
			const output = await encodeSegment({ sourcePath: makeClip(clip) });
			expect(tagsOf(output)).toEqual({
				stream: EXPORT_TAGS,
				frames: [EXPORT_TAGS],
			});
			expect(barsError(output)).toBeLessThanOrEqual(5);
		}, 60_000);

		it.each([
			{ name: "bars.png", limit: 4 },
			// JPEG's own coding of saturated bars costs a few levels.
			{ name: "bars.jpg", limit: 7 },
		])("writes the still $name as BT.709 limited, showing its colours", async ({
			name,
			limit,
		}) => {
			const output = await encodeSegment({
				sourcePath: makeStill(name),
				isImage: true,
			});
			expect(tagsOf(output)).toEqual({
				stream: EXPORT_TAGS,
				frames: [EXPORT_TAGS],
			});
			expect(barsError(output)).toBeLessThanOrEqual(limit);
		}, 60_000);

		it("reads an untagged clip by its size, as the preview does, whatever it was coded with", async () => {
			// HD coded BT.601 and SD coded BT.709 say nothing, so they are read
			// as BT.709 and BT.601: the colours come out shifted, exactly as the
			// preview and the in-browser export show them.
			const hd = await encodeSegment({
				sourcePath: makeClip({
					name: "hd-untagged-601.mp4",
					matrix: "bt601",
					tagged: false,
				}),
			});
			const sd = await encodeSegment({
				sourcePath: makeClip({
					name: "sd-untagged-709.mp4",
					matrix: "bt709",
					tagged: false,
					width: 640,
					height: 360,
				}),
			});
			expect(barsError(hd)).toBeGreaterThan(30);
			expect(barsError(sd)).toBeGreaterThan(15);
			for (const output of [hd, sd]) {
				expect(tagsOf(output).frames).toEqual([EXPORT_TAGS]);
			}
		}, 60_000);

		it("passes a BT.709 limited picture through as it is", async () => {
			// The conversion is the last filter of every segment; for the
			// common source it must change nothing.
			const source = makeClip({ name: "hd-709-pass.mp4", matrix: "bt709" });
			const color = resolveSourceColor({
				probe: await probeSourceColor({ mediaPath: source }),
			});
			expect(color).toEqual({ declare: null, hdr: false });
			const raw = (filter: string) =>
				run([
					"-t",
					"0.2",
					"-i",
					source,
					"-vf",
					filter,
					"-pix_fmt",
					"yuv420p",
					"-f",
					"rawvideo",
					"-",
				]);
			const args = buildExportSegmentEncodeArgs({
				inputArgs: [],
				scaleFilter: "null",
				segment: {
					elementId: "clip-1",
					trackId: "track-1",
					trackOrder: 0,
					elementOrder: 0,
					sourcePath: source,
					startTime: 0,
					duration: 0.2,
					trimStart: 0,
					sourceId: "media-1",
					fitMode: "cover",
				},
				settings: SETTINGS,
				audio: null,
				outputPath: "unused.mov",
				color,
			});
			const staged = raw(args[args.indexOf("-vf") + 1]);
			expect(staged.length).toBeGreaterThan(0);
			expect(staged.equals(raw("null"))).toBe(true);
		}, 60_000);

		it("joins clips of every kind, and the black between them, under one set of tags", async () => {
			const files = [
				await encodeSegment({
					sourcePath: makeClip({ name: "join-601.mp4", matrix: "bt601" }),
				}),
				path.join(tempDir, "gap-0000.mov"),
				await encodeSegment({
					sourcePath: makeStill("join.png"),
					isImage: true,
				}),
				await encodeSegment({
					sourcePath: makeClip({
						name: "join-full.mp4",
						matrix: "bt709",
						range: "pc",
					}),
				}),
			];
			run(
				buildGapSegmentEncodeArgs({
					gap: { beforeSegment: 1, startTime: 0.5, duration: 0.5 },
					settings: SETTINGS,
					outputPath: files[1],
				})
			);
			const list = path.join(tempDir, "join-list.txt");
			fs.writeFileSync(list, files.map((file) => `file '${file}'`).join("\n"));
			const joined = path.join(tempDir, "joined.mp4");
			run([
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				list,
				"-map",
				"0:v:0",
				"-c:v",
				"copy",
				joined,
			]);
			// The joined picture used to change tags at every such cut.
			expect(tagsOf(joined)).toEqual({
				stream: EXPORT_TAGS,
				frames: [EXPORT_TAGS],
			});
			expect(await probeJoinedPictureColor({ path: joined })).toEqual({
				range: "tv",
				space: "bt709",
			});
			// Each clip's bars under the file's one description.
			expect(barsError(joined, [0.1, 0.3])).toBeLessThanOrEqual(5);
			expect(barsError(joined, [1.1, 0.3])).toBeLessThanOrEqual(5);
			expect(barsError(joined, [1.6, 0.3])).toBeLessThanOrEqual(5);
		}, 120_000);

		it("keeps the description through a transition render", async () => {
			// Transitions are drawn in RGB by the layer chain the editor's own
			// FFmpeg export uses. It hands the picture back in the matrix and
			// range it came in, but without its primaries and transfer, so the
			// engine states the description again on the way out.
			const from = await encodeSegment({
				sourcePath: makeClip({ name: "transition-601.mp4", matrix: "bt601" }),
			});
			const to = await encodeSegment({
				sourcePath: makeStill("transition.png"),
				isImage: true,
			});
			const output = path.join(tempDir, "transitioned.mp4");
			const source = (elementId: string, file: string, startTime: number) => ({
				elementId,
				trackId: "main",
				trackOrder: 0,
				elementOrder: startTime > 0 ? 1 : 0,
				path: file,
				startTime,
				duration: 0.5,
				trimStart: 0,
				trimEnd: 0,
			});
			const args = buildFFmpegArgs({
				inputDir: tempDir,
				outputFile: output,
				width: W,
				height: H,
				fps: FPS,
				quality: "medium",
				duration: 1,
				useDirectCopy: false,
				videoSources: [source("from", from, 0), source("to", to, 0.5)],
				videoTransitions: [
					{
						id: "dissolve",
						trackId: "main",
						fromElementId: "from",
						toElementId: "to",
						presetId: "dissolve",
						type: "dissolve",
						easing: "linear",
						duration: 0.2,
					},
				],
				includeEmbeddedAudio: false,
				outputPictureFilters: EXPORT_PICTURE_COLOR_FILTERS,
			});
			const rendered = spawnSync(ffmpegPath, ["-v", "error", ...args], {
				encoding: "utf8",
				timeout: 60_000,
			});
			expect(rendered.status, rendered.stderr).toBe(0);
			expect(tagsOf(output)).toEqual({
				stream: EXPORT_TAGS,
				frames: [EXPORT_TAGS],
			});
			// Both clips show the bars, so the dissolve between them does too.
			expect(barsError(output)).toBeLessThanOrEqual(6);
		}, 120_000);

		it("keeps the description through the passes that encode the picture again", async () => {
			// Each pass reads the joined picture and writes it once more; the
			// description rides on the frames, and none of them may drop it.
			const base = await encodeSegment({
				sourcePath: makeClip({ name: "passes-601.mp4", matrix: "bt601" }),
			});
			const color = structuredClone(DEFAULT_VIDEO_COLOR_SETTINGS);
			color.enabled = true;
			color.basic = { ...color.basic, enabled: true, saturation: -40 };
			const adjusted = path.join(tempDir, "pass-adjusted.mp4");
			const adjustment = buildAdjustmentLayerPass({
				inputPath: base,
				outputPath: adjusted,
				layers: [
					{
						elementId: "adjustment-1",
						trackOrder: 0,
						startTime: 0.1,
						endTime: 0.3,
						color,
						opacity: 0.5,
						aboveOverlays: false,
					},
				],
				codec: "libx264",
				bitrate: "8000k",
			});
			expect(adjustment).not.toBeNull();
			run(adjustment?.args.slice(1) ?? []);

			const sticker = makeStill("pass-sticker.png");
			const stickered = path.join(tempDir, "pass-stickered.mp4");
			run(
				buildStickerOverlayPass({
					inputPath: base,
					outputPath: stickered,
					stickerOverlays: [
						{
							mediaId: "sticker-1",
							sourcePath: sticker,
							startTime: 0.1,
							endTime: 0.4,
							x: 20,
							y: 20,
							width: 160,
							height: 90,
							rotation: 0,
							opacity: 0.8,
						},
					],
					codec: "libx264",
					bitrate: "8000k",
				}).args.slice(1)
			);

			// Text the renderer drew ahead of time, laid over the picture.
			const texted = path.join(tempDir, "pass-texted.mp4");
			run(
				buildTextRasterOverlayPassArgs({
					sourcePath: base,
					outputPath: texted,
					layers: [
						{
							elementId: "text-1",
							source: { kind: "image", path: sticker },
							startTime: 0.1,
							endTime: 0.4,
							blendMode: "normal",
							x: 40,
							y: 40,
						},
					],
					settings: {
						...SETTINGS,
						engine: "native-cli",
						presetId: "test",
						format: "mp4",
					},
					baseColor: await probeJoinedPictureColor({ path: base }),
				}).slice(1)
			);

			const cut = path.join(tempDir, "pass-range.mp4");
			run(
				buildRangePictureArgs({
					inputPath: base,
					outputPath: cut,
					range: { start: 0.1, end: 0.4 },
					settings: SETTINGS,
				}).slice(1)
			);

			for (const output of [adjusted, stickered, texted, cut]) {
				expect(tagsOf(output), path.basename(output)).toEqual({
					stream: EXPORT_TAGS,
					frames: [EXPORT_TAGS],
				});
			}
			// The range cut changes no pixel's meaning: still the bars.
			expect(barsError(cut)).toBeLessThanOrEqual(5);
		}, 120_000);

		it("brings a recording drawn on as RGBA back to the description", async () => {
			// A recording with a drawn cursor is decoded to RGBA, drawn on and
			// encoded again. FFmpeg left to itself reads an untagged recording
			// as BT.601 whatever its size, and writes RGBA back as BT.601 with
			// no tags.
			const frames = 6;
			for (const [name, matrix, tagged] of [
				["cursor-untagged.mp4", "bt709", false],
				["cursor-601.mp4", "bt601", true],
			] as const) {
				const sourcePath = makeClip({ name, matrix, tagged });
				const color = resolveSourceColor({
					probe: await probeSourceColor({ mediaPath: sourcePath }),
				});
				const segmentPath = await encodeSegment({ sourcePath });
				const rgba = run(
					buildCursorDecodeArgs({
						sourcePath,
						duration: frames / FPS,
						frames,
						fps: FPS,
						width: W,
						height: H,
						color,
					})
				);
				expect(rgba.length, name).toBe(frames * W * H * 4);
				const outputPath = path.join(tempDir, `cursor-${name}.mov`);
				const encoded = spawnSync(
					ffmpegPath,
					[
						"-v",
						"error",
						...buildCursorEncodeArgs({
							segmentPath,
							outputPath,
							width: W,
							height: H,
							fps: FPS,
							frames,
							codec: "libx264",
							bitrate: "8000k",
						}),
					],
					{ input: rgba, maxBuffer: 16 * 1024 * 1024 }
				);
				expect(encoded.status, encoded.stderr.toString()).toBe(0);
				expect(tagsOf(outputPath), name).toEqual({
					stream: EXPORT_TAGS,
					frames: [EXPORT_TAGS],
				});
				expect(barsError(outputPath), name).toBeLessThanOrEqual(6);
			}
		}, 120_000);

		it("draws an untagged overlay in the colours the preview reads it in", async () => {
			const base = await encodeSegment({
				sourcePath: makeClip({ name: "overlay-base.mp4", matrix: "bt709" }),
			});
			// HD and untagged: BT.709 to the preview, BT.601 to FFmpeg left to
			// itself.
			const overlaySource = makeClip({
				name: "overlay-untagged.mp4",
				matrix: "bt709",
				tagged: false,
			});
			const overlay: ExportSegment = {
				elementId: "overlay-1",
				trackId: "overlay-track",
				trackOrder: 0,
				elementOrder: 0,
				sourcePath: overlaySource,
				startTime: 0,
				duration: 0.5,
				trimStart: 0,
				sourceId: "overlay",
				fitMode: "cover",
			};
			const overlays = await probeMediaOverlayInputs({ overlays: [overlay] });
			expect(overlays[0].color).toEqual({
				declare: "setparams=colorspace=bt709:range=tv",
				hdr: false,
			});
			const draw = async (name: string, inputs: typeof overlays) => {
				const output = path.join(tempDir, name);
				run(
					buildMediaOverlayPassArgs({
						inputPath: base,
						outputPath: output,
						overlays: inputs,
						settings: SETTINGS,
						duration: 0.5,
						baseColor: await probeJoinedPictureColor({ path: base }),
					}).args
				);
				return output;
			};
			// The overlay covers the picture: its bars, under the file's tags.
			const output = await draw("overlaid.mp4", overlays);
			expect(tagsOf(output).frames).toEqual([EXPORT_TAGS]);
			expect(barsError(output)).toBeLessThanOrEqual(6);
			// Without the statement the layer chain turns it into RGB as BT.601.
			const unstated = await draw(
				"overlaid-unstated.mp4",
				overlays.map(({ segment, alpha }) => ({ segment, alpha }))
			);
			expect(barsError(unstated)).toBeGreaterThan(15);
		}, 60_000);
	}
);
