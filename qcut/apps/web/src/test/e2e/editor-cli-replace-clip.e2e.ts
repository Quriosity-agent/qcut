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
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
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
		execFileSync(FFMPEG, [
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=880:duration=0.5",
			sfx,
		]);
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
		await page.evaluate(() => {
			window.location.hash = "#/projects";
		});
		await page.waitForTimeout(1000);
		qcut({
			apiPort,
			args: ["editor:project:delete", ...pid, "--force"],
		});
		const folder = path.join(
			homedir(),
			"Documents",
			"QCut",
			"Projects",
			projectId
		);
		if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
		rmSync(workDir, { recursive: true, force: true });
	}
});
