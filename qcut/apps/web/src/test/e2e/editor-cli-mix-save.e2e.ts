/**
 * N19 (2026-10-29 trailer report): a mixer change made through the CLI is in
 * the project's stored record as soon as the command answers, and a rename,
 * a duplicate and a reopen keep it. `editor:project:rename` saved the project
 * list's copy of the record, from before the master curve was set: the
 * stored curve went back to the old one, and the open editor's with it.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const CURVE = [
	{ time: 0, value: -2 },
	{ time: 10, value: -24 },
];
const PAN = [
	{ time: 0, value: -1 },
	{ time: 2, value: 1 },
];

interface Points {
	gainDb?: Array<{ time: number; value: number }>;
	pan?: Array<{ time: number; value: number }>;
}

interface Bus {
	id: string;
	name: string;
	gainDb: number;
	automation?: Points;
}

interface Mix {
	master: Bus;
	buses: Bus[];
}

interface MixSnapshot extends Mix {
	tracks: Array<{
		trackId: string;
		muted: boolean;
		audio: { gainDb: number; busId: string; automation?: Points };
	}>;
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

function makeTone({ file }: { file: string }): void {
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=330:duration=2",
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

const bus = ({ id, name, gainDb, automation }: Bus) => ({
	id,
	name,
	gainDb,
	automation: automation ?? null,
});

/** What a project's own record holds of the mix. */
const projectMix = (mix: Mix) => ({
	master: bus(mix.master),
	buses: mix.buses.map(bus),
});

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(600_000);

test("mixer changes are stored at once and survive a rename, a duplicate and a reopen", async ({
	apiPort,
	electronApp,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const userData = await electronApp.evaluate(({ app }) =>
		app.getPath("userData")
	);
	const stored = (projectId: string): Mix =>
		JSON.parse(
			readFileSync(
				path.join(
					userData,
					"projects",
					`video-editor-projects_projects_${projectId}.json`
				),
				"utf8"
			)
		).audioMix;
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-mix-save-"));
	const projectIds: string[] = [];
	try {
		const { projectId } = run<{ projectId: string }>(
			"editor:project:create",
			"--name",
			"Mix save (delete me)",
			"--open"
		);
		projectIds.push(projectId);
		const pid = ["--project-id", projectId];
		const music = path.join(workDir, "music.wav");
		makeTone({ file: music });
		run("editor:media:batch-import", ...pid, "--sources", music);
		const trackId = run<{ trackId: string }>(
			"editor:track:create",
			...pid,
			"--type",
			"audio",
			"--name",
			"配乐 1"
		).trackId;
		run(
			"editor:timeline:batch-add",
			...pid,
			"--elements",
			JSON.stringify([
				{
					type: "media",
					sourceName: "music.wav",
					trackId,
					startTime: 0,
					duration: 2,
				},
			])
		);
		const live = (id: string) => {
			const mix = run<MixSnapshot>("editor:mix:export", "--project-id", id);
			const track = mix.tracks.find((item) => item.trackId === trackId);
			return {
				...projectMix(mix),
				track: {
					muted: track?.muted,
					gainDb: track?.audio.gainDb,
					busId: track?.audio.busId,
					automation: track?.audio.automation ?? null,
				},
			};
		};

		// The project's own mix is in its record as each command answers.
		run("editor:mix:bus-create", ...pid, "--name", "SFX", "--bus-id", "sfx");
		run("editor:mix:bus-set", ...pid, "--bus-id", "sfx", "--gain-db", "-4");
		run("editor:mix:master-set", ...pid, "--gain-db", "-2");
		run(
			"editor:mix:bus-automation",
			...pid,
			"--bus-id",
			"master",
			"--param",
			"gainDb",
			"--points",
			JSON.stringify(CURVE)
		);
		run("editor:mix:bus-create", ...pid, "--name", "Temp", "--bus-id", "temp");
		run("editor:mix:bus-remove", ...pid, "--bus-id", "temp");
		const expectedMix = {
			master: {
				id: "master",
				name: "Master",
				gainDb: -2,
				automation: { gainDb: CURVE },
			},
			buses: [{ id: "sfx", name: "SFX", gainDb: -4, automation: null }],
		};
		expect(projectMix(stored(projectId))).toEqual(expectedMix);

		// A track's mix is saved with the timeline.
		run(
			"editor:track:audio-set",
			...pid,
			"--track-id",
			trackId,
			"--gain-db",
			"-6",
			"--bus",
			"sfx"
		);
		run(
			"editor:track:audio-automation",
			...pid,
			"--track-id",
			trackId,
			"--param",
			"pan",
			"--points",
			JSON.stringify(PAN)
		);
		run("editor:track:mute", ...pid, "--track-id", trackId);
		const expected = {
			...expectedMix,
			track: {
				muted: true,
				gainDb: -6,
				busId: "sfx",
				automation: { pan: PAN },
			},
		};
		expect(live(projectId)).toEqual(expected);

		// N19: the rename saved the list's copy, from before any of this.
		run(
			"editor:project:rename",
			...pid,
			"--new-name",
			"Mix save renamed (delete me)"
		);
		expect(projectMix(stored(projectId))).toEqual(expectedMix);
		expect(live(projectId)).toEqual(expected);

		// A duplicate copies the mix as it is now.
		const copyId = run<{ projectId: string }>(
			"editor:project:duplicate",
			...pid
		).projectId;
		projectIds.push(copyId);
		expect(projectMix(stored(copyId))).toEqual(expectedMix);

		// A change after the list was last read, then a rename while the
		// project is closed (v16b lost its curve that way).
		run("editor:mix:master-set", ...pid, "--gain-db", "-3");
		const changed = { ...expected, master: { ...expected.master, gainDb: -3 } };
		run("editor:navigator:open", "--project-id", copyId);
		expect(live(copyId)).toEqual(expected);
		run(
			"editor:project:rename",
			...pid,
			"--new-name",
			"Mix save renamed while closed (delete me)"
		);
		expect(projectMix(stored(projectId)).master).toEqual(changed.master);

		// Back in the project, everything is as it was left.
		run("editor:navigator:open", ...pid);
		expect(live(projectId)).toEqual(changed);
	} finally {
		for (const projectId of projectIds) {
			await deleteProject({ apiPort, page, projectId });
		}
		rmSync(workDir, { recursive: true, force: true });
	}
});
