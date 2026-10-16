/**
 * `editor beats mark` and `editor timeline snap --to beats` on a real music
 * cue: the tempo lands near the reference, the beats go into the editor's
 * beat store with bookmarks, and clips snap onto them with the moves
 * reported. Needs the drill's trailer cue; skips where it is missing.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";
import { localFixturePath } from "./helpers/local-fixtures";

const MUSIC = localFixturePath("QCUT_BEATS_E2E_SOURCE");
/** The cue's tempo by an independent spectral-flux autocorrelation. */
const REFERENCE_BPM = 144;
const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
/** A sound effect whose attack sits this far into its file. */
const SFX_ATTACK = 0.3;

/** Silence, then a short 880 Hz hit: an effect whose attack is not at its start. */
function makeSfx(): string {
	const directory = path.resolve("output/playwright/beats-mark-snap");
	mkdirSync(directory, { recursive: true });
	const file = path.join(directory, "late-hit.wav");
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`aevalsrc=0:d=${SFX_ATTACK}`,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=880:duration=0.25",
		"-filter_complex",
		"[0:a][1:a]concat=n=2:v=0:a=1[a]",
		"-map",
		"[a]",
		"-ar",
		"48000",
		file,
	]);
	return file;
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
				maxBuffer: 32 * 1024 * 1024,
				timeout: 300_000,
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`${args[0]} failed: ${stdout}\n${stderr}`));
					return;
				}
				const last = stdout.trimEnd().lastIndexOf("\n{");
				resolve(JSON.parse(stdout.slice(last + 1)) as T);
			}
		);
	});
}

interface Exported {
	fps?: number;
	tracks: Array<{
		id: string;
		type: string;
		elements: Array<{ id: string; startTime: number; content?: string }>;
	}>;
}

interface Snapped {
	moved: number;
	results: Array<{
		elementId: string;
		from: number;
		to: number;
		moved: number;
		beat: number | null;
		offset?: number;
		frameAligned?: boolean;
		applied: boolean;
	}>;
	onsets?: Record<string, { sourceTime: number | null; offset?: number }>;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(420_000);

test("beats are marked from a music cue and clips snap onto them", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(MUSIC), "the drill's music cue is not on this machine");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });

	const { projectId } = await run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Beats",
		"--open"
	);
	const pid = ["--project-id", projectId];
	const music = await run<{ trackId: string }>(
		"editor:track:create",
		...pid,
		"--type",
		"audio",
		"--name",
		"Music"
	);
	await run(
		"editor:media:batch-import",
		...pid,
		"--sources",
		MUSIC,
		"--append-to-track",
		music.trackId
	);
	const exported = await run<Exported>("editor:timeline:export", ...pid);
	const song = exported.tracks.find((t) => t.id === music.trackId)?.elements[0];
	if (!song) throw new Error("music not placed");

	// B1: the tempo comes from the cue's periodicity, near the reference.
	const marked = await run<{
		bpm: number;
		confidence: number;
		onTimeline: number;
		bookmarksAdded: number;
		beats: Array<{ timelineTime: number | null; isDownbeat: boolean }>;
	}>(
		"editor:beats:mark",
		...pid,
		"--element-id",
		song.id,
		"--bookmarks",
		"downbeats"
	);
	expect(Math.abs(marked.bpm - REFERENCE_BPM)).toBeLessThan(3);
	expect(marked.confidence).toBeGreaterThan(0.5);
	expect(marked.onTimeline).toBeGreaterThan(100);
	expect(marked.bookmarksAdded).toBeGreaterThan(10);
	const beatTimes = marked.beats
		.map((beat) => beat.timelineTime)
		.filter((time): time is number => time !== null);

	// B2: clips snap onto the nearest beat and say how far they moved.
	const titles = await run<{ trackId: string }>(
		"editor:track:create",
		...pid,
		"--type",
		"text",
		"--name",
		"Titles"
	);
	const starts = [4.2, 6.33, 9.05];
	for (const [index, startTime] of starts.entries()) {
		await run(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "text",
				trackId: titles.trackId,
				content: `Cut ${index + 1}`,
				startTime,
				duration: 1,
			})
		);
	}
	const before = await run<Exported>("editor:timeline:export", ...pid);
	const cuts =
		before.tracks.find((t) => t.id === titles.trackId)?.elements ?? [];
	expect(cuts).toHaveLength(3);
	const snapped = await run<Snapped>(
		"editor:timeline:snap",
		...pid,
		"--to",
		"beats",
		"--element-ids",
		cuts.map((cut) => cut.id).join(","),
		"--beats-from",
		song.id
	);
	expect(snapped.moved).toBeGreaterThanOrEqual(2);
	// Titles are visual: they land on the frame nearest the beat.
	const fps = before.fps ?? 30;
	for (const result of snapped.results) {
		if (!result.applied) continue;
		expect(Math.abs(result.moved)).toBeLessThanOrEqual(0.5 + 0.5 / fps);
		expect(result.frameAligned).toBe(true);
		expect(
			Math.abs(result.to * fps - Math.round(result.to * fps))
		).toBeLessThan(1e-6);
		expect(
			beatTimes.some((beat) => Math.abs(beat - result.to) <= 0.5 / fps + 1e-6)
		).toBe(true);
	}
	const after = await run<Exported>("editor:timeline:export", ...pid);
	const afterCuts =
		after.tracks.find((t) => t.id === titles.trackId)?.elements ?? [];
	for (const result of snapped.results) {
		const cut = afterCuts.find((element) => element.id === result.elementId);
		expect(cut?.startTime).toBeCloseTo(
			result.applied ? result.to : result.from,
			6
		);
	}

	// --edge onset: a sound effect's attack, 0.3 s into its file, lands on the
	// beat; sound is not frame-aligned, so the start is exactly beat − offset.
	const effects = await run<{ trackId: string }>(
		"editor:track:create",
		...pid,
		"--type",
		"audio",
		"--name",
		"SFX"
	);
	await run(
		"editor:media:batch-import",
		...pid,
		"--sources",
		makeSfx(),
		"--append-to-track",
		effects.trackId
	);
	const placed = await run<Exported>("editor:timeline:export", ...pid);
	const sfx = placed.tracks.find((t) => t.id === effects.trackId)?.elements[0];
	if (!sfx) throw new Error("effect not placed");
	await run(
		"editor:timeline:move",
		...pid,
		"--element-id",
		sfx.id,
		"--time",
		"20.1"
	);
	const onBeat = await run<Snapped>(
		"editor:timeline:snap",
		...pid,
		"--to",
		"beats",
		"--element-ids",
		sfx.id,
		"--beats-from",
		song.id,
		"--edge",
		"onset",
		"--max-distance",
		"1"
	);
	const [hit] = onBeat.results;
	expect(hit.applied).toBe(true);
	expect(hit.frameAligned).toBe(false);
	expect(Math.abs((hit.offset ?? 0) - SFX_ATTACK)).toBeLessThan(0.04);
	expect(Math.abs(hit.to + (hit.offset ?? 0) - (hit.beat ?? 0))).toBeLessThan(
		1e-6
	);
	expect(
		Math.abs((onBeat.onsets?.[sfx.id]?.sourceTime ?? 0) - SFX_ATTACK)
	).toBeLessThan(0.04);
});
