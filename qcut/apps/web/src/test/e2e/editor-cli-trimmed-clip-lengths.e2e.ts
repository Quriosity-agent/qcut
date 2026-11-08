/**
 * The 2026-11-08 report (兽族版开场, QCut 2026.11.06.1), through the real CLI
 * on a project of its own:
 *
 * - Q1: a trimmed clip whose `duration` is its length after the trims is
 *   refused, with both ways to write it; `timelineDuration` (timeline
 *   export's shape) and the file's whole length both place it right.
 * - Q2: `timeline apply --verify` checks where each clip ends, and a
 *   manifest written the report's way fails under the clip's alias.
 * - Q3: a clip with nothing left after its trims is refused, and an atomic
 *   apply leaves the timeline as it was.
 * - Q4: `--output-dir` names the export after the project.
 * - Q5: batch import reports each file's length, and `project create` prints
 *   no `[FFmpeg]` line on stderr.
 *
 * It leaves no project folder in ~/Documents/QCut/Projects.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const PROJECTS_DIR = path.join(homedir(), "Documents", "QCut", "Projects");
const PROJECT_NAME = "Trimmed clip lengths (delete me)";

/** 6 s at 24 fps, so trims land on whole frames. */
const CLIP_SECONDS = 6;

type Json = Record<string, unknown>;

interface Clip extends Json {
	id: string;
	startTime: number;
	endTime: number;
	duration: number;
	timelineDuration: number;
	trimStart: number;
	trimEnd: number;
}

interface Timeline {
	tracks: Array<Json & { id: string; isMain?: boolean; elements: Clip[] }>;
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
	const output = `${child.stdout}\n${child.stderr}`;
	/** The message of the error envelope a failed command prints. */
	const error = (): string => {
		const start = output.indexOf('{\n  "status": "error"');
		if (start < 0) return output;
		const end = output.indexOf("\n}", start);
		return (
			(JSON.parse(output.slice(start, end + 2)) as { error?: string }).error ??
			output
		);
	};
	return {
		status: child.status,
		stdout: child.stdout.trimEnd(),
		stderr: child.stderr,
		output,
		error,
	};
}

function cli<T>({ apiPort, args }: { apiPort: number; args: string[] }): T {
	const run = qcut({ apiPort, args });
	if (run.status !== 0) throw new Error(`${args[0]} failed: ${run.output}`);
	return JSON.parse(run.stdout.slice(run.stdout.lastIndexOf("\n{") + 1)) as T;
}

function makeClip({ file }: { file: string }): void {
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`testsrc2=s=320x180:r=24:d=${CLIP_SECONDS}`,
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
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
	const folder = path.join(PROJECTS_DIR, projectId);
	if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
}

function projectFolders(): string[] {
	return existsSync(PROJECTS_DIR) ? readdirSync(PROJECTS_DIR) : [];
}

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(600_000);

test("trimmed clips take the length they were given, or are refused with the reason", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const foldersBefore = new Set(projectFolders());
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-trimmed-lengths-"));
	const clipPath = path.join(workDir, "G1.mp4");
	makeClip({ file: clipPath });

	// Q5: no [FFmpeg] line on stderr while --match-media probes the clip.
	const created = qcut({
		apiPort,
		args: [
			"editor:project:create",
			"--name",
			PROJECT_NAME,
			"--match-media",
			clipPath,
			"--open",
		],
	});
	expect(created.status, created.output).toBe(0);
	expect(created.stderr).not.toContain("[FFmpeg]");
	const { projectId } = JSON.parse(
		created.stdout.slice(created.stdout.lastIndexOf("\n{") + 1)
	) as { projectId: string };
	const pid = ["--project-id", projectId];
	const timeline = () => run<Timeline>("editor:timeline:export", ...pid);
	const mainClips = () =>
		timeline()
			.tracks.find((track) => track.isMain)
			?.elements.sort((left, right) => left.startTime - right.startTime) ?? [];

	try {
		// Q5: the import says how long the file is.
		const imported = run<Array<{ mediaFile?: { duration?: number } }>>(
			"editor:media:batch-import",
			...pid,
			"--sources",
			clipPath
		);
		expect(imported[0].mediaFile?.duration).toBeCloseTo(CLIP_SECONDS, 2);
		const mainId = run<{ tracks: Array<{ id: string; isMain?: boolean }> }>(
			"editor:track:list",
			...pid
		).tracks.find((track) => track.isMain)?.id as string;
		const media = { type: "media", sourceName: "G1.mp4", trackId: mainId };
		const batchAdd = (elements: Json[]) =>
			qcut({
				apiPort,
				args: [
					"editor:timeline:batch-add",
					...pid,
					"--elements",
					JSON.stringify(elements),
				],
			});

		// Q1: 4 s wanted by trimEnd 2 s, written as the length after the trims
		// (the report: 8.5 s from a 15.04 s file showed 1.96 s).
		const refused = batchAdd([
			{ ...media, startTime: 0, duration: 4, trimStart: 0, trimEnd: 2 },
		]);
		expect(refused.status).not.toBe(0);
		expect(refused.error()).toContain(
			"duration 4s is the clip's source span before its trims, so the trims leave 2s on the timeline, but the file is 6s long"
		);
		expect(refused.error()).toContain('give "timelineDuration"');
		expect(mainClips()).toHaveLength(0);

		// Q3: trims that leave nothing.
		const empty = batchAdd([
			{ ...media, startTime: 0, duration: 6, trimStart: 4, trimEnd: 2 },
		]);
		expect(empty.status).not.toBe(0);
		expect(empty.error()).toContain("leave nothing of duration 6s");
		expect(mainClips()).toHaveLength(0);

		// Both ways the clip can be written: its length on the timeline, or
		// the file's whole length with the trims.
		const added = batchAdd([
			{ ...media, startTime: 0, timelineDuration: 4, trimEnd: 2 },
			{ ...media, startTime: 4, duration: 6, trimStart: 1, trimEnd: 2 },
		]);
		expect(added.status, added.output).toBe(0);
		const placed = mainClips();
		expect(
			placed.map(({ startTime, endTime, timelineDuration }) => ({
				startTime,
				endTime: Number(endTime.toFixed(6)),
				timelineDuration: Number(timelineDuration.toFixed(6)),
			}))
		).toEqual([
			{ startTime: 0, endTime: 4, timelineDuration: 4 },
			{ startTime: 4, endTime: 7, timelineDuration: 3 },
		]);

		// Q2 and Q3 through `timeline apply`: a refused clip names its alias and
		// the atomic apply leaves the timeline as it was.
		const manifestPath = path.join(workDir, "timeline.json");
		const applyManifest = (elements: Json[]) => {
			writeFileSync(
				manifestPath,
				JSON.stringify({
					replace: true,
					tracks: [{ alias: "main", type: "media", name: "Main", elements }],
				})
			);
			return qcut({
				apiPort,
				args: [
					"editor:timeline:apply",
					...pid,
					"--manifest",
					`@${manifestPath}`,
					"--replace",
					"--atomic",
					"--verify",
				],
			});
		};
		const reportWay = applyManifest([
			{ ...media, alias: "开场1", startTime: 0, duration: 4, trimEnd: 2 },
		]);
		expect(reportWay.status).not.toBe(0);
		expect(reportWay.error()).toContain("Element '开场1'");
		const nothingLeft = applyManifest([
			{
				...media,
				alias: "开场1",
				startTime: 0,
				timelineDuration: 4,
				trimEnd: 2,
			},
			{
				...media,
				alias: "开场2",
				startTime: 4,
				duration: 6,
				trimStart: 3,
				trimEnd: 3,
			},
		]);
		expect(nothingLeft.status).not.toBe(0);
		expect(nothingLeft.error()).toContain("Element '开场2'");
		expect(mainClips().map((clip) => clip.id)).toEqual(
			placed.map((clip) => clip.id)
		);

		// An export applies back as it was, read back at the same lengths.
		const before = timeline();
		writeFileSync(manifestPath, JSON.stringify(before));
		const applied = run<{ verified: boolean }>(
			"editor:timeline:apply",
			...pid,
			"--manifest",
			`@${manifestPath}`,
			"--replace",
			"--atomic",
			"--verify"
		);
		expect(applied.verified).toBe(true);
		expect(
			mainClips().map(({ startTime, endTime, trimStart, trimEnd }) => ({
				startTime,
				endTime: Number(endTime.toFixed(6)),
				trimStart,
				trimEnd,
			}))
		).toEqual(
			placed.map(({ startTime, endTime, trimStart, trimEnd }) => ({
				startTime,
				endTime: Number(endTime.toFixed(6)),
				trimStart,
				trimEnd,
			}))
		);

		// Q4: a folder alone names the file after the project.
		const exportDir = path.join(workDir, "exports");
		const exported = run<{
			outputPath?: string;
			result?: { outputPath?: string };
		}>(
			"editor:export:start",
			...pid,
			"--output-dir",
			exportDir,
			"--poll",
			"--timeout",
			"300"
		);
		const outputPath = String(
			exported.outputPath ?? exported.result?.outputPath ?? ""
		);
		expect(path.basename(outputPath)).toMatch(
			/^Trimmed clip lengths \(delete me\)-\d{4}-\d{2}-\d{2}-\d{6}\.mp4$/
		);
		expect(existsSync(outputPath)).toBe(true);
	} finally {
		await deleteProject({ apiPort, page, projectId });
		rmSync(workDir, { recursive: true, force: true });
	}
	expect(projectFolders().filter((name) => !foldersBefore.has(name))).toEqual(
		[]
	);
});
