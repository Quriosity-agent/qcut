/**
 * The independent engine's manual body slim and zoom on timeline clips,
 * through a real export. The source's columns carry their own coordinate
 * (R a coarse ramp, G/B a 32-pixel sine/cosine phase of x), so every
 * exported pixel says which source column it shows. Each clip, a rotated
 * slim box and a magnifying and a shrinking zoom circle, must show the
 * columns the engine's own geometry picks
 * (`manual_body_render.slim_source_points` / `zoom_source_points`), and the
 * rest of the frame its own columns.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const ENGINE = path.resolve("research/independent-beauty/research");
const PYTHON = path.join(ENGINE, ".venv/bin/python");
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 24;
const PERIOD = 32;
type ManualBody =
	| {
			slim: {
				intensity: number;
				x: number;
				y: number;
				width: number;
				height: number;
				rotation: number;
			};
	  }
	| { zoom: { intensity: number; x: number; y: number; radius: number } };
const CLIPS: ManualBody[] = [
	{
		slim: {
			intensity: 40,
			x: 0.5,
			y: 0.5,
			width: 0.4,
			height: 0.7,
			rotation: 20,
		},
	},
	{ zoom: { intensity: 40, x: 0.45, y: 0.55, radius: 0.35 } },
	{ zoom: { intensity: -40, x: 0.55, y: 0.45, radius: 0.35 } },
];

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

/** One second of the column-coordinate frame, BT.709 tagged. */
function makeColumnSource({ dir }: { dir: string }): string {
	const file = path.join(dir, "columns.mp4");
	const geq =
		`geq=r='X*255/${WIDTH - 1}'` +
		`:g='128+127*sin(2*PI*X/${PERIOD})'` +
		`:b='128+127*cos(2*PI*X/${PERIOD})'`;
	execFileSync(FFMPEG, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=1,format=rgb24,${geq}`,
		"-vf",
		"scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
		"-c:v",
		"libx264",
		"-crf",
		"6",
		"-colorspace",
		"bt709",
		"-color_primaries",
		"bt709",
		"-color_trc",
		"bt709",
		"-color_range",
		"tv",
		file,
	]);
	return file;
}

/**
 * The engine's own source column (continuous: column c spans [c, c+1]) for
 * every pixel of a one-tool clip; pixels the tool leaves alone keep theirs.
 */
function engineColumns({
	dir,
	index,
	manualBody,
}: {
	dir: string;
	index: number;
	manualBody: ManualBody;
}): Float32Array {
	const file = path.join(dir, `expected-${index}.f32`);
	const script = [
		"import json, sys",
		"import numpy as np",
		`sys.path.insert(0, ${JSON.stringify(ENGINE)})`,
		"import manual_body_render as body",
		`width, height = ${WIDTH}, ${HEIGHT}`,
		`(tool, s), = json.loads(${JSON.stringify(JSON.stringify(manualBody))}).items()`,
		"columns = np.tile(np.arange(width, dtype=np.float64) + 0.5, (height, 1))",
		"if tool == 'slim':",
		"    table, step = body.load_slim_field()",
		"    rows, cols, points = body.slim_source_points(width=width, height=height, intensity=s['intensity'], x=s['x'], y=s['y'], rect_width=s['width'], rect_height=s['height'], rotation=s['rotation'], table=table, step=step)",
		"else:",
		"    rows, cols, points = body.zoom_source_points(width=width, height=height, **s)",
		"columns[rows, cols] = points[:, 0]",
		`columns.astype(np.float32).tofile(${JSON.stringify(file)})`,
	].join("\n");
	execFileSync(PYTHON, ["-B", "-c", script]);
	const bytes = readFileSync(file);
	return new Float32Array(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
	);
}

/**
 * The source column each exported pixel shows. The G/B phase gives it to
 * within the 32-column period; `near` picks the period. (The coarse R ramp
 * is not trusted for that: after two encodes it sits several levels off,
 * enough to slip a period.)
 */
function shownColumns({
	file,
	time,
	near,
}: {
	file: string;
	time: number;
	near: Float32Array;
}): Float32Array {
	const frame = execFileSync(
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
	const shown = new Float32Array(WIDTH * HEIGHT);
	for (let pixel = 0; pixel < shown.length; pixel += 1) {
		const offset = pixel * 3;
		const phase = Math.atan2(frame[offset + 1] - 128, frame[offset + 2] - 128);
		const fine =
			((((phase / (2 * Math.PI)) * PERIOD) % PERIOD) + PERIOD) % PERIOD;
		const reference = near[pixel] - 0.5;
		shown[pixel] =
			fine + Math.round((reference - fine) / PERIOD) * PERIOD + 0.5;
	}
	return shown;
}

function quantile({ sorted, share }: { sorted: number[]; share: number }) {
	return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("independent slim and zoom export the engine's columns on timeline clips", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	test.skip(!existsSync(PYTHON), "independent engine environment missing");
	await page.waitForLoadState("domcontentloaded");
	const status = await page.evaluate(() =>
		(
			window as unknown as {
				electronAPI?: {
					beautyLab?: {
						inspectIndependent?: () => Promise<{
							available: boolean;
							message: string;
							manualBodyTools?: string[];
						}>;
					};
				};
			}
		).electronAPI?.beautyLab?.inspectIndependent?.()
	);
	test.skip(
		!status?.available ||
			!["slim", "zoom"].every((tool) => status.manualBodyTools?.includes(tool)),
		`independent engine unavailable: ${status?.message}`
	);
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(
		path.join(tmpdir(), "qcut-independent-slim-zoom-")
	);
	try {
		const source = makeColumnSource({ dir: workDir });
		const { projectId } = run<{ projectId: string }>(
			"editor:project:create",
			"--name",
			"Independent slim and zoom",
			"--width",
			String(WIDTH),
			"--height",
			String(HEIGHT),
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
		run("editor:media:batch-import", ...pid, "--sources", source);
		for (const [index, manualBody] of CLIPS.entries()) {
			const { elementId } = run<{ elementId: string }>(
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify({
					type: "media",
					sourceName: "columns.mp4",
					trackId: mainId,
					startTime: index * 0.5,
					duration: 1,
					trimStart: 0,
					trimEnd: 0.5,
				})
			);
			run(
				"editor:timeline:update-element",
				...pid,
				"--element-id",
				elementId,
				"--data",
				JSON.stringify({
					portraitAdjustments: {
						enabled: true,
						engine: "independent",
						values: {},
						manualBody,
					},
				})
			);
		}

		// Kept as evidence beside the other Playwright outputs.
		const outputPath = path.resolve(
			"output/playwright/portrait-independent-slim-zoom/slim-zoom.mp4"
		);
		rmSync(outputPath, { force: true });
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
				"muxer",
				"--poll",
			],
		});
		expect(existsSync(outputPath), "export written").toBe(true);

		for (const [index, manualBody] of CLIPS.entries()) {
			const expected = engineColumns({ dir: workDir, index, manualBody });
			const shown = shownColumns({
				file: outputPath,
				time: index * 0.5 + 0.25,
				near: expected,
			});
			const movedErrors: number[] = [];
			const stillErrors: number[] = [];
			let planned = 0;
			let moved = 0;
			for (let pixel = 0; pixel < shown.length; pixel += 1) {
				const own = (pixel % WIDTH) + 0.5;
				const error = Math.abs(shown[pixel] - expected[pixel]);
				const shift = Math.abs(expected[pixel] - own);
				(shift > 0.5 ? movedErrors : stillErrors).push(error);
				planned = Math.max(planned, shift);
				moved = Math.max(moved, Math.abs(shown[pixel] - own));
			}
			movedErrors.sort((left, right) => left - right);
			stillErrors.sort((left, right) => left - right);
			const stats = (sorted: number[]) =>
				`median ${quantile({ sorted, share: 0.5 }).toFixed(2)} p99 ${quantile({ sorted, share: 0.99 }).toFixed(2)} max ${quantile({ sorted, share: 1 }).toFixed(2)}`;
			console.log(
				`clip ${index} ${JSON.stringify(manualBody)}: moved pixels ${movedErrors.length} (${stats(movedErrors)} px), still pixels (${stats(stillErrors)} px); engine moves up to ${planned.toFixed(1)} px, export shows up to ${moved.toFixed(1)} px`
			);
			// The tool really moves the picture...
			expect(planned, `clip ${index} planned motion`).toBeGreaterThan(5);
			expect(movedErrors.length, `clip ${index} moved area`).toBeGreaterThan(
				10_000
			);
			// ...and the export shows the engine's columns within coding noise.
			expect(quantile({ sorted: movedErrors, share: 0.5 })).toBeLessThan(0.5);
			expect(quantile({ sorted: movedErrors, share: 0.99 })).toBeLessThan(1.5);
			expect(quantile({ sorted: stillErrors, share: 0.5 })).toBeLessThan(0.5);
			expect(quantile({ sorted: stillErrors, share: 0.99 })).toBeLessThan(1.5);
		}
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
});
