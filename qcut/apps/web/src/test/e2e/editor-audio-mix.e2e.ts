/**
 * The mixer, end to end: set through the CLI against an isolated QCut, then
 * heard in real exports from both engines (FFmpeg and the in-browser muxer).
 *
 * Music (440 Hz) plays the whole 4 s and ducks under an SFX burst (2 kHz,
 * 1.5–2.5 s) that goes through an SFX bus:
 *
 * - music track -6 dB, master -2 dB      → music lands 8 dB under its source;
 * - SFX bus -4 dB, master -2 dB          → the burst lands 6 dB under its;
 * - ducking -12 dB while the burst plays → music drops by about 12 dB;
 * - soloing the SFX track                → music is gone;
 * - `mix loudness` agrees with FFmpeg's EBU R 128 meter on the export.
 *
 * Each tone is measured with a narrow band-pass so the two never mix up.
 */

import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const EVIDENCE_DIR = path.resolve("output/playwright/editor-audio-mix");
const MUSIC_BAND = "bandpass=f=440:width_type=q:w=4";
const SFX_BAND = "bandpass=f=2000:width_type=q:w=4";
/** Level checks allow for AAC and the band-pass edges. */
const LEVEL_TOLERANCE_DB = 0.7;

type ExportEngine = "cli" | "muxer";

interface ExposedWindow extends Window {
	__exportActions?: {
		exportLocalVideo: (request: {
			engine: ExportEngine;
			filename: string;
			format: "mp4";
			frameRate: 30;
			height: number;
			outputPath: string;
			projectId: string;
			quality: "720p";
			width: number;
		}) => Promise<void>;
	};
}

function ffmpeg(args: string[]): string {
	return execFileSync("ffmpeg", ["-hide_banner", "-nostats", ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/** Mean level (dB) of one band of `file` between `from` and `to` seconds. */
function bandLevel(
	file: string,
	band: string,
	[from, to]: [number, number]
): number {
	const result = spawnSync(
		"ffmpeg",
		[
			"-hide_banner",
			"-nostats",
			"-i",
			file,
			"-af",
			`atrim=start=${from}:end=${to},${band},volumedetect`,
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8" }
	);
	if (result.status !== 0) throw new Error(result.stderr);
	const match = result.stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/);
	if (!match) throw new Error(result.stderr);
	return match[1] === "-inf" ? -120 : Number(match[1]);
}

/** FFmpeg's EBU R 128 meter: integrated loudness and true peak of `file`. */
function ebur128(file: string): {
	integratedLufs: number;
	truePeakDbtp: number;
} {
	const result = spawnSync(
		"ffmpeg",
		[
			"-hide_banner",
			"-nostats",
			"-i",
			file,
			"-af",
			"ebur128=peak=true",
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8" }
	);
	const summary = result.stderr.slice(result.stderr.lastIndexOf("Summary:"));
	const integrated = summary.match(/I:\s+(-?[\d.]+) LUFS/);
	const peak = summary.match(/Peak:\s+(-?[\d.]+) dBFS/);
	if (!integrated || !peak) throw new Error(result.stderr);
	return {
		integratedLufs: Number(integrated[1]),
		truePeakDbtp: Number(peak[1]),
	};
}

function makeFixtures(dir: string) {
	const video = path.join(dir, "picture.mp4");
	const music = path.join(dir, "music.wav");
	const sfx = path.join(dir, "sfx.wav");
	ffmpeg([
		"-y",
		"-f",
		"lavfi",
		"-i",
		"color=c=black:s=1280x720:r=30:d=4",
		"-an",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		video,
	]);
	ffmpeg([
		"-y",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:sample_rate=48000:duration=4",
		"-ac",
		"2",
		music,
	]);
	ffmpeg([
		"-y",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=2000:sample_rate=48000:duration=1,adelay=1500:all=1,apad=whole_dur=4",
		"-ac",
		"2",
		sfx,
	]);
	return { video, music, sfx };
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
				timeout: 120_000,
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`${args[0]} failed: ${stdout}\n${stderr}`));
					return;
				}
				resolve(JSON.parse(stdout) as T);
			}
		);
	});
}

async function exportWith({
	page,
	engine,
	projectId,
	outputPath,
}: {
	page: Page;
	engine: ExportEngine;
	projectId: string;
	outputPath: string;
}): Promise<void> {
	await page.evaluate(
		async ({ engine, filename, projectId, outputPath }) => {
			const actions = (window as unknown as ExposedWindow).__exportActions;
			if (!actions) throw new Error("Export actions are not registered");
			await actions.exportLocalVideo({
				engine,
				filename,
				format: "mp4",
				frameRate: 30,
				height: 720,
				outputPath,
				projectId,
				quality: "720p",
				width: 1280,
			});
		},
		{ engine, filename: path.basename(outputPath), projectId, outputPath }
	);
	expect(existsSync(outputPath)).toBe(true);
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(600_000);

test("the CLI mix is what both export engines render", async ({
	apiPort,
	page,
}) => {
	const workDir = await mkdtemp(path.join(tmpdir(), "qcut-audio-mix-"));
	mkdirSync(EVIDENCE_DIR, { recursive: true });
	try {
		const fixtures = makeFixtures(workDir);
		const reference = {
			music: bandLevel(fixtures.music, MUSIC_BAND, [0.5, 1.4]),
			sfx: bandLevel(fixtures.sfx, SFX_BAND, [1.7, 2.3]),
		};

		const { projectId } = await cli<{ projectId: string }>({
			apiPort,
			args: ["editor:project:create", "--name", "Mixer", "--open"],
		});
		const { tracks } = await cli<{
			tracks: Array<{ id: string; isMain?: boolean }>;
		}>({ apiPort, args: ["editor:track:list", "--project-id", projectId] });
		const mainTrackId = tracks.find((track) => track.isMain)?.id as string;
		const createTrack = async (name: string) =>
			(
				await cli<{ trackId: string }>({
					apiPort,
					args: [
						"editor:track:create",
						"--project-id",
						projectId,
						"--type",
						"audio",
						"--name",
						name,
					],
				})
			).trackId;
		const musicTrackId = await createTrack("Music");
		const sfxTrackId = await createTrack("SFX · Guns");
		for (const [source, trackId] of [
			[fixtures.video, mainTrackId],
			[fixtures.music, musicTrackId],
			[fixtures.sfx, sfxTrackId],
		]) {
			const imported = await cli<{ appended: { failedCount: number } }>({
				apiPort,
				args: [
					"editor:media:batch-import",
					"--project-id",
					projectId,
					"--sources",
					source,
					"--append-to-track",
					trackId,
				],
			});
			expect(imported.appended.failedCount).toBe(0);
		}

		// --- the mix, through the CLI -------------------------------------------
		const bus = await cli<{ busId: string; bus: { gainDb: number } }>({
			apiPort,
			args: [
				"editor:mix:bus-create",
				"--project-id",
				projectId,
				"--name",
				"SFX",
				"--bus-id",
				"sfx",
				"--gain-db",
				"-4",
			],
		});
		expect(bus).toMatchObject({ busId: "sfx", bus: { gainDb: -4 } });
		await cli({
			apiPort,
			args: [
				"editor:mix:master-set",
				"--project-id",
				projectId,
				"--gain-db",
				"-2",
			],
		});
		await cli({
			apiPort,
			args: [
				"editor:track:audio-set",
				"--project-id",
				projectId,
				"--track-id",
				sfxTrackId,
				"--bus",
				"sfx",
			],
		});
		const music = await cli<{
			track: { audio: { gainDb: number; ducking: { reductionDb: number } } };
		}>({
			apiPort,
			args: [
				"editor:track:audio-set",
				"--project-id",
				projectId,
				"--track-id",
				musicTrackId,
				"--gain-db",
				"-6",
				"--ducking",
				JSON.stringify({
					enabled: true,
					sourceTrackIds: [sfxTrackId],
					thresholdDb: -40,
					reductionDb: -12,
					attackMs: 10,
					releaseMs: 50,
				}),
			],
		});
		expect(music.track.audio).toMatchObject({
			gainDb: -6,
			ducking: { reductionDb: -12 },
		});

		// A value outside the range is refused, not clamped.
		await expect(
			cli({
				apiPort,
				args: [
					"editor:track:audio-set",
					"--project-id",
					projectId,
					"--track-id",
					musicTrackId,
					"--gain-db",
					"20",
				],
			})
		).rejects.toThrow(/gainDb must be between -60 and 12/);

		const mix = await cli<{
			master: { gainDb: number };
			tracks: Array<{
				trackId: string;
				effective: { busId: string; silenced: boolean };
			}>;
		}>({ apiPort, args: ["editor:mix:export", "--project-id", projectId] });
		expect(mix.master.gainDb).toBe(-2);
		expect(
			mix.tracks.find((track) => track.trackId === sfxTrackId)?.effective
		).toEqual({ busId: "sfx", silenced: false });

		// --- both engines render it ---------------------------------------------
		await page.getByTestId("export-button").click();
		await expect(page.getByTestId("export-dialog")).toBeVisible();
		await page.waitForFunction(
			() => Boolean((window as unknown as ExposedWindow).__exportActions),
			undefined,
			{ timeout: 10_000 }
		);
		const measured = {} as Record<
			ExportEngine,
			{ musicDb: number; sfxDb: number; duckDb: number; soloMusicDb: number }
		>;
		for (const engine of ["muxer", "cli"] as const) {
			const output = path.join(workDir, `mix-${engine}.mp4`);
			await exportWith({ page, engine, projectId, outputPath: output });
			measured[engine] = {
				musicDb: bandLevel(output, MUSIC_BAND, [0.5, 1.4]) - reference.music,
				sfxDb: bandLevel(output, SFX_BAND, [1.7, 2.3]) - reference.sfx,
				duckDb:
					bandLevel(output, MUSIC_BAND, [3, 3.8]) -
					bandLevel(output, MUSIC_BAND, [1.7, 2.3]),
				soloMusicDb: 0,
			};
		}

		// --- loudness of the mix, against FFmpeg's own R 128 meter ---------------
		const loudness = await cli<{
			integratedLufs: number;
			truePeakDbtp: number;
		}>({ apiPort, args: ["editor:mix:loudness", "--project-id", projectId] });
		const reference128 = ebur128(path.join(workDir, "mix-muxer.mp4"));

		// --- solo the SFX: the music is gone from both ---------------------------
		await cli({
			apiPort,
			args: [
				"editor:track:solo",
				"--project-id",
				projectId,
				"--track-id",
				sfxTrackId,
			],
		});
		for (const engine of ["muxer", "cli"] as const) {
			const output = path.join(workDir, `solo-${engine}.mp4`);
			await exportWith({ page, engine, projectId, outputPath: output });
			measured[engine].soloMusicDb =
				bandLevel(output, MUSIC_BAND, [0.5, 1.4]) - reference.music;
		}

		// Persist the numbers before asserting so a failure leaves them behind.
		await writeFile(
			path.join(EVIDENCE_DIR, "evidence.json"),
			JSON.stringify(
				{ reference, ...measured, loudness, ffmpegEbur128: reference128 },
				null,
				2
			)
		);
		expect(
			Math.abs(loudness.integratedLufs - reference128.integratedLufs),
			"integrated loudness against ffmpeg ebur128"
		).toBeLessThan(0.5);
		expect(
			Math.abs(loudness.truePeakDbtp - reference128.truePeakDbtp),
			"true peak against ffmpeg ebur128"
		).toBeLessThan(0.5);
		for (const engine of ["muxer", "cli"] as const) {
			const { musicDb, sfxDb, duckDb, soloMusicDb } = measured[engine];
			expect(Math.abs(musicDb + 8), `${engine} music level`).toBeLessThan(
				LEVEL_TOLERANCE_DB
			);
			expect(Math.abs(sfxDb + 6), `${engine} SFX level`).toBeLessThan(
				LEVEL_TOLERANCE_DB
			);
			expect(duckDb, `${engine} ducking`).toBeGreaterThan(10.5);
			expect(duckDb, `${engine} ducking`).toBeLessThanOrEqual(12.5);
			expect(soloMusicDb, `${engine} music under an SFX solo`).toBeLessThan(
				-50
			);
		}
	} finally {
		await rm(workDir, { force: true, recursive: true });
	}
});
