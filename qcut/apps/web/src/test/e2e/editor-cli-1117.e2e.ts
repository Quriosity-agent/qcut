/**
 * The field test of 2026-11-17 (QCut 2026.11.15.3 on a 4:51 film), replayed
 * against a real editor through the command line:
 * - B: `media rename` takes the clips along, an unknown media id is an
 *   error, a clip without media stops the native export, and `media
 *   replace` leaves a same-named file under its name;
 * - A: a media file written over in the project folder is read again by the
 *   editor, on request and before an export;
 * - C: an adjustment layer under a media overlay exports natively, with a
 *   range, and grades what is below it only;
 * - D: a range export of a timeline of several clips is drawn on the clips
 *   around the range and still shows the right picture;
 * - E: a seek ends a hover preview.
 */

import { execFile, execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const FFPROBE = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffprobe");
const FPS = 24;
const WIDTH = 320;
const HEIGHT = 180;

type Json = Record<string, unknown>;

interface CliOutcome<T> {
	ok: boolean;
	data: T;
	error?: string;
}

/** Runs the CLI and returns its JSON envelope whether it succeeded or not. */
function cli<T = Json>({
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
				maxBuffer: 64 * 1024 * 1024,
				timeout: 420_000,
			},
			(error, stdout, stderr) => {
				// Thrown in here it would escape the promise: every way out
				// of this callback settles it.
				try {
					const start = stdout.indexOf("{");
					if (start < 0) throw new Error("it printed no JSON");
					const envelope = JSON.parse(stdout.slice(start)) as {
						status: string;
						error?: string;
						data?: { data?: T } & Json;
					};
					resolve({
						ok: envelope.status === "ok",
						data: (envelope.data?.data ?? {}) as T,
						error: envelope.error,
					});
				} catch (unreadable) {
					reject(
						new Error(
							`${args.join(" ")}: ${unreadable instanceof Error ? unreadable.message : String(unreadable)}${error ? ` (${error.message})` : ""}\n${stdout}\n${stderr}`
						)
					);
				}
			}
		);
	});
}

/** A flat colour, `seconds` long, with or without a tone. */
function colourVideo({
	file,
	colour,
	seconds,
	sound = false,
}: {
	file: string;
	colour: string;
	seconds: number;
	sound?: boolean;
}): void {
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=${colour}:size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=${seconds}`,
		...(sound
			? ["-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`]
			: []),
		"-pix_fmt",
		"yuv420p",
		...(sound ? ["-shortest"] : []),
		file,
	]);
}

/** The colour of the 8×8 patch at (x, y) of the frame at `time`. */
function patch({
	file,
	time,
	x,
	y,
}: {
	file: string;
	time: number;
	x: number;
	y: number;
}): number[] {
	const raw = execFileSync(FFMPEG, [
		"-v",
		"error",
		"-ss",
		String(time),
		"-i",
		file,
		"-frames:v",
		"1",
		"-vf",
		`crop=8:8:${x}:${y},scale=1:1:flags=area`,
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgb24",
		"-",
	]);
	return [raw[0], raw[1], raw[2]];
}

function durationOf({ file }: { file: string }): number {
	return Number(
		execFileSync(FFPROBE, [
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"csv=p=0",
			file,
		])
			.toString()
			.trim()
	);
}

/** Which of red, green and blue a colour is closest to, or "grey". */
function hue([r, g, b]: number[]): string {
	const top = Math.max(r, g, b);
	if (top - Math.min(r, g, b) < 40) return top > 200 ? "white" : "grey";
	if (r > 150 && g > 150 && b < 100) return "yellow";
	return r === top ? "red" : g === top ? "green" : "blue";
}

interface Exported {
	tracks: Array<{
		id: string;
		name: string;
		type: string;
		isMain?: boolean;
		elements: Array<Json & { id: string; name?: string }>;
	}>;
}

interface MediaListed {
	id: string;
	name: string;
	path: string;
	size: number;
}

/** A point of the frame the corner card does not cover, and one it does. */
const FILM = { x: 200, y: 100 };
const CARD = { x: 30, y: 20 };

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(1_200_000);

test("QCut 1117 field test: renamed and overwritten media, a grade under an overlay, ranges, seek", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T = Json>(...args: string[]) => cli<T>({ apiPort, args });
	const notes: string[] = [];
	const note = (label: string, value: unknown) => {
		notes.push(
			`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`
		);
	};

	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-1117-"));
	const film = path.join(workDir, "film.mp4");
	const shake = path.join(workDir, "shake.mp4");
	colourVideo({ file: film, colour: "0x808080", seconds: 8, sound: true });
	colourVideo({ file: shake, colour: "0xd02020", seconds: 4 });
	const corner = path.join(workDir, "corner.png");
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=black@0:s=${WIDTH}x${HEIGHT}:d=1,format=rgba,drawbox=x=0:y=0:w=80:h=60:color=white@1:t=fill:replace=1`,
		"-frames:v",
		"1",
		corner,
	]);

	const created = await run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"QCut1117 E2E (delete me)",
		"--open"
	);
	expect(created.ok, created.error).toBe(true);
	const projectId = created.data.projectId;
	const pid = ["--project-id", projectId];
	await run(
		"editor:project:update-settings",
		...pid,
		"--data",
		JSON.stringify({ width: WIDTH, height: HEIGHT, fps: FPS })
	);

	const exportTimeline = async (): Promise<Exported> => {
		const exported = await run<Exported>("editor:timeline:export", ...pid);
		expect(exported.ok, exported.error).toBe(true);
		return exported.data;
	};
	const listMedia = async (): Promise<MediaListed[]> => {
		const listed = await run<MediaListed[]>("editor:media:list", ...pid);
		expect(listed.ok, listed.error).toBe(true);
		return listed.data;
	};
	let exportCount = 0;
	/** Exports and returns the file, or the error the export start gave. */
	const exportFile = async (
		...flags: string[]
	): Promise<{ file: string; error?: string; seconds: number }> => {
		exportCount += 1;
		const file = path.join(workDir, `export-${exportCount}.mp4`);
		const started = Date.now();
		const result = await run(
			"editor:export:start",
			...pid,
			...flags,
			"--output",
			file,
			"--poll"
		);
		return {
			file,
			error: result.ok ? undefined : (result.error ?? "failed"),
			seconds: (Date.now() - started) / 1000,
		};
	};

	// Four two-second clips of the film on the main track, and the shake
	// clip over seconds 1 to 3.
	const filmClips = Array.from({ length: 4 }, (_, index) => ({
		alias: `film-${index}`,
		type: "media",
		media: "film",
		startTime: index * 2,
		duration: 8,
		trimStart: index * 2,
		trimEnd: 8 - (index + 1) * 2,
		name: `film ${index + 1}`,
	}));
	const shakeClip = {
		alias: "shake",
		type: "media",
		media: "shake",
		startTime: 1,
		duration: 4,
		trimStart: 0,
		trimEnd: 2,
		name: "shake 01",
	};
	const manifestPath = path.join(workDir, "manifest.json");
	writeFileSync(
		manifestPath,
		JSON.stringify({
			media: [
				{ alias: "film", path: film },
				{ alias: "shake", path: shake },
			],
			tracks: [
				{ name: "Shake", type: "media", elements: [shakeClip] },
				{ name: "Main", type: "media", isMain: true, elements: filmClips },
			],
		})
	);
	const applied = await run<{ verified: boolean }>(
		"editor:timeline:apply",
		...pid,
		"--manifest",
		`@${manifestPath}`,
		"--replace"
	);
	expect(applied.ok, applied.error).toBe(true);

	const shakeBefore = (await listMedia()).find(
		(media) => media.name === "shake.mp4"
	);
	expect(shakeBefore).toBeDefined();
	const oldId = shakeBefore?.id as string;

	// --- D: a range in the second clip, with the overlay begun before it ------
	const firstRange = await exportFile(
		"--engine",
		"native",
		"--start-time",
		"2",
		"--end-time",
		"3.5"
	);
	expect(firstRange.error).toBeUndefined();
	expect(Math.abs(durationOf({ file: firstRange.file }) - 1.5)).toBeLessThan(
		0.1
	);
	// The shake clip runs to second 3: one second into the range.
	expect(hue(patch({ file: firstRange.file, time: 0.5, ...FILM }))).toBe("red");
	expect(hue(patch({ file: firstRange.file, time: 1.25, ...FILM }))).toBe(
		"grey"
	);
	note("D range 2–3.5 s of four clips: seconds taken", firstRange.seconds);

	// --- B: a rename takes the clips along -------------------------------------
	const renamed = await run<{
		renamed: boolean;
		id: string;
		name: string;
		previousId: string;
		previousName: string;
	}>(
		"editor:media:rename",
		...pid,
		"--media-id",
		oldId,
		"--new-name",
		"shake_v2"
	);
	expect(renamed.ok, renamed.error).toBe(true);
	expect(renamed.data).toMatchObject({
		renamed: true,
		name: "shake_v2.mp4",
		previousId: oldId,
		previousName: "shake.mp4",
	});
	const newId = renamed.data.id;
	expect(newId).not.toBe(oldId);
	note("B media rename answer", renamed.data);

	const afterRename = await exportTimeline();
	const shakeTrack = afterRename.tracks.find((track) => track.name === "Shake");
	const renamedClip = shakeTrack?.elements[0];
	expect(renamedClip?.sourceId ?? renamedClip?.mediaId).toBe(newId);
	const namesAfterRename = (await listMedia()).map((media) => media.name);
	expect(namesAfterRename).toContain("shake_v2.mp4");
	expect(namesAfterRename).not.toContain("shake.mp4");
	// The editor holds one item for the file, under the new id.
	const editorItems = await page.evaluate(() =>
		(
			window as unknown as {
				__mediaStore: {
					getState: () => {
						mediaItems: Array<{ id: string; name: string; localPath?: string }>;
					};
				};
			}
		).__mediaStore
			.getState()
			.mediaItems.map((item) => ({ id: item.id, name: item.name }))
	);
	expect(editorItems.filter((item) => item.name.startsWith("shake"))).toEqual([
		{ id: newId, name: "shake_v2.mp4" },
	]);

	// The clip is still in the export; it used to be left out without a word.
	const afterRenameExport = await exportFile(
		"--engine",
		"native",
		"--start-time",
		"1.5",
		"--end-time",
		"2.5"
	);
	expect(afterRenameExport.error).toBeUndefined();
	expect(hue(patch({ file: afterRenameExport.file, time: 0.5, ...FILM }))).toBe(
		"red"
	);

	// An id the project does not have is an error, not an empty answer.
	const gone = await run("editor:media:info", ...pid, "--media-id", oldId);
	expect(gone.ok).toBe(false);
	expect(gone.error).toContain("Media not found");
	note("B media info for the old id", gone.error);

	// --- A: a file written over in the project folder --------------------------
	const shakeFile = (await listMedia()).find((media) => media.id === newId)
		?.path as string;
	expect(existsSync(shakeFile)).toBe(true);
	const editorCopy = () =>
		page.evaluate((id) => {
			const item = (
				window as unknown as {
					__mediaStore: {
						getState: () => {
							mediaItems: Array<{
								id: string;
								file: File;
								metadata?: { sourceFile?: { size: number } };
							}>;
						};
					};
				}
			).__mediaStore
				.getState()
				.mediaItems.find((candidate) => candidate.id === id);
			return {
				size: item?.file.size,
				recorded: item?.metadata?.sourceFile?.size,
			};
		}, newId);
	const green = path.join(workDir, "green.mp4");
	// Longer, so its size differs whatever the encoder makes of a flat colour.
	colourVideo({ file: green, colour: "0x20c020", seconds: 5 });
	copyFileSync(green, shakeFile);
	expect((await editorCopy()).size).not.toBe(statSync(green).size);

	const refreshed = await run<{
		checked: number;
		refreshed: Array<{ id: string; name: string }>;
		failed: unknown[];
	}>("editor:media:refresh", ...pid);
	expect(refreshed.ok, refreshed.error).toBe(true);
	expect(refreshed.data.refreshed).toEqual([
		{ id: newId, name: "shake_v2.mp4" },
	]);
	expect(refreshed.data.failed).toEqual([]);
	note("A media refresh answer", refreshed.data);
	expect(await editorCopy()).toEqual({
		size: statSync(green).size,
		recorded: statSync(green).size,
	});
	// A second check finds nothing left to read.
	const again = await run<{ refreshed: unknown[] }>(
		"editor:media:refresh",
		...pid
	);
	expect(again.data.refreshed).toEqual([]);

	// The editor's own export and the native one now show the same file.
	const rendererGreen = await exportFile("--engine", "muxer");
	expect(rendererGreen.error).toBeUndefined();
	expect(hue(patch({ file: rendererGreen.file, time: 2, ...FILM }))).toBe(
		"green"
	);
	const nativeGreen = await exportFile(
		"--engine",
		"native",
		"--start-time",
		"1.5",
		"--end-time",
		"2.5"
	);
	expect(hue(patch({ file: nativeGreen.file, time: 0.5, ...FILM }))).toBe(
		"green"
	);

	// Written over again and exported straight away: the export start has the
	// editor read it first, with no refresh asked for.
	const blue = path.join(workDir, "blue.mp4");
	colourVideo({ file: blue, colour: "0x2020d0", seconds: 6 });
	copyFileSync(blue, shakeFile);
	const rendererBlue = await exportFile("--engine", "muxer");
	expect(rendererBlue.error).toBeUndefined();
	expect(hue(patch({ file: rendererBlue.file, time: 2, ...FILM }))).toBe(
		"blue"
	);
	expect((await editorCopy()).size).toBe(statSync(blue).size);
	note("A renderer export after a second overwrite", "blue, as the folder");

	// --- B: `media replace` leaves a same-named file under its name ------------
	const yellowDir = mkdtempSync(path.join(tmpdir(), "qcut-1117-yellow-"));
	const yellow = path.join(yellowDir, "shake_v2.mp4");
	colourVideo({ file: yellow, colour: "0xe0e020", seconds: 4 });
	const replaced = await run<{
		mediaId: string;
		name: string;
		importedAs?: string;
		oldMediaRemoved: boolean;
		warning?: string;
	}>(
		"editor:media:replace",
		...pid,
		"--media-id",
		newId,
		"--source",
		yellow,
		"--force"
	);
	expect(replaced.ok, replaced.error).toBe(true);
	note("B media replace answer", replaced.data);
	expect(replaced.data).toMatchObject({
		name: "shake_v2.mp4",
		mediaId: newId,
		importedAs: "shake_v2_1.mp4",
		oldMediaRemoved: true,
	});
	expect(replaced.data.warning).toBeUndefined();
	const namesAfterReplace = (await listMedia()).map((media) => media.name);
	expect(namesAfterReplace).toContain("shake_v2.mp4");
	expect(namesAfterReplace).not.toContain("shake_v2_1.mp4");
	const afterReplaceExport = await exportFile(
		"--engine",
		"native",
		"--start-time",
		"1.5",
		"--end-time",
		"2.5"
	);
	expect(afterReplaceExport.error).toBeUndefined();
	expect(
		hue(patch({ file: afterReplaceExport.file, time: 0.5, ...FILM }))
	).toBe("yellow");

	// --- E: a seek ends a hover preview ----------------------------------------
	await page.evaluate(() => {
		const store = (
			window as unknown as {
				__playbackStore: {
					getState: () => { setPreviewScrubTime: (time: number) => void };
				};
			}
		).__playbackStore;
		// The pointer rests on the timeline at 1 s.
		store.getState().setPreviewScrubTime(1);
	});
	const seek = await run("editor:timeline:seek", ...pid, "--time", "5");
	expect(seek.ok, seek.error).toBe(true);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const state = (
					window as unknown as {
						__playbackStore: {
							getState: () => {
								currentTime: number;
								previewScrubTime: number | null;
							};
						};
					}
				).__playbackStore.getState();
				return {
					currentTime: state.currentTime,
					previewScrubTime: state.previewScrubTime,
				};
			})
		)
		.toEqual({ currentTime: 5, previewScrubTime: null });

	// --- C: an adjustment layer under a media overlay --------------------------
	const blueCube = {
		size: 2,
		values: Array.from({ length: 8 }, () => [0, 0, 1]).flat(),
	};
	const stackPath = path.join(workDir, "stack.json");
	writeFileSync(
		stackPath,
		JSON.stringify({
			media: [
				{ alias: "film", path: film },
				{ alias: "corner", path: corner },
			],
			tracks: [
				{
					name: "Corner",
					type: "media",
					elements: [
						{
							alias: "corner",
							type: "media",
							media: "corner",
							startTime: 0,
							duration: 8,
							name: "corner card",
						},
					],
				},
				{
					name: "Grade",
					type: "adjustment",
					elements: [
						{
							alias: "grade",
							type: "adjustment",
							startTime: 0,
							duration: 6,
							name: "all blue",
							color: {
								enabled: true,
								lut: {
									enabled: true,
									presetId: "custom",
									name: "all blue",
									intensity: 100,
									skinProtection: 0,
									cube: blueCube,
								},
							},
						},
					],
				},
				{ name: "Main", type: "media", isMain: true, elements: filmClips },
			],
		})
	);
	const stacked = await run<{ verified: boolean }>(
		"editor:timeline:apply",
		...pid,
		"--manifest",
		`@${stackPath}`,
		"--replace"
	);
	expect(stacked.ok, stacked.error).toBe(true);
	const stack = await exportTimeline();
	note(
		"C track order, top first",
		stack.tracks.map((track) => `${track.name} (${track.type})`)
	);
	const order = stack.tracks.map((track) => track.name);
	expect(order.indexOf("Corner")).toBeLessThan(order.indexOf("Grade"));
	expect(order.indexOf("Grade")).toBeLessThan(order.indexOf("Main"));

	// A range and a bitrate are the native export's: it has to be the one.
	const stackRange = await exportFile(
		"--engine",
		"native",
		"--start-time",
		"4.5",
		"--end-time",
		"6.5",
		"--bitrate",
		"6M"
	);
	expect(stackRange.error).toBeUndefined();
	note("C native range export of the stack: seconds taken", stackRange.seconds);
	expect(Math.abs(durationOf({ file: stackRange.file }) - 2)).toBeLessThan(0.1);
	// Under the layer (it ends at second 6) the film is blue and the card,
	// which is above the layer, is still white.
	expect(hue(patch({ file: stackRange.file, time: 0.5, ...FILM }))).toBe(
		"blue"
	);
	expect(hue(patch({ file: stackRange.file, time: 0.5, ...CARD }))).toBe(
		"white"
	);
	// After the layer the film is grey again.
	expect(hue(patch({ file: stackRange.file, time: 1.75, ...FILM }))).toBe(
		"grey"
	);
	expect(hue(patch({ file: stackRange.file, time: 1.75, ...CARD }))).toBe(
		"white"
	);
	// The editor's own export draws the same stack.
	const stackRenderer = await exportFile("--engine", "muxer");
	expect(stackRenderer.error).toBeUndefined();
	expect(hue(patch({ file: stackRenderer.file, time: 5, ...FILM }))).toBe(
		"blue"
	);
	expect(hue(patch({ file: stackRenderer.file, time: 5, ...CARD }))).toBe(
		"white"
	);

	// --- B: a clip whose media is gone stops the native export -----------------
	const filmFile = (await listMedia()).find(
		(media) => media.name === "film.mp4"
	)?.path as string;
	// Out of the project folder altogether, as a file deleted there is.
	const hidden = path.join(workDir, "film-taken-away.mp4");
	copyFileSync(filmFile, hidden);
	rmSync(filmFile);
	try {
		const missing = await exportFile("--engine", "native");
		note("B export with the film's file gone", missing.error);
		expect(missing.error).toContain(
			"4 clips play media that is not in the project"
		);
		expect(missing.error).toContain('"film 1"');
		expect(missing.error).toContain("Nothing was exported");
		expect(existsSync(missing.file)).toBe(false);
	} finally {
		copyFileSync(hidden, filmFile);
	}

	console.log(`[qcut-1117]\n${notes.join("\n")}`);
});
