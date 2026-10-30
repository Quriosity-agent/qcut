/**
 * Film subtitles (N25, 2026-10-30 trailer report): a caption in a SemiBold
 * CJK face over a second line with its own spacing, two soft shadows and a
 * 4-frame fade-in / 3-frame fade-out. Both export engines — the native
 * FFmpeg pass (libass) and the renderer muxer (canvas) — must draw it alike,
 * measured on exported frames over a grey background: the lines' places,
 * the shadows' darkening, and each fade frame's level.
 *
 * Hiragino Mincho ProN is a CJK font macOS installs that the native
 * export's old fixed family list did not name; W6 is its weight 600 face.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 24;
/** The caption runs from frame 12 to frame 60 (0.5 s to 2.5 s). */
const START_FRAME = 12;
const END_FRAME = 60;
const GREY = 128;

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
	const stdout = child.stdout.trimEnd();
	return JSON.parse(stdout.slice(stdout.lastIndexOf("\n{") + 1)) as T;
}

/** The given frames (by number), decoded in order. */
function readFrames({
	file,
	frames,
}: {
	file: string;
	frames: number[];
}): Map<number, Buffer> {
	const select = frames.map((frame) => `eq(n\\,${frame})`).join("+");
	const result = spawnSync(
		FFMPEG,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vf",
			`select=${select}`,
			"-fps_mode",
			"passthrough",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: 256 * 1024 * 1024 }
	);
	if (result.status !== 0) {
		throw new Error(`ffmpeg frame read failed: ${result.stderr.toString()}`);
	}
	const size = WIDTH * HEIGHT * 3;
	const decoded = new Map<number, Buffer>();
	for (const [index, frame] of [...frames].sort((a, b) => a - b).entries()) {
		decoded.set(
			frame,
			result.stdout.subarray(index * size, (index + 1) * size)
		);
	}
	return decoded;
}

interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
	count: number;
}

/** Extents of the pixels that `match`. */
function measure({
	frame,
	match,
}: {
	frame: Buffer;
	match: (r: number, g: number, b: number) => boolean;
}): Box {
	const box = { left: WIDTH, right: -1, top: HEIGHT, bottom: -1, count: 0 };
	for (let y = 0; y < HEIGHT; y += 1) {
		for (let x = 0; x < WIDTH; x += 1) {
			const offset = (y * WIDTH + x) * 3;
			if (!match(frame[offset], frame[offset + 1], frame[offset + 2])) continue;
			box.count += 1;
			box.left = Math.min(box.left, x);
			box.right = Math.max(box.right, x);
			box.top = Math.min(box.top, y);
			box.bottom = Math.max(box.bottom, y);
		}
	}
	return box;
}

/** Mean luma over a box of the frame. */
function meanLuma({
	frame,
	left,
	right,
	top,
	bottom,
}: {
	frame: Buffer;
	left: number;
	right: number;
	top: number;
	bottom: number;
}): number {
	let sum = 0;
	let count = 0;
	for (let y = Math.max(0, top); y <= Math.min(HEIGHT - 1, bottom); y += 1) {
		for (let x = Math.max(0, left); x <= Math.min(WIDTH - 1, right); x += 1) {
			const offset = (y * WIDTH + x) * 3;
			sum +=
				0.2126 * frame[offset] +
				0.7152 * frame[offset + 1] +
				0.0722 * frame[offset + 2];
			count += 1;
		}
	}
	return count ? sum / count : 0;
}

/** The 2nd-percentile luma of the pixels darker than the grey in a box. */
function darkLuma({
	frame,
	left,
	right,
	top,
	bottom,
}: {
	frame: Buffer;
	left: number;
	right: number;
	top: number;
	bottom: number;
}): number {
	const values: number[] = [];
	for (let y = Math.max(0, top); y <= Math.min(HEIGHT - 1, bottom); y += 1) {
		for (let x = Math.max(0, left); x <= Math.min(WIDTH - 1, right); x += 1) {
			const offset = (y * WIDTH + x) * 3;
			const luma =
				0.2126 * frame[offset] +
				0.7152 * frame[offset + 1] +
				0.0722 * frame[offset + 2];
			if (luma < GREY - 2) values.push(luma);
		}
	}
	values.sort((a, b) => a - b);
	return values.length ? values[Math.floor(values.length * 0.02)] : GREY;
}

/** How far a frame's text box is from the grey, against the full frame's. */
function textLevel({
	frame,
	full,
	box,
}: {
	frame: Buffer;
	full: Buffer;
	box: Box;
}): number {
	const region = {
		left: box.left,
		right: box.right,
		top: box.top,
		bottom: box.bottom,
	};
	let numerator = 0;
	let denominator = 0;
	for (let y = region.top; y <= region.bottom; y += 1) {
		for (let x = region.left; x <= region.right; x += 1) {
			const offset = (y * WIDTH + x) * 3;
			const target = full[offset + 1] - GREY;
			if (target < 60) continue;
			numerator += frame[offset + 1] - GREY;
			denominator += target;
		}
	}
	return denominator ? numerator / denominator : 0;
}

const isText = (r: number, g: number, b: number) =>
	r > 215 && g > 215 && b > 205;
const isGold = (r: number, g: number, b: number) =>
	r > 200 && g > 160 && b < 110;

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(900_000);

test("a film subtitle's weight, shadows and fade frames match in both export engines", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	test.skip(
		!existsSync("/System/Library/Fonts/Supplemental/GillSans.ttc"),
		"macOS fonts missing"
	);
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-film-caption-"));
	const { projectId } = run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Film caption style parity (delete me)",
		"--open"
	);
	const pid = ["--project-id", projectId];
	try {
		run(
			"editor:project:update-settings",
			...pid,
			"--data",
			JSON.stringify({ width: WIDTH, height: HEIGHT, fps: FPS })
		);
		const clip = path.join(workDir, "grey.mp4");
		execFileSync(FFMPEG, [
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`color=c=0x808080:s=${WIDTH}x${HEIGHT}:r=${FPS}`,
			"-t",
			"3",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			clip,
		]);
		const mainId = run<{ tracks: Array<{ id: string; isMain?: boolean }> }>(
			"editor:track:list",
			...pid
		).tracks.find((track) => track.isMain)?.id as string;
		run(
			"editor:media:batch-import",
			...pid,
			"--sources",
			clip,
			"--append-to-track",
			mainId
		);
		const lane = run<{ trackId: string }>(
			"editor:track:create",
			...pid,
			"--type",
			"captions",
			"--name",
			"字幕 电影"
		);
		const added = run<{ warnings?: string[] }>(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "captions",
				trackId: lane.trackId,
				startTime: START_FRAME / FPS,
				duration: (END_FRAME - START_FRAME) / FPS,
				content: "三年前你是最能打的人",
				secondaryContent: "Three years ago",
				style: {
					fontFamily: "Hiragino Mincho ProN",
					fontSize: 48,
					fontWeight: 600,
					letterSpacing: 4.8,
					fontColor: "#F4EFE6",
					outlineWidth: 0,
					bgOpacity: 0,
					shadows: [
						{ color: "#000000", opacity: 0.75, blur: 6, y: 3 },
						{ color: "#000000", opacity: 0.38, blur: 30 },
					],
					fadeInFrames: 4,
					fadeOutFrames: 3,
					secondary: {
						fontFamily: "Gill Sans",
						fontSize: 34,
						fontWeight: 400,
						letterSpacing: 1,
						fontColor: "#FFD700",
					},
				},
			})
		);
		expect(added.warnings ?? [], "nothing in the style ignored").toEqual([]);
		const exported = run<{
			tracks: Array<{ elements: Array<Record<string, unknown>> }>;
		}>("editor:timeline:export", ...pid);
		const stored = exported.tracks
			.flatMap((track) => track.elements)
			.find((element) => element.secondaryContent);
		expect(stored, "timeline export shows the film style").toMatchObject({
			style: {
				fontWeight: 600,
				fadeInFrames: 4,
				fadeOutFrames: 3,
				secondary: { letterSpacing: 1 },
			},
		});

		const fadeFrames = [12, 13, 14, 15, 16, 57, 58, 59, 60];
		const measured: Record<string, Record<string, unknown>> = {};
		for (const engine of ["native", "muxer"] as const) {
			const outputPath = path.join(workDir, `${engine}.mp4`);
			cli({
				apiPort,
				timeout: 600_000,
				args: [
					"editor:export:start",
					...pid,
					"--preset",
					"discord",
					"--fps",
					String(FPS),
					"--format",
					"mp4",
					"--output",
					outputPath,
					"--engine",
					engine,
					"--poll",
				],
			});
			expect(existsSync(outputPath), `${engine} export written`).toBe(true);
			const frames = readFrames({
				file: outputPath,
				frames: [36, ...fadeFrames],
			});
			const full = frames.get(36) as Buffer;
			const text = measure({ frame: full, match: isText });
			const second = measure({ frame: full, match: isGold });
			// The shadows darken the grey between the two lines, and most
			// just under the letters; far from the text the frame is the grey.
			const between = meanLuma({
				frame: full,
				left: text.left,
				right: text.right,
				top: text.bottom + 2,
				bottom: second.top - 2,
			});
			const darkest = darkLuma({
				frame: full,
				left: text.left - 10,
				right: text.right + 10,
				top: text.top - 10,
				bottom: second.bottom + 20,
			});
			const far = meanLuma({
				frame: full,
				left: 40,
				right: 240,
				top: 40,
				bottom: 120,
			});
			const fades = fadeFrames.map((frame) =>
				Number(
					textLevel({
						frame: frames.get(frame) as Buffer,
						full,
						box: text,
					}).toFixed(3)
				)
			);
			measured[engine] = { text, second, between, darkest, far, fades };
		}
		console.log(`[film-caption] ${JSON.stringify(measured)}`);

		const value = <T>(engine: string, key: string) =>
			measured[engine][key] as T;
		for (const engine of ["native", "muxer"] as const) {
			const text = value<Box>(engine, "text");
			const second = value<Box>(engine, "second");
			expect(text.count, `${engine} draws the text`).toBeGreaterThan(800);
			expect(second.count, `${engine} draws the second line`).toBeGreaterThan(
				200
			);
			expect(second.top, `${engine} order`).toBeGreaterThan(text.bottom);
			expect(value<number>(engine, "far"), `${engine} grey`).toBeGreaterThan(
				GREY - 4
			);
			expect(
				value<number>(engine, "between"),
				`${engine} shadow between the lines`
			).toBeLessThan(GREY - 4);
			expect(
				value<number>(engine, "darkest"),
				`${engine} shadow core`
			).toBeLessThan(GREY - 30);
			// Clear at the first frame, full from the fifth, clear at the end
			// frame; rising over the 4 frames in, falling over the 3 out. (The
			// levels sit under ¼, ½, ¾ because the shadow shows through the
			// half-faded letters; the opacity itself is pinned by unit tests.)
			const fades = value<number[]>(engine, "fades");
			expect(fades[0], `${engine} first frame`).toBeLessThan(0.05);
			expect(fades[4], `${engine} fifth frame`).toBeGreaterThan(0.95);
			expect(fades[5], `${engine} before the fade-out`).toBeGreaterThan(0.95);
			expect(fades[8], `${engine} end frame`).toBeLessThan(0.05);
			for (const index of [1, 2, 3, 4]) {
				expect(fades[index], `${engine} fade-in ${index}`).toBeGreaterThan(
					fades[index - 1] + 0.1
				);
			}
			for (const index of [6, 7, 8]) {
				expect(fades[index], `${engine} fade-out ${index}`).toBeLessThan(
					fades[index - 1] - 0.1
				);
			}
		}
		const nativeFades = value<number[]>("native", "fades");
		const muxerFades = value<number[]>("muxer", "fades");
		for (const [index, level] of nativeFades.entries()) {
			expect(
				Math.abs(level - muxerFades[index]),
				`fade frame ${fadeFrames[index]}: native ${level}, muxer ${muxerFades[index]}`
			).toBeLessThan(0.06);
		}
		for (const line of ["text", "second"] as const) {
			const a = value<Box>("native", line);
			const b = value<Box>("muxer", line);
			const width = (box: Box) => box.right - box.left + 1;
			expect(
				Math.abs(width(a) - width(b)) / Math.max(width(a), width(b)),
				`${line} width (letter spacing)`
			).toBeLessThan(0.06);
			expect(Math.abs(a.bottom - b.bottom), `${line} bottom`).toBeLessThan(6);
			expect(
				Math.abs(a.count - b.count) / Math.max(a.count, b.count),
				`${line} weight (lit pixels)`
			).toBeLessThan(0.25);
		}
		for (const key of ["between", "darkest"]) {
			expect(
				Math.abs(value<number>("native", key) - value<number>("muxer", key)),
				`shadow ${key}`
			).toBeLessThan(key === "between" ? 4 : 14);
		}
	} finally {
		await page.evaluate(() => {
			window.location.hash = "#/projects";
		});
		await page.waitForTimeout(1000);
		spawnSync(
			"bun",
			[
				"--silent",
				"run",
				"qcut",
				"--",
				"editor:project:delete",
				...pid,
				"--force",
				"--json",
			],
			{
				cwd: path.resolve("."),
				env: { ...process.env, QCUT_API_PORT: String(apiPort) },
				encoding: "utf8",
			}
		);
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
