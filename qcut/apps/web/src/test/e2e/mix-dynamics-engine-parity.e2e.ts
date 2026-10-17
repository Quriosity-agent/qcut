/**
 * A track compressor and a master limiter that nothing reaches must leave
 * the sound where the timeline has it and at its level, from either engine.
 *
 * One track holds a quiet 200 Hz bed (0.06 peak, under the compressor's
 * knee in both engines) with three 10 ms clicks well under the −1 dB
 * ceiling. Measured on the exported files:
 * - every click sounds on time (FFmpeg's limiter delayed the native export
 *   by its 3 ms lookahead: +3.02 ms on v2026.10.17.2);
 * - the bed comes out at its source level from both engines (Chromium's
 *   compressor and limiter add makeup gain of their own, 0.91 and 0.57 dB
 *   here: the editor engine's export was 1.48 dB louder on v2026.10.17.2).
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const EVIDENCE_DIR = path.resolve(
	"output/playwright/mix-dynamics-engine-parity"
);
const FPS = 24;
const RATE = 48_000;
const SECONDS = 4;
const CLICKS = [0.7, 1.9, 3.1];
const BED_AMPLITUDE = 0.06;
/** The bed's level before the first click, where nothing else sounds. */
const BED_WINDOW = { from: 0.1, to: 0.6 };

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
	threshold,
}: {
	samples: Float32Array;
	threshold: number;
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

function rmsDb({
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
	return 20 * Math.log10(Math.sqrt(sum / Math.max(1, window.length)));
}

test("a track compressor and a master limiter keep both engines on time and level", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-mix-dynamics-"));
	try {
		const picture = path.join(workDir, "picture.mp4");
		execFileSync(FFMPEG, [
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`color=c=gray:s=1280x720:r=${FPS}:d=${SECONDS}`,
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			picture,
		]);
		const clicks = CLICKS.map(
			(at) => `0.5*sin(2*PI*1000*t)*between(t\\,${at}\\,${at + 0.01})`
		).join("+");
		const sound = path.join(workDir, "sound.wav");
		execFileSync(FFMPEG, [
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`aevalsrc=${BED_AMPLITUDE}*sin(2*PI*200*t)+${clicks}:s=${RATE}:c=stereo:d=${SECONDS}`,
			"-c:a",
			"pcm_s16le",
			sound,
		]);
		const source = decodeSound({ file: sound });
		const sourceBedDb = rmsDb({ samples: source, ...BED_WINDOW });

		const { projectId } = run<{ projectId: string }>(
			"editor:project:create",
			"--name",
			"Mix dynamics",
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
		run(
			"editor:media:batch-import",
			...pid,
			"--sources",
			`${picture},${sound}`
		);
		run(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "media",
				sourceName: "picture.mp4",
				trackId: mainId,
				startTime: 0,
				duration: SECONDS,
			})
		);
		run(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "media",
				sourceName: "sound.wav",
				startTime: 0,
				duration: SECONDS,
			})
		);
		const exported = run<{
			tracks: Array<{ id: string; elements: Array<{ sourceName?: string }> }>;
		}>("editor:timeline:export", ...pid);
		const soundTrack = exported.tracks.find((track) =>
			track.elements.some((element) => element.sourceName === "sound.wav")
		);
		if (!soundTrack) throw new Error("sound not placed");
		run(
			"editor:track:audio-set",
			...pid,
			"--track-id",
			soundTrack.id,
			"--effects",
			JSON.stringify({ compressor: { enabled: true } })
		);
		run(
			"editor:mix:bus-set",
			...pid,
			"--bus-id",
			"master",
			"--effects",
			JSON.stringify({ limiter: { enabled: true, ceilingDb: -1 } })
		);
		const mix = run<{
			master: { effects: { limiter: { enabled: boolean; ceilingDb: number } } };
			tracks: Array<{
				trackId: string;
				audio: {
					effects: { compressor: { enabled: boolean; thresholdDb: number } };
				};
			}>;
		}>("editor:mix:export", ...pid);
		expect(mix.master.effects.limiter).toMatchObject({
			enabled: true,
			ceilingDb: -1,
		});
		expect(
			mix.tracks.find((track) => track.trackId === soundTrack.id)?.audio.effects
				.compressor
		).toMatchObject({ enabled: true, thresholdDb: -18 });

		const measured: Record<string, { clickErrorsMs: number[]; bedDb: number }> =
			{};
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
					"--poll",
				],
			});
			expect(existsSync(outputPath), `${engine} export written`).toBe(true);
			const samples = decodeSound({ file: outputPath });
			const heard = burstTimes({ samples, threshold: 0.15 });
			expect(heard, `${engine} clicks`).toHaveLength(CLICKS.length);
			measured[engine] = {
				clickErrorsMs: heard.map((time, index) =>
					Number(((time - CLICKS[index]) * 1000).toFixed(3))
				),
				bedDb: Number(rmsDb({ samples, ...BED_WINDOW }).toFixed(3)),
			};
		}
		const evidence = {
			sourceBedDb: Number(sourceBedDb.toFixed(3)),
			...measured,
		};
		console.log("mix dynamics parity", JSON.stringify(evidence));
		mkdirSync(EVIDENCE_DIR, { recursive: true });
		writeFileSync(
			path.join(EVIDENCE_DIR, "measurements.json"),
			`${JSON.stringify(evidence, null, 2)}\n`
		);

		for (const engine of ["native", "muxer"] as const) {
			for (const error of measured[engine].clickErrorsMs)
				expect(Math.abs(error), `${engine} click error (ms)`).toBeLessThan(
					0.25
				);
			expect(
				Math.abs(measured[engine].bedDb - sourceBedDb),
				`${engine} bed level against the source (dB)`
			).toBeLessThan(0.15);
		}
		expect(
			Math.abs(measured.native.bedDb - measured.muxer.bedDb),
			"bed level between engines (dB)"
		).toBeLessThan(0.15);
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
});
