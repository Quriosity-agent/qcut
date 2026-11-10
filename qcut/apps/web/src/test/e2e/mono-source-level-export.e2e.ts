/**
 * A mono source must come out of every export as loud as it plays.
 *
 * The preview puts a one-channel file into both channels at full level:
 * the first node of a clip's graph that works in stereo, Chromium's
 * DynamicsCompressorNode, copies it, so the panner after it gets a stereo
 * signal and leaves it alone at centre. The in-browser (muxer) export builds
 * the same nodes. FFmpeg's own conversion to stereo keeps the power instead
 * and writes each channel at 1/√2, so the native export of a mono clip was
 * 3 dB quieter than the preview and the muxer export.
 *
 * Four stretches, each with one sound, measured per channel in both exports
 * against the level of the file itself:
 * - a mono clip on the main track;
 * - a stereo clip on the main track, its right channel half as loud;
 * - a mono clip on an audio track;
 * - the same mono clip on a track panned hard left, which the panner's law
 *   for a stereo input sums into the left channel (twice the level).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const FPS = 24;
const RATE = 48_000;
const CLIP_SECONDS = 3;
const SFX_SECONDS = 2;
/** Where each sound starts on the timeline. */
const AT = { mono: 0, stereo: 3, track: 7, panned: 10 };
/** Below this a channel counts as silent. */
const SILENT_DB = -60;
/** AAC and the meter's window leave a pure tone within this of its source. */
const TOLERANCE_DB = 0.3;

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

function ffmpeg(args: string[]) {
	execFileSync(FFMPEG, ["-v", "error", "-y", ...args]);
}

/** Each channel's RMS level in dB over one second of `file` from `start`. */
function channelLevels({
	file,
	start = 0.5,
}: {
	file: string;
	start?: number;
}): number[] {
	const result = spawnSync(
		FFMPEG,
		[
			"-v",
			"info",
			"-ss",
			String(start),
			"-t",
			"1",
			"-i",
			file,
			"-map",
			"0:a:0",
			"-af",
			"astats=measure_perchannel=RMS_level:measure_overall=none",
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8" }
	);
	if (result.status !== 0) throw new Error(result.stderr);
	return [...result.stderr.matchAll(/RMS level dB:\s*(-?[\d.]+|-inf)/g)].map(
		(match) =>
			match[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(match[1])
	);
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("a mono source exports at the level it plays at, from both engines", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-mono-level-"));
	try {
		// --- what the preview's nodes do with one channel ---------------------
		// The clip graph runs source → filters → DynamicsCompressorNode → … →
		// StereoPannerNode. Measured here in the app's own Chromium: the
		// compressor hands on two equal channels at the source's level; a
		// panner fed the mono signal directly would put each 3 dB under it.
		const nodes = await page.evaluate(async () => {
			const rate = 48_000;
			const render = async (throughCompressor: boolean) => {
				const context = new OfflineAudioContext(2, rate, rate);
				const buffer = context.createBuffer(1, rate, rate);
				const samples = buffer.getChannelData(0);
				for (let index = 0; index < samples.length; index += 1) {
					samples[index] = 0.125 * Math.sin((2 * Math.PI * 440 * index) / rate);
				}
				const source = context.createBufferSource();
				source.buffer = buffer;
				const panner = context.createStereoPanner();
				if (throughCompressor) {
					const compressor = context.createDynamicsCompressor();
					compressor.threshold.value = 0;
					compressor.knee.value = 0;
					compressor.ratio.value = 1;
					source.connect(compressor);
					compressor.connect(panner);
				} else {
					source.connect(panner);
				}
				panner.connect(context.destination);
				source.start();
				const rendered = await context.startRendering();
				return [0, 1].map((channel) => {
					// Past the compressor's look-ahead.
					const data = rendered.getChannelData(channel).subarray(rate / 10);
					let sum = 0;
					for (const sample of data) sum += sample * sample;
					return 10 * Math.log10(sum / data.length);
				});
			};
			return {
				throughCompressor: await render(true),
				pannerAlone: await render(false),
			};
		});
		const toneDb = 20 * Math.log10(0.125 / Math.SQRT2);
		console.log("preview nodes, mono in (dB)", JSON.stringify(nodes));
		for (const level of nodes.throughCompressor) {
			expect(Math.abs(level - toneDb)).toBeLessThan(TOLERANCE_DB);
		}
		for (const level of nodes.pannerAlone) {
			expect(Math.abs(level - (toneDb - 3.01))).toBeLessThan(TOLERANCE_DB);
		}

		// --- the sources --------------------------------------------------------
		const picture = `color=c=black:s=320x180:r=${FPS}:d=${CLIP_SECONDS}`;
		const video = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
		const monoClip = path.join(workDir, "mono-tone.mp4");
		ffmpeg([
			"-f",
			"lavfi",
			"-i",
			picture,
			"-f",
			"lavfi",
			"-i",
			`aevalsrc=0.125*sin(2*PI*440*t):s=${RATE}:d=${CLIP_SECONDS}`,
			...video,
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			monoClip,
		]);
		const stereoClip = path.join(workDir, "stereo-tone.mp4");
		ffmpeg([
			"-f",
			"lavfi",
			"-i",
			picture,
			"-f",
			"lavfi",
			"-i",
			`aevalsrc=0.125*sin(2*PI*440*t)|0.0625*sin(2*PI*440*t):s=${RATE}:d=${CLIP_SECONDS}`,
			...video,
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			stereoClip,
		]);
		const monoSfx = path.join(workDir, "mono-sfx.wav");
		ffmpeg([
			"-f",
			"lavfi",
			"-i",
			`aevalsrc=0.125*sin(2*PI*880*t):s=${RATE}:d=${SFX_SECONDS}`,
			"-c:a",
			"pcm_s16le",
			monoSfx,
		]);
		const source = {
			mono: channelLevels({ file: monoClip }),
			stereo: channelLevels({ file: stereoClip }),
			sfx: channelLevels({ file: monoSfx }),
		};
		console.log("source levels (dB)", JSON.stringify(source));
		expect(source.mono).toHaveLength(1);
		expect(source.stereo).toHaveLength(2);
		expect(source.sfx).toHaveLength(1);

		// --- the timeline -------------------------------------------------------
		const { projectId } = run<{ projectId: string }>(
			"editor:project:create",
			"--name",
			"Mono level",
			"--width",
			"320",
			"--height",
			"180",
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
		run(
			"editor:media:batch-import",
			...pid,
			"--sources",
			[monoClip, stereoClip, monoSfx].join(",")
		);
		const createTrack = (name: string) =>
			run<{ trackId: string }>(
				"editor:track:create",
				...pid,
				"--type",
				"audio",
				"--name",
				name
			).trackId;
		const sfxTrack = createTrack("SFX");
		const leftTrack = createTrack("Left");
		const add = (data: Record<string, unknown>) =>
			run(
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify(data)
			);
		add({
			type: "media",
			sourceName: "mono-tone.mp4",
			trackId: mainId,
			startTime: AT.mono,
			duration: CLIP_SECONDS,
		});
		add({
			type: "media",
			sourceName: "stereo-tone.mp4",
			trackId: mainId,
			startTime: AT.stereo,
			duration: CLIP_SECONDS,
		});
		add({
			type: "audio",
			sourceName: "mono-sfx.wav",
			trackId: sfxTrack,
			startTime: AT.track,
			duration: SFX_SECONDS,
		});
		add({
			type: "audio",
			sourceName: "mono-sfx.wav",
			trackId: leftTrack,
			startTime: AT.panned,
			duration: SFX_SECONDS,
		});
		run(
			"editor:track:audio-set",
			...pid,
			"--track-id",
			leftTrack,
			"--pan",
			"-1"
		);

		// --- both exports, against the files themselves -------------------------
		const measured: Record<string, Record<string, number[]>> = {};
		for (const engine of ["native", "muxer"] as const) {
			const outputPath = path.join(workDir, `${engine}.mp4`);
			const job = cli<{ status: string }>({
				apiPort,
				timeout: 600_000,
				args: [
					"editor:export:start",
					...pid,
					"--output",
					outputPath,
					"--engine",
					engine,
					"--poll",
				],
			});
			expect(job.status, `${engine} export`).toBe("completed");
			const at = (start: number) =>
				channelLevels({ file: outputPath, start: start + 0.5 });
			measured[engine] = {
				mono: at(AT.mono),
				stereo: at(AT.stereo),
				track: at(AT.track),
				panned: at(AT.panned),
			};
		}
		console.log("exported levels (dB)", JSON.stringify(measured));

		const near = (actual: number, expected: number, label: string) =>
			expect(
				Math.abs(actual - expected),
				`${label}: ${actual.toFixed(2)} dB, want ${expected.toFixed(2)} dB`
			).toBeLessThan(TOLERANCE_DB);
		for (const engine of ["muxer", "native"]) {
			const levels = measured[engine];
			for (const stretch of Object.values(levels)) {
				expect(stretch, `${engine} writes stereo`).toHaveLength(2);
			}
			// A mono clip: the file's level in both channels.
			near(levels.mono[0], source.mono[0], `${engine} mono clip left`);
			near(levels.mono[1], source.mono[0], `${engine} mono clip right`);
			// A stereo clip: each channel as it is in the file.
			near(levels.stereo[0], source.stereo[0], `${engine} stereo clip left`);
			near(levels.stereo[1], source.stereo[1], `${engine} stereo clip right`);
			// A mono clip on an audio track: the same rule.
			near(levels.track[0], source.sfx[0], `${engine} mono track left`);
			near(levels.track[1], source.sfx[0], `${engine} mono track right`);
			// Panned hard left: both of its channels summed into the left one.
			near(levels.panned[0], source.sfx[0] + 6.02, `${engine} panned left`);
			expect(levels.panned[1], `${engine} panned right`).toBeLessThan(
				SILENT_DB
			);
		}
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
});
