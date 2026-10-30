/**
 * Two trailer-report items in the running app (2026-10-30):
 *
 * - N24: `editor timeline replace-media` swaps a clip's media in one step,
 *   keeping its place, length, in-point and audio settings, and refuses
 *   media that ends too early without leaving the file behind.
 * - N23: read-only commands read a project the editor does not have open
 *   from storage, and the editor stays on the project it has open.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");

function qcut({ apiPort, args }: { apiPort: number; args: string[] }): {
	ok: boolean;
	data: Record<string, unknown>;
	error: string;
} {
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
	const stdout = child.stdout.trimEnd();
	const start = stdout.lastIndexOf("\n{") + 1;
	let parsed: Record<string, unknown> = {};
	try {
		parsed = JSON.parse(stdout.slice(start)) as Record<string, unknown>;
	} catch {
		// The error is in the output.
	}
	return {
		ok: child.status === 0,
		data: parsed,
		error: `${child.stdout}\n${child.stderr}`,
	};
}

function clipFile({
	dir,
	name,
	seconds,
	color,
}: {
	dir: string;
	name: string;
	seconds: number;
	color: string;
}): string {
	const file = path.join(dir, name);
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=${color}:s=640x360:r=30`,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:sample_rate=48000",
		"-t",
		String(seconds),
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-shortest",
		file,
	]);
	return file;
}

type Element = Record<string, unknown> & { id: string };
type Timeline = {
	projectId?: string;
	tracks: Array<{ id: string; elements: Element[] }>;
};

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(600_000);

test("replace-media keeps the clip and closed projects read from storage", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = (...args: string[]) => {
		const result = qcut({ apiPort, args });
		if (!result.ok) throw new Error(`${args[0]} failed: ${result.error}`);
		return result.data;
	};
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-replace-media-"));
	const created: string[] = [];
	const project = (name: string) => {
		const { projectId } = run(
			"editor:project:create",
			"--name",
			`${name} (delete me)`,
			"--open"
		) as { projectId: string };
		created.push(projectId);
		return projectId;
	};
	try {
		// A closed project with one clip on its main track.
		const closedId = project("Closed project reads");
		const closedMain = (
			run("editor:track:list", "--project-id", closedId) as {
				tracks: Array<{ id: string; isMain?: boolean }>;
			}
		).tracks.find((track) => track.isMain)?.id as string;
		run(
			"editor:media:batch-import",
			"--project-id",
			closedId,
			"--sources",
			clipFile({
				dir: workDir,
				name: "closed.mp4",
				seconds: 2,
				color: "green",
			}),
			"--append-to-track",
			closedMain
		);

		// The open project: a 6 s shot, trimmed to its 1–4 s, at -6 dB.
		const openId = project("Replace media");
		const pid = ["--project-id", openId];
		const main = (
			run("editor:track:list", ...pid) as {
				tracks: Array<{ id: string; isMain?: boolean }>;
			}
		).tracks.find((track) => track.isMain)?.id as string;
		run(
			"editor:media:batch-import",
			...pid,
			"--sources",
			clipFile({ dir: workDir, name: "shot_v1.mp4", seconds: 6, color: "red" }),
			"--append-to-track",
			main
		);
		const shot = () =>
			(run("editor:timeline:export", ...pid) as Timeline).tracks
				.flatMap((track) => track.elements)
				.find((element) => element.type === "media") as Element;
		const clipId = shot().id;
		run(
			"editor:timeline:update-element",
			...pid,
			"--element-id",
			clipId,
			"--changes",
			JSON.stringify({
				startTime: 2,
				trimStart: 1,
				trimEnd: 2,
				audio: { volumeDb: -6 },
			})
		);
		const before = shot();
		expect(before).toMatchObject({ startTime: 2, trimStart: 1, trimEnd: 2 });

		// N24: a longer render swaps in where the old one was.
		const replaced = run(
			"editor:timeline:replace-media",
			...pid,
			"--element-id",
			clipId,
			"--source",
			clipFile({ dir: workDir, name: "shot_v2.mp4", seconds: 8, color: "blue" })
		) as { clip: Record<string, unknown> };
		expect(replaced.clip).toMatchObject({
			elementId: clipId,
			sourceName: "shot_v2.mp4",
			startTime: 2,
			trimStart: 1,
		});
		const after = shot();
		expect(after).toMatchObject({
			id: clipId,
			sourceName: "shot_v2.mp4",
			startTime: 2,
			endTime: before.endTime,
			trimStart: 1,
		});
		expect(Number(after.trimEnd)).toBeCloseTo(4, 1);
		expect(JSON.stringify(after.audio ?? after)).toContain("-6");

		// Too short for the clip's 1–4 s: refused, nothing changes, and the
		// file it imported is gone again.
		const mediaCount = () => {
			const media = run("editor:media:list", ...pid);
			return Array.isArray(media) ? media.length : -1;
		};
		const mediaBefore = mediaCount();
		expect(mediaBefore).toBeGreaterThan(0);
		const short = qcut({
			apiPort,
			args: [
				"editor:timeline:replace-media",
				...pid,
				"--element-id",
				clipId,
				"--source",
				clipFile({
					dir: workDir,
					name: "shot_short.mp4",
					seconds: 3,
					color: "yellow",
				}),
			],
		});
		expect(short.ok).toBe(false);
		expect(short.error).toContain(
			"but the clip reads it from 1.000 s to 4.000 s"
		);
		expect(shot()).toMatchObject({ sourceName: "shot_v2.mp4", trimStart: 1 });
		expect(mediaCount()).toBe(mediaBefore);

		// N23: the closed project reads from storage; the editor stays put.
		const closedTimeline = run(
			"editor:timeline:export",
			"--project-id",
			closedId
		) as Timeline & { readFromStorage?: boolean };
		expect(closedTimeline.projectId).toBe(closedId);
		expect(closedTimeline.readFromStorage).toBe(true);
		expect(
			closedTimeline.tracks
				.flatMap((track) => track.elements)
				.map((element) => element.sourceName)
		).toEqual(["closed.mp4"]);
		const stats = run(
			"editor:project:info",
			"--project-id",
			closedId
		) as Record<string, unknown>;
		expect(stats).toMatchObject({
			projectId: closedId,
			counts: { elements: 1 },
		});
		const mix = qcut({
			apiPort,
			args: ["editor:mix:export", "--project-id", closedId],
		});
		expect(mix.ok, mix.error).toBe(true);
		await expect
			.poll(() => page.evaluate(() => window.location.hash))
			.toContain(openId);
	} finally {
		await page.evaluate(() => {
			window.location.hash = "#/projects";
		});
		await page.waitForTimeout(1000);
		for (const projectId of created) {
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
		rmSync(workDir, { recursive: true, force: true });
	}
});
