import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => tmpdir(), isPackaged: false },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock("electron-log", () => ({
	default: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		log: vi.fn(),
	},
}));
// The planner runs as it is; the test only reads what it decided.
vi.mock(
	"../claude/handlers/claude-export-handler/picture-window",
	async (original) => {
		const actual =
			await original<
				typeof import("../claude/handlers/claude-export-handler/picture-window")
			>();
		return { ...actual, planPictureWindow: vi.fn(actual.planPictureWindow) };
	}
);

import type { AdjustmentLayer } from "../claude/handlers/claude-export-handler/adjustment-layer-pass";
import { executeExportJob } from "../claude/handlers/claude-export-handler/export-engine";
import {
	exportJobs,
	getExportJobStatus,
} from "../claude/handlers/claude-export-handler/job-manager";
import { planPictureWindow } from "../claude/handlers/claude-export-handler/picture-window";
import { collectTextOverlays } from "../claude/handlers/claude-export-handler/text-overlay";
import {
	EXPORT_JOB_STATUS,
	type ExportJobInternal,
	type ExportSegment,
	type ResolvedExportSettings,
	type StickerOverlay,
	type TextOverlay,
} from "../claude/handlers/claude-export-handler/types";
import { DEFAULT_VIDEO_COLOR_SETTINGS } from "../ffmpeg/color-settings";
import type { AudioBusEffects, AudioMixConfig } from "../ffmpeg/types";
import type { ClaudeTimeline } from "../types/claude-api";

/**
 * A range export draws its picture for the clips around the range only
 * (picture-window.ts). Six two-second clips; the range is seconds 5 to 7, so
 * the window is the third and fourth clip, a third of the film. Whatever lies
 * over the range has to come out as it does in the full export: an overlay
 * that began before the window is cut at its start and read from the right
 * instant, a grade that began before it switches off where it did, and a
 * sticker or a text that began before the range pulls the window back to its
 * own start. Each case is rendered whole and as a range through the real
 * engine and compared frame by frame.
 */

const ffmpeg = path.resolve(
	__dirname,
	`../resources/ffmpeg/${process.platform}-${process.arch}/ffmpeg`
);
const WIDTH = 320;
const HEIGHT = 180;
const FPS = 24;
const CLIP_SECONDS = 2;
const CLIPS = 6;
const RANGE = { start: 5, end: 7 };

const settings: ResolvedExportSettings = {
	engine: "native-cli",
	presetId: "custom",
	width: WIDTH,
	height: HEIGHT,
	fps: FPS,
	format: "mp4",
	codec: "libx264",
	bitrate: "8Mbps",
	audioBitrate: 192,
	audioSampleRate: 48_000,
	audioChannels: 2,
};

let directory = "";

function run({ args }: { args: string[] }): Buffer {
	const result = spawnSync(
		ffmpeg,
		["-hide_banner", "-nostdin", "-nostats", "-v", "error", ...args],
		{ timeout: 120_000, windowsHide: true, maxBuffer: 256 * 1024 * 1024 }
	);
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr.toString("utf8"));
	return result.stdout;
}

/** Every frame of a file as RGB. */
function frames({ file }: { file: string }): Uint8Array[] {
	const raw = run({
		args: [
			"-i",
			file,
			"-map",
			"0:v:0",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
	});
	const size = WIDTH * HEIGHT * 3;
	const result: Uint8Array[] = [];
	for (let offset = 0; offset + size <= raw.length; offset += size) {
		result.push(new Uint8Array(raw.buffer, raw.byteOffset + offset, size));
	}
	return result;
}

function psnr({ a, b }: { a: Uint8Array; b: Uint8Array }): number {
	let squares = 0;
	for (let index = 0; index < a.length; index += 1) {
		const difference = a[index] - b[index];
		squares += difference * difference;
	}
	const mse = squares / a.length;
	return mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10(255 ** 2 / mse);
}

/** The sound of a file as interleaved stereo float samples. */
function samples({ file }: { file: string }): Float32Array {
	const raw = run({
		args: [
			"-i",
			file,
			"-map",
			"0:a:0",
			"-vn",
			"-f",
			"f32le",
			"-ac",
			"2",
			"-ar",
			"48000",
			"-",
		],
	});
	return new Float32Array(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)
	);
}

/** RMS of the difference over the RMS of the reference. */
function relativeError({
	reference,
	candidate,
}: {
	reference: Float32Array;
	candidate: Float32Array;
}): number {
	let differences = 0;
	let energy = 0;
	for (let index = 0; index < reference.length; index += 1) {
		const difference = reference[index] - (candidate[index] ?? 0);
		differences += difference * difference;
		energy += reference[index] * reference[index];
	}
	return Math.sqrt(differences / Math.max(energy, 1e-12));
}

function effects(): AudioBusEffects {
	return {
		parametricEqualizer: {
			enabled: false,
			lowCutHz: 20,
			highCutHz: 20_000,
			bands: [],
		},
		compressor: {
			enabled: false,
			thresholdDb: -18,
			ratio: 3,
			attackMs: 10,
			releaseMs: 120,
			makeupGainDb: 0,
		},
		limiter: { enabled: false, ceilingDb: -1, releaseMs: 50 },
	};
}

/** A master limiter the film's tone keeps busy. */
function limitedMix(): AudioMixConfig {
	const master = effects();
	master.limiter = { enabled: true, ceilingDb: -18, releaseMs: 200 };
	return {
		master: {
			id: "master",
			name: "Master",
			gainDb: 3,
			pan: 0,
			muted: false,
			solo: false,
			effects: master,
		},
		buses: [],
		tracks: [],
	};
}

interface Layers {
	mediaOverlays?: ExportSegment[];
	adjustmentLayers?: AdjustmentLayer[];
	stickerOverlays?: StickerOverlay[];
	textOverlays?: TextOverlay[];
}

describe.skipIf(!existsSync(ffmpeg))(
	"the picture window of a range export (real ffmpeg)",
	() => {
		let segments: ExportSegment[] = [];
		let badge = "";
		let card = "";
		let dot = "";

		async function exportTimeline({
			name,
			layers,
			range,
			audioMixConfig,
		}: {
			name: string;
			layers: Layers;
			range?: { start: number; end: number };
			audioMixConfig?: AudioMixConfig;
		}): Promise<string> {
			const outputPath = path.join(directory, `${name}.mp4`);
			const jobId = `export_${name}`;
			const job: ExportJobInternal = {
				jobId,
				projectId: "picture-window",
				status: EXPORT_JOB_STATUS.queued,
				progress: 0,
				startedAt: Date.now(),
				presetId: "custom",
				engine: "native-cli",
				settings,
				outputPath,
			};
			exportJobs.set(jobId, job);
			await executeExportJob({
				jobId,
				projectId: "picture-window",
				settings,
				outputPath,
				segments,
				audioFiles: [],
				audioMixConfig,
				projectFps: FPS,
				projectCanvas: { width: WIDTH, height: HEIGHT },
				range,
				...layers,
			});
			const status = getExportJobStatus(jobId);
			expect(status?.error).toBeUndefined();
			expect(status?.status).toBe("completed");
			return outputPath;
		}

		/**
		 * Renders `layers` whole and as the range, checks the window the range
		 * was drawn on, and compares the range with the same frames of the
		 * whole film.
		 */
		async function expectRangeMatchesFull({
			name,
			layers,
			windowSeconds,
		}: {
			name: string;
			layers: Layers;
			/** Where the window is expected to start and end, in seconds. */
			windowSeconds: { start: number; end: number } | null;
		}): Promise<void> {
			const full = await exportTimeline({ name: `${name}-full`, layers });
			vi.mocked(planPictureWindow).mockClear();
			const range = await exportTimeline({
				name: `${name}-range`,
				layers,
				range: RANGE,
			});
			const window = vi.mocked(planPictureWindow).mock.results[0]?.value;
			if (windowSeconds === null) {
				expect(window).toBeUndefined();
			} else {
				expect(window).toMatchObject({
					start: windowSeconds.start,
					frames: (windowSeconds.end - windowSeconds.start) * FPS,
				});
			}

			const fullFrames = frames({ file: full });
			const rangeFrames = frames({ file: range });
			const firstFrame = RANGE.start * FPS;
			expect(fullFrames.length).toBe(CLIPS * CLIP_SECONDS * FPS);
			expect(rangeFrames.length).toBe((RANGE.end - RANGE.start) * FPS);
			let worst = Number.POSITIVE_INFINITY;
			for (const [index, frame] of rangeFrames.entries()) {
				const value = psnr({ a: fullFrames[firstFrame + index], b: frame });
				worst = Math.min(worst, value);
				expect(value, `${name}: frame ${index}`).toBeGreaterThan(45);
			}
			if (process.env.KEEP_PICTURE_WINDOW) {
				console.log(
					`[picture-window] ${name}: worst frame ${worst.toFixed(1)} dB`
				);
			}
			// And a frame off is not the same picture: the film moves.
			expect(
				psnr({ a: fullFrames[firstFrame + 1], b: rangeFrames[0] })
			).toBeLessThan(30);
		}

		beforeAll(() => {
			directory = path.join(tmpdir(), `qcut-picture-window-${process.pid}`);
			rmSync(directory, { recursive: true, force: true });
			mkdirSync(directory, { recursive: true });
			const film = path.join(directory, "film.mov");
			run({
				args: [
					"-y",
					"-f",
					"lavfi",
					"-i",
					`testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=${CLIPS * CLIP_SECONDS}`,
					"-f",
					"lavfi",
					"-i",
					// Another pitch each second, so sound cut from the wrong place
					// does not pass as right.
					`aevalsrc=0.2*sin(2*PI*(300+80*floor(t))*t)|0.2*sin(2*PI*(300+80*floor(t))*t):s=48000:d=${CLIPS * CLIP_SECONDS}`,
					"-c:v",
					"libx264",
					"-preset",
					"veryfast",
					"-g",
					"12",
					"-pix_fmt",
					"yuv420p",
					"-c:a",
					"pcm_s16le",
					film,
				],
			});
			segments = Array.from({ length: CLIPS }, (_, index) => ({
				elementId: `clip-${index}`,
				trackId: "main",
				trackOrder: 3,
				elementOrder: index,
				sourcePath: film,
				sourceId: "film",
				startTime: index * CLIP_SECONDS,
				duration: CLIP_SECONDS,
				trimStart: index * CLIP_SECONDS,
				isImage: false,
				fitMode: "cover" as const,
			}));
			// A second moving picture, so an overlay read from the wrong instant
			// of its file does not pass as right.
			badge = path.join(directory, "badge.mov");
			run({
				args: [
					"-y",
					"-f",
					"lavfi",
					"-i",
					`testsrc=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=10`,
					"-c:v",
					"libx264",
					"-preset",
					"veryfast",
					"-g",
					"12",
					"-pix_fmt",
					"yuv420p",
					badge,
				],
			});
			card = path.join(directory, "card.png");
			run({
				args: [
					"-y",
					"-f",
					"lavfi",
					"-i",
					`color=c=black@0:s=${WIDTH}x${HEIGHT}:d=1,format=rgba,drawbox=x=10:y=120:w=120:h=40:color=red@0.6:t=fill:replace=1`,
					"-frames:v",
					"1",
					card,
				],
			});
			dot = path.join(directory, "dot.png");
			run({
				args: [
					"-y",
					"-f",
					"lavfi",
					"-i",
					"color=c=yellow:s=40x40:d=1,format=rgba",
					"-frames:v",
					"1",
					dot,
				],
			});
		}, 120_000);

		afterAll(() => {
			if (process.env.KEEP_PICTURE_WINDOW) return;
			rmSync(directory, { recursive: true, force: true });
		});

		const overlay = (extra: Partial<ExportSegment>): ExportSegment => ({
			elementId: "overlay",
			trackId: "overlays",
			trackOrder: 1,
			elementOrder: 0,
			sourcePath: badge,
			sourceId: "badge",
			startTime: 1,
			duration: 8,
			trimStart: 0.5,
			isImage: false,
			fitMode: "cover",
			...extra,
		});
		const corner = {
			x: 70,
			y: -40,
			rotationDegrees: 0,
			scaleX: 0.4,
			scaleY: 0.4,
			opacity: 1,
		};
		const grade = (extra: Partial<AdjustmentLayer> = {}): AdjustmentLayer => {
			const color = structuredClone(DEFAULT_VIDEO_COLOR_SETTINGS);
			color.enabled = true;
			color.basic = { ...color.basic, enabled: true, saturation: -100 };
			return {
				elementId: "grade",
				trackOrder: 2,
				startTime: 3,
				endTime: 6.5,
				color,
				opacity: 1,
				aboveOverlays: false,
				...extra,
			};
		};

		it("matches the full export with overlays cut at the window's start and a grade moved to it", async () => {
			await expectRangeMatchesFull({
				name: "cut-overlays",
				layers: {
					mediaOverlays: [
						// A video from second 1 to 9, a still over all of the film.
						overlay({ transform: corner }),
						overlay({
							elementId: "card",
							trackOrder: 0,
							sourcePath: card,
							sourceId: "card",
							startTime: 0,
							duration: CLIPS * CLIP_SECONDS,
							trimStart: 0,
							isImage: true,
						}),
					],
					// Under the still, over the video: on from second 3, off at 6.5.
					adjustmentLayers: [grade({ trackOrder: 0.5 })],
				},
				// The clips the range touches: seconds 4 to 8 of twelve.
				windowSeconds: { start: 4, end: 8 },
			});
		}, 240_000);

		it("matches the full export with a grade over the finished picture", async () => {
			await expectRangeMatchesFull({
				name: "grade-only",
				layers: { adjustmentLayers: [grade()] },
				windowSeconds: { start: 4, end: 8 },
			});
		}, 240_000);

		it("starts the window at a sticker and a text that began before the range", async () => {
			const timeline = {
				name: "Window",
				duration: CLIPS * CLIP_SECONDS,
				width: WIDTH,
				height: HEIGHT,
				fps: FPS,
				tracks: [
					{
						id: "titles",
						index: 0,
						name: "Titles",
						type: "text",
						elements: [
							{
								id: "title",
								type: "text",
								name: "Title",
								content: "QCut",
								fontSize: 48,
								fontFamily: "Arial",
								color: "#ffffff",
								backgroundColor: "transparent",
								textAlign: "center",
								fontWeight: "normal",
								fontStyle: "normal",
								textDecoration: "none",
								width: 300,
								height: 100,
								x: 0,
								y: 0,
								rotation: 0,
								opacity: 1,
								// From second 3.5 to 5.5: it is on screen when the range starts.
								startTime: 3.5,
								endTime: 5.5,
								duration: 2,
								trimStart: 0,
								trimEnd: 0,
							},
						],
					},
				],
			} as unknown as ClaudeTimeline;
			const textOverlays = collectTextOverlays(timeline);
			expect(textOverlays).toHaveLength(1);
			await expectRangeMatchesFull({
				name: "sticker-text",
				layers: {
					textOverlays,
					stickerOverlays: [
						{
							mediaId: "dot",
							sourcePath: dot,
							startTime: 4.5,
							endTime: 6,
							x: 20,
							y: 20,
							width: 40,
							height: 40,
							opacity: 1,
							rotation: 0,
						},
					],
				},
				// The text began in the second clip (seconds 2 to 4).
				windowSeconds: { start: 2, end: 8 },
			});
		}, 240_000);

		it("starts the window at an overlay that moves over its length", async () => {
			await expectRangeMatchesFull({
				name: "moving-overlay",
				layers: {
					mediaOverlays: [
						overlay({
							startTime: 3,
							duration: 4,
							transform: {
								...corner,
								// Slides from the left to the right over its four seconds.
								xKeyframes: [
									{ timeSeconds: 0, value: -80 },
									{ timeSeconds: 4, value: 80 },
								],
							},
						}),
					],
				},
				windowSeconds: { start: 2, end: 8 },
			});
		}, 240_000);

		/**
		 * The picture is counted from the window's start, the sound from the
		 * timeline's: the range of the mix must not move with the window.
		 */
		it("cuts the sound on the timeline's clock, with or without a mix", async () => {
			for (const [name, audioMixConfig] of [
				["sound-plain", undefined],
				["sound-limited", limitedMix()],
			] as const) {
				const layers = { adjustmentLayers: [grade()] };
				const full = await exportTimeline({
					name: `${name}-full`,
					layers,
					audioMixConfig,
				});
				vi.mocked(planPictureWindow).mockClear();
				const range = await exportTimeline({
					name: `${name}-range`,
					layers,
					range: RANGE,
					audioMixConfig,
				});
				expect(
					vi.mocked(planPictureWindow).mock.results[0]?.value
				).toMatchObject({ start: 4 });
				const fullSound = samples({ file: full });
				const rangeSound = samples({ file: range });
				const sampleCount = (RANGE.end - RANGE.start) * 48_000 * 2;
				const at = (seconds: number) =>
					fullSound.subarray(
						seconds * 48_000 * 2,
						seconds * 48_000 * 2 + sampleCount
					);
				expect(Math.abs(rangeSound.length - sampleCount)).toBeLessThan(
					0.05 * 48_000 * 2
				);
				const candidate = rangeSound.subarray(0, sampleCount);
				expect(
					relativeError({ reference: at(RANGE.start), candidate }),
					`${name}: the range's sound`
				).toBeLessThan(0.1);
				// Not the sound a second into the window (seconds 1 to 3 of it).
				expect(
					relativeError({ reference: at(RANGE.start - 4), candidate }),
					`${name}: the sound at the window's own second 1`
				).toBeGreaterThan(0.5);
			}
		}, 480_000);

		it("draws the whole picture when the range touches every clip", async () => {
			vi.mocked(planPictureWindow).mockClear();
			await exportTimeline({
				name: "whole",
				layers: {},
				range: { start: 0.5, end: 11.5 },
			});
			expect(
				vi.mocked(planPictureWindow).mock.results[0]?.value
			).toBeUndefined();
		}, 240_000);
	}
);
