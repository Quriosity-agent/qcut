/**
 * The CLI report of 2026-11-14 (a 4:42 short built entirely with `qcut`),
 * replayed against a real editor: the project's "last modified" time, the
 * open project as the default, a custom 3D LUT from write to native export,
 * blend fields through `element patch`, `element color --lut-file`, a
 * manifest refused before anything changes, and the behaviours that report
 * asked to keep: ranged exports and a failed apply leaving the timeline as
 * it was.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const FFPROBE = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffprobe");
const FPS = 24;

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
			(_error, stdout, stderr) => {
				const start = stdout.indexOf("{");
				if (start < 0) {
					reject(new Error(`${args[0]} printed no JSON: ${stdout}\n${stderr}`));
					return;
				}
				const envelope = JSON.parse(stdout.slice(start)) as {
					status: string;
					error?: string;
					data?: { data?: T } & Json;
				};
				resolve({
					ok: envelope.status === "ok",
					// A failure keeps its partial result at the same place.
					data: (envelope.data?.data ?? {}) as T,
					error: envelope.error,
				});
			}
		);
	});
}

/** A cube that turns every colour into `rgb`, in .cube order. */
function flatCube({
	size,
	rgb,
}: {
	size: number;
	rgb: [number, number, number];
}): { size: number; values: number[] } {
	return {
		size,
		values: Array.from({ length: size ** 3 }, () => rgb).flat(),
	};
}

/** The mean colour of the frame at `time`, 0..255 per channel. */
function meanColor({ file, time }: { file: string; time: number }): number[] {
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
		"scale=1:1:flags=area",
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

interface Exported {
	tracks: Array<{
		id: string;
		name: string;
		isMain?: boolean;
		colorLabel?: string;
		elements: Array<Json & { id: string }>;
	}>;
}

/** Whether every field `expected` names reads back the same in `actual`. */
function differences({
	expected,
	actual,
	at = "",
}: {
	expected: unknown;
	actual: unknown;
	at?: string;
}): string[] {
	if (typeof expected === "number" && typeof actual === "number") {
		return Math.abs(expected - actual) < 1e-9 ? [] : [at];
	}
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual) || actual.length !== expected.length) {
			return [at];
		}
		const firstDifferent = expected.findIndex(
			(item, index) =>
				differences({ expected: item, actual: actual[index] }).length > 0
		);
		return firstDifferent < 0 ? [] : [`${at}[${firstDifferent}]`];
	}
	if (expected !== null && typeof expected === "object") {
		if (actual === null || typeof actual !== "object") return [at];
		return Object.entries(expected).flatMap(([key, value]) =>
			differences({
				expected: value,
				actual: (actual as Json)[key],
				at: at ? `${at}.${key}` : key,
			})
		);
	}
	return expected === actual ? [] : [at];
}

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(900_000);

test("QCut 1114 report: modified time, LUTs, blend patch, preflight, rollback", async ({
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

	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-1114-"));
	const video = path.join(workDir, "grey.mp4");
	// Mid grey, so a LUT's effect on the picture is unmistakable.
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=0x808080:size=320x180:rate=${FPS}:duration=6`,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=6",
		"-pix_fmt",
		"yuv420p",
		"-shortest",
		video,
	]);

	const created = await run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"QCut1114 E2E (delete me)",
		"--open"
	);
	expect(created.ok, created.error).toBe(true);
	const projectId = created.data.projectId;
	const pid = ["--project-id", projectId];
	await run(
		"editor:project:update-settings",
		...pid,
		"--data",
		JSON.stringify({ width: 320, height: 180, fps: FPS })
	);

	const updatedAt = async (): Promise<number> => {
		const listed = await run<{
			projects: Array<{ id: string; updatedAt: string }>;
		}>("editor:project:list");
		const project = listed.data.projects.find((item) => item.id === projectId);
		return Date.parse(project?.updatedAt ?? "");
	};
	const exportTimeline = async (): Promise<Exported> => {
		const exported = await run<Exported>("editor:timeline:export", ...pid);
		expect(exported.ok, exported.error).toBe(true);
		// 问题 10: with --json the timeline is the object at .data.data.
		expect(Array.isArray(exported.data.tracks)).toBe(true);
		return exported.data;
	};

	// --- 问题 4: the open project is the default, and "ready" says so ----------
	const info = await run<{ projectId: string; isActive: boolean }>(
		"editor:project:info"
	);
	expect(info.ok, info.error).toBe(true);
	expect(info.data).toMatchObject({ projectId, isActive: true });
	const opened = await run<{
		navigation: { navigated: boolean };
		readiness: { ready: boolean; opened: boolean; elapsedMs: number };
	}>("editor:navigator:open", ...pid, "--wait-ready");
	expect(opened.ok, opened.error).toBe(true);
	expect(opened.data.navigation.navigated).toBe(true);
	expect(opened.data.readiness).toMatchObject({ ready: true, opened: true });
	note("问题 4 navigator open --wait-ready", opened.data.readiness);

	// --- 问题 3: the project's "last modified" follows its contents -----------
	await page.waitForTimeout(1200);
	const afterSettings = await updatedAt();
	// Opening the project again is not a change.
	await run("editor:navigator:open", ...pid, "--wait-ready");
	await page.waitForTimeout(1500);
	expect(await updatedAt(), "reopening leaves updatedAt alone").toBe(
		afterSettings
	);

	const imported = await run<
		Array<{ success: boolean; mediaFile?: { id: string } }>
	>("editor:media:batch-import", ...pid, "--sources", video);
	expect(imported.ok, imported.error).toBe(true);
	await expect
		.poll(updatedAt, { message: "a media import moves updatedAt" })
		.toBeGreaterThan(afterSettings);
	const afterImport = await updatedAt();
	note(
		"问题 3 updatedAt after media import",
		new Date(afterImport).toISOString()
	);

	// --- 问题 2 + 问题 9: a custom LUT, written without its domain --------------
	const red = flatCube({ size: 2, rgb: [1, 0, 0] });
	const gradedClip = {
		alias: "graded",
		type: "media",
		media: "grey",
		startTime: 0,
		// A manifest's duration is the source's; the trims leave 3 s of it.
		duration: 6,
		trimStart: 0,
		trimEnd: 3,
		name: "01 graded",
		color: {
			enabled: true,
			lut: {
				enabled: true,
				presetId: "custom",
				name: "all red",
				intensity: 100,
				skinProtection: 0,
				cube: red,
			},
		},
	};
	const plainClip = {
		alias: "plain",
		type: "media",
		media: "grey",
		startTime: 3,
		duration: 6,
		trimStart: 3,
		trimEnd: 0,
		name: "02 plain",
	};
	const manifest = {
		media: [{ alias: "grey", path: video }],
		tracks: [
			{
				name: "Main",
				type: "media",
				isMain: true,
				colorLabel: "violet",
				elements: [gradedClip, plainClip],
			},
		],
	};
	const manifestPath = path.join(workDir, "manifest.json");
	writeFileSync(manifestPath, JSON.stringify(manifest));
	await page.waitForTimeout(1200);
	const applied = await run<{
		verified: boolean;
		elements: Record<string, string>;
	}>(
		"editor:timeline:apply",
		...pid,
		"--manifest",
		`@${manifestPath}`,
		"--replace"
	);
	expect(applied.ok, applied.error).toBe(true);
	expect(applied.data.verified).toBe(true);
	await expect
		.poll(updatedAt, { message: "timeline apply moves updatedAt" })
		.toBeGreaterThan(afterImport);
	note(
		"问题 3 updatedAt after timeline apply",
		new Date(await updatedAt()).toISOString()
	);

	const written = await exportTimeline();
	const main = written.tracks.find((track) => track.isMain);
	expect(main?.colorLabel).toBe("violet");
	const graded = main?.elements.find((element) => element.name === "01 graded");
	const storedLut = (graded?.color as { lut: Json & { cube: Json } }).lut;
	expect(storedLut.cube).toEqual({
		...red,
		domainMin: [0, 0, 0],
		domainMax: [1, 1, 1],
	});
	// 问题 9: every field the manifest gave reads back as given; the editor
	// only adds what was left out (the cube's domain, the grade's defaults).
	const colorDifferences = differences({
		expected: gradedClip.color,
		actual: graded?.color,
	});
	note(
		"问题 9 fields of the written grade that read back different",
		colorDifferences
	);
	expect(colorDifferences).toEqual([]);
	const addedKeys = Object.keys(graded?.color as Json).filter(
		(key) => !(key in gradedClip.color)
	);
	note("问题 9 keys the editor added to the grade", addedKeys);

	// The native export applies the LUT (it used to die on `reading 'join'`).
	const gradedOut = path.join(workDir, "graded.mp4");
	const exportRun = await run<Json>(
		"editor:export:start",
		...pid,
		"--engine",
		"native",
		"--output",
		gradedOut,
		"--poll"
	);
	expect(exportRun.ok, exportRun.error).toBe(true);
	const redFrame = meanColor({ file: gradedOut, time: 1 });
	const greyFrame = meanColor({ file: gradedOut, time: 4.5 });
	note("问题 2 exported frame under the LUT (rgb)", redFrame);
	note("问题 2 exported frame without a LUT (rgb)", greyFrame);
	expect(redFrame[0]).toBeGreaterThan(200);
	expect(redFrame[1]).toBeLessThan(60);
	expect(redFrame[2]).toBeLessThan(60);
	for (const channel of greyFrame) {
		expect(Math.abs(channel - 128)).toBeLessThan(12);
	}
	expect(Math.abs(durationOf({ file: gradedOut }) - 6)).toBeLessThan(0.1);

	// Kept behaviour: a ranged export is the range, and still graded.
	const rangeOut = path.join(workDir, "range.mp4");
	const rangeRun = await run<Json>(
		"editor:export:start",
		...pid,
		"--engine",
		"native",
		"--start-time",
		"2",
		"--end-time",
		"4",
		"--output",
		rangeOut,
		"--poll"
	);
	expect(rangeRun.ok, rangeRun.error).toBe(true);
	expect(Math.abs(durationOf({ file: rangeOut }) - 2)).toBeLessThan(0.1);
	expect(meanColor({ file: rangeOut, time: 0.5 })[0]).toBeGreaterThan(200);
	expect(
		Math.abs(meanColor({ file: rangeOut, time: 1.5 })[0] - 128)
	).toBeLessThan(12);
	note(
		"kept: --start-time 2 --end-time 4 export length (s)",
		durationOf({ file: rangeOut })
	);

	// --- 问题 8: a manifest that cannot be applied changes nothing -------------
	const transactionsBefore = await run<{ recent: unknown[] }>(
		"editor:transaction:list"
	);
	const badColorPath = path.join(workDir, "bad-colour.json");
	writeFileSync(
		badColorPath,
		JSON.stringify({
			...manifest,
			tracks: [
				...manifest.tracks,
				{
					name: "调色 · 暗角",
					type: "media",
					colorLabel: "cyan",
					elements: [],
				},
			],
		})
	);
	const refusedAt = Date.now();
	const refused = await run<{ changed: boolean; problems: string[] }>(
		"editor:timeline:apply",
		...pid,
		"--manifest",
		`@${badColorPath}`,
		"--replace"
	);
	expect(refused.ok).toBe(false);
	expect(refused.error).toContain("nothing was changed");
	expect(refused.error).toContain(
		"colorLabel must be one of: violet, blue, green, yellow, red, rose, orange, mango"
	);
	expect(refused.data.changed).toBe(false);
	note(
		"问题 8 refusal",
		`${Date.now() - refusedAt} ms (CLI start-up included): ${refused.error}`
	);
	const transactionsAfter = await run<{ recent: unknown[] }>(
		"editor:transaction:list"
	);
	expect(transactionsAfter.data.recent).toHaveLength(
		transactionsBefore.data.recent.length
	);
	const untouched = await exportTimeline();
	expect(untouched.tracks).toEqual(written.tracks);

	// A cube that does not fill its size is refused the same way.
	const badCubePath = path.join(workDir, "bad-cube.json");
	writeFileSync(
		badCubePath,
		JSON.stringify({
			...manifest,
			tracks: [
				{
					...manifest.tracks[0],
					elements: [
						{
							...gradedClip,
							color: {
								...gradedClip.color,
								lut: {
									...gradedClip.color.lut,
									cube: { size: 3, values: red.values },
								},
							},
						},
					],
				},
			],
		})
	);
	const badCube = await run(
		"editor:timeline:apply",
		...pid,
		"--manifest",
		`@${badCubePath}`,
		"--replace"
	);
	expect(badCube.ok).toBe(false);
	expect(badCube.error).toContain(
		"Element 'graded': color.lut.cube.values must hold 81 numbers (size³ × 3 for size 3); it holds 24"
	);

	// Kept behaviour: an apply the editor refuses part-way is rolled back.
	const unknownMediaPath = path.join(workDir, "unknown-media.json");
	writeFileSync(
		unknownMediaPath,
		JSON.stringify({
			tracks: [
				{
					name: "Main",
					type: "media",
					isMain: true,
					elements: [
						{
							...plainClip,
							media: undefined,
							mediaId: "no-such-media",
							startTime: 0,
						},
					],
				},
				{ name: "Extra", type: "audio", elements: [] },
			],
		})
	);
	const rolled = await run<{ rolledBack: boolean; rollback: Json }>(
		"editor:timeline:apply",
		...pid,
		"--manifest",
		`@${unknownMediaPath}`,
		"--replace"
	);
	expect(rolled.ok).toBe(false);
	expect(rolled.data.rolledBack).toBe(true);
	expect(rolled.data.rollback).toMatchObject({ by: "requested" });
	note(
		"kept: failed apply",
		`${rolled.error} → ${JSON.stringify(rolled.data.rollback)}`
	);
	const restored = await exportTimeline();
	// Not only the same ids: what a rollback restores reads back the same.
	expect(restored.tracks).toEqual(written.tracks);

	// --- 问题 7: blend fields through element patch ----------------------------
	const plain = main?.elements.find((element) => element.name === "02 plain");
	const patched = await run(
		"editor:element:patch",
		...pid,
		"--element-id",
		plain?.id as string,
		"--set",
		JSON.stringify({ blendMode: "overlay", blendEnabled: true, opacity: 0.7 })
	);
	expect(patched.ok, patched.error).toBe(true);
	const unsupported = await run(
		"editor:element:patch",
		...pid,
		"--element-id",
		plain?.id as string,
		"--set",
		JSON.stringify({ wobble: 3 })
	);
	expect(unsupported.ok).toBe(false);
	expect(unsupported.error).toContain("It takes:");
	expect(unsupported.error).toContain("blendMode");

	// --- 问题 5: a LUT from a .cube file onto a whole track ---------------------
	const cubePath = path.join(workDir, "all-blue.cube");
	writeFileSync(
		cubePath,
		[
			'TITLE "All blue"',
			"LUT_3D_SIZE 2",
			...Array.from({ length: 8 }, () => "0 0 1"),
			"",
		].join("\n")
	);
	// A built-in preset is rendered in the LUT's place; setting a LUT takes
	// it off, or the export below would show the preset instead.
	const preset = await run(
		"editor:element:patch",
		...pid,
		"--element-id",
		graded?.id as string,
		"--set",
		JSON.stringify({ color: { filter: { presetId: "vivid", intensity: 100 } } })
	);
	expect(preset.ok, preset.error).toBe(true);
	const lutApplied = await run<{ updated: number }>(
		"editor:element:color",
		...pid,
		"--track-id",
		main?.id as string,
		"--lut-file",
		cubePath,
		"--lut-intensity",
		"100"
	);
	expect(lutApplied.ok, lutApplied.error).toBe(true);
	expect(lutApplied.data.updated).toBe(2);

	const afterEdits = await exportTimeline();
	const mainAfter = afterEdits.tracks.find((track) => track.isMain);
	const plainAfter = mainAfter?.elements.find(
		(element) => element.name === "02 plain"
	);
	expect(plainAfter).toMatchObject({
		blendMode: "overlay",
		blendEnabled: true,
		opacity: 0.7,
	});
	for (const element of mainAfter?.elements ?? []) {
		expect(
			(element.color as { filter: { presetId: string } }).filter.presetId
		).toBe("none");
		expect((element.color as { lut: Json }).lut).toMatchObject({
			enabled: true,
			presetId: "custom",
			name: "All blue",
			intensity: 100,
			cube: {
				size: 2,
				domainMin: [0, 0, 0],
				domainMax: [1, 1, 1],
				values: flatCube({ size: 2, rgb: [0, 0, 1] }).values,
			},
		});
	}

	const blueOut = path.join(workDir, "blue.mp4");
	const blueRun = await run(
		"editor:export:start",
		...pid,
		"--engine",
		"native",
		"--start-time",
		"0",
		"--end-time",
		"2",
		"--output",
		blueOut,
		"--poll"
	);
	expect(blueRun.ok, blueRun.error).toBe(true);
	const blueFrame = meanColor({ file: blueOut, time: 1 });
	note("问题 5 exported frame under --lut-file (rgb)", blueFrame);
	expect(blueFrame[2]).toBeGreaterThan(200);
	expect(blueFrame[0]).toBeLessThan(60);

	const cleared = await run<{ updated: number }>(
		"editor:element:color",
		...pid,
		"--track-id",
		main?.id as string,
		"--lut-clear"
	);
	expect(cleared.ok, cleared.error).toBe(true);
	const afterClear = await exportTimeline();
	for (const element of afterClear.tracks.find((track) => track.isMain)
		?.elements ?? []) {
		const lut = (element.color as { lut: Json }).lut;
		expect(lut.enabled).toBe(false);
		expect(lut.cube ?? null).toBeNull();
	}

	// --- 问题 6: one LUT for a stretch of the programme, stored once -----------
	// An adjustment layer grades every track under it for its duration, so a
	// LUT on one layer does what a copy of it on every clip did.
	const layer = await run<{ elementId: string }>(
		"editor:timeline:add-element",
		...pid,
		"--data",
		JSON.stringify({ type: "adjustment", startTime: 0, duration: 2 })
	);
	expect(layer.ok, layer.error).toBe(true);
	const layerGraded = await run<{ updated: number }>(
		"editor:element:color",
		...pid,
		"--element-id",
		layer.data.elementId,
		"--lut-file",
		cubePath
	);
	expect(layerGraded.ok, layerGraded.error).toBe(true);
	const layerOut = path.join(workDir, "layer.mp4");
	const layerRun = await run(
		"editor:export:start",
		...pid,
		"--engine",
		"native",
		"--start-time",
		"0",
		"--end-time",
		"3",
		"--output",
		layerOut,
		"--poll"
	);
	expect(layerRun.ok, layerRun.error).toBe(true);
	const underLayer = meanColor({ file: layerOut, time: 1 });
	// Still the first clip: the second one is at 70 % opacity since 问题 7.
	const pastLayer = meanColor({ file: layerOut, time: 2.5 });
	note("问题 6 frame under an adjustment layer with the LUT (rgb)", underLayer);
	note("问题 6 frame after the layer ends (rgb)", pastLayer);
	expect(underLayer[2]).toBeGreaterThan(200);
	expect(underLayer[0]).toBeLessThan(60);
	expect(Math.abs(pastLayer[0] - 128)).toBeLessThan(12);

	console.log(`[qcut-1114]\n${notes.join("\n")}`);
});
