/**
 * `timeline apply --replace --atomic --verify` with a manifest of the size a
 * graded programme produces: 30 tracks, 216 clips, 63 of them carrying their
 * own 3D LUT, about 22 MB of JSON. The editor used to re-read every clip
 * (LUT included) on each change, so the apply either outlived its 30 s
 * transaction ("Track not found" once QCut rolled the timeline back under
 * it) or held the editor past the 5 s project check.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const GRADED_CLIPS = 63;
const LUT_SIZE = 25;
const OVERLAY_TRACKS = 9;
const AUDIO_TRACKS = 20;
const CLIP_SECONDS = 0.5;

type Json = Record<string, unknown>;

interface CliOutcome<T> {
	ok: boolean;
	data: T;
	error?: string;
}

/** Runs the CLI and returns its JSON envelope whether it succeeded or not. */
function cli<T>({
	apiPort,
	args,
}: {
	apiPort: number;
	args: string[];
}): Promise<CliOutcome<T>> {
	return new Promise((resolve, reject) => {
		execFile(
			"bun",
			["--silent", "run", "qcut", "--", ...args, "--json"],
			{
				cwd: path.resolve("."),
				env: { ...process.env, QCUT_API_PORT: String(apiPort) },
				maxBuffer: 256 * 1024 * 1024,
				timeout: 900_000,
			},
			(_error, stdout, stderr) => {
				const start = stdout.indexOf("{");
				if (start < 0) {
					reject(new Error(`${args[0]} printed no JSON: ${stdout}\n${stderr}`));
					return;
				}
				const envelope = JSON.parse(stdout.slice(start)) as {
					status: string;
					error?: string;
					data?: { data?: T };
				};
				resolve({
					ok: envelope.status === "ok",
					data: (envelope.data?.data ?? {}) as T,
					error: envelope.error,
				});
			}
		);
	});
}

/** A warm grade as a cube: blue outermost, red innermost, as a .cube file. */
function gradeCube({ size }: { size: number }): Json {
	const values: number[] = [];
	const round = (value: number) => Math.round(value * 100_000) / 100_000;
	for (let blue = 0; blue < size; blue += 1) {
		for (let green = 0; green < size; green += 1) {
			for (let red = 0; red < size; red += 1) {
				const r = red / (size - 1);
				const g = green / (size - 1);
				const b = blue / (size - 1);
				values.push(
					round(Math.min(1, r * 0.93 + 0.0712345)),
					round(g * 0.9712345 + 0.0112345),
					round(b * 0.8812345 + 0.0212345)
				);
			}
		}
	}
	return { size, values, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

function clip({
	media,
	index,
	extra = {},
}: {
	media: string;
	index: number;
	extra?: Json;
}): Json {
	return {
		type: "media",
		media,
		startTime: index * CLIP_SECONDS,
		duration: CLIP_SECONDS,
		trimStart: 0,
		trimEnd: 0,
		...extra,
	};
}

function buildManifest({
	video,
	audio,
}: {
	video: string;
	audio: string;
}): Json {
	const cube = gradeCube({ size: LUT_SIZE });
	const graded = Array.from({ length: GRADED_CLIPS }, (_, index) =>
		clip({
			media: "picture",
			index,
			extra: {
				color: {
					enabled: true,
					lut: {
						enabled: true,
						presetId: "custom",
						name: "programme grade",
						intensity: 100,
						skinProtection: 0,
						cube,
					},
				},
			},
		})
	);
	const overlays = Array.from({ length: OVERLAY_TRACKS }, (_, track) => ({
		name: `Overlay ${track + 1}`,
		type: "media",
		colorLabel: "orange",
		elements: Array.from({ length: 7 }, (_, index) =>
			clip({ media: "picture", index: index * 2 + track })
		),
	}));
	const sounds = Array.from({ length: AUDIO_TRACKS }, (_, track) => ({
		name: `Sound ${track + 1}`,
		type: "audio",
		colorLabel: "blue",
		elements: Array.from({ length: track % 2 === 0 ? 5 : 4 }, (_, index) =>
			clip({ media: "sound", index: index * 3 + track })
		),
	}));
	return {
		media: [
			{ alias: "picture", path: video },
			{ alias: "sound", path: audio },
		],
		tracks: [
			...overlays,
			{ name: "Main", type: "media", isMain: true, elements: graded },
			...sounds,
		],
	};
}

interface Exported {
	tracks: Array<{
		id: string;
		name: string;
		elements: Array<Json & { id: string }>;
	}>;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("a 22 MB manifest with a LUT on every picture clip applies in one command", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });

	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-apply-large-"));
	const video = path.join(workDir, "picture.mp4");
	const audio = path.join(workDir, "sound.wav");
	execFileSync(FFMPEG, [
		"-y",
		"-f",
		"lavfi",
		"-i",
		"testsrc2=size=320x180:rate=24:duration=4",
		"-pix_fmt",
		"yuv420p",
		video,
	]);
	execFileSync(FFMPEG, [
		"-y",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=4",
		audio,
	]);

	const created = await run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Apply large manifest",
		"--open"
	);
	expect(created.ok, created.error).toBe(true);
	const pid = ["--project-id", created.data.projectId];

	const manifest = buildManifest({ video, audio });
	const manifestPath = path.join(workDir, "manifest.json");
	writeFileSync(manifestPath, JSON.stringify(manifest));
	const megabytes = statSync(manifestPath).size / 1024 / 1024;
	expect(megabytes).toBeGreaterThan(20);
	const clipCount = (manifest.tracks as Array<{ elements: unknown[] }>).reduce(
		(total, track) => total + track.elements.length,
		0
	);
	expect(clipCount).toBe(216);

	const startedAt = Date.now();
	const applied = await run<{
		verified?: boolean;
		rolledBack?: boolean;
		elements?: Json;
	}>(
		"editor:timeline:apply",
		...pid,
		"--manifest",
		`@${manifestPath}`,
		"--replace",
		"--atomic",
		"--verify"
	);
	const elapsedSeconds = (Date.now() - startedAt) / 1000;
	console.log(
		`[apply-large] ${megabytes.toFixed(1)} MB, ${clipCount} clips: ${
			applied.ok ? "applied" : `failed (${applied.error})`
		} in ${elapsedSeconds.toFixed(1)} s, rolledBack=${String(applied.data.rolledBack)}`
	);
	expect(applied.ok, applied.error).toBe(true);
	expect(applied.data.verified).toBe(true);
	// Far inside the 30 s a transaction lasts by default.
	expect(elapsedSeconds).toBeLessThan(25);

	const after = await run<Exported>("editor:timeline:export", ...pid);
	expect(after.ok, after.error).toBe(true);
	expect(after.data.tracks).toHaveLength(1 + OVERLAY_TRACKS + AUDIO_TRACKS);
	expect(
		after.data.tracks.reduce((total, track) => total + track.elements.length, 0)
	).toBe(clipCount);
	const main = after.data.tracks.find((track) => track.name === "Main");
	expect(main?.elements).toHaveLength(GRADED_CLIPS);
	for (const element of main?.elements ?? []) {
		const lut = (element.color as { lut?: { cube?: { values?: number[] } } })
			?.lut;
		expect(lut?.cube?.values).toHaveLength(LUT_SIZE ** 3 * 3);
	}
});
