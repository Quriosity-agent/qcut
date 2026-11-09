import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clipGainDb,
	clipSourceSeconds,
	matchedClipGain,
	measureStretchLoudness,
} from "../native-pipeline/editor/editor-replace-media-loudness.js";
import type { ClaudeElement } from "../types/claude-api.js";

/**
 * `replace-media --match-loudness` (2026-11-09): a final that came back
 * 0.5–1.5 dB louder than the preview it replaced had to be measured and
 * turned down by hand, clip by clip.
 */

function clip(fields: Partial<ClaudeElement>): ClaudeElement {
	return {
		id: "shot",
		trackIndex: 0,
		type: "media",
		startTime: 10,
		endTime: 15,
		duration: 5,
		...fields,
	} as ClaudeElement;
}

describe("clipSourceSeconds", () => {
	it("is the clip's length on the timeline at normal speed", () => {
		expect(clipSourceSeconds({ clip: clip({}) })).toBe(5);
		expect(clipSourceSeconds({ clip: clip({ timelineDuration: 4.5 }) })).toBe(
			4.5
		);
	});

	it("is the length times a constant speed", () => {
		expect(clipSourceSeconds({ clip: clip({ playbackRate: 2 }) })).toBe(10);
	});

	it("counts a speed curve as normal speed, as the export plays it", () => {
		expect(
			clipSourceSeconds({
				clip: clip({
					playbackRate: 2,
					speedKeyframes: [{ id: "k", frame: 0, value: 2, easing: "linear" }],
				}),
			})
		).toBe(5);
	});
});

describe("clipGainDb", () => {
	it("reads audio.volumeDb first", () => {
		expect(
			clipGainDb({ clip: clip({ audio: { volumeDb: -3 }, volume: 0.5 }) })
		).toBe(-3);
	});

	it("falls back to the legacy linear volume, then 0 dB", () => {
		expect(clipGainDb({ clip: clip({ volume: 0.5 }) })).toBeCloseTo(-6.02, 2);
		expect(clipGainDb({ clip: clip({ volume: 0 }) })).toBe(-60);
		expect(clipGainDb({ clip: clip({}) })).toBe(0);
	});
});

describe("matchedClipGain", () => {
	it("moves the gain by the difference, in tenths of a dB", () => {
		expect(
			matchedClipGain({
				clip: clip({ audio: { volumeDb: -2 } }),
				differenceDb: -1.46,
			})
		).toEqual({
			audio: { volumeDb: -3.5 },
			appliedDb: -1.5,
			clamped: false,
		});
	});

	it("moves every volume keyframe with it, keeping the rest of each", () => {
		const change = matchedClipGain({
			clip: clip({
				audio: {
					volumeDb: 0,
					keyframes: {
						volumeDb: [
							{ id: "a", frame: 0, value: 0, easing: "linear" },
							{ id: "b", frame: 30, value: -18, easing: "easeInOut" },
						],
					},
				},
			}),
			differenceDb: 2,
		});
		expect(change.audio).toEqual({
			volumeDb: 2,
			keyframes: {
				volumeDb: [
					{ id: "a", frame: 0, value: 2, easing: "linear" },
					{ id: "b", frame: 30, value: -16, easing: "easeInOut" },
				],
			},
		});
		expect(change.clamped).toBe(false);
	});

	it("stops at the editor's 12 dB and says so", () => {
		expect(
			matchedClipGain({
				clip: clip({ audio: { volumeDb: 10 } }),
				differenceDb: 5,
			})
		).toEqual({ audio: { volumeDb: 12 }, appliedDb: 2, clamped: true });
	});

	it("reports a keyframe the range cut off", () => {
		const change = matchedClipGain({
			clip: clip({
				audio: {
					volumeDb: 0,
					keyframes: {
						volumeDb: [{ id: "a", frame: 0, value: -58, easing: "linear" }],
					},
				},
			}),
			differenceDb: -4,
		});
		expect(change.audio.keyframes?.volumeDb[0]?.value).toBe(-60);
		expect(change.audio.volumeDb).toBe(-4);
		expect(change.clamped).toBe(true);
	});
});

const ffmpegPath = path.resolve(
	__dirname,
	`../resources/ffmpeg/${process.platform}-${process.arch}/ffmpeg`
);
const tempDir = path.resolve(__dirname, "../../.tmp/replace-media-loudness");

function makeFile({ name, args }: { name: string; args: string[] }): string {
	const file = path.join(tempDir, name);
	const made = spawnSync(ffmpegPath, ["-y", ...args, file], {
		encoding: "utf8",
		timeout: 60_000,
	});
	expect(made.status, made.stderr).toBe(0);
	return file;
}

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"measureStretchLoudness (real ffmpeg)",
	() => {
		let steps = "";
		let silent = "";
		let picture = "";

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			// 4 s of a 200 Hz tone at -20 dBFS, then 4 s of it at -26 dBFS.
			steps = makeFile({
				name: "steps.wav",
				args: [
					"-f",
					"lavfi",
					"-i",
					"aevalsrc=if(lt(t\\,4)\\,0.1\\,0.05)*sin(2*PI*200*t)|if(lt(t\\,4)\\,0.1\\,0.05)*sin(2*PI*200*t):s=48000:d=8",
					"-c:a",
					"pcm_s16le",
				],
			});
			silent = makeFile({
				name: "silent.wav",
				args: [
					"-f",
					"lavfi",
					"-i",
					"anullsrc=r=48000:cl=stereo",
					"-t",
					"3",
					"-c:a",
					"pcm_s16le",
				],
			});
			picture = makeFile({
				name: "picture.mp4",
				args: [
					"-f",
					"lavfi",
					"-i",
					"color=c=gray:s=64x36:r=24",
					"-t",
					"2",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
				],
			});
		});

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		it("measures only the stretch it is given", async () => {
			const loud = await measureStretchLoudness({
				stretch: { path: steps, start: 0.5, duration: 3 },
			});
			const quiet = await measureStretchLoudness({
				stretch: { path: steps, start: 4.5, duration: 3 },
			});
			expect(loud).not.toBeNull();
			expect(quiet).not.toBeNull();
			expect((loud as number) - (quiet as number)).toBeCloseTo(6, 0);
		});

		it("gives null for silence and for a file without sound", async () => {
			await expect(
				measureStretchLoudness({
					stretch: { path: silent, start: 0, duration: 3 },
				})
			).resolves.toBeNull();
			await expect(
				measureStretchLoudness({
					stretch: { path: picture, start: 0, duration: 2 },
				})
			).resolves.toBeNull();
		});
	}
);
