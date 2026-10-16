/**
 * `editor timeline shot-split` on a real AI-generated clip whose cuts the
 * Jianying shot-split model finds and FFmpeg's scene filter mostly misses.
 * Needs this machine's private runtime and native bridge; the spec skips
 * itself where `editor analyze engines` says the jianying engine is unavailable.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const SOURCE =
	"/Users/peter/Documents/QCut/Projects/481632c1-df20-4317-8c79-041922c3ab50/media/08_机甲滑索接战三种怪物.mp4";
/** The model's cuts for this clip, verified frame by frame (source seconds). */
const EXPECTED_CUTS = [
	3.333, 4.125, 5.208, 7.833, 15.167, 15.833, 16.917, 21.5, 25.333,
];

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

interface ShotSplitResponse {
	results: Array<{
		elementId: string;
		engine?: string;
		requestedEngine: string;
		fallbacks?: Array<{ engine: string; reason: string }>;
		dryRun: boolean;
		cuts: Array<{ sourceTime: number; timelineTime: number }>;
		skipped: Array<{ reason: string }>;
		createdElementIds: string[];
		elementIds: string[];
	}>;
	failed: Array<{ elementId: string; error: string }>;
}

interface Exported {
	tracks: Array<{
		id: string;
		elements: Array<{
			id: string;
			type: string;
			startTime: number;
			duration: number;
			trimStart: number;
			trimEnd: number;
		}>;
	}>;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(420_000);

test("splits a clip by its shots the way the menu does, undoable in one step", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(SOURCE), "the 门的计划 clip is not on this machine");
	await page.waitForLoadState("domcontentloaded");

	const engines = await cli<{
		engines: Array<{ engine: string; available: boolean; message: string }>;
		preferred: string | null;
	}>({
		apiPort,
		args: ["editor:analyze:engines"],
	});
	const jianying = engines.engines.find((entry) => entry.engine === "jianying");
	test.skip(
		!jianying?.available,
		`jianying engine unavailable: ${jianying?.message}`
	);
	expect(engines.preferred).toBe("jianying");

	const { projectId } = await cli<{ projectId: string }>({
		apiPort,
		args: ["editor:project:create", "--name", "Shot split", "--open"],
	});
	const { tracks } = await cli<{
		tracks: Array<{ id: string; isMain?: boolean }>;
	}>({
		apiPort,
		args: ["editor:track:list", "--project-id", projectId],
	});
	const mainId = tracks.find((track) => track.isMain)?.id as string;
	await cli({
		apiPort,
		args: [
			"editor:media:batch-import",
			"--project-id",
			projectId,
			"--sources",
			SOURCE,
			"--append-to-track",
			mainId,
		],
	});
	const before = await cli<Exported>({
		apiPort,
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	const clip = before.tracks.find((track) => track.id === mainId)?.elements[0];
	if (!clip) throw new Error("clip not placed");
	const fps = 24;

	// A1: a dry run plans the model's nine cuts and changes nothing.
	const planned = await cli<ShotSplitResponse>({
		apiPort,
		args: [
			"editor:timeline:shot-split",
			"--project-id",
			projectId,
			"--element-id",
			clip.id,
			"--engine",
			"jianying",
			"--dry-run",
		],
	});
	expect(planned.failed).toEqual([]);
	const plan = planned.results[0];
	expect(plan.engine).toBe("jianying");
	expect(plan.dryRun).toBe(true);
	// The engine reports whole frames (80/24 = 3.333333…); the doc lists them
	// rounded to milliseconds.
	expect(plan.cuts.map((cut) => Number(cut.sourceTime.toFixed(3)))).toEqual(
		EXPECTED_CUTS
	);
	for (const cut of plan.cuts) {
		// Source and timeline times both sit on frames (reported to 6 decimals,
		// so 3.333333 × 24 misses 80 by a few millionths of a frame).
		for (const time of [cut.sourceTime, cut.timelineTime]) {
			expect(Math.abs(time * fps - Math.round(time * fps))).toBeLessThan(1e-3);
		}
	}
	expect(plan.createdElementIds).toEqual([]);
	const afterDry = await cli<Exported>({
		apiPort,
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	expect(
		afterDry.tracks.find((track) => track.id === mainId)?.elements
	).toHaveLength(1);

	// A4: auto picks the same engine and the same cuts.
	const auto = await cli<ShotSplitResponse>({
		apiPort,
		args: [
			"editor:timeline:shot-split",
			"--project-id",
			projectId,
			"--element-id",
			clip.id,
			"--dry-run",
		],
	});
	expect(auto.results[0].engine).toBe("jianying");
	expect(auto.results[0].cuts).toEqual(plan.cuts);

	// A2: the real split makes ten contiguous clips with the same total length.
	const split = await cli<ShotSplitResponse>({
		apiPort,
		args: [
			"editor:timeline:shot-split",
			"--project-id",
			projectId,
			"--element-id",
			clip.id,
			"--engine",
			"jianying",
		],
	});
	const result = split.results[0];
	expect(result.createdElementIds).toHaveLength(9);
	expect(result.elementIds).toHaveLength(10);
	const after = await cli<Exported>({
		apiPort,
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	const pieces = (
		after.tracks.find((track) => track.id === mainId)?.elements ?? []
	)
		.slice()
		.sort((left, right) => left.startTime - right.startTime);
	expect(pieces).toHaveLength(10);
	// The snapshot's `duration` is already the trimmed, on-timeline length.
	const visible = (element: Exported["tracks"][number]["elements"][number]) =>
		element.duration;
	for (let index = 1; index < pieces.length; index += 1) {
		const previous = pieces[index - 1];
		expect(
			Math.abs(previous.startTime + visible(previous) - pieces[index].startTime)
		).toBeLessThan(1e-6);
	}
	const total = pieces.reduce((sum, element) => sum + visible(element), 0);
	expect(Math.abs(total - visible(clip))).toBeLessThan(1e-6);
	expect(pieces.map((element) => element.startTime).slice(1)).toEqual(
		plan.cuts.map((cut) => cut.timelineTime)
	);

	// A3: one undo in the editor brings the single clip back.
	await page.keyboard.press(
		process.platform === "darwin" ? "Meta+z" : "Control+z"
	);
	await expect
		.poll(
			async () => {
				const exported = await cli<Exported>({
					apiPort,
					args: ["editor:timeline:export", "--project-id", projectId],
				});
				return exported.tracks.find((track) => track.id === mainId)?.elements
					.length;
			},
			{ timeout: 15_000 }
		)
		.toBe(1);

	// A5: given cut points cut exactly there, nothing detected.
	const restored = await cli<Exported>({
		apiPort,
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	const restoredClip = restored.tracks.find((track) => track.id === mainId)
		?.elements[0];
	if (!restoredClip) throw new Error("clip not restored");
	const given = await cli<ShotSplitResponse>({
		apiPort,
		args: [
			"editor:timeline:shot-split",
			"--project-id",
			projectId,
			"--element-id",
			restoredClip.id,
			"--cuts",
			"3.333,15.167",
		],
	});
	expect(given.results[0].requestedEngine).toBe("manual");
	expect(given.results[0].engine).toBe("manual");
	// Given seconds land on the frame grid: 3.333 → frame 80, 15.167 → 364.
	expect(given.results[0].cuts.map((cut) => cut.sourceTime)).toEqual([
		80 / 24,
		364 / 24,
	]);
	expect(given.results[0].createdElementIds).toHaveLength(2);
	const afterGiven = await cli<Exported>({
		apiPort,
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	expect(
		afterGiven.tracks.find((track) => track.id === mainId)?.elements
	).toHaveLength(3);

	// A6: a whole track, with a minimum shot length; single-shot clips are reported, not cut.
	const track = await cli<ShotSplitResponse>({
		apiPort,
		args: [
			"editor:timeline:shot-split",
			"--project-id",
			projectId,
			"--track-id",
			mainId,
			"--engine",
			"jianying",
			"--min-shot",
			"2",
		],
	});
	expect(track.failed).toEqual([]);
	expect(track.results).toHaveLength(3);
	expect(track.results.every((entry) => entry.engine === "jianying")).toBe(
		true
	);
	const created = track.results.reduce(
		(sum, entry) => sum + entry.createdElementIds.length,
		0
	);
	expect(created).toBeGreaterThan(0);
	const skipped = track.results.flatMap((entry) =>
		entry.skipped.map((skip) => skip.reason)
	);
	expect(skipped.some((reason) => reason.includes("shorter than 2 s"))).toBe(
		true
	);
	const afterTrack = await cli<Exported>({
		apiPort,
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	expect(afterTrack.tracks.find((t) => t.id === mainId)?.elements).toHaveLength(
		3 + created
	);

	// The ffmpeg engine runs too, with its threshold, and says so.
	const ffmpeg = await cli<ShotSplitResponse>({
		apiPort,
		args: [
			"editor:timeline:shot-split",
			"--project-id",
			projectId,
			"--element-id",
			afterTrack.tracks.find((t) => t.id === mainId)!.elements[0].id,
			"--engine",
			"ffmpeg",
			"--threshold",
			"0.3",
			"--dry-run",
		],
	});
	expect(ffmpeg.results[0].engine).toBe("ffmpeg");
	execFileSync("true");
});
