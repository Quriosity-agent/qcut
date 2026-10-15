/**
 * The "门的计划" workflow an agent ran through the CLI, end to end against an
 * isolated QCut instance:
 *
 * - `project:create --match-media` gives the project the footage's size and
 *   frame rate, and both `project:settings` and `timeline:export` report it.
 * - `media:batch-import --append-to-track` lays clips end to end at their
 *   video-stream length (the container is longer because of the audio).
 * - `media:list` carries duration, size and frame rate.
 * - A refused `batch-update` move fails with the reason instead of success.
 * - `timeline:move --time` works without `--to-track`.
 * - With the window closed, `health` says so and editor commands reopen it.
 */

import { execFile, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FPS = 24;
const FRAME_COUNTS = [41, 36, 29];
const CLIP_DIRECTORY = path.join(tmpdir(), "qcut-cli-agent-workflow");

/** A 1280×720 24 fps clip whose AAC track runs 80 ms past its last frame. */
function generateClip({ frames, index }: { frames: number; index: number }) {
	mkdirSync(CLIP_DIRECTORY, { recursive: true });
	const filePath = path.join(CLIP_DIRECTORY, `0${index + 1}.mp4`);
	const videoSeconds = (frames / FPS).toFixed(7);
	execFileSync(
		"ffmpeg",
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			`testsrc2=size=1280x720:rate=${FPS}:duration=${videoSeconds}`,
			"-f",
			"lavfi",
			"-i",
			`sine=frequency=440:sample_rate=48000:duration=${(frames / FPS + 0.08).toFixed(3)}`,
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			filePath,
		],
		{ stdio: "pipe" }
	);
	return filePath;
}

interface CliRun {
	code: number;
	stdout: string;
	output: string;
}

function runCli({
	apiPort,
	args,
}: {
	apiPort: number;
	args: string[];
}): Promise<CliRun> {
	return new Promise((resolve) => {
		execFile(
			"bun",
			["--silent", "run", "qcut", "--", ...args, "--json", "--flat"],
			{
				cwd: path.resolve("."),
				env: { ...process.env, QCUT_API_PORT: String(apiPort) },
				maxBuffer: 8 * 1024 * 1024,
				timeout: 180_000,
			},
			(error, stdout, stderr) => {
				const code =
					error && typeof (error as { code?: unknown }).code === "number"
						? (error as { code: number }).code
						: error
							? 1
							: 0;
				resolve({ code, stdout, output: `${stdout}\n${stderr}` });
			}
		);
	});
}

async function cliJson<T>(input: {
	apiPort: number;
	args: string[];
}): Promise<T> {
	const run = await runCli(input);
	expect(run.code, run.output).toBe(0);
	return JSON.parse(run.stdout) as T;
}

interface ExportedTimeline {
	width: number;
	height: number;
	fps: number;
	tracks: Array<{
		id: string;
		isMain?: boolean;
		type: string;
		elements: Array<{ id: string; startTime: number; endTime: number }>;
	}>;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(600_000);

test.describe("editor CLI: the agent workflow from the improvement list", () => {
	test("create, append, inspect, refuse, move, and survive a closed window", async ({
		apiPort,
		electronApp,
		// Requested so the editor has mounted before the first CLI call.
		page: _page,
	}) => {
		const clips = FRAME_COUNTS.map((frames, index) =>
			generateClip({ frames, index })
		);

		// --- project:create --match-media ----------------------------------------
		const created = await cliJson<{
			projectId: string;
			settings: { width: number; height: number; fps: number };
		}>({
			apiPort,
			args: [
				"editor:project:create",
				"--name",
				"Door Plan",
				"--match-media",
				clips[0],
				"--open",
			],
		});
		expect(created.settings).toEqual({ width: 1280, height: 720, fps: 24 });
		const projectId = created.projectId;

		// --- batch-import --append-to-track ---------------------------------------
		const before = await cliJson<ExportedTimeline>({
			apiPort,
			args: ["editor:timeline:export", "--project-id", projectId],
		});
		const mainTrack =
			before.tracks.find((track) => track.isMain) ??
			before.tracks.find((track) => track.type === "media");
		if (!mainTrack) throw new Error("New project has no media track");

		const appended = await cliJson<{
			appended: { failedCount: number };
			skipped: unknown[];
		}>({
			apiPort,
			args: [
				"editor:media:batch-import",
				"--project-id",
				projectId,
				"--sources",
				clips.join(","),
				"--append-to-track",
				mainTrack.id,
			],
		});
		expect(appended.appended.failedCount).toBe(0);
		expect(appended.skipped).toEqual([]);

		// --- the clips sit end to end at their video length -------------------------
		const timeline = await cliJson<ExportedTimeline>({
			apiPort,
			args: ["editor:timeline:export", "--project-id", projectId],
		});
		const placed = [
			...(timeline.tracks.find((track) => track.id === mainTrack.id)
				?.elements ?? []),
		].sort((a, b) => a.startTime - b.startTime);
		expect(placed).toHaveLength(FRAME_COUNTS.length);
		let expectedStart = 0;
		for (const [index, element] of placed.entries()) {
			expect(element.startTime).toBeCloseTo(expectedStart, 3);
			const length = element.endTime - element.startTime;
			// Within a few ms of frames/fps, and shorter than the 80 ms-longer
			// container.
			expect(Math.abs(length - FRAME_COUNTS[index] / FPS)).toBeLessThan(0.005);
			expectedStart = element.endTime;
		}

		// --- settings agree everywhere --------------------------------------------
		expect(timeline).toMatchObject({ width: 1280, height: 720, fps: 24 });
		const settings = await cliJson<{
			width: number;
			height: number;
			fps: number;
		}>({
			apiPort,
			args: ["editor:project:settings", "--project-id", projectId],
		});
		expect(settings).toMatchObject({ width: 1280, height: 720, fps: 24 });

		// --- media:list carries what placement needs -------------------------------
		const media = await cliJson<
			Array<{
				name: string;
				duration?: number;
				fps?: number;
				dimensions?: { width: number; height: number };
			}>
		>({
			apiPort,
			args: ["editor:media:list", "--project-id", projectId],
		});
		const firstClip = media.find((item) => item.name === "01.mp4");
		expect(firstClip).toMatchObject({
			fps: 24,
			dimensions: { width: 1280, height: 720 },
		});
		expect(Math.abs((firstClip?.duration ?? 0) - 41 / FPS)).toBeLessThan(0.005);

		// --- a refused batch-update move reports failure ---------------------------
		const [first, , last] = placed;
		const refused = await cliJson<{
			updatedCount: number;
			failedCount: number;
			results: Array<{ success: boolean; error?: string }>;
		}>({
			apiPort,
			args: [
				"editor:timeline:batch-update",
				"--project-id",
				projectId,
				"--updates",
				JSON.stringify([
					{ elementId: last.id, changes: { startTime: first.startTime } },
				]),
			],
		});
		expect(refused.failedCount).toBe(1);
		expect(refused.results[0]?.error).toContain("overlaps");
		expect(refused.results[0]?.error).toContain("next free start");

		// --- move along the current track with only --time -------------------------
		const moveTo = Number((last.endTime + 1).toFixed(3));
		const moved = await cliJson<{ moved: boolean; startTime: number }>({
			apiPort,
			args: [
				"editor:timeline:move",
				"--project-id",
				projectId,
				"--element-id",
				last.id,
				"--time",
				String(moveTo),
			],
		});
		expect(moved.moved).toBe(true);
		expect(moved.startTime).toBeCloseTo(moveTo, 3);

		// --- a closed window is reported and reopened ------------------------------
		await electronApp.evaluate(({ BrowserWindow }) => {
			for (const win of BrowserWindow.getAllWindows()) win.close();
		});
		await expect
			.poll(
				async () =>
					(
						await cliJson<{ window?: { hasWindow: boolean } }>({
							apiPort,
							args: ["editor:health"],
						})
					).window?.hasWindow,
				{ timeout: 15_000 }
			)
			.toBe(false);

		const projects = await cliJson<unknown>({
			apiPort,
			args: ["editor:navigator:projects"],
		});
		expect(JSON.stringify(projects)).toContain(projectId);
		const health = await cliJson<{ window?: { hasWindow: boolean } }>({
			apiPort,
			args: ["editor:health"],
		});
		expect(health.window?.hasWindow).toBe(true);
	});
});
