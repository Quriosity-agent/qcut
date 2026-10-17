/**
 * `editor:project:duplicate` over the editor API: the copy carries the
 * source's media, tracks and clips (a music clip and a title here) and is
 * named "原名（副本）"; opening it shows the same timeline. The earlier API
 * copy left an empty main track and the name "Duplicated Project".
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const AUDIO = path.resolve(
	"apps/web/src/test/e2e/fixtures/media/sample-audio.mp3"
);

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
	name?: string;
	tracks: Array<{
		id: string;
		name: string;
		type: string;
		elements: Array<{
			id: string;
			type: string;
			startTime: number;
			content?: string;
			mediaId?: string;
			sourceId?: string;
		}>;
	}>;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(300_000);

test("a duplicated project carries its media, tracks and clips under the copy's name", async ({
	apiPort,
	page,
}) => {
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });

	const { projectId } = await run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"副本测试",
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
		AUDIO,
		"--append-to-track",
		music.trackId
	);
	await run(
		"editor:timeline:add-element",
		...pid,
		"--data",
		JSON.stringify({
			type: "text",
			content: "门的计划",
			startTime: 1,
			duration: 3,
			fontSize: 64,
		})
	);
	const source = await run<Exported>("editor:timeline:export", ...pid);
	const sourceClips = source.tracks.flatMap((track) =>
		track.elements.map((element) => ({
			track: track.name,
			type: element.type,
			startTime: element.startTime,
			content: element.content,
			media: element.sourceId ?? element.mediaId,
		}))
	);
	expect(sourceClips).toHaveLength(2);

	const copy = await run<{
		projectId: string;
		name: string;
		sourceProjectId: string;
	}>("editor:project:duplicate", ...pid);
	expect(copy.sourceProjectId).toBe(projectId);
	expect(copy.projectId).not.toBe(projectId);
	expect(copy.name).toBe("副本测试（副本）");

	await run("editor:navigator:open", "--project-id", copy.projectId);
	const media = await run<Array<{ id: string; name: string }>>(
		"editor:media:list",
		"--project-id",
		copy.projectId
	);
	expect(media.map((item) => item.name)).toEqual(["sample-audio.mp3"]);

	const copied = await run<Exported>(
		"editor:timeline:export",
		"--project-id",
		copy.projectId
	);
	expect(copied.name).toBe("副本测试（副本）");
	const copiedClips = copied.tracks.flatMap((track) =>
		track.elements.map((element) => ({
			track: track.name,
			type: element.type,
			startTime: element.startTime,
			content: element.content,
			media: element.sourceId ?? element.mediaId,
		}))
	);
	// Same clips on the same tracks; media ids survive the copy.
	expect(copiedClips).toEqual(sourceClips);
	expect(media[0]?.id).toBe(sourceClips.find((clip) => clip.media)?.media);
});
