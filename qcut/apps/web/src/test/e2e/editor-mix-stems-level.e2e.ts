/**
 * Stems are level-neutral: a track routed to a bus with every fader at 0 dB
 * and no effect enabled comes out of `editor mix stems` at the level it went
 * in, across the band. Guards the pass-through cut filters (clip chain and
 * strips), whose default Web Audio resonance once lifted sub-bass by 4.5 dB
 * and a clip by 2 dB.
 */

import { execFile, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const SAMPLE_RATE = 48_000;
const SECONDS = 6;
/** The window measured, inside the clip and clear of its edges. */
const WINDOW = { start: 1, end: 5 };

/** 16-bit stereo WAV from per-channel sample functions (amplitude in [-1, 1]). */
function writeWav({
	file,
	left,
	right = left,
}: {
	file: string;
	left: (t: number, frame: number) => number;
	right?: (t: number, frame: number) => number;
}) {
	const frames = SECONDS * SAMPLE_RATE;
	const data = Buffer.alloc(frames * 4);
	const pcm = (value: number) => {
		const clamped = Math.max(-1, Math.min(1, value));
		return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
	};
	for (let frame = 0; frame < frames; frame += 1) {
		const t = frame / SAMPLE_RATE;
		data.writeInt16LE(pcm(left(t, frame)), frame * 4);
		data.writeInt16LE(pcm(right(t, frame)), frame * 4 + 2);
	}
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(2, 22);
	header.writeUInt32LE(SAMPLE_RATE, 24);
	header.writeUInt32LE(SAMPLE_RATE * 4, 28);
	header.writeUInt16LE(4, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data.length, 40);
	writeFileSync(file, Buffer.concat([header, data]));
}

function volumeDetect(file: string): { meanDb: number; peakDb: number } {
	const result = spawnSync(
		"ffmpeg",
		[
			"-hide_banner",
			"-nostats",
			"-i",
			file,
			"-af",
			`atrim=start=${WINDOW.start}:end=${WINDOW.end},volumedetect`,
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8" }
	);
	const mean = result.stderr.match(/mean_volume: (-?[\d.]+) dB/);
	const peak = result.stderr.match(/max_volume: (-?[\d.]+) dB/);
	if (!mean || !peak) throw new Error(result.stderr);
	return { meanDb: Number(mean[1]), peakDb: Number(peak[1]) };
}

function cli<T>({
	apiPort,
	args,
}: {
	apiPort: number;
	args: string[];
}): Promise<T> {
	return new Promise((resolve, reject) => {
		execFile(
			"bun",
			["--silent", "run", "qcut", "--", ...args, "--json", "--flat"],
			{
				cwd: path.resolve("."),
				env: { ...process.env, QCUT_API_PORT: String(apiPort) },
				maxBuffer: 8 * 1024 * 1024,
				timeout: 300_000,
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`${args[0]} failed: ${stdout}\n${stderr}`));
					return;
				}
				// A polled command prints progress documents first; the result is
				// the last one.
				const last = stdout.trimEnd().lastIndexOf("\n{");
				resolve(JSON.parse(stdout.slice(last + 1)) as T);
			}
		);
	});
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(300_000);

test("stems keep the level of what feeds them, from sub-bass to noise", async ({
	apiPort,
	page,
}) => {
	await page.waitForLoadState("domcontentloaded");
	const workDir = await mkdtemp(path.join(tmpdir(), "qcut-stems-level-"));
	try {
		const sourceDir = path.join(workDir, "sources");
		const stemDir = path.join(workDir, "stems");
		mkdirSync(sourceDir);
		let seed = 0x1234_5678;
		const noise = () => {
			seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
			return ((seed / 0xffff_ffff) * 2 - 1) * 0.2;
		};
		const noiseLeft = Float32Array.from(
			{ length: SECONDS * SAMPLE_RATE },
			noise
		);
		const noiseRight = Float32Array.from(
			{ length: SECONDS * SAMPLE_RATE },
			noise
		);
		const signals: Array<{ name: string; file: string }> = [
			{
				name: "tone25",
				file: path.join(sourceDir, "tone25.wav"),
			},
			{ name: "tone1k", file: path.join(sourceDir, "tone1k.wav") },
			{ name: "noise", file: path.join(sourceDir, "noise.wav") },
		];
		writeWav({
			file: signals[0].file,
			left: (t) => 0.1 * Math.sin(2 * Math.PI * 25 * t),
		});
		writeWav({
			file: signals[1].file,
			left: (t) => 0.1 * Math.sin(2 * Math.PI * 1000 * t),
		});
		writeWav({
			file: signals[2].file,
			left: (_t, frame) => noiseLeft[frame],
			right: (_t, frame) => noiseRight[frame],
		});

		const { projectId } = await cli<{ projectId: string }>({
			apiPort,
			args: ["editor:project:create", "--name", "Stem level", "--open"],
		});
		for (const signal of signals) {
			const { trackId } = await cli<{ trackId: string }>({
				apiPort,
				args: [
					"editor:track:create",
					"--project-id",
					projectId,
					"--type",
					"audio",
					"--name",
					signal.name,
				],
			});
			await cli({
				apiPort,
				args: [
					"editor:media:batch-import",
					"--project-id",
					projectId,
					"--sources",
					signal.file,
					"--append-to-track",
					trackId,
				],
			});
			await cli({
				apiPort,
				args: [
					"editor:mix:bus-create",
					"--project-id",
					projectId,
					"--name",
					signal.name,
					"--bus-id",
					signal.name,
				],
			});
			await cli({
				apiPort,
				args: [
					"editor:track:audio-set",
					"--project-id",
					projectId,
					"--track-id",
					trackId,
					"--bus",
					signal.name,
				],
			});
		}

		const { jobId, stems } = await cli<{
			jobId: string;
			stems: Array<{ busId: string; path: string }>;
		}>({
			apiPort,
			args: [
				"editor:mix:stems",
				"--project-id",
				projectId,
				"--output-dir",
				stemDir,
				"--timeout",
				"240",
			],
		});
		expect(jobId).toMatch(/^mix_stems_/);
		// The empty main track still feeds the master, so a "master" stem may
		// come along; every signal's bus must have one.
		for (const signal of signals) {
			expect(stems.map((stem) => stem.busId)).toContain(signal.name);
		}

		const rows = signals.map((signal) => {
			const stem = stems.find((candidate) => candidate.busId === signal.name);
			if (!stem) throw new Error(`no stem for ${signal.name}`);
			return {
				name: signal.name,
				source: volumeDetect(signal.file),
				stem: volumeDetect(stem.path),
			};
		});
		console.log(JSON.stringify(rows));
		for (const row of rows) {
			expect(row.stem.meanDb, `${row.name} level`).toBeCloseTo(
				row.source.meanDb,
				0.7
			);
			expect(row.stem.peakDb, `${row.name} peak`).toBeLessThanOrEqual(
				row.source.peakDb + 0.5
			);
		}
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
});
