/**
 * Editor API gates found by an agent driving QCut from the terminal:
 *
 * - `editor:navigator:open` answers only once the project has loaded, and a
 *   project that does not exist is an error, not a success.
 * - `editor:project:update-settings` on a project that is not open reaches it
 *   when it opens, instead of living only in a file the editor never reads.
 * - `editor:timeline:update-element` can give a clip a volume envelope
 *   (`audio.keyframes.volumeDb`), and malformed audio fails with the reason.
 * - `compose project --target editor` turns manifest `volumeKeyframes` into
 *   those same keyframes, re-based past transition handles.
 *
 * Every step goes through the real CLI against an isolated QCut instance.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import {
	createTestProject,
	navigateToProjects,
	uploadTestMedia,
} from "./helpers/electron-helpers";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FIXTURE_DIR = path.join(tmpdir(), "qcut-editor-api-fixtures");

function generateClip(): string {
	mkdirSync(FIXTURE_DIR, { recursive: true });
	const filePath = path.join(FIXTURE_DIR, "music-bed.mp4");
	if (existsSync(filePath)) return filePath;
	execFileSync(
		"ffmpeg",
		[
			"-y",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=1280x720:rate=30:duration=4",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000:duration=4",
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-shortest",
			"-movflags",
			"+faststart",
			filePath,
		],
		{ stdio: "pipe" }
	);
	return filePath;
}

function ffmpegSync(args: string[]): void {
	execFileSync(
		"ffmpeg",
		["-y", "-hide_banner", "-loglevel", "error", ...args],
		{
			stdio: "pipe",
		}
	);
}

/** Two 4 s clips joined by a 0.5 s crossfade, with ducked music. */
function generateComposeManifest(): string {
	const directory = path.join(FIXTURE_DIR, "compose");
	mkdirSync(directory, { recursive: true });
	for (const name of ["a", "b"]) {
		ffmpegSync([
			"-f",
			"lavfi",
			"-i",
			"color=gray:s=640x360:r=30:d=4",
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
			path.join(directory, `${name}.mp4`),
		]);
	}
	ffmpegSync([
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=1000:sample_rate=48000:duration=7.5",
		"-ac",
		"2",
		path.join(directory, "music.wav"),
	]);
	const configPath = path.join(directory, "edit.qcut-compose.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: 1,
			canvas: { width: 640, height: 360, fps: 30 },
			clips: [
				{ id: "a", source: "a.mp4" },
				{
					id: "b",
					source: "b.mp4",
					volumeKeyframes: [
						{ time: 0, volumeDb: -12 },
						{ time: 1, volumeDb: 0 },
					],
				},
			],
			transitions: [{ between: ["a", "b"], duration: 0.5 }],
			audio: [
				{
					type: "sound-effect",
					source: "music.wav",
					start: 0,
					volumeKeyframes: [
						{ time: 2, volumeDb: 0 },
						{ time: 3, volumeDb: -20 },
						{ time: 5, volumeDb: -20 },
						{ time: 6, volumeDb: 0 },
					],
				},
			],
		})
	);
	return configPath;
}

function projectIdFromPage(page: Page): string {
	const projectId = new URL(page.url()).hash.match(/^#\/editor\/([^/?]+)/)?.[1];
	if (!projectId) throw new Error("Could not resolve the E2E project id");
	return decodeURIComponent(projectId);
}

function runCli({
	apiPort,
	args,
}: {
	apiPort: number;
	args: string[];
}): Promise<{ code: number; output: string }> {
	return new Promise((resolve) => {
		execFile(
			"bun",
			["--silent", "run", "qcut", "--", ...args, "--json"],
			{
				cwd: path.resolve("."),
				env: { ...process.env, QCUT_API_PORT: String(apiPort) },
				maxBuffer: 8 * 1024 * 1024,
				timeout: 120_000,
			},
			(error, stdout, stderr) => {
				const code =
					error && typeof (error as { code?: unknown }).code === "number"
						? ((error as { code: number }).code ?? 1)
						: error
							? 1
							: 0;
				resolve({ code, output: `${stdout}\n${stderr}` });
			}
		);
	});
}

async function readProjectState(page: Page) {
	return page.evaluate(() => {
		const state = (
			window as unknown as {
				__projectStore: {
					getState: () => {
						loadedProjectId: string | null;
						activeProject: {
							id: string;
							canvasSize: { width: number; height: number };
						} | null;
					};
				};
			}
		).__projectStore.getState();
		return {
			loadedProjectId: state.loadedProjectId,
			activeProjectId: state.activeProject?.id,
			canvasSize: state.activeProject?.canvasSize,
		};
	});
}

/** Puts the imported clip on the main track and returns its element id. */
async function addClipToTimeline(page: Page): Promise<string> {
	return page.evaluate(() => {
		const harness = window as unknown as {
			__timelineStore: { getState: () => any };
			__mediaStore: { getState: () => any };
		};
		const item = harness.__mediaStore
			.getState()
			.mediaItems.find(
				(candidate: { type: string }) => candidate.type === "video"
			);
		if (!item) throw new Error("No video imported");
		const state = harness.__timelineStore.getState();
		const trackId =
			state.tracks.find(
				(track: { isMain?: boolean; type: string }) =>
					track.isMain || track.type === "media"
			)?.id ?? state.addTrack("media");
		const elementId = harness.__timelineStore.getState().addElementToTrack(
			trackId,
			{
				duration: 4,
				mediaId: item.id,
				name: "music-bed",
				startTime: 0,
				trimEnd: 0,
				trimStart: 0,
				type: "media",
			},
			{ pushHistory: false, selectElement: false }
		);
		if (!elementId) throw new Error("Clip was not added");
		return elementId as string;
	});
}

async function readVolumeKeyframes(page: Page, elementId: string) {
	return page.evaluate((id) => {
		const harness = window as unknown as {
			__timelineStore: { getState: () => any };
		};
		for (const track of harness.__timelineStore.getState().tracks) {
			const element = track.elements.find(
				(candidate: { id: string }) => candidate.id === id
			);
			if (element) return element.audio?.keyframes?.volumeDb ?? null;
		}
		return null;
	}, elementId);
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(600_000);

test.describe("editor API: project open, settings, and clip volume", () => {
	test("open waits for the project, settings reach a closed project, and clips take volume keyframes", async ({
		page,
		apiPort,
	}) => {
		await createTestProject(page, "Settings Target");
		const targetId = projectIdFromPage(page);
		await navigateToProjects(page);
		await createTestProject(page, "Working Project");
		const workingId = projectIdFromPage(page);
		expect(workingId).not.toBe(targetId);

		// --- settings for a project that is not open -----------------------------
		const square = await runCli({
			apiPort,
			args: [
				"editor:project:update-settings",
				"--project-id",
				targetId,
				"--ratio",
				"1:1",
			],
		});
		expect(square.code, square.output).toBe(0);
		expect(projectIdFromPage(page)).toBe(workingId);

		// --- open answers once the project has loaded ----------------------------
		const opened = await runCli({
			apiPort,
			args: ["editor:navigator:open", "--project-id", targetId],
		});
		expect(opened.code, opened.output).toBe(0);
		// Read immediately: success must mean the project is already loaded.
		const afterOpen = await readProjectState(page);
		expect(afterOpen).toMatchObject({
			loadedProjectId: targetId,
			activeProjectId: targetId,
		});
		expect(afterOpen.canvasSize?.width).toBe(afterOpen.canvasSize?.height);

		const missing = await runCli({
			apiPort,
			args: ["editor:navigator:open", "--project-id", "no-such-project"],
		});
		expect(missing.code).not.toBe(0);
		expect(missing.output).toContain("does not exist");

		// --- clip volume keyframes ------------------------------------------------
		await uploadTestMedia(page, generateClip());
		const elementId = await addClipToTimeline(page);
		const duck = await runCli({
			apiPort,
			args: [
				"editor:timeline:update-element",
				"--project-id",
				targetId,
				"--element-id",
				elementId,
				"--data",
				JSON.stringify({
					audio: {
						keyframes: {
							volumeDb: [
								{ frame: 0, value: 0 },
								{ frame: 30, value: -18 },
								{ frame: 90, value: -18 },
								{ frame: 105, value: 0 },
							],
						},
					},
				}),
			],
		});
		expect(duck.code, duck.output).toBe(0);
		await expect
			.poll(() => readVolumeKeyframes(page, elementId), { timeout: 15_000 })
			.toEqual([
				{ id: "volumeDb-0", frame: 0, value: 0, easing: "linear" },
				{ id: "volumeDb-30", frame: 30, value: -18, easing: "linear" },
				{ id: "volumeDb-90", frame: 90, value: -18, easing: "linear" },
				{ id: "volumeDb-105", frame: 105, value: 0, easing: "linear" },
			]);

		const malformed = await runCli({
			apiPort,
			args: [
				"editor:timeline:update-element",
				"--project-id",
				targetId,
				"--element-id",
				elementId,
				"--data",
				JSON.stringify({
					audio: { keyframes: { volumeDb: [{ frame: 1.5, value: 0 }] } },
				}),
			],
		});
		expect(malformed.code).not.toBe(0);
		expect(malformed.output).toContain(
			"audio.keyframes.volumeDb[0].frame must be a whole number of frames"
		);
		expect(await readVolumeKeyframes(page, elementId)).toHaveLength(4);
	});

	test("compose manifests bring volume keyframes into the editor", async ({
		page,
		apiPort,
	}) => {
		const built = await runCli({
			apiPort,
			args: [
				"compose",
				"project",
				"--config",
				generateComposeManifest(),
				"--target",
				"editor",
				"--name",
				"Compose Volume",
			],
		});
		expect(built.code, built.output).toBe(0);

		const timeline = await page.evaluate(() => {
			type VolumeKeyframe = { frame: number; value: number };
			type HarnessElement = {
				startTime: number;
				audio?: { keyframes?: { volumeDb?: VolumeKeyframe[] } };
			};
			type KeyframedElement = HarnessElement & {
				audio: { keyframes: { volumeDb: VolumeKeyframe[] } };
			};
			const harness = window as unknown as {
				__timelineStore: {
					getState: () => { tracks: Array<{ elements: HarnessElement[] }> };
				};
				__projectStore: {
					getState: () => { activeProject?: { fps: number } | null };
				};
			};
			const elements = harness.__timelineStore
				.getState()
				.tracks.flatMap((track) => track.elements);
			return {
				fps: harness.__projectStore.getState().activeProject?.fps as number,
				keyframed: elements
					.filter((element): element is KeyframedElement =>
						Boolean(element.audio?.keyframes?.volumeDb)
					)
					.sort((left, right) => left.startTime - right.startTime)
					.map((element) => ({
						startTime: element.startTime,
						volumeDb: element.audio.keyframes.volumeDb,
					})),
			};
		});
		const frame = (seconds: number) => Math.round(seconds * timeline.fps);

		// The music bed starts at 0; clip b starts after a's 3.75 s, its
		// keyframes re-based past the 0.25 s crossfade handle.
		expect(timeline.keyframed).toHaveLength(2);
		const [music, clipB] = timeline.keyframed;
		expect(music.startTime).toBe(0);
		expect(
			music.volumeDb.map(({ frame, value }) => ({ frame, value }))
		).toEqual([
			{ frame: frame(2), value: 0 },
			{ frame: frame(3), value: -20 },
			{ frame: frame(5), value: -20 },
			{ frame: frame(6), value: 0 },
		]);
		expect(clipB.startTime).toBeCloseTo(3.75, 3);
		expect(
			clipB.volumeDb.map(({ frame, value }) => ({ frame, value }))
		).toEqual([
			{ frame: 0, value: -9 },
			{ frame: frame(0.75), value: 0 },
		]);
	});
});
