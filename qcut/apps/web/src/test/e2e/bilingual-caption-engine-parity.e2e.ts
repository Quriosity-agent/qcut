/**
 * A bilingual caption (N11 follow-up to the 2026-10-28 trailer report): one
 * caption carries a second-language line under its text, in its own font,
 * size and colour. Both export engines — the native FFmpeg pass (libass) and
 * the renderer muxer (canvas) — must draw both lines at the same places and
 * sizes, measured on exported frames: the text in white, the second line in
 * yellow, so each line's pixels can be told apart.
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

/** Extents of the pixels that `match`, over the whole frame. */
function measure({
	frame,
	match,
}: {
	frame: Buffer;
	match: (r: number, g: number, b: number) => boolean;
}) {
	let left = WIDTH;
	let right = -1;
	let top = HEIGHT;
	let bottom = -1;
	let count = 0;
	for (let y = 0; y < HEIGHT; y += 1) {
		for (let x = 0; x < WIDTH; x += 1) {
			const offset = (y * WIDTH + x) * 3;
			if (!match(frame[offset], frame[offset + 1], frame[offset + 2])) continue;
			count += 1;
			left = Math.min(left, x);
			right = Math.max(right, x);
			top = Math.min(top, y);
			bottom = Math.max(bottom, y);
		}
	}
	return {
		top,
		bottom,
		height: bottom - top + 1,
		centerX: (left + right) / 2,
		width: right - left + 1,
		count,
	};
}

const isWhite = (r: number, g: number, b: number) =>
	r > 190 && g > 190 && b > 190;
const isYellow = (r: number, g: number, b: number) =>
	r > 170 && g > 170 && b < 90;

test.use({ captureScreenshotVideo: false, appCredentials: "empty" });
test.setTimeout(600_000);

test("a bilingual caption's two lines measure the same from both export engines", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-bilingual-"));
	const { projectId } = run<{ projectId: string }>(
		"editor:project:create",
		"--name",
		"Bilingual caption parity (delete me)",
		"--open"
	);
	const pid = ["--project-id", projectId];
	try {
		run(
			"editor:project:update-settings",
			...pid,
			"--data",
			JSON.stringify({ width: WIDTH, height: HEIGHT, fps: 30 })
		);
		const clip = path.join(workDir, "black.mp4");
		execFileSync(FFMPEG, [
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`color=c=black:s=${WIDTH}x${HEIGHT}:r=30`,
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
			"字幕 双语"
		);
		run(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "captions",
				trackId: lane.trackId,
				startTime: 0,
				duration: 3,
				content: "第一回合",
				secondaryContent: "Round one",
				style: {
					fontFamily: "Songti SC",
					fontSize: 52,
					bold: true,
					fontColor: "#ffffff",
					bgOpacity: 0,
					outlineWidth: 0,
					shadowOffset: { x: 0, y: 0 },
					secondary: {
						fontFamily: "Futura",
						fontSize: 30,
						fontColor: "#ffff00",
						bold: false,
					},
				},
			})
		);
		const exported = run<{
			tracks: Array<{ elements: Array<Record<string, unknown>> }>;
		}>("editor:timeline:export", ...pid);
		const stored = exported.tracks
			.flatMap((track) => track.elements)
			.find((element) => element.secondaryContent);
		expect(stored, "timeline export shows the second line").toMatchObject({
			content: "第一回合",
			secondaryContent: "Round one",
			style: { secondary: { fontFamily: "Futura", fontSize: 30 } },
		});

		const measured: Record<
			string,
			{ text: ReturnType<typeof measure>; second: ReturnType<typeof measure> }
		> = {};
		for (const engine of ["native", "muxer"] as const) {
			const outputPath = path.join(workDir, `${engine}.mp4`);
			cli({
				apiPort,
				timeout: 420_000,
				args: [
					"editor:export:start",
					...pid,
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
			const frame = readFrame({ file: outputPath, time: 1.5 });
			measured[engine] = {
				text: measure({ frame, match: isWhite }),
				second: measure({ frame, match: isYellow }),
			};
		}
		console.log(`[bilingual] ${JSON.stringify(measured)}`);

		for (const engine of ["native", "muxer"] as const) {
			const { text, second } = measured[engine];
			expect(text.count, `${engine} draws the text`).toBeGreaterThan(200);
			expect(second.count, `${engine} draws the second line`).toBeGreaterThan(
				100
			);
			// The second line is under the text, and smaller.
			expect(second.top, `${engine} order`).toBeGreaterThan(text.bottom);
			expect(second.height, `${engine} sizes`).toBeLessThan(text.height);
			expect(second.bottom, `${engine} inset`).toBeLessThan(HEIGHT - 28);
		}
		const native = measured.native;
		const muxer = measured.muxer;
		for (const line of ["text", "second"] as const) {
			const a = native[line];
			const b = muxer[line];
			expect(
				Math.abs(a.height - b.height) / Math.max(a.height, b.height),
				`${line} height`
			).toBeLessThan(0.12);
			expect(Math.abs(a.bottom - b.bottom), `${line} bottom`).toBeLessThan(6);
			expect(Math.abs(a.centerX - b.centerX), `${line} centre x`).toBeLessThan(
				8
			);
		}
		// The gap between the two lines is the same in both engines.
		expect(
			Math.abs(
				native.second.top -
					native.text.bottom -
					(muxer.second.top - muxer.text.bottom)
			),
			"gap between the lines"
		).toBeLessThan(6);
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
