/**
 * `editor beats mark` and `editor timeline snap --to beats` on a real music
 * cue: the tempo lands near the reference, the beats go into the editor's
 * beat store with bookmarks, and clips snap onto them with the moves
 * reported. Needs the drill's trailer cue; skips where it is missing.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";
import { localFixturePath } from "./helpers/local-fixtures";

const MUSIC = localFixturePath("QCUT_BEATS_E2E_SOURCE");
/** The cue's tempo by an independent spectral-flux autocorrelation. */
const REFERENCE_BPM = 144;

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
	tracks: Array<{
		id: string;
		type: string;
		elements: Array<{ id: string; startTime: number; content?: string }>;
	}>;
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
	const snapped = await run<{
		moved: number;
		results: Array<{
			elementId: string;
			from: number;
			to: number;
			moved: number;
			beat: number | null;
			applied: boolean;
		}>;
	}>(
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
	for (const result of snapped.results) {
		if (!result.applied) continue;
		expect(Math.abs(result.moved)).toBeLessThanOrEqual(0.5);
		expect(beatTimes.some((beat) => Math.abs(beat - result.to) < 1e-6)).toBe(
			true
		);
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
});
