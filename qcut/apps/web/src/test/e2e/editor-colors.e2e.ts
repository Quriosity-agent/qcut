/**
 * Track and clip colours, end to end through the CLI against an isolated
 * QCut instance:
 *
 * - an audio track created with `--color red` shows a red strip on its header;
 * - clips appended to it show red with no colour of their own (audio clips used
 *   to stay blue whatever their label);
 * - `color-label` recolours one clip, and `select --color` finds the rest.
 */

import { execFile, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const CLIP_DIRECTORY = path.join(tmpdir(), "qcut-editor-colors");
const SCREENSHOT_DIRECTORY = path.resolve("output/playwright/editor-colors");
const RED = "rgb(239, 68, 68)";
const GREEN = "rgb(34, 197, 94)";

function generateSound(name: string, frequency: number): string {
	mkdirSync(CLIP_DIRECTORY, { recursive: true });
	const filePath = path.join(CLIP_DIRECTORY, name);
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
			`sine=frequency=${frequency}:sample_rate=48000:duration=1.5`,
			filePath,
		],
		{ stdio: "pipe" }
	);
	return filePath;
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

test.use({ captureScreenshotVideo: false });
test.setTimeout(300_000);

test("tracks colour their clips, and clips can be recoloured and selected by colour", async ({
	apiPort,
	page,
}) => {
	const sounds = [
		generateSound("shot-1.wav", 440),
		generateSound("shot-2.wav", 660),
	];

	const { projectId } = await cli<{ projectId: string }>({
		apiPort,
		args: ["editor:project:create", "--name", "Colours", "--open"],
	});
	const { trackId } = await cli<{ trackId: string }>({
		apiPort,
		args: [
			"editor:track:create",
			"--project-id",
			projectId,
			"--type",
			"audio",
			"--name",
			"SFX · Guns",
			"--color",
			"red",
		],
	});
	const appended = await cli<{ appended: { failedCount: number } }>({
		apiPort,
		args: [
			"editor:media:batch-import",
			"--project-id",
			projectId,
			"--sources",
			sounds.join(","),
			"--append-to-track",
			trackId,
		],
	});
	expect(appended.appended.failedCount).toBe(0);

	// --- the track's colour reaches its header and its uncoloured clips -------
	await expect(
		page.locator(
			`[data-testid="timeline-track-label"][data-track-id="${trackId}"] [data-testid="timeline-track-color"]`
		)
	).toHaveAttribute("data-color-label", "red");
	const clips = page.locator(
		`[data-testid="timeline-element"][data-track-id="${trackId}"] > [data-color-label]`
	);
	await expect(clips).toHaveCount(2);
	for (const clip of await clips.all()) {
		await expect(clip).toHaveAttribute("data-color-label", "red");
		await expect(clip).toHaveCSS("background-color", RED);
	}

	// --- one clip gets its own colour ------------------------------------------
	const timeline = await cli<{
		tracks: Array<{
			id: string;
			colorLabel?: string;
			elements: Array<{ id: string; startTime: number }>;
		}>;
	}>({
		apiPort,
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	const track = timeline.tracks.find((candidate) => candidate.id === trackId);
	expect(track?.colorLabel).toBe("red");
	const [first, second] = [...(track?.elements ?? [])].sort(
		(a, b) => a.startTime - b.startTime
	);
	const recoloured = await cli<{ updatedCount: number; skipped: unknown[] }>({
		apiPort,
		args: [
			"editor:timeline:color-label",
			"--project-id",
			projectId,
			"--element-ids",
			first.id,
			"--color",
			"green",
		],
	});
	expect(recoloured).toMatchObject({ updatedCount: 1, skipped: [] });
	await expect(
		page.locator(
			`[data-testid="timeline-element"][data-element-id="${first.id}"] > [data-color-label]`
		)
	).toHaveCSS("background-color", GREEN);

	// --- selecting by colour finds the clip still showing the track's red ------
	const selection = await cli<{
		selected: number;
		elements: Array<{ elementId: string }>;
	}>({
		apiPort,
		args: [
			"editor:timeline:select",
			"--project-id",
			projectId,
			"--color",
			"red",
		],
	});
	expect(selection.selected).toBe(1);
	expect(selection.elements[0]?.elementId).toBe(second.id);

	mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
	await page.screenshot({
		path: path.join(SCREENSHOT_DIRECTORY, "audio-track-colours.png"),
		animations: "disabled",
	});
});
