/**
 * The 2026-10-28 trailer report (QCut 2701, N6–N12), replayed through the
 * real CLI against an isolated QCut:
 *
 * - N6: a delete that empties a track says the track went; an add naming it
 *   then fails ("Track not found") instead of making a new track; an empty
 *   track made on purpose survives a delete elsewhere.
 * - N7: a `captions import` whose transaction begin times out (editor busy)
 *   leaves nothing open; the next import works.
 * - N8: caption style given with text-element names / at the top level is
 *   stored under the caption's names; what cannot be used is a warning;
 *   `timeline export` shows the stored style.
 * - N9: `bold` Avenir Next exports upright (it came out Bold Italic).
 * - N10: an ElevenLabs transcription with only the E2E placeholder FAL key
 *   fails before any request, naming the credentials it needs.
 * - N12.1: `export start --poll --json` prints one JSON document on stdout.
 *
 * The app runs with no credentials of the user's (`appCredentials: "empty"`),
 * so nothing here can reach a provider with their account.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const AVENIR = "/System/Library/Fonts/Avenir Next.ttc";
const WIDTH = 1280;
const HEIGHT = 720;

interface CliRun {
	code: number;
	stdout: string;
	stderr: string;
}

/** Runs the source CLI; resolves with its exit code and both streams. */
function cliRaw({
	apiPort,
	args,
	timeout = 300_000,
}: {
	apiPort: number;
	args: string[];
	timeout?: number;
}): Promise<CliRun> {
	return new Promise((resolve) => {
		const child = spawn("bun", ["--silent", "run", "qcut", "--", ...args], {
			cwd: path.resolve("."),
			env: { ...process.env, QCUT_API_PORT: String(apiPort) },
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? 1, stdout, stderr });
		});
	});
}

/** The CLI's flat JSON payload; throws with both streams on failure. */
async function cli<T>(apiPort: number, ...args: string[]): Promise<T> {
	const run = await cliRaw({ apiPort, args: [...args, "--json", "--flat"] });
	if (run.code !== 0) {
		throw new Error(`${args[0]} failed: ${run.stdout}\n${run.stderr}`);
	}
	return JSON.parse(run.stdout) as T;
}

function makeBlackClip({ dir }: { dir: string }): string {
	const file = path.join(dir, "black.mp4");
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=${WIDTH}x${HEIGHT}:r=24`,
		"-f",
		"lavfi",
		"-i",
		"anullsrc=r=48000:cl=stereo",
		"-t",
		"4",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-shortest",
		file,
	]);
	return file;
}

function readGrayFrame({ file, time }: { file: string; time: number }): Buffer {
	return execFileSync(
		FFMPEG,
		[
			"-v",
			"error",
			"-ss",
			String(time),
			"-i",
			file,
			"-frames:v",
			"1",
			"-vf",
			`scale=${WIDTH}:${HEIGHT}`,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"gray",
			"-",
		],
		{ maxBuffer: 16 * 1024 * 1024 }
	);
}

/**
 * How far the strokes of "IIII" lean: the horizontal drift of the left edge
 * of the first lit run, per row, from the glyphs' top to their bottom (px
 * per px). Upright strokes stay near 0; Avenir Next italic leans ~0.2.
 */
function strokeSlant(frame: Buffer): number {
	const rows: Array<{ y: number; x: number }> = [];
	for (let y = 0; y < HEIGHT; y += 1) {
		for (let x = 0; x < WIDTH; x += 1) {
			if (frame[y * WIDTH + x] > 128) {
				rows.push({ y, x });
				break;
			}
		}
	}
	expect(rows.length, "caption pixels").toBeGreaterThan(40);
	const top = rows.slice(5, 15);
	const bottom = rows.slice(-15, -5);
	const mean = (points: typeof rows, key: "x" | "y") =>
		points.reduce((sum, point) => sum + point[key], 0) / points.length;
	return (
		(mean(top, "x") - mean(bottom, "x")) / (mean(bottom, "y") - mean(top, "y"))
	);
}

/** One line of evidence per check, kept in the run's output. */
function evidence(label: string, value: unknown): void {
	console.log(
		`[2701] ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`
	);
}

function srtTime(seconds: number): string {
	const millis = Math.round(seconds * 1000);
	const pad = (value: number, size = 2) => String(value).padStart(size, "0");
	return `00:00:${pad(Math.floor(millis / 1000))},${pad(millis % 1000, 3)}`;
}

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(900_000);

test("QCut 2701 report: tracks, transactions, caption style, bold font, keys", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-2701-"));
	const { projectId } = await cli<{ projectId: string }>(
		apiPort,
		"editor:project:create",
		"--name",
		"QCut2701 E2E (delete me)",
		"--open"
	);
	const pid = ["--project-id", projectId];
	try {
		await cli(
			apiPort,
			"editor:project:update-settings",
			...pid,
			"--data",
			JSON.stringify({ width: WIDTH, height: HEIGHT, fps: 24 })
		);
		const { tracks } = await cli<{
			tracks: Array<{ id: string; isMain?: boolean }>;
		}>(apiPort, "editor:track:list", ...pid);
		const mainId = tracks.find((track) => track.isMain)?.id as string;
		await cli(
			apiPort,
			"editor:media:batch-import",
			...pid,
			"--sources",
			makeBlackClip({ dir: workDir }),
			"--append-to-track",
			mainId
		);

		// --- N6: emptied tracks and named tracks ---------------------------------
		const scoreTrack = await cli<{ trackId: string }>(
			apiPort,
			"editor:track:create",
			...pid,
			"--type",
			"captions",
			"--name",
			"配乐 1"
		);
		const added = await cli<{ elementId: string; trackId: string }>(
			apiPort,
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "captions",
				trackId: scoreTrack.trackId,
				content: "only cue",
				startTime: 0,
				duration: 1,
			})
		);
		expect(added.trackId, "add names the track it used").toBe(
			scoreTrack.trackId
		);
		const freshTrack = await cli<{ trackId: string }>(
			apiPort,
			"editor:track:create",
			...pid,
			"--type",
			"captions",
			"--name",
			"配乐 Suno"
		);
		const removed = await cli<{
			trackRemoved: boolean;
			trackId: string;
			warning: string;
		}>(
			apiPort,
			"editor:timeline:delete-element",
			...pid,
			"--element-id",
			added.elementId,
			"--force"
		);
		expect(removed).toMatchObject({
			trackId: scoreTrack.trackId,
			trackRemoved: true,
		});
		expect(removed.warning).toContain("配乐 1");
		evidence("N6 delete of the last element", removed);
		const afterDelete = await cli<{ tracks: Array<{ id: string }> }>(
			apiPort,
			"editor:timeline:export",
			...pid
		);
		const ids = afterDelete.tracks.map((track) => track.id);
		expect(ids, "the emptied track is gone").not.toContain(scoreTrack.trackId);
		expect(ids, "an unfilled new track survives").toContain(freshTrack.trackId);
		const stale = await cliRaw({
			apiPort,
			args: [
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify({
					type: "captions",
					trackId: scoreTrack.trackId,
					content: "lost",
					startTime: 0,
					duration: 1,
				}),
				"--json",
			],
		});
		expect(stale.code, stale.stdout).not.toBe(0);
		expect(stale.stdout).toContain(`Track not found: ${scoreTrack.trackId}`);
		evidence(
			"N6 add to the removed track",
			/"error":\s*"([^"]+)"/.exec(stale.stdout)?.[1] ?? stale.stdout
		);
		const afterStale = await cli<{ tracks: Array<{ id: string }> }>(
			apiPort,
			"editor:timeline:export",
			...pid
		);
		expect(afterStale.tracks.length, "no track made for the stale id").toBe(
			afterDelete.tracks.length
		);

		// --- N8: caption style names, warnings and read-back ----------------------
		const batch = await cli<{
			added: Array<{
				success: boolean;
				elementId: string;
				warnings?: string[];
			}>;
		}>(
			apiPort,
			"editor:timeline:batch-add",
			...pid,
			"--elements",
			JSON.stringify([
				{
					type: "captions",
					trackId: freshTrack.trackId,
					content: "Round one.",
					startTime: 0,
					duration: 1,
					fontFamily: "Futura",
					color: "#ECE8DE",
					strokeWidth: 1.6,
					backgroundOpacity: 0,
					style: { verticalAlign: "bottom", marginV: 34 },
				},
			])
		);
		expect(batch.added[0].success).toBe(true);
		expect(batch.added[0].warnings).toEqual([
			expect.stringContaining('Caption field "style.marginV" ignored'),
		]);
		const exported = await cli<{
			tracks: Array<{
				id: string;
				elements: Array<{ id: string; style?: Record<string, unknown> }>;
			}>;
		}>(apiPort, "editor:timeline:export", ...pid);
		const styled = exported.tracks
			.find((track) => track.id === freshTrack.trackId)
			?.elements.find((element) => element.id === batch.added[0].elementId);
		evidence("N8 batch-add warnings", batch.added[0].warnings);
		evidence("N8 exported caption style", styled?.style);
		expect(styled?.style, "timeline export shows the stored style").toEqual({
			fontFamily: "Futura",
			fontColor: "#ECE8DE",
			outlineWidth: 1.6,
			bgOpacity: 0,
			position: { align: "bottom" },
		});

		// --- N7: a begin that times out leaves nothing open -----------------------
		const srt = path.join(workDir, "cues.srt");
		writeFileSync(srt, `1\n${srtTime(1.2)} --> ${srtTime(1.9)}\nRound two.\n`);
		const busy = page.evaluate(() => {
			const until = Date.now() + 8000;
			while (Date.now() < until) {
				// Hold the editor's main thread, as loading a large project does.
			}
		});
		const timedOut = await cliRaw({
			apiPort,
			args: ["editor:captions:import", ...pid, "--file", srt, "--json"],
		});
		await busy;
		expect(timedOut.code, timedOut.stdout).not.toBe(0);
		expect(timedOut.stdout).toContain("Timeout waiting for transaction begin");
		evidence(
			"N7 import while the editor is busy",
			/"error":\s*"([^"]+)"/.exec(timedOut.stdout)?.[1] ?? timedOut.stdout
		);
		await expect
			.poll(
				async () =>
					(
						await cli<{
							editor?: { activeTransaction: unknown; orphaned: boolean };
						}>(apiPort, "editor:transaction:list")
					).editor,
				{ timeout: 20_000 }
			)
			.toEqual({ activeTransaction: null, orphaned: false });
		const imported = await cli<{ added: number }>(
			apiPort,
			"editor:captions:import",
			...pid,
			"--file",
			srt
		);
		expect(imported.added, "the next import works").toBe(1);
		evidence("N7 next import", imported);

		// --- N9 + N12.1: bold Avenir Next stays upright; one JSON document --------
		if (existsSync(AVENIR)) {
			await cli(
				apiPort,
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify({
					type: "captions",
					trackId: freshTrack.trackId,
					content: "IIIIII",
					startTime: 2.5,
					duration: 1,
					style: {
						fontFamily: "Avenir Next",
						bold: true,
						fontSize: 160,
						fontColor: "#ffffff",
						outlineWidth: 0,
						shadowOffset: { x: 0, y: 0 },
						bgOpacity: 0,
					},
				})
			);
			const outputPath = path.join(workDir, "native.mp4");
			const exportRun = await cliRaw({
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
					"native",
					"--poll",
					"--json",
				],
			});
			expect(exportRun.code, exportRun.stderr).toBe(0);
			// N12.1: the pending notice is on stderr; stdout parses as is.
			const result = JSON.parse(exportRun.stdout) as { status: string };
			expect(result.status).toBe("ok");
			expect(exportRun.stderr).toContain('"status": "pending"');
			evidence(
				"N12.1 stdout",
				`${exportRun.stdout.length} bytes, one JSON document; stderr has the pending notice`
			);
			const slant = strokeSlant(readGrayFrame({ file: outputPath, time: 3 }));
			evidence("N9 bold Avenir Next stroke slant (px/px)", slant.toFixed(4));
			expect(Math.abs(slant), `stroke slant ${slant.toFixed(3)}`).toBeLessThan(
				0.05
			);
		}

		// --- N10: the E2E placeholder FAL key is never used ------------------------
		const credentialHome = process.env.QCUT_CREDENTIALS_HOME as string;
		mkdirSync(path.join(credentialHome, ".qcut"), { recursive: true });
		writeFileSync(
			path.join(credentialHome, ".qcut", ".env"),
			"FAL_KEY=test-fal-api-key-e2e\n"
		);
		const audio = path.join(workDir, "dialogue.wav");
		execFileSync(FFMPEG, [
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=1",
			audio,
		]);
		const transcribe = await cliRaw({
			apiPort,
			args: [
				"editor:transcribe:start",
				...pid,
				"--source",
				`path:${audio}`,
				"--provider",
				"elevenlabs",
				"--poll",
				"--json",
			],
		});
		const output = `${transcribe.stdout}\n${transcribe.stderr}`;
		expect(output).toContain(
			"ElevenLabs transcription has no usable credentials"
		);
		expect(output).toContain("FAL_KEY looks like a test placeholder");
		expect(output).not.toContain("FAL storage initiate failed");
		evidence(
			"N10 transcription error",
			/ElevenLabs transcription has no usable credentials[^"\n]*/.exec(
				output
			)?.[0]
		);
		const keys = spawnSync(
			"bun",
			["--silent", "run", "qcut", "--", "check-keys", "--json", "--flat"],
			{ cwd: path.resolve("."), env: process.env, encoding: "utf8" }
		);
		const fal = (
			JSON.parse(keys.stdout) as {
				keys: Array<{ name: string; warning?: string }>;
			}
		).keys.find((key) => key.name === "FAL_KEY");
		expect(fal?.warning).toContain("test placeholder");
		evidence("N10 check-keys FAL_KEY", fal);
	} finally {
		await cliRaw({
			apiPort,
			args: ["editor:project:delete", ...pid, "--force", "--json"],
		});
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
