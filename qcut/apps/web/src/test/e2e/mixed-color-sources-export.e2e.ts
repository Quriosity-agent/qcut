/**
 * Sources that describe their colour differently, or not at all, must come
 * out of an export in one description, in the colours the editor reads them
 * in.
 *
 * Colour bars of known RGB values in every form a project meets: tagged
 * BT.709, tagged BT.601, untagged (HD and SD, each coded both ways), full
 * range, a PNG and a JPEG, each a clip of its own on the main track, and an
 * untagged clip once more as an overlay. Both exports are decoded through
 * their own tags and each stretch compared with the bars, so a clip that
 * kept another matrix or range under the file's tags reads 20 to 40 levels
 * off. A text and a caption sit over one last clip, so the pass that burns
 * them in encodes the whole picture once more before it is measured.
 *
 * The rule, measured here on the in-browser (muxer) export and on the
 * preview: a file is read by its tags; untagged, as BT.601 below 720 lines
 * and BT.709 from there up. The export is BT.709, limited range, on every
 * frame. The native export used to keep each source's own description
 * (and wrote a PNG as BT.601 with no tags), so one file changed tags from
 * clip to clip under the first clip's.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import {
	generateColorBarsClip,
	generateColorBarsImage,
	measureColorBarsFrames,
	probeColorTags,
	readColorBarsImage,
} from "./helpers/color-space-evidence";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const FFPROBE = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffprobe");
const EVIDENCE_DIR = path.resolve("output/playwright/mixed-color-sources");
const W = 1280;
const H = 720;
const FPS = 30;
const CLIP_SECONDS = 1;
/** Bars read back through a file's tags are within this of their values. */
const BARS_LIMIT = 8;
/** The two engines convert a few levels apart at most. */
const ENGINE_LIMIT = 6;
const EXPORT_TAGS = "tv,bt709,bt709,bt709";

interface Source {
	name: string;
	/** Whether the file is coded the way the editor reads it. */
	readAsCoded: boolean;
	make: (filePath: string) => Promise<void>;
}

const clip =
	(
		options: Omit<
			Parameters<typeof generateColorBarsClip>[0],
			"filePath" | "seconds"
		>
	) =>
	(filePath: string) =>
		generateColorBarsClip({ filePath, seconds: 2, fps: FPS, ...options });
const sd = { width: 640, height: 360 };

/** Every form of source, in timeline order. */
const SOURCES: Source[] = [
	{ name: "hd-709.mp4", readAsCoded: true, make: clip({ matrix: "bt709" }) },
	{ name: "hd-601.mp4", readAsCoded: true, make: clip({ matrix: "bt601" }) },
	{
		name: "hd-untagged-709.mp4",
		readAsCoded: true,
		make: clip({ matrix: "bt709", tagged: false }),
	},
	{
		// HD that says nothing is read as BT.709, which this one is not.
		name: "hd-untagged-601.mp4",
		readAsCoded: false,
		make: clip({ matrix: "bt601", tagged: false }),
	},
	{
		name: "sd-untagged-601.mp4",
		readAsCoded: true,
		make: clip({ matrix: "bt601", tagged: false, ...sd }),
	},
	{
		// SD that says nothing is read as BT.601, which this one is not.
		name: "sd-untagged-709.mp4",
		readAsCoded: false,
		make: clip({ matrix: "bt709", tagged: false, ...sd }),
	},
	{
		name: "hd-709-full.mp4",
		readAsCoded: true,
		make: clip({ matrix: "bt709", range: "pc" }),
	},
	{
		name: "bars.png",
		readAsCoded: true,
		make: (filePath) => generateColorBarsImage({ filePath }),
	},
	{
		name: "bars.jpg",
		readAsCoded: true,
		make: (filePath) => generateColorBarsImage({ filePath }),
	},
];
/** After the sources: a BT.709 clip with an untagged one drawn over its middle. */
const OVERLAY_AT = SOURCES.length * CLIP_SECONDS;
const OVERLAY_SOURCE = "hd-untagged-709.mp4";
/** The overlay at half size in the middle of the picture. */
const OVERLAY_REGION = { x: W / 4, y: H / 4, width: W / 2, height: H / 2 };
/** Then a BT.601 clip once more, with a text and a caption over it. */
const TITLES_AT = OVERLAY_AT + CLIP_SECONDS;
const TITLES_SOURCE = "hd-601.mp4";

function cli<T>({
	apiPort,
	args,
	timeout = 300_000,
}: {
	apiPort: number;
	args: string[];
	timeout?: number;
}): T {
	const child = spawnSync(
		"bun",
		["--silent", "run", "qcut", "--", ...args, "--json", "--flat"],
		{
			cwd: path.resolve("."),
			env: { ...process.env, QCUT_API_PORT: String(apiPort) },
			maxBuffer: 32 * 1024 * 1024,
			timeout,
			encoding: "utf8",
		}
	);
	if (child.status !== 0) {
		throw new Error(`${args[0]} failed: ${child.stdout}\n${child.stderr}`);
	}
	const last = child.stdout.trimEnd().lastIndexOf("\n{");
	return JSON.parse(child.stdout.slice(last + 1)) as T;
}

/** The distinct colour tags the frames of `file` carry. */
function frameTags(file: string): string[] {
	const out = execFileSync(
		FFPROBE,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"frame=color_range,color_space,color_primaries,color_transfer",
			"-of",
			"csv=p=0",
			file,
		],
		{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
	);
	return [
		...new Set(
			out
				.split("\n")
				.map((line) => line.replace(/,+$/, "").trim())
				.filter(Boolean)
		),
	];
}

/**
 * How alike two stretches of `file` are (PSNR, dB): two encodes of one
 * still picture are far above 40, a picture with text drawn over it is not.
 */
function stretchesAlike({
	file,
	first,
	second,
	seconds,
}: {
	file: string;
	first: number;
	second: number;
	seconds: number;
}): number {
	const child = spawnSync(
		FFMPEG,
		[
			"-hide_banner",
			"-ss",
			String(first),
			"-t",
			String(seconds),
			"-i",
			file,
			"-ss",
			String(second),
			"-t",
			String(seconds),
			"-i",
			file,
			"-lavfi",
			"[0:v]setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]psnr",
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
	);
	const average = /average:(inf|[0-9.]+)/.exec(child.stderr)?.[1];
	if (child.status !== 0 || !average) {
		throw new Error(`psnr failed: ${child.stderr.slice(-800)}`);
	}
	return average === "inf" ? Number.POSITIVE_INFINITY : Number(average);
}

function srtTime(seconds: number): string {
	const whole = Math.floor(seconds);
	const ms = Math.round((seconds - whole) * 1000);
	const m = String(Math.floor(whole / 60)).padStart(2, "0");
	const s = String(whole % 60).padStart(2, "0");
	return `00:${m}:${s},${String(ms).padStart(3, "0")}`;
}

/** The largest channel difference between two sets of bar colours. */
function barsApart(left: number[][], right: number[][]): number {
	let worst = 0;
	for (const [index, color] of left.entries()) {
		for (const [channel, value] of color.entries()) {
			worst = Math.max(worst, Math.abs(value - right[index][channel]));
		}
	}
	return worst;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("sources tagged differently, or not at all, export in one colour description", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-mixed-color-"));
	mkdirSync(EVIDENCE_DIR, { recursive: true });
	try {
		for (const source of SOURCES) {
			await source.make(path.join(workDir, source.name));
		}
		const { projectId } = run<{ projectId: string }>(
			"editor:project:create",
			"--name",
			"Mixed colour",
			"--width",
			String(W),
			"--height",
			String(H),
			"--fps",
			String(FPS),
			"--open",
			"--wait-ready"
		);
		const pid = ["--project-id", projectId];
		const { tracks } = run<{
			tracks: Array<{ id: string; isMain?: boolean }>;
		}>("editor:track:list", ...pid);
		const mainId = tracks.find((track) => track.isMain)?.id as string;
		run(
			"editor:media:batch-import",
			...pid,
			"--sources",
			SOURCES.map((source) => path.join(workDir, source.name)).join(",")
		);
		const add = (data: Record<string, unknown>) =>
			run<{ elementId: string }>(
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify({ type: "media", duration: CLIP_SECONDS, ...data })
			).elementId;
		for (const [index, source] of SOURCES.entries()) {
			add({
				sourceName: source.name,
				trackId: mainId,
				startTime: index * CLIP_SECONDS,
			});
		}
		add({ sourceName: "hd-709.mp4", trackId: mainId, startTime: OVERLAY_AT });
		const overlayTrack = run<{ trackId: string }>(
			"editor:track:create",
			...pid,
			"--type",
			"media",
			"--name",
			"Overlay",
			"--index",
			"0"
		).trackId;
		const overlayId = add({
			sourceName: OVERLAY_SOURCE,
			trackId: overlayTrack,
			startTime: OVERLAY_AT,
		});
		run(
			"editor:element:patch",
			...pid,
			"--element-id",
			overlayId,
			"--set",
			JSON.stringify({ scaleX: 0.5, scaleY: 0.5 })
		);

		// A text and a caption over one more clip: the pass that burns them in
		// encodes the whole picture again, and must leave it as it found it.
		add({ sourceName: TITLES_SOURCE, trackId: mainId, startTime: TITLES_AT });
		add({
			type: "text",
			content: "QCut",
			startTime: TITLES_AT,
			fontSize: 64,
			color: "#ffffff",
			x: 0,
			y: 0,
		});
		const srtPath = path.join(workDir, "titles.srt");
		writeFileSync(
			srtPath,
			`1\n${srtTime(TITLES_AT + 0.1)} --> ${srtTime(TITLES_AT + 0.9)}\nOne description\n`
		);
		run(
			"editor:captions:import",
			...pid,
			"--file",
			srtPath,
			"--language",
			"en"
		);

		// --- how the preview reads a file that says nothing --------------------
		// The preview's video is colour-managed for the display, so its pixels
		// are not the file's; what it takes an untagged file for shows in what
		// it draws the same as: untagged HD as the BT.709 clip, untagged SD as
		// the BT.601 one, each coded that way.
		const shown: Record<string, number[][]> = {};
		for (const [index, source] of SOURCES.entries()) {
			run(
				"editor:timeline:seek",
				...pid,
				"--time",
				String(index * CLIP_SECONDS + 0.5)
			);
			await page.waitForTimeout(1200);
			const box = await page
				.getByTestId("preview-capture-surface")
				.boundingBox();
			if (!box) throw new Error("preview surface not found");
			const png = path.join(EVIDENCE_DIR, `preview-${source.name}.png`);
			await page.screenshot({ path: png, clip: box });
			shown[source.name] = await readColorBarsImage({ filePath: png });
		}
		const previewApart = {
			untaggedHdAs709: barsApart(
				shown["hd-untagged-709.mp4"],
				shown["hd-709.mp4"]
			),
			untaggedSdAs601: barsApart(
				shown["sd-untagged-601.mp4"],
				shown["hd-601.mp4"]
			),
			// For scale: the same pictures read the other way.
			untaggedHdAs601: barsApart(
				shown["hd-untagged-601.mp4"],
				shown["hd-709.mp4"]
			),
			untaggedSdAs709: barsApart(
				shown["sd-untagged-709.mp4"],
				shown["hd-601.mp4"]
			),
		};
		console.log("preview, bars apart", JSON.stringify(previewApart));

		// --- what each engine writes -------------------------------------------
		interface Measured {
			stream: Awaited<ReturnType<typeof probeColorTags>>;
			frames: string[];
			perClip: Record<string, number>;
			overlay: number;
			/** The clip under the text and the caption: its bars, and how like the same clip without them it is. */
			titles: { bars: number; alike: number };
		}
		const measured = {} as Record<"muxer" | "native", Measured>;
		for (const engine of ["muxer", "native"] as const) {
			const outputPath = path.join(EVIDENCE_DIR, `${engine}.mp4`);
			rmSync(outputPath, { force: true });
			const job = cli<{ status: string; warnings?: string[] }>({
				apiPort,
				timeout: 600_000,
				args: [
					"editor:export:start",
					...pid,
					"--output",
					outputPath,
					"--engine",
					engine,
					"--poll",
				],
			});
			expect(job.status, `${engine} export`).toBe("completed");
			if (engine === "native") expect(job.warnings ?? []).toEqual([]);
			const bars = async (
				startSeconds: number,
				region?: typeof OVERLAY_REGION
			) =>
				(
					await measureColorBarsFrames({
						filePath: outputPath,
						decodeMatrix: "auto",
						startSeconds: startSeconds + 0.3,
						durationSeconds: 0.4,
						...(region ? { region } : {}),
					})
				).maxErr;
			const perClip: Record<string, number> = {};
			for (const [index, source] of SOURCES.entries()) {
				perClip[source.name] = await bars(index * CLIP_SECONDS);
			}
			measured[engine] = {
				stream: await probeColorTags({ filePath: outputPath }),
				frames: frameTags(outputPath),
				perClip,
				overlay: await bars(OVERLAY_AT, OVERLAY_REGION),
				titles: {
					bars: await bars(TITLES_AT),
					alike: stretchesAlike({
						file: outputPath,
						first:
							SOURCES.findIndex((source) => source.name === TITLES_SOURCE) *
								CLIP_SECONDS +
							0.3,
						second: TITLES_AT + 0.3,
						seconds: 0.4,
					}),
				},
			};
		}
		console.log("exports, worst bar error", JSON.stringify(measured));
		writeFileSync(
			path.join(EVIDENCE_DIR, "measurements.json"),
			`${JSON.stringify({ previewApart, measured }, null, 2)}\n`
		);

		// The preview takes untagged HD for BT.709 and untagged SD for BT.601.
		expect(previewApart.untaggedHdAs709).toBeLessThanOrEqual(4);
		expect(previewApart.untaggedSdAs601).toBeLessThanOrEqual(4);
		expect(previewApart.untaggedHdAs601).toBeGreaterThan(15);
		expect(previewApart.untaggedSdAs709).toBeGreaterThan(15);

		for (const engine of ["muxer", "native"] as const) {
			const { stream, frames, perClip, overlay, titles } = measured[engine];
			// One description, on the file and on every frame of it.
			expect(stream, `${engine} tags`).toMatchObject({
				colorPrimaries: "bt709",
				colorRange: "tv",
				colorSpace: "bt709",
				colorTransfer: "bt709",
			});
			expect(frames, `${engine} frame tags`).toEqual([EXPORT_TAGS]);
			for (const source of SOURCES) {
				if (source.readAsCoded) {
					// Read as it was coded: its bars, through the file's tags.
					expect(
						perClip[source.name],
						`${engine} ${source.name}`
					).toBeLessThanOrEqual(BARS_LIMIT);
				} else {
					// Read by its size, against its coding: shifted, as in the
					// preview.
					expect(
						perClip[source.name],
						`${engine} ${source.name}`
					).toBeGreaterThan(15);
				}
			}
			// The untagged overlay is read the same way as the clip.
			expect(overlay, `${engine} overlay`).toBeLessThanOrEqual(BARS_LIMIT);
			// The text and the caption are on the picture (it is no longer the
			// clip alone), and the bars around them are still the bars.
			expect(titles.alike, `${engine} titles drawn`).toBeLessThan(35);
			expect(titles.bars, `${engine} under titles`).toBeLessThanOrEqual(
				BARS_LIMIT
			);
		}
		// And the two engines agree, clip by clip.
		for (const source of SOURCES) {
			expect(
				Math.abs(
					measured.native.perClip[source.name] -
						measured.muxer.perClip[source.name]
				),
				`engines on ${source.name}`
			).toBeLessThanOrEqual(ENGINE_LIMIT);
		}
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
});
