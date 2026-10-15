/**
 * The mixer panel and the CLI change the same mix: set from either side,
 * read back from the other, against an isolated QCut.
 *
 * - the CLI sets a track to -6 dB → the mixer's fader shows -6.0;
 * - the mixer sets it to -3 dB → the CLI reads -3;
 * - dragging a track onto a bus in the mixer → the CLI sees it on that bus;
 * - the track header's mix button shows the same level;
 * - "Measure the mix" in the master strip matches `editor mix loudness`.
 */

import { execFile, execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const CLIP_DIRECTORY = path.join(tmpdir(), "qcut-editor-mixer-ui");
const SCREENSHOT_DIRECTORY = path.resolve("output/playwright/editor-mixer-ui");

function tone(name: string, frequency: number): string {
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
			`sine=frequency=${frequency}:sample_rate=48000:duration=3`,
			"-ac",
			"2",
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

test("the mixer panel and the CLI read and write the same mix", async ({
	apiPort,
	page,
}) => {
	const { projectId } = await cli<{ projectId: string }>({
		apiPort,
		args: ["editor:project:create", "--name", "Mixer UI", "--open"],
	});
	const createTrack = async (name: string, source: string) => {
		const { trackId } = await cli<{ trackId: string }>({
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
		});
		await cli({
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
		return trackId;
	};
	const dialogueId = await createTrack("Dialogue", tone("dialogue.wav", 440));
	const gunsId = await createTrack("SFX · Guns", tone("guns.wav", 2000));
	const readTrack = async (trackId: string) =>
		(
			await cli<{
				track: { audio: { gainDb: number; busId: string } };
			}>({
				apiPort,
				args: [
					"editor:track:audio-get",
					"--project-id",
					projectId,
					"--track-id",
					trackId,
				],
			})
		).track.audio;

	// --- CLI → mixer --------------------------------------------------------
	await cli({
		apiPort,
		args: [
			"editor:track:audio-set",
			"--project-id",
			projectId,
			"--track-id",
			dialogueId,
			"--gain-db",
			"-6",
		],
	});
	await cli({
		apiPort,
		args: [
			"editor:mix:bus-create",
			"--project-id",
			projectId,
			"--name",
			"Hard SFX",
			"--bus-id",
			"sfx",
		],
	});
	await page.getByTestId("mixer-panel-tab").click();
	const dialogueLevel = page.getByTestId(
		`mixer-track-${dialogueId}-level-value`
	);
	await expect(dialogueLevel).toHaveValue("-6.0");
	await expect(page.getByTestId("mixer-bus-sfx-name")).toHaveValue("Hard SFX");

	// --- mixer → CLI --------------------------------------------------------
	await dialogueLevel.fill("-3");
	await dialogueLevel.press("Enter");
	await expect(dialogueLevel).toHaveValue("-3.0");
	await expect.poll(async () => (await readTrack(dialogueId)).gainDb).toBe(-3);

	await page
		.getByTestId(`mixer-track-${gunsId}-drag`)
		.dragTo(page.getByTestId("mixer-bus-sfx-name"));
	await expect.poll(async () => (await readTrack(gunsId)).busId).toBe("sfx");
	await expect(page.getByTestId(`mixer-track-${gunsId}-output`)).toContainText(
		"Hard SFX"
	);

	// --- the track header shows the same level -----------------------------
	await expect(
		page.locator(
			`[data-testid="timeline-track-label"][data-track-id="${dialogueId}"] [data-testid="timeline-track-mix"]`
		)
	).toContainText("-3.0");

	// --- the master's measurement matches the CLI ---------------------------
	await page.getByTestId("mixer-loudness-measure").click();
	const measured = page.getByTestId("mixer-loudness-measured-integrated");
	await expect(measured).toContainText("LUFS", { timeout: 60_000 });
	const panelLufs = Number.parseFloat((await measured.textContent()) ?? "");
	const { integratedLufs } = await cli<{ integratedLufs: number }>({
		apiPort,
		args: ["editor:mix:loudness", "--project-id", projectId],
	});
	expect(Math.abs(panelLufs - integratedLufs)).toBeLessThanOrEqual(0.06);

	mkdirSync(SCREENSHOT_DIRECTORY, { recursive: true });
	await page.getByTestId("media-panel").screenshot({
		path: path.join(SCREENSHOT_DIRECTORY, "mixer-panel.png"),
		animations: "disabled",
	});
});
