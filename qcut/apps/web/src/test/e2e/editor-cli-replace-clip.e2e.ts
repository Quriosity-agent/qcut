/**
 * N17 and N18 (2026-10-28 trailer report): replacing a main-track clip in
 * place through the CLI, on a project of its own.
 *
 * - A batch delete without `--ripple` keeps the gap, on the main track too
 *   (the magnet closed it), and still takes the `--cuts` name the docs gave.
 * - A single `add-element` honours `"collision"` (it ignored it).
 * - `editor:undo` says which step it took back and what that changed, and
 *   fails when nothing was undone (it printed ok).
 * - A ripple delete on the main track leaves an unlinked sound-effect track
 *   exactly as it was (two effects that overlapped by a few milliseconds
 *   moved by 4 and 16 ms).
 * - So do a batch delete of several main-track clips and a batch-add insert
 *   with no undo at all (v14: on 2701 the delete closed its gap through the
 *   magnet's ripple, which re-resolved the overlaps of every track).
 * - N20: where a clip ends a rounding error after the next one starts (v17),
 *   a clip put back into the gap it left moves nothing, and ripple deletes
 *   still close their gaps.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");

interface Timeline {
	tracks: Array<{
		id: string;
		isMain?: boolean;
		elements: Array<{ id: string; name?: string; startTime: number }>;
	}>;
}

interface UndoAnswer {
	applied: boolean;
	label?: string;
	changes?: {
		added: number;
		removed: number;
		moved: number;
		elements: Array<{
			elementId: string;
			change: string;
			startTime: number;
			from?: { startTime: number };
		}>;
	};
}

function qcut({ apiPort, args }: { apiPort: number; args: string[] }) {
	const child = spawnSync(
		"bun",
		["--silent", "run", "qcut", "--", ...args, "--json", "--flat"],
		{
			cwd: path.resolve("."),
			env: { ...process.env, QCUT_API_PORT: String(apiPort) },
			maxBuffer: 32 * 1024 * 1024,
			timeout: 300_000,
			encoding: "utf8",
		}
	);
	return {
		status: child.status,
		output: `${child.stdout}\n${child.stderr}`,
		stdout: child.stdout.trimEnd(),
	};
}

function cli<T>({ apiPort, args }: { apiPort: number; args: string[] }): T {
	const run = qcut({ apiPort, args });
	if (run.status !== 0) {
		throw new Error(`${args[0]} failed: ${run.output}`);
	}
	return JSON.parse(run.stdout.slice(run.stdout.lastIndexOf("\n{") + 1)) as T;
}

function makeClip({ file, color }: { file: string; color: string }): void {
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=${color}:s=320x180:r=30:d=2`,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=2",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-shortest",
		file,
	]);
}

function makeHit({ file }: { file: string }): void {
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=880:duration=0.5",
		file,
	]);
}

/** Leaves the editor first, so no empty Untitled Project is left behind. */
async function deleteProject({
	apiPort,
	page,
	projectId,
}: {
	apiPort: number;
	page: Page;
	projectId: string;
}): Promise<void> {
	await page.evaluate(() => {
		window.location.hash = "#/projects";
	});
	await page.waitForTimeout(1000);
	qcut({
		apiPort,
		args: ["editor:project:delete", "--project-id", projectId, "--force"],
	});
	const folder = path.join(
		homedir(),
		"Documents",
		"QCut",
		"Projects",
		projectId
	);
	if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
}

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(600_000);

test("a main-track clip is replaced in place, and undo says what it took back", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-replace-clip-"));
	const { projectId } = run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Replace clip in place (delete me)",
		"--open"
	);
	const pid = ["--project-id", projectId];
	const timeline = () => run<Timeline>("editor:timeline:export", ...pid);
	try {
		run(
			"editor:project:update-settings",
			...pid,
			"--data",
			JSON.stringify({ width: 320, height: 180, fps: 30 })
		);
		const clips = ["red", "green", "blue"].map((color) => {
			const file = path.join(workDir, `${color}.mp4`);
			makeClip({ file, color });
			return file;
		});
		const sfx = path.join(workDir, "hit.wav");
		makeHit({ file: sfx });
		const mainId = run<Timeline>("editor:track:list", ...pid).tracks.find(
			(track) => track.isMain
		)?.id as string;
		run(
			"editor:media:batch-import",
			...pid,
			"--sources",
			clips.join(","),
			"--append-to-track",
			mainId
		);
		run("editor:media:batch-import", ...pid, "--sources", sfx);
		const sfxTrack = run<{ trackId: string }>(
			"editor:track:create",
			...pid,
			"--type",
			"audio",
			"--name",
			"音效 1"
		).trackId;
		// Pairs that overlap by less than half a frame, which a placement
		// allows: the report's two effects were like that.
		run(
			"editor:timeline:batch-add",
			...pid,
			"--elements",
			JSON.stringify(
				[3, 3.488, 5, 5.496].map((startTime) => ({
					type: "media",
					sourceName: "hit.wav",
					trackId: sfxTrack,
					startTime,
					duration: 0.5,
				}))
			)
		);
		const starts = (trackId: string) =>
			timeline()
				.tracks.find((track) => track.id === trackId)
				?.elements.map((element) => element.startTime)
				.sort((left, right) => left - right);
		const before = timeline();
		const main = before.tracks
			.find((track) => track.id === mainId)
			?.elements.sort((left, right) => left.startTime - right.startTime);
		expect(main?.map((element) => element.startTime)).toEqual([0, 2, 4]);
		const sfxStarts = starts(sfxTrack);
		expect(sfxStarts).toEqual([3, 3.488, 5, 5.496]);
		const middle = main?.[1].id as string;
		const cut = JSON.stringify([{ trackId: mainId, elementId: middle }]);

		// N17: the name the docs gave, and no ripple: the gap stays.
		run("editor:timeline:batch-delete", ...pid, "--cuts", cut, "--force");
		expect(starts(mainId)).toEqual([0, 4]);
		expect(starts(sfxTrack)).toEqual(sfxStarts);

		// N18: the undo takes back that delete and says so.
		const undone = run<UndoAnswer>("editor:undo", ...pid, "--force");
		expect(undone).toMatchObject({
			applied: true,
			label: "Edit",
			changes: { added: 1, removed: 0, moved: 0 },
		});
		expect(undone.changes?.elements).toEqual([
			expect.objectContaining({
				elementId: middle,
				change: "added",
				startTime: 2,
			}),
		]);
		expect(starts(mainId)).toEqual([0, 2, 4]);

		// A ripple delete moves the main track only.
		run(
			"editor:timeline:batch-delete",
			...pid,
			"--elements",
			cut,
			"--ripple",
			"--force"
		);
		expect(starts(mainId)).toEqual([0, 2]);
		expect(starts(sfxTrack)).toEqual(sfxStarts);
		const rippleUndone = run<UndoAnswer>("editor:undo", ...pid, "--force");
		expect(rippleUndone.changes).toMatchObject({
			added: 1,
			removed: 0,
			moved: 1,
		});
		expect(rippleUndone.changes?.elements).toContainEqual(
			expect.objectContaining({
				change: "moved",
				startTime: 4,
				from: expect.objectContaining({ startTime: 2 }),
			})
		);
		expect(starts(mainId)).toEqual([0, 2, 4]);
		expect(starts(sfxTrack)).toEqual(sfxStarts);

		// N17: a single add honours "collision".
		const replacement = {
			type: "media",
			sourceName: "red.mp4",
			trackId: mainId,
			startTime: 2,
			duration: 2,
		};
		const refused = qcut({
			apiPort,
			args: [
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify(replacement),
			],
		});
		expect(refused.status, "an occupied span is refused").not.toBe(0);
		const unknown = qcut({
			apiPort,
			args: [
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify({ ...replacement, collision: "squeeze" }),
			],
		});
		expect(unknown.status).not.toBe(0);
		expect(unknown.output).toContain(
			"collision must be one of: reject, insert, overwrite"
		);
		run(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({ ...replacement, collision: "insert" })
		);
		expect(starts(mainId)).toEqual([0, 2, 4, 6]);

		// N18: with nothing left to take back, the undo fails and says so.
		let last = qcut({ apiPort, args: ["editor:undo", ...pid, "--force"] });
		for (let step = 0; step < 40 && last.status === 0; step++) {
			last = qcut({ apiPort, args: ["editor:undo", ...pid, "--force"] });
		}
		expect(last.status, "an undo with nothing to take back").not.toBe(0);
		expect(last.output).toContain("Nothing to undo: the undo history is empty");
	} finally {
		await deleteProject({ apiPort, page, projectId });
		rmSync(workDir, { recursive: true, force: true });
	}
});

test("a main-track batch delete and insert leave the sound effects where they were", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-delete-insert-"));
	const { projectId } = run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Delete and insert (delete me)",
		"--open"
	);
	const pid = ["--project-id", projectId];
	const starts = (trackId: string) =>
		run<Timeline>("editor:timeline:export", ...pid)
			.tracks.find((track) => track.id === trackId)
			?.elements.map((element) => element.startTime)
			.sort((left, right) => left - right);
	try {
		run(
			"editor:project:update-settings",
			...pid,
			"--data",
			JSON.stringify({ width: 320, height: 180, fps: 30 })
		);
		const clip = path.join(workDir, "red.mp4");
		makeClip({ file: clip, color: "red" });
		const hit = path.join(workDir, "hit.wav");
		makeHit({ file: hit });
		run("editor:media:batch-import", ...pid, "--sources", `${clip},${hit}`);
		const mainId = run<Timeline>("editor:track:list", ...pid).tracks.find(
			(track) => track.isMain
		)?.id as string;
		const sfxTrack = run<{ trackId: string }>(
			"editor:track:create",
			...pid,
			"--type",
			"audio",
			"--name",
			"音效 1"
		).trackId;
		const place = (
			trackId: string,
			sourceName: string,
			duration: number,
			startTimes: number[]
		) =>
			startTimes.map((startTime) => ({
				type: "media",
				sourceName,
				trackId,
				startTime,
				duration,
			}));
		run(
			"editor:timeline:batch-add",
			...pid,
			"--elements",
			JSON.stringify([
				...place(mainId, "red.mp4", 2, [0, 2, 4, 6, 8, 10, 12, 14]),
				// Overlapping by 16 and 4 ms, as the report's two effects did.
				...place(sfxTrack, "hit.wav", 0.5, [1, 1.484, 3, 3.496]),
			])
		);
		const sfxStarts = [1, 1.484, 3, 3.496];
		expect(starts(sfxTrack)).toEqual(sfxStarts);

		// Five clips in the middle, without --ripple: the gap stays.
		const main = run<Timeline>("editor:timeline:export", ...pid).tracks.find(
			(track) => track.id === mainId
		);
		const middle = (main?.elements ?? [])
			.filter((element) => element.startTime >= 4 && element.startTime < 14)
			.map((element) => ({ trackId: mainId, elementId: element.id }));
		expect(middle).toHaveLength(5);
		run(
			"editor:timeline:batch-delete",
			...pid,
			"--elements",
			JSON.stringify(middle),
			"--force"
		);
		expect(starts(sfxTrack)).toEqual(sfxStarts);
		expect(starts(mainId)).toEqual([0, 2, 14]);

		// An insert splits the clip at 14 s and moves its second half on.
		run(
			"editor:timeline:batch-add",
			...pid,
			"--elements",
			JSON.stringify([
				{ ...place(mainId, "red.mp4", 2, [15])[0], collision: "insert" },
			])
		);
		expect(starts(sfxTrack)).toEqual(sfxStarts);
		expect(starts(mainId)).toEqual([0, 2, 14, 15, 17]);
	} finally {
		await deleteProject({ apiPort, page, projectId });
		rmSync(workDir, { recursive: true, force: true });
	}
});

// N20 (2026-10-29 trailer report): on v17's main track 105 ended 0.1 ms after
// 106 started. The delete kept its gap, as one without --ripple does, and the
// replacement put back into the gap pushed the 30 clips after it right by its
// whole length. On that seam a ripple delete, the magnet's included, left the
// gap open.
test("a clip put back into its gap moves nothing, and ripple deletes close the gaps", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-seams-"));
	const { projectId } = run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Seams (delete me)",
		"--open"
	);
	const pid = ["--project-id", projectId];
	const track = (trackId: string) =>
		run<Timeline>("editor:timeline:export", ...pid).tracks.find(
			(candidate) => candidate.id === trackId
		);
	// In the export's own order, which is time order.
	const starts = (trackId: string) =>
		track(trackId)?.elements.map((element) =>
			Number(element.startTime.toFixed(4))
		);
	const idAt = (trackId: string, startTime: number) =>
		track(trackId)?.elements.find(
			(element) => Number(element.startTime.toFixed(4)) === startTime
		)?.id as string;
	try {
		run(
			"editor:project:update-settings",
			...pid,
			"--data",
			JSON.stringify({ width: 320, height: 180, fps: 24 })
		);
		const clips = ["red", "green", "blue"].map((color) => {
			const file = path.join(workDir, `${color}.mp4`);
			makeClip({ file, color });
			return file;
		});
		const hit = path.join(workDir, "hit.wav");
		makeHit({ file: hit });
		run(
			"editor:media:batch-import",
			...pid,
			"--sources",
			[...clips, hit].join(",")
		);
		const mainId = run<Timeline>("editor:track:list", ...pid).tracks.find(
			(candidate) => candidate.isMain
		)?.id as string;
		const sfxTrack = run<{ trackId: string }>(
			"editor:track:create",
			...pid,
			"--type",
			"audio",
			"--name",
			"音效 1"
		).trackId;
		const clip = (sourceName: string, startTime: number) => ({
			type: "media",
			sourceName,
			trackId: mainId,
			startTime,
			duration: 1.2917,
		});
		// 105 ends at 2.5834 and 107 at 5.1667, 0.1 ms after 106 and 108 start.
		run(
			"editor:timeline:batch-add",
			...pid,
			"--elements",
			JSON.stringify([
				clip("red.mp4", 0),
				clip("green.mp4", 1.2917),
				clip("blue.mp4", 2.5833),
				clip("red.mp4", 3.875),
				clip("green.mp4", 5.1666),
				{
					type: "media",
					sourceName: "hit.wav",
					trackId: sfxTrack,
					startTime: 3,
					duration: 0.5,
				},
			])
		);
		expect(starts(mainId)).toEqual([0, 1.2917, 2.5833, 3.875, 5.1666]);

		// Without --ripple the gap stays (plain ids, as replace_main_clip.py
		// gives them).
		run(
			"editor:timeline:batch-delete",
			...pid,
			"--elements",
			JSON.stringify([idAt(mainId, 1.2917)]),
			"--force"
		);
		expect(starts(mainId)).toEqual([0, 2.5833, 3.875, 5.1666]);

		// The replacement is 0.1 ms longer than the gap: nothing moves, and
		// the export lists it second, where it is, not last.
		run(
			"editor:timeline:batch-add",
			...pid,
			"--elements",
			JSON.stringify([{ ...clip("blue.mp4", 1.2917), collision: "insert" }])
		);
		expect(starts(mainId)).toEqual([0, 1.2917, 2.5833, 3.875, 5.1666]);

		// A ripple delete closes its gap across the seam after it.
		run(
			"editor:timeline:batch-delete",
			...pid,
			"--elements",
			JSON.stringify([idAt(mainId, 3.875)]),
			"--ripple",
			"--force"
		);
		expect(starts(mainId)).toEqual([0, 1.2917, 2.5833, 3.8749]);

		// So does a single delete on the main track, through the magnet.
		run(
			"editor:timeline:delete-element",
			...pid,
			"--element-id",
			idAt(mainId, 1.2917),
			"--force"
		);
		expect(starts(mainId)).toEqual([0, 1.2916, 2.5832]);
		expect(starts(sfxTrack)).toEqual([3]);
	} finally {
		await deleteProject({ apiPort, page, projectId });
		rmSync(workDir, { recursive: true, force: true });
	}
});
