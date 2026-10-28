/**
 * N16 (2026-10-28 trailer report): a main-track clip's own `audio` settings —
 * volume keyframes, `enabled: false` — read back correctly but changed
 * nothing in the native export, which came out sample for sample like the
 * previous one. Both export engines must honour them, measured on the
 * exported sound.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");

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
	const stdout = child.stdout.trimEnd();
	return JSON.parse(stdout.slice(stdout.lastIndexOf("\n{") + 1)) as T;
}

function makeToneClip({
	file,
	seconds,
	frequency,
}: {
	file: string;
	seconds: number;
	frequency: number;
}): void {
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=gray:s=640x360:r=30:d=${seconds}`,
		"-f",
		"lavfi",
		"-i",
		`sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`,
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-shortest",
		file,
	]);
}

/** RMS of the export's sound between `from` and `to` seconds. */
function rms({ file, from, to }: { file: string; from: number; to: number }) {
	const decoded = spawnSync(
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
			"48000",
			"-f",
			"f32le",
			"-",
		],
		{ maxBuffer: 128 * 1024 * 1024 }
	);
	if (decoded.status !== 0) throw new Error(decoded.stderr.toString());
	const samples = new Float32Array(
		decoded.stdout.buffer,
		decoded.stdout.byteOffset,
		decoded.stdout.byteLength / 4
	);
	let sum = 0;
	let count = 0;
	for (let index = Math.round(from * 48_000); index < to * 48_000; index++) {
		sum += samples[index] ** 2;
		count++;
	}
	return Math.sqrt(sum / count);
}

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(600_000);

test("a main-track clip's own volume keyframes and mute reach both exports", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-clip-audio-"));
	const { projectId } = run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Clip audio export (delete me)",
		"--open"
	);
	const pid = ["--project-id", projectId];
	try {
		run(
			"editor:project:update-settings",
			...pid,
			"--data",
			JSON.stringify({ width: 640, height: 360, fps: 30 })
		);
		const first = path.join(workDir, "first.mp4");
		const second = path.join(workDir, "second.mp4");
		makeToneClip({ file: first, seconds: 3, frequency: 440 });
		makeToneClip({ file: second, seconds: 2, frequency: 660 });
		const mainId = run<{ tracks: Array<{ id: string; isMain?: boolean }> }>(
			"editor:track:list",
			...pid
		).tracks.find((track) => track.isMain)?.id as string;
		run(
			"editor:media:batch-import",
			...pid,
			"--sources",
			`${first},${second}`,
			"--append-to-track",
			mainId
		);
		const clips = run<{
			tracks: Array<{
				id: string;
				elements: Array<{ id: string; startTime: number }>;
			}>;
		}>("editor:timeline:export", ...pid)
			.tracks.find((track) => track.id === mainId)
			?.elements.sort((left, right) => left.startTime - right.startTime);
		expect(clips?.length, "both clips on the main track").toBe(2);
		const [keyed, muted] = clips ?? [];

		// The report's shape: silence (-60 dB) for the first 1.5 s, then full.
		run(
			"editor:timeline:update-element",
			...pid,
			"--element-id",
			keyed.id,
			"--data",
			JSON.stringify({
				audio: {
					keyframes: {
						volumeDb: [
							{ frame: 0, value: -60 },
							{ frame: 45, value: -60 },
							{ frame: 46, value: 0 },
						],
					},
				},
			})
		);
		run(
			"editor:timeline:update-element",
			...pid,
			"--element-id",
			muted.id,
			"--data",
			JSON.stringify({
				volume: 0,
				audio: { enabled: false, volumeDb: -60 },
			})
		);

		const measured: Record<string, Record<string, number>> = {};
		for (const engine of ["native", "muxer"] as const) {
			const outputPath = path.join(workDir, `${engine}.mp4`);
			cli({
				apiPort,
				timeout: 420_000,
				args: [
					"editor:export:start",
					...pid,
					"--preset",
					"discord",
					"--format",
					"mp4",
					"--output",
					outputPath,
					"--engine",
					engine,
					"--poll",
				],
			});
			measured[engine] = {
				keyedSilent: rms({ file: outputPath, from: 0.2, to: 1.3 }),
				keyedLoud: rms({ file: outputPath, from: 1.8, to: 2.8 }),
				muted: rms({ file: outputPath, from: 3.2, to: 4.8 }),
			};
		}
		console.log(`[clip-audio] ${JSON.stringify(measured)}`);
		for (const engine of ["native", "muxer"] as const) {
			const sound = measured[engine];
			expect(sound.keyedSilent, `${engine}: keyframed -60 dB`).toBeLessThan(
				0.002
			);
			expect(sound.keyedLoud, `${engine}: after the keyframes`).toBeGreaterThan(
				0.03
			);
			expect(sound.muted, `${engine}: enabled false`).toBeLessThan(0.002);
		}
	} finally {
		await page.evaluate(() => {
			window.location.hash = "#/projects";
		});
		await page.waitForTimeout(1000);
		spawnSync(
			"bun",
			[
				"--silent",
				"run",
				"qcut",
				"--",
				"editor:project:delete",
				...pid,
				"--force",
				"--json",
			],
			{
				cwd: path.resolve("."),
				env: { ...process.env, QCUT_API_PORT: String(apiPort) },
				encoding: "utf8",
			}
		);
		const folder = path.join(
			homedir(),
			"Documents",
			"QCut",
			"Projects",
			projectId
		);
		if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
		rmSync(workDir, { recursive: true, force: true });
	}
});
