/**
 * A main track of hard cuts must export frame for frame and with its own
 * sound in place from either engine, and its stems must add up to the mix.
 *
 * Eight cuts of one 24 fps source whose frames carry their own index as a
 * colour ramp and whose 32 kHz AAC sound has a click inside every cut. The
 * cut points sit a third of a microsecond past their frames per earlier
 * cut, as a ripple delete with six-decimal cut points leaves them. Measured
 * on the exported files:
 * - every output frame shows the source frame the timeline puts there (the
 *   muxer used to show the clip before for one more frame at such cuts);
 * - the frame count ignores an audio clip ending 0.3 ms past the last frame
 *   (the muxer made one more frame);
 * - every click sounds where the timeline has it, counted in decoded
 *   samples (the native engine stacked AAC priming and padding at each cut,
 *   40–60 ms later per cut);
 * - the master's fade-out is applied (the muxer left it out);
 * - each stem holds its own bus, and the stems sum to the mix.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const FFPROBE = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffprobe");
const FPS = 24;
const RATE = 48_000;
const SOURCE_SECONDS = 12;
/** Source seconds of the clicks, one inside each cut below. */
const CLICKS = [0.5, 1.7, 3.3, 4.9, 6.1, 7.7, 9.3, 10.9];
/** Each cut's first source frame and length in frames. */
const CUTS = [
	{ trimFrames: 0, frames: 30 },
	{ trimFrames: 36, frames: 21 },
	{ trimFrames: 72, frames: 36 },
	{ trimFrames: 114, frames: 25 },
	{ trimFrames: 144, frames: 18 },
	{ trimFrames: 180, frames: 27 },
	{ trimFrames: 216, frames: 23 },
	{ trimFrames: 252, frames: 24 },
];
const TOTAL_FRAMES = CUTS.reduce((sum, cut) => sum + cut.frames, 0);
/** How far past its frame each cut point drifts per earlier cut. */
const RIPPLE_NOISE_SECONDS = 3.3e-7;
/** The sound effect: a 2 kHz burst 0.25 s into a clip placed at 2 s. */
const SFX_AT = 2;
const SFX_BURST = 0.25;
/** The master fades from 0 to −60 dB over the last half second. */
const FADE = { from: 8, to: TOTAL_FRAMES / FPS };
/** A silent clip ending this far past the last frame. */
const AUDIO_TAIL_SECONDS = 0.0003;
/** Colour ramp of the source frames (see sequential-decode-evidence.ts). */
const RAMP = { redBase: 40, cycle: 20, step: 12, redStep: 8 };

function cli<T>({
	apiPort,
	args,
	timeout = 300_000,
}: {
	apiPort: number;
	args: string[];
	timeout?: number;
}): T {
	const child = spawnSync(
		"bun",
		["--silent", "run", "qcut", "--", ...args, "--json", "--flat"],
		{
			cwd: path.resolve("."),
			env: { ...process.env, QCUT_API_PORT: String(apiPort) },
			maxBuffer: 32 * 1024 * 1024,
			timeout,
			encoding: "utf8",
		}
	);
	if (child.status !== 0) {
		throw new Error(`${args[0]} failed: ${child.stdout}\n${child.stderr}`);
	}
	const last = child.stdout.trimEnd().lastIndexOf("\n{");
	return JSON.parse(child.stdout.slice(last + 1)) as T;
}

/**
 * The source: frame n is a flat colour holding n (G = (n % 20) × 12 and
 * B = 234 − G, R steps every 20 frames), tagged BT.709 like the other
 * export fixtures; the sound is a quiet 200 Hz bed with 10 ms 1 kHz clicks.
 */
function makeSource({ dir }: { dir: string }): string {
	const file = path.join(dir, "ramp-clicks-32k.mp4");
	const geq =
		`geq=r='${RAMP.redBase}+floor(N/${RAMP.cycle})*${RAMP.redStep}'` +
		`:g='mod(N\\,${RAMP.cycle})*${RAMP.step}'` +
		`:b='234-mod(N\\,${RAMP.cycle})*${RAMP.step}'`;
	const bursts = CLICKS.map(
		(time) => `between(t\\,${time}\\,${time + 0.01})`
	).join("+");
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=320x180:r=${FPS}:d=${SOURCE_SECONDS},format=rgb24,${geq}`,
		"-f",
		"lavfi",
		"-i",
		`aevalsrc=0.1*sin(2*PI*200*t)+0.8*sin(2*PI*1000*t)*(${bursts}):s=32000:c=stereo:d=${SOURCE_SECONDS}`,
		"-vf",
		"scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
		"-c:v",
		"libx264",
		"-crf",
		"12",
		"-g",
		"24",
		"-colorspace",
		"bt709",
		"-color_primaries",
		"bt709",
		"-color_trc",
		"bt709",
		"-color_range",
		"tv",
		"-c:a",
		"aac",
		"-ar",
		"32000",
		file,
	]);
	return file;
}

function makeWav({
	dir,
	name,
	expression,
	seconds,
}: {
	dir: string;
	name: string;
	expression: string;
	seconds: number;
}): string {
	const file = path.join(dir, name);
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`aevalsrc=${expression}:s=${RATE}:c=stereo:d=${seconds}`,
		"-c:a",
		"pcm_s16le",
		file,
	]);
	return file;
}

/** The file's sound as mono samples in a row, the way a player plays it. */
function decodeSound({ file }: { file: string }): Float32Array {
	const result = spawnSync(
		FFMPEG,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vn",
			"-ac",
			"1",
			"-ar",
			String(RATE),
			"-f",
			"f32le",
			"-",
		],
		{ maxBuffer: 256 * 1024 * 1024 }
	);
	if (result.status !== 0) throw new Error(result.stderr.toString());
	const bytes = result.stdout;
	return new Float32Array(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
	);
}

/** Seconds where a burst starts after at least 50 ms below the threshold. */
function burstTimes({
	samples,
	threshold = 0.3,
}: {
	samples: Float32Array;
	threshold?: number;
}): number[] {
	const times: number[] = [];
	let quiet = 0;
	for (const [index, sample] of samples.entries()) {
		if (Math.abs(sample) > threshold) {
			if (quiet > 0.05 * RATE) times.push(index / RATE);
			quiet = 0;
		} else quiet += 1;
	}
	return times;
}

function rms({
	samples,
	from,
	to,
}: {
	samples: Float32Array;
	from: number;
	to: number;
}): number {
	const window = samples.subarray(
		Math.round(from * RATE),
		Math.round(to * RATE)
	);
	let sum = 0;
	for (const sample of window) sum += sample * sample;
	return Math.sqrt(sum / Math.max(1, window.length));
}

interface ShownFrame {
	/** Source frame index modulo the ramp cycle, from G and B (fractional). */
	phase: number;
	red: number;
}

/** Each output frame's ramp phase and red level, from its mean colour. */
function shownFrames({ file }: { file: string }): ShownFrame[] {
	const result = spawnSync(
		FFMPEG,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vf",
			"scale=16:9:flags=area",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	if (result.status !== 0) throw new Error(result.stderr.toString());
	const frameBytes = 16 * 9 * 3;
	const frames: ShownFrame[] = [];
	for (
		let offset = 0;
		offset + frameBytes <= result.stdout.length;
		offset += frameBytes
	) {
		let r = 0;
		let g = 0;
		let b = 0;
		for (let pixel = offset; pixel < offset + frameBytes; pixel += 3) {
			r += result.stdout[pixel];
			g += result.stdout[pixel + 1];
			b += result.stdout[pixel + 2];
		}
		const count = frameBytes / 3;
		frames.push({
			phase: (g / count + 234 - b / count) / (2 * RAMP.step),
			red: r / count,
		});
	}
	return frames;
}

/**
 * Whether `frame` is source frame `index`: the phase (G and B, 24 levels a
 * frame apart) must match, and the red level, which only tells the 20-frame
 * cycles apart, be within one and a half of its steps (an encoder's first
 * frames can sit a few levels off in red).
 */
function showsSourceFrame({
	frame,
	index,
}: {
	frame: ShownFrame;
	index: number;
}): boolean {
	const phaseError = Math.abs(frame.phase - (index % RAMP.cycle));
	const circular = Math.min(phaseError, RAMP.cycle - phaseError);
	const red = RAMP.redBase + Math.floor(index / RAMP.cycle) * RAMP.redStep;
	return circular < 0.5 && Math.abs(frame.red - red) <= 1.5 * RAMP.redStep;
}

function probe(file: string, args: string[]): string {
	return spawnSync(
		FFPROBE,
		["-v", "error", ...args, "-of", "default=noprint_wrappers=1:nokey=1", file],
		{ encoding: "utf8" }
	).stdout.trim();
}

/** Where the timeline puts each cut, each a little past its frame. */
function placedCuts() {
	let firstFrame = 0;
	return CUTS.map((cut, index) => {
		const placed = {
			...cut,
			firstFrame,
			startTime: firstFrame / FPS + index * RIPPLE_NOISE_SECONDS,
		};
		firstFrame += cut.frames;
		return placed;
	});
}

const cuts = placedCuts();
/** Timeline seconds of every click on the main track. */
const mainClicks = cuts.map(
	(cut, index) => cut.startTime + CLICKS[index] - cut.trimFrames / FPS
);

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("hard cuts export frame for frame with their own sound, a fade and summing stems", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-cut-sync-"));
	try {
		const source = makeSource({ dir: workDir });
		const sfx = makeWav({
			dir: workDir,
			name: "sfx.wav",
			expression: `0.6*sin(2*PI*2000*t)*between(t\\,${SFX_BURST}\\,${SFX_BURST + 0.01})`,
			seconds: 1,
		});
		const silence = makeWav({
			dir: workDir,
			name: "tail.wav",
			expression: "0",
			seconds: 0.5 + AUDIO_TAIL_SECONDS,
		});

		const { projectId } = run<{ projectId: string }>(
			"editor:project:create",
			"--name",
			"Cut sync",
			"--width",
			"1280",
			"--height",
			"720",
			"--fps",
			String(FPS),
			"--open",
			"--wait-ready"
		);
		const pid = ["--project-id", projectId];
		const { tracks } = run<{
			tracks: Array<{ id: string; isMain?: boolean }>;
		}>("editor:track:list", ...pid);
		const mainId = tracks.find((track) => track.isMain)?.id as string;
		run("editor:media:batch-import", ...pid, "--sources", source);
		for (const cut of cuts) {
			run(
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify({
					type: "media",
					sourceName: path.basename(source),
					trackId: mainId,
					startTime: cut.startTime,
					duration: SOURCE_SECONDS,
					trimStart: cut.trimFrames / FPS,
					trimEnd: SOURCE_SECONDS - (cut.trimFrames + cut.frames) / FPS,
				})
			);
		}
		run("editor:media:batch-import", ...pid, "--sources", `${sfx},${silence}`);
		run(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "media",
				sourceName: "sfx.wav",
				startTime: SFX_AT,
				duration: 1,
			})
		);
		run(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "media",
				sourceName: "tail.wav",
				startTime: TOTAL_FRAMES / FPS - 0.5,
				duration: 0.5 + AUDIO_TAIL_SECONDS,
			})
		);
		const exported = run<{
			duration: number;
			tracks: Array<{
				id: string;
				type: string;
				isMain?: boolean;
				elements: Array<{ sourceName?: string }>;
			}>;
		}>("editor:timeline:export", ...pid);
		expect(exported.duration).toBeCloseTo(
			TOTAL_FRAMES / FPS + AUDIO_TAIL_SECONDS,
			6
		);
		const sfxTrack = exported.tracks.find((track) =>
			track.elements.some((element) => element.sourceName === "sfx.wav")
		);
		if (!sfxTrack) throw new Error("sound effect not placed");
		// The main track feeds 原声, the effect its own bus, the tail the master.
		run(
			"editor:mix:bus-create",
			...pid,
			"--name",
			"原声",
			"--bus-id",
			"dialogue"
		);
		run("editor:mix:bus-create", ...pid, "--name", "SFX", "--bus-id", "sfx");
		run(
			"editor:track:audio-set",
			...pid,
			"--track-id",
			mainId,
			"--bus",
			"dialogue"
		);
		run(
			"editor:track:audio-set",
			...pid,
			"--track-id",
			sfxTrack.id,
			"--bus",
			"sfx"
		);
		run(
			"editor:mix:bus-automation",
			...pid,
			"--bus-id",
			"master",
			"--param",
			"gainDb",
			"--points",
			JSON.stringify([
				{ time: FADE.from, value: 0 },
				{ time: FADE.to, value: -60 },
			])
		);

		const sfxClick = SFX_AT + SFX_BURST;
		const mixClicks = [...mainClicks, sfxClick].sort((a, b) => a - b);
		for (const engine of ["native", "muxer"] as const) {
			const outputPath = path.join(workDir, engine, `${engine}.mp4`);
			cli({
				apiPort,
				timeout: 600_000,
				args: [
					"editor:export:start",
					...pid,
					"--preset",
					"discord",
					"--fps",
					String(FPS),
					"--format",
					"mp4",
					"--output",
					outputPath,
					"--engine",
					engine,
					...(engine === "native" ? ["--stems"] : []),
					"--poll",
				],
			});
			expect(existsSync(outputPath), `${engine} export written`).toBe(true);
			expect(
				probe(outputPath, [
					"-select_streams",
					"v:0",
					"-show_entries",
					"stream=r_frame_rate",
				])
			).toBe(`${FPS}/1`);

			// Picture: one output frame per timeline frame, each the right one.
			const shown = shownFrames({ file: outputPath });
			expect(shown.length, `${engine} frames`).toBe(TOTAL_FRAMES);
			const wrong: string[] = [];
			for (const cut of cuts) {
				for (let frame = 0; frame < cut.frames; frame += 1) {
					const at = cut.firstFrame + frame;
					const index = cut.trimFrames + frame;
					if (!showsSourceFrame({ frame: shown[at], index })) {
						const { phase, red } = shown[at];
						wrong.push(
							`${at}: phase ${phase.toFixed(2)} red ${red.toFixed(0)}, want ${index}`
						);
					}
				}
			}
			console.log(`${engine} wrong frames`, wrong.join("; ") || "none");
			expect(wrong, `${engine} frames off their source`).toEqual([]);

			// Sound: every click where the timeline has it.
			const mix = decodeSound({ file: outputPath });
			const heard = burstTimes({ samples: mix });
			const errorsMs = heard.map((time, index) =>
				Number(((time - mixClicks[index]) * 1000).toFixed(2))
			);
			console.log(`${engine} click error (ms)`, errorsMs.join(" "));
			expect(heard).toHaveLength(mixClicks.length);
			for (const error of errorsMs) expect(Math.abs(error)).toBeLessThan(1);

			// The master fade: the end at least 30 dB below the bed before it.
			const bed = rms({ samples: mix, from: 7.6, to: 7.85 });
			const end = rms({ samples: mix, from: FADE.to - 0.15, to: FADE.to });
			const fadeDb = 20 * Math.log10(end / bed);
			console.log(`${engine} fade depth (dB)`, fadeDb.toFixed(1));
			expect(fadeDb, `${engine} master fade`).toBeLessThan(-30);

			if (engine !== "native") continue;
			// Stems: <name>-<bus>.wav beside the export, each holding its bus.
			const stemFiles = readdirSync(path.dirname(outputPath)).filter((name) =>
				name.endsWith(".wav")
			);
			console.log("stems", stemFiles.join(", "));
			const stem = (bus: string) => {
				const name = stemFiles.find((file) => file === `${engine}-${bus}.wav`);
				if (!name) throw new Error(`no ${bus} stem among ${stemFiles}`);
				return decodeSound({ file: path.join(path.dirname(outputPath), name) });
			};
			const dialogue = stem("原声");
			const effects = stem("SFX");
			const dialogueErrors = burstTimes({ samples: dialogue }).map(
				(time, index) => Number(((time - mainClicks[index]) * 1000).toFixed(2))
			);
			console.log("原声 stem click error (ms)", dialogueErrors.join(" "));
			expect(dialogueErrors).toHaveLength(mainClicks.length);
			for (const error of dialogueErrors)
				expect(Math.abs(error)).toBeLessThan(1);
			const effectBursts = burstTimes({ samples: effects });
			expect(effectBursts).toHaveLength(1);
			expect(Math.abs(effectBursts[0] - sfxClick) * 1000).toBeLessThan(1);
			// Before the master fade, all stems summed are the mix (the mix is
			// AAC, so up to its coding noise).
			const everyStem = stemFiles.map((name) =>
				decodeSound({ file: path.join(path.dirname(outputPath), name) })
			);
			const window = { from: 0.2, to: FADE.from - 0.05 };
			let residual = 0;
			let signal = 0;
			for (
				let index = Math.round(window.from * RATE);
				index < Math.round(window.to * RATE);
				index += 1
			) {
				let sum = 0;
				for (const samples of everyStem) sum += samples[index] ?? 0;
				residual += (mix[index] - sum) ** 2;
				signal += mix[index] ** 2;
			}
			const residualDb = 10 * Math.log10(residual / signal);
			console.log("stems vs mix residual (dB)", residualDb.toFixed(1));
			expect(residualDb, "stems sum to the mix").toBeLessThan(-20);
		}
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
});
