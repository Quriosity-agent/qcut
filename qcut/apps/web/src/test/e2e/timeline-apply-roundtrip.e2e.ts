/**
 * `timeline export` → `timeline apply --replace` on one project brings back
 * everything the export wrote: track colour, mute and lock, the mix (a bus,
 * routing, ducking, the master), a clip's name, placement and grade, text on
 * the track it was asked for, and more than fifty captions in one command,
 * with `--verify` reading it all back.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";
import { localFixturePath } from "./helpers/local-fixtures";

const VIDEO = localFixturePath("QCUT_SHOT_SPLIT_E2E_SOURCE");
const AUDIO = path.resolve(
	"apps/web/src/test/e2e/fixtures/media/sample-audio.mp3"
);
const CAPTION_COUNT = 60;

type Json = Record<string, unknown>;

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
	tracks: Array<
		Json & {
			id: string;
			type: string;
			name: string;
			isMain?: boolean;
			elements: Array<Json & { id: string; type: string }>;
		}
	>;
	mix?: {
		master: Json & { gainDb: number };
		buses: Array<Json & { id: string; name: string; gainDb: number }>;
	};
}

function srtTime(seconds: number): string {
	const whole = Math.floor(seconds);
	const ms = Math.round((seconds - whole) * 1000);
	const h = String(Math.floor(whole / 3600)).padStart(2, "0");
	const m = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
	const s = String(whole % 60).padStart(2, "0");
	return `${h}:${m}:${s},${String(ms).padStart(3, "0")}`;
}

function round3(value: unknown): number | null {
	return typeof value === "number" ? Math.round(value * 1000) / 1000 : null;
}

/** The part of an export a round trip must keep, without ids or defaults. */
function normalize(exported: Exported) {
	return {
		tracks: exported.tracks.map((track) => {
			const audio = track.audio as Json | undefined;
			const ducking = audio?.ducking as Json | undefined;
			return {
				type: track.type,
				name: track.name,
				colorLabel: track.colorLabel ?? null,
				muted: track.muted === true,
				hidden: track.hidden === true,
				locked: track.locked === true,
				audio: audio
					? {
							gainDb: audio.gainDb,
							pan: audio.pan,
							busId: audio.busId,
							solo: audio.solo,
							ducking: {
								enabled: ducking?.enabled,
								thresholdDb: ducking?.thresholdDb,
								sourceTrackIds: ducking?.sourceTrackIds,
							},
						}
					: null,
				elements: track.elements
					.map((element) => ({
						type: element.type,
						startTime: round3(element.startTime),
						duration: round3(element.duration),
						trimStart: round3(element.trimStart),
						trimEnd: round3(element.trimEnd),
						name: element.name ?? null,
						x: element.x ?? null,
						y: element.y ?? null,
						fitMode: element.fitMode ?? null,
						opacity: element.opacity ?? null,
						content: element.content ?? null,
						contrast:
							(element.adjustments as Json | undefined)?.contrast ?? null,
					}))
					.sort(
						(left, right) => (left.startTime ?? 0) - (right.startTime ?? 0)
					),
			};
		}),
		mix: exported.mix
			? {
					master: exported.mix.master.gainDb,
					buses: exported.mix.buses.map((bus) => ({
						id: bus.id,
						name: bus.name,
						gainDb: bus.gainDb,
					})),
				}
			: null,
	};
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(600_000);

test("an export applied back with --replace restores tracks, clips, captions and the mix", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(VIDEO), "the 门的计划 clip is not on this machine");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const exportTimeline = () =>
		run<Exported>("editor:timeline:export", "--project-id", projectId);

	const { projectId } = await run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Apply round trip",
		"--open"
	);
	const pid = ["--project-id", projectId];
	const { tracks } = await run<{
		tracks: Array<{ id: string; isMain?: boolean }>;
	}>("editor:track:list", ...pid);
	const mainId = tracks.find((track) => track.isMain)?.id as string;
	await run(
		"editor:media:batch-import",
		...pid,
		"--sources",
		VIDEO,
		"--append-to-track",
		mainId
	);
	const music = await run<{ trackId: string }>(
		"editor:track:create",
		...pid,
		"--type",
		"audio",
		"--name",
		"Music",
		"--color",
		"blue"
	);
	await run(
		"editor:media:batch-import",
		...pid,
		"--sources",
		AUDIO,
		"--append-to-track",
		music.trackId
	);

	// Text goes on the track it names (a single add used to make a new one).
	const titles = await run<{ trackId: string }>(
		"editor:track:create",
		...pid,
		"--type",
		"text",
		"--name",
		"Titles"
	);
	await run(
		"editor:timeline:add-element",
		...pid,
		"--data",
		JSON.stringify({
			type: "text",
			trackId: titles.trackId,
			content: "门的计划",
			startTime: 1,
			duration: 2,
		})
	);
	const afterText = await exportTimeline();
	const titleTrack = afterText.tracks.find((t) => t.id === titles.trackId);
	expect(titleTrack?.elements.map((e) => e.content)).toEqual(["门的计划"]);
	expect(afterText.tracks.filter((t) => t.type === "text")).toHaveLength(1);

	// A graded, renamed, repositioned clip.
	const clip = afterText.tracks.find((t) => t.id === mainId)?.elements[0];
	if (!clip) throw new Error("clip not placed");
	await run(
		"editor:element:patch",
		...pid,
		"--element-id",
		clip.id,
		"--set",
		JSON.stringify({
			name: "改名测试",
			x: 40,
			y: -20,
			fitMode: "contain",
			opacity: 0.8,
			// Trims: an export reports the trimmed length, and the apply must not
			// take the trims off a second time.
			trimStart: 1.5,
			trimEnd: 2,
		})
	);
	await run(
		"editor:element:color",
		...pid,
		"--element-id",
		clip.id,
		"--contrast",
		"15",
		"--saturation",
		"-30"
	);

	// Sixty captions: more than one batch.
	const srtDir = mkdtempSync(path.join(tmpdir(), "qcut-apply-roundtrip-"));
	const srtPath = path.join(srtDir, "captions.srt");
	writeFileSync(
		srtPath,
		Array.from({ length: CAPTION_COUNT }, (_, index) => {
			const start = index * 0.4;
			return `${index + 1}\n${srtTime(start)} --> ${srtTime(start + 0.35)}\n字幕 ${index + 1}\n`;
		}).join("\n")
	);
	await run(
		"editor:captions:import",
		...pid,
		"--file",
		srtPath,
		"--language",
		"zh"
	);

	// The mix: a bus, routing with ducking, the master; a muted, locked track.
	await run(
		"editor:mix:bus-create",
		...pid,
		"--name",
		"SFX",
		"--bus-id",
		"sfx",
		"--gain-db",
		"-3"
	);
	await run(
		"editor:track:audio-set",
		...pid,
		"--track-id",
		music.trackId,
		"--bus",
		"sfx",
		"--gain-db",
		"-6",
		"--pan",
		"0.2",
		"--ducking",
		JSON.stringify({
			enabled: true,
			sourceTrackIds: [mainId],
			thresholdDb: -30,
		})
	);
	await run("editor:mix:master-set", ...pid, "--gain-db", "-1");
	await run("editor:track:mute", ...pid, "--track-id", music.trackId);
	await run(
		"editor:track:update",
		...pid,
		"--track-id",
		titles.trackId,
		"--lock"
	);

	const before = await exportTimeline();
	expect(before.mix?.buses.map((bus) => bus.id)).toEqual(["sfx"]);
	expect(before.mix?.master.gainDb).toBe(-1);
	const musicBefore = before.tracks.find((t) => t.id === music.trackId);
	expect(musicBefore?.muted).toBe(true);
	expect((musicBefore?.audio as Json).busId).toBe("sfx");
	expect(before.tracks.find((t) => t.id === titles.trackId)?.locked).toBe(true);
	const captionsBefore = before.tracks
		.filter((t) => t.type === "captions")
		.flatMap((t) => t.elements);
	expect(captionsBefore).toHaveLength(CAPTION_COUNT);
	const manifestPath = path.join(srtDir, "timeline.json");
	writeFileSync(manifestPath, JSON.stringify(before));

	// Wreck the timeline the way a drill does.
	await run(
		"editor:track:update",
		...pid,
		"--track-id",
		titles.trackId,
		"--unlock"
	);
	await run(
		"editor:track:delete",
		...pid,
		"--track-id",
		music.trackId,
		"--force"
	);
	for (const track of before.tracks.filter((t) => t.type === "captions")) {
		await run("editor:track:delete", ...pid, "--track-id", track.id, "--force");
	}
	await run("editor:mix:bus-remove", ...pid, "--bus-id", "sfx");
	await run("editor:mix:master-set", ...pid, "--gain-db", "0");
	await run(
		"editor:element:patch",
		...pid,
		"--element-id",
		clip.id,
		"--set",
		JSON.stringify({ name: "临时", x: 0, opacity: 1 })
	);
	const wrecked = await exportTimeline();
	expect(wrecked.tracks).toHaveLength(2);
	expect(wrecked.mix?.buses).toEqual([]);

	// One command puts it all back.
	const applied = await run<{
		success?: boolean;
		verified: boolean;
		positionalTracks: boolean;
		mixApplied: boolean;
	}>(
		"editor:timeline:apply",
		...pid,
		"--manifest",
		`@${manifestPath}`,
		"--replace"
	);
	expect(applied.verified).toBe(true);
	expect(applied.positionalTracks).toBe(true);
	expect(applied.mixApplied).toBe(true);

	const after = await exportTimeline();
	expect(normalize(after)).toEqual(normalize(before));
	const restoredTitles = after.tracks.find((t) => t.type === "text");
	expect(restoredTitles?.locked).toBe(true);
	expect(restoredTitles?.elements.map((e) => e.content)).toEqual(["门的计划"]);
	const restoredClip = after.tracks.find((t) => t.id === mainId)?.elements[0];
	expect(restoredClip).toMatchObject({
		name: "改名测试",
		x: 40,
		y: -20,
		fitMode: "contain",
		opacity: 0.8,
		trimStart: 1.5,
		trimEnd: 2,
	});
	expect(restoredClip?.duration).toBeCloseTo(Number(clip.duration) - 3.5, 3);
	const restoredMusic = after.tracks.find((t) => t.name === "Music");
	expect(restoredMusic?.muted).toBe(true);
	expect(restoredMusic?.colorLabel).toBe("blue");
	expect(
		((restoredMusic?.audio as Json).ducking as Json).sourceTrackIds
	).toEqual([mainId]);
	expect(after.mix?.buses.map((bus) => [bus.id, bus.gainDb])).toEqual([
		["sfx", -3],
	]);
	expect(after.mix?.master.gainDb).toBe(-1);
});
