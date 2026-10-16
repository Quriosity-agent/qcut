/**
 * Text and captions must look the same from both export engines: the native
 * FFmpeg pass (libass) and the renderer muxer (canvas). Both are measured on
 * exported frames — glyph extents (font size, letter spacing), the glow, and
 * where captions sit — so a drift in either engine fails here, not in a
 * viewer's eye.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const WIDTH = 1280;
const HEIGHT = 720;
/**
 * A 24 fps clip of 99 frames on a 30 fps project: 123.75 frames, so the
 * timeline does not end on a frame and both engines must still end there.
 */
const CLIP_SECONDS = 4.125;
const PROJECT_FPS = 30;

function cli<T>({
	apiPort,
	args,
	timeout = 300_000,
}: {
	apiPort: number;
	args: string[];
	timeout?: number;
}): Promise<T> {
	return new Promise((resolve, reject) => {
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
			reject(new Error(`${args[0]} failed: ${child.stdout}\n${child.stderr}`));
			return;
		}
		const stdout = child.stdout;
		const last = stdout.trimEnd().lastIndexOf("\n{");
		resolve(JSON.parse(stdout.slice(last + 1)) as T);
	});
}

/** A black 4 s clip at the canvas size, so every lit pixel is text. */
function makeBlackClip({ dir }: { dir: string }): string {
	const file = path.join(dir, "black.mp4");
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=${WIDTH}x${HEIGHT}:r=24`,
		"-f",
		"lavfi",
		"-i",
		"anullsrc=r=48000:cl=stereo",
		"-t",
		String(CLIP_SECONDS),
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

/** The frame at `time` as packed RGB, read straight from ffmpeg. */
function readFrame({ file, time }: { file: string; time: number }): Buffer {
	const result = spawnSync(
		FFMPEG,
		[
			"-v",
			"error",
			"-ss",
			String(time),
			"-i",
			file,
			"-frames:v",
			"1",
			"-vf",
			`scale=${WIDTH}:${HEIGHT}`,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	if (result.status !== 0) {
		throw new Error(`ffmpeg frame read failed: ${result.stderr.toString()}`);
	}
	return result.stdout;
}

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
	count: number;
}

/** Bounding box of the pixels in rows [rowStart, rowEnd) that `match`. */
function boundingBox({
	frame,
	rowStart,
	rowEnd,
	match,
}: {
	frame: Buffer;
	rowStart: number;
	rowEnd: number;
	match: (r: number, g: number, b: number) => boolean;
}): Box {
	const box: Box = {
		left: WIDTH,
		top: HEIGHT,
		right: -1,
		bottom: -1,
		count: 0,
	};
	for (let y = rowStart; y < rowEnd; y += 1) {
		for (let x = 0; x < WIDTH; x += 1) {
			const offset = (y * WIDTH + x) * 3;
			if (!match(frame[offset], frame[offset + 1], frame[offset + 2])) continue;
			box.count += 1;
			if (x < box.left) box.left = x;
			if (x > box.right) box.right = x;
			if (y < box.top) box.top = y;
			if (y > box.bottom) box.bottom = y;
		}
	}
	return box;
}

const isWhite = (r: number, g: number, b: number) =>
	r > 190 && g > 190 && b > 190;
/** The glow colour #4FA3FF seen through blur: a blue tint, however faint. */
const isGlow = (r: number, g: number, b: number) =>
	b > 40 && b - r > 20 && !isWhite(r, g, b);

function describe(box: Box) {
	return {
		width: box.right - box.left + 1,
		height: box.bottom - box.top + 1,
		centerX: (box.left + box.right) / 2,
		centerY: (box.top + box.bottom) / 2,
		bottom: box.bottom,
		count: box.count,
	};
}

function srtTime(seconds: number): string {
	const whole = Math.floor(seconds);
	const ms = Math.round((seconds - whole) * 1000);
	const m = String(Math.floor(whole / 60)).padStart(2, "0");
	const s = String(whole % 60).padStart(2, "0");
	return `00:${m}:${s},${String(ms).padStart(3, "0")}`;
}

/** Relative difference of two lengths, in percent. */
function percentApart(a: number, b: number): number {
	return (Math.abs(a - b) / Math.max(a, b)) * 100;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(600_000);

test("text and captions measure the same from the native and muxer engines", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-text-parity-"));
	const clip = makeBlackClip({ dir: workDir });

	const { projectId } = await run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Text parity",
		"--open"
	);
	const pid = ["--project-id", projectId];
	await run(
		"editor:project:update-settings",
		...pid,
		"--data",
		JSON.stringify({ width: WIDTH, height: HEIGHT, fps: PROJECT_FPS })
	);
	const settings = await run<{ width: number; height: number }>(
		"editor:project:settings",
		...pid
	);
	expect([settings.width, settings.height], "canvas size").toEqual([
		WIDTH,
		HEIGHT,
	]);
	const { tracks } = await run<{
		tracks: Array<{ id: string; isMain?: boolean }>;
	}>("editor:track:list", ...pid);
	const mainId = tracks.find((track) => track.isMain)?.id as string;
	await run(
		"editor:media:batch-import",
		...pid,
		"--sources",
		clip,
		"--append-to-track",
		mainId
	);

	// The drill's text: Songti SC 96 bold, white with a black stroke, a blue
	// glow and letter spacing, a little above the centre.
	await run(
		"editor:timeline:add-element",
		...pid,
		"--data",
		JSON.stringify({
			type: "text",
			content: "门的计划 QCUT",
			startTime: 0,
			duration: 4,
			fontSize: 96,
			fontFamily: "Songti SC",
			fontWeight: "bold",
			color: "#ffffff",
			strokeColor: "#000000",
			strokeWidth: 4,
			glowColor: "#4FA3FF",
			glowOpacity: 0.9,
			glowBlur: 24,
			letterSpacing: 20,
			x: 0,
			y: -140,
		})
	);
	// Two overlapping captions (two lanes) and one Latin caption on its own.
	const srtPath = path.join(workDir, "captions.srt");
	writeFileSync(
		srtPath,
		[
			`1\n${srtTime(0.5)} --> ${srtTime(2.6)}\n第一句字幕\n`,
			`2\n${srtTime(1.0)} --> ${srtTime(2.4)}\n第二句字幕\n`,
			`3\n${srtTime(3.0)} --> ${srtTime(4.0)}\nCaption line\n`,
		].join("\n")
	);
	await run(
		"editor:captions:import",
		...pid,
		"--file",
		srtPath,
		"--language",
		"zh"
	);

	const { duration: timelineSeconds } = await run<{ duration: number }>(
		"editor:timeline:export",
		...pid
	);
	expect(
		Math.abs(timelineSeconds - CLIP_SECONDS),
		"timeline length"
	).toBeLessThan(0.002);

	const measured: Record<string, Record<string, unknown>> = {};
	for (const engine of ["native", "muxer"] as const) {
		const outputPath = path.join(workDir, `${engine}.mp4`);
		await cli({
			apiPort,
			timeout: 420_000,
			args: [
				"editor:export:start",
				...pid,
				// The 1280 × 720 preset matches the canvas, so neither engine scales.
				"--preset",
				"discord",
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
		const probe = spawnSync(
			path.resolve("electron/resources/ffmpeg/darwin-arm64/ffprobe"),
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=width,height",
				"-of",
				"csv=p=0",
				outputPath,
			],
			{ encoding: "utf8" }
		);
		expect(probe.stdout.trim(), `${engine} frame size`).toBe(
			`${WIDTH},${HEIGHT}`
		);
		// The picture ends where the timeline ends: the muxer cuts its last
		// frame to the remainder instead of a whole frame. FFmpeg's constant
		// frame rate cannot shorten a frame, so the native engine drops the
		// partial one instead (its first PTS can also sit a frame late after
		// the concat), and AAC frame granularity may stretch either file's
		// sound by up to two frames of 1024 samples.
		const probeLength = spawnSync(
			path.resolve("electron/resources/ffmpeg/darwin-arm64/ffprobe"),
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=start_time,duration,nb_frames:format=duration",
				"-of",
				"json",
				outputPath,
			],
			{ encoding: "utf8" }
		);
		const parsed = JSON.parse(probeLength.stdout) as {
			streams: Array<{
				start_time: string;
				duration: string;
				nb_frames: string;
			}>;
			format: { duration: string };
		};
		const video = parsed.streams[0];
		const videoEnd = Number(video.start_time) + Number(video.duration);
		const label = `${engine} video ${video.nb_frames} frames, ends ${videoEnd.toFixed(4)}, file ${parsed.format.duration}`;
		const frames = Number(video.nb_frames);
		const timelineFrames = timelineSeconds * PROJECT_FPS;
		expect(frames, label).toBeGreaterThanOrEqual(Math.floor(timelineFrames));
		expect(frames, label).toBeLessThanOrEqual(Math.ceil(timelineFrames));
		if (engine === "muxer") {
			expect(frames, label).toBe(Math.ceil(timelineFrames));
		}
		expect(Math.abs(videoEnd - timelineSeconds), label).toBeLessThanOrEqual(
			engine === "muxer" ? 0.002 : 1 / PROJECT_FPS + 0.002
		);
		const fileOvershoot = Number(parsed.format.duration) - timelineSeconds;
		expect(fileOvershoot, label).toBeGreaterThanOrEqual(-0.002);
		expect(fileOvershoot, label).toBeLessThanOrEqual(
			(2 * 1024) / 48_000 + 0.002
		);
		const overlap = readFrame({ file: outputPath, time: 2.0 });
		const latin = readFrame({ file: outputPath, time: 3.5 });
		const textRows = { rowStart: 0, rowEnd: HEIGHT / 2 + 40 };
		const captionRows = { rowStart: HEIGHT - 260, rowEnd: HEIGHT };
		const text = describe(
			boundingBox({ frame: overlap, ...textRows, match: isWhite })
		);
		const glow = boundingBox({ frame: overlap, ...textRows, match: isGlow });
		measured[engine] = {
			text,
			glowPixels: glow.count,
			captionsOverlap: describe(
				boundingBox({ frame: overlap, ...captionRows, match: isWhite })
			),
			captionLatin: describe(
				boundingBox({ frame: latin, ...captionRows, match: isWhite })
			),
		};
	}
	console.log("text/caption parity", JSON.stringify(measured, null, 1));
	const native = measured.native;
	const muxer = measured.muxer;
	const nativeText = native.text as ReturnType<typeof describe>;
	const muxerText = muxer.text as ReturnType<typeof describe>;

	// Font size and letter spacing: the glyph run has the same height and width.
	expect(
		percentApart(nativeText.height, muxerText.height),
		"text height"
	).toBeLessThan(6);
	expect(
		percentApart(nativeText.width, muxerText.width),
		"text width"
	).toBeLessThan(6);
	expect(
		Math.abs(nativeText.centerX - muxerText.centerX),
		"text centre x"
	).toBeLessThan(8);
	expect(
		Math.abs(nativeText.centerY - muxerText.centerY),
		"text centre y"
	).toBeLessThan(8);
	// The glow is there in both, hugging the glyphs rather than a box.
	expect(native.glowPixels as number, "native glow").toBeGreaterThan(1500);
	expect(muxer.glowPixels as number, "muxer glow").toBeGreaterThan(1500);
	expect(
		Math.max(native.glowPixels as number, muxer.glowPixels as number) /
			Math.min(native.glowPixels as number, muxer.glowPixels as number),
		"glow extent ratio"
	).toBeLessThan(2.5);
	// Captions: same size, same place (the preview's 28 px bottom inset), the
	// same handling of two lanes at once.
	for (const key of ["captionsOverlap", "captionLatin"] as const) {
		const a = native[key] as ReturnType<typeof describe>;
		const b = muxer[key] as ReturnType<typeof describe>;
		expect(percentApart(a.height, b.height), `${key} height`).toBeLessThan(8);
		expect(Math.abs(a.bottom - b.bottom), `${key} bottom`).toBeLessThan(8);
		expect(Math.abs(a.centerX - b.centerX), `${key} centre x`).toBeLessThan(8);
		expect(a.bottom, `${key} sits above the inset`).toBeLessThan(HEIGHT - 28);
		expect(a.bottom, `${key} sits near the bottom`).toBeGreaterThan(
			HEIGHT - 70
		);
	}
	// Two captions at once stack: the pair spans two line boxes, not one.
	const single = (muxer.captionLatin as ReturnType<typeof describe>).height;
	for (const engine of [native, muxer]) {
		const pair = engine.captionsOverlap as ReturnType<typeof describe>;
		expect(pair.height, "stacked captions").toBeGreaterThan(single * 2);
	}
});
