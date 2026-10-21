/**
 * Shared driving helpers for the independent (自研) smart-body video specs:
 * paused-frame readiness, frame cache and checkpoint inspection, engine worker
 * discovery, body edits through the store and a framemd5 export.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { type ElectronApplication, expect, type Page } from "@playwright/test";
import { getFFmpegPath } from "../../../../../../electron/ffmpeg/paths";
import { probeVideo } from "./transition-export-evidence";
import { stubExportSaveDialog } from "./e2e-export-helpers";
import { waitForBodyExportFile } from "./body-export-completion";
import type { ReferenceWindow } from "./portrait-reference";

const run = promisify(execFile);

export interface BodyVideoWindow extends ReferenceWindow {
	__playbackStore: {
		getState: () => {
			currentTime: number;
			pause: () => void;
			seek: (time: number) => void;
		};
	};
}

export interface CacheEntry {
	key: string;
	width: number;
	height: number;
	rgbaSha256: string;
}

export async function cacheEntries({
	cache,
}: {
	cache: string;
}): Promise<CacheEntry[]> {
	const names = await readdir(cache).catch(() => [] as string[]);
	return Promise.all(
		names
			.filter((name) => name.endsWith(".json"))
			.sort()
			.map(
				async (name) =>
					JSON.parse(
						await readFile(path.join(cache, name), "utf8")
					) as CacheEntry
			)
	);
}

export async function checkpointFiles({ sessions }: { sessions: string }) {
	const folders = await readdir(sessions).catch(() => [] as string[]);
	const files: Record<string, string[]> = {};
	for (const folder of folders.sort())
		files[folder] = (await readdir(path.join(sessions, folder))).sort();
	return files;
}

export async function engineWorkers({ appPid }: { appPid: number }) {
	const { stdout } = await run("ps", ["-axo", "pid=,ppid=,args="]);
	return stdout.split("\n").flatMap((line) => {
		const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
		return match &&
			Number(match[2]) === appPid &&
			match[3].includes("independent_worker.py")
			? [Number(match[1])]
			: [];
	});
}

export async function seek({
	page,
	frame,
	fps,
}: {
	page: Page;
	frame: number;
	fps: number;
}) {
	await page.evaluate((time) => {
		const playback = (
			window as unknown as BodyVideoWindow
		).__playbackStore.getState();
		playback.pause();
		playback.seek(time);
	}, frame / fps);
}

/** The paused preview of `frame`, from the exact composition or the DOM portrait canvas. */
export async function waitForPausedFrame({
	page,
	frame,
	timeout = 240_000,
}: {
	page: Page;
	frame: number;
	timeout?: number;
}) {
	await expect
		.poll(
			() =>
				page.evaluate((expected) => {
					const composition = document.querySelector<HTMLImageElement>(
						'[data-canvas-composition-preview="ready"]'
					);
					if (composition)
						return Number(composition.dataset.frame) === expected
							? "composition"
							: `composition:${composition.dataset.frame}`;
					const canvas = document.querySelector<HTMLCanvasElement>(
						'[data-testid="color-preview-canvas"]'
					);
					if (
						canvas &&
						Number(canvas.dataset.renderedFrameSeed) === expected &&
						canvas.dataset.renderedPortraitStatus === "applied" &&
						!document.querySelector(
							'[data-testid="independent-portrait-pending"]'
						)
					)
						return "dom";
					return `pending:${canvas?.dataset.renderedFrameSeed ?? "none"}`;
				}, frame),
			{ timeout, intervals: [250, 500, 1_000] }
		)
		.toMatch(/^(composition|dom)$/);
}

export async function setBodyValues({
	page,
	values,
}: {
	page: Page;
	values: Record<string, number>;
}) {
	await page.evaluate((next) => {
		const timeline = (
			window as unknown as BodyVideoWindow
		).__timelineStore.getState();
		const track = timeline.tracks.find((candidate) =>
			candidate.elements.some((element) => element.type === "media")
		);
		const element = track?.elements.find(
			(candidate) => candidate.type === "media"
		);
		if (!track || !element || element.type !== "media")
			throw new Error("Missing body clip");
		const current = element.portraitAdjustments ?? {
			enabled: true,
			values: {},
		};
		timeline.updateMediaElement(track.id, element.id, {
			portraitAdjustments: {
				...current,
				enabled: true,
				engine: "independent",
				values: { ...current.values, ...next },
			},
		});
	}, values);
}

/** Frame-level digests of the decoded export: equal lists mean identical pictures. */
export async function exportFrameDigests({
	file,
	frames: expectedFrames,
}: {
	file: string;
	frames: number;
}) {
	const { stdout } = await run(
		getFFmpegPath(),
		[
			"-v",
			"error",
			"-xerror",
			"-i",
			file,
			"-map",
			"0:v:0",
			"-an",
			"-pix_fmt",
			"rgba",
			"-f",
			"framemd5",
			"-",
		],
		{ timeout: 120_000 }
	);
	const frames = stdout
		.split("\n")
		.filter((line) => line.trim() && !line.startsWith("#"))
		.map((line) => line.split(",").at(-1)!.trim());
	expect(frames).toHaveLength(expectedFrames);
	return frames;
}

/**
 * Opens the export dialog, picks 1080p at `fps` without audio and starts the
 * export to `file`. Returns once the export is running so a caller can act
 * while frames are still being computed.
 */
export async function startExport({
	app,
	page,
	file,
	fps,
}: {
	app: ElectronApplication;
	page: Page;
	file: string;
	fps: number;
}) {
	await rm(file, { force: true });
	await stubExportSaveDialog({ electronApp: app, outputPath: file });
	await page.getByTestId("export-button").click();
	await expect(page.getByTestId("export-dialog")).toBeVisible();
	await page.getByTestId("export-quality-select").getByRole("button").click();
	await page.locator('button[role="radio"][id="1080p"]').check();
	await page
		.getByTestId("export-frame-rate-select")
		.getByRole("button")
		.click();
	await page
		.getByRole("radio", { name: `${fps} fps`, exact: true })
		.locator("..")
		.click();
	const includeAudio = page.getByRole("checkbox", {
		name: "Include audio in export",
	});
	if ((await includeAudio.count()) > 0 && (await includeAudio.isChecked()))
		await includeAudio.click();
	const started = Date.now();
	await page.getByTestId("export-start-button").click();
	return { started };
}

/** Waits for a started export to finish, closes the dialog and digests the file. */
export async function finishExport({
	page,
	file,
	fps,
	frames: expectedFrames,
	started,
	timeout = 900_000,
}: {
	page: Page;
	file: string;
	fps: number;
	frames: number;
	started: number;
	timeout?: number;
}) {
	await waitForBodyExportFile({ page, file, timeout });
	const seconds = (Date.now() - started) / 1000;
	await expect(page.getByTestId("export-start-button")).toBeVisible({
		timeout: 30_000,
	});
	await page.getByRole("button", { name: "Close export dialog" }).click();
	const probe = await probeVideo({ filePath: file });
	expect(probe).toMatchObject({
		width: 1080,
		height: 1920,
		frameCount: expectedFrames,
		fps,
	});
	const frames = await exportFrameDigests({ file, frames: expectedFrames });
	return { seconds, frames };
}

export async function exportTimeline({
	app,
	page,
	file,
	fps,
	frames,
}: {
	app: ElectronApplication;
	page: Page;
	file: string;
	fps: number;
	frames: number;
}) {
	const { started } = await startExport({ app, page, file, fps });
	return finishExport({ page, file, fps, frames, started });
}
