/**
 * The independent engine's manual body stretch on timeline clips, through a
 * real export. The source's rows carry their own coordinate (R a coarse
 * ramp, G/B a 32-pixel sine/cosine phase), so every exported row says which
 * source row it shows. Two clips, one lengthening the band and one
 * shortening it, must show exactly the rows the engine's own geometry
 * (`manual_body_render.stretch_source_rows`) picks, the shortened one with
 * the uncovered strips at the frame edges keeping the photo's own rows.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
const CLIPS = [
	{ intensity: 40, upper: 0.7, bottom: 0.3 },
	{ intensity: -40, upper: 0.65, bottom: 0.25 },
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

/** One second of the row-coordinate frame, BT.709 tagged. */
function makeRowSource({ dir }: { dir: string }): string {
	const file = path.join(dir, "rows.mp4");
	const geq =
		`geq=r='Y*255/${HEIGHT - 1}'` +
		`:g='128+127*sin(2*PI*Y/${PERIOD})'` +
		`:b='128+127*cos(2*PI*Y/${PERIOD})'`;
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
 * The source row (continuous, row r spans [r, r+1]) each exported row shows.
 * The G/B phase gives it to within the 32-row period; `near` picks the
 * period. (The coarse R ramp is not trusted for that: after two encodes its
 * ends sit 5–11 levels off, enough to slip a period.)
 */
function shownRows({
	file,
	time,
	near,
}: {
	file: string;
	time: number;
	near: number[];
}): number[] {
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
	const rows: number[] = [];
	for (let row = 0; row < HEIGHT; row += 1) {
		const reference = near[row] - 0.5;
		const estimates: number[] = [];
		for (let column = WIDTH / 4; column < (3 * WIDTH) / 4; column += 4) {
			const offset = (row * WIDTH + column) * 3;
			const phase = Math.atan2(
				frame[offset + 1] - 128,
				frame[offset + 2] - 128
			);
			const fine =
				((((phase / (2 * Math.PI)) * PERIOD) % PERIOD) + PERIOD) % PERIOD;
			estimates.push(fine + Math.round((reference - fine) / PERIOD) * PERIOD);
		}
		estimates.sort((left, right) => left - right);
		rows.push(estimates[Math.floor(estimates.length / 2)] + 0.5);
	}
	return rows;
}

/** The engine's own source rows for a band, null where the photo shows. */
function engineRows(stretch: (typeof CLIPS)[number]): Array<number | null> {
	const script = [
		"import json, math, sys",
		`sys.path.insert(0, ${JSON.stringify(ENGINE)})`,
		"import manual_body_render as body",
		`rows = body.stretch_source_rows(height=${HEIGHT}, intensity=${stretch.intensity}, upper=${stretch.upper}, bottom=${stretch.bottom})`,
		"print(json.dumps([None if math.isnan(r) else r for r in rows.tolist()]))",
	].join("\n");
	return JSON.parse(
		execFileSync(PYTHON, ["-B", "-c", script], { encoding: "utf8" })
	) as Array<number | null>;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("independent stretch exports the engine's rows on timeline clips", async ({
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
		!status?.available || !status.manualBodyTools?.includes("stretch"),
		`independent engine unavailable: ${status?.message}`
	);
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-independent-stretch-"));
	try {
		const source = makeRowSource({ dir: workDir });
		const { projectId } = run<{ projectId: string }>(
			"editor:project:create",
			"--name",
			"Independent stretch",
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
		const elementIds: string[] = [];
		for (const [index, stretch] of CLIPS.entries()) {
			const added = run<{ elementId: string }>(
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify({
					type: "media",
					sourceName: "rows.mp4",
					trackId: mainId,
					startTime: index * 0.5,
					duration: 1,
					trimStart: 0,
					trimEnd: 0.5,
				})
			);
			const elementId = added.elementId;
			elementIds.push(elementId);
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
						manualBody: { stretch },
					},
				})
			);
		}

		// Kept as evidence beside the other Playwright outputs.
		const outputPath = path.resolve(
			"output/playwright/portrait-independent-stretch/stretch.mp4"
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

		for (const [index, stretch] of CLIPS.entries()) {
			const expected = engineRows(stretch);
			// Rows the band leaves uncovered show the photo's own row.
			const want = expected.map((value, row) => value ?? row + 0.5);
			const shown = shownRows({
				file: outputPath,
				time: index * 0.5 + 0.25,
				near: want,
			});
			const errors = shown
				.map((value, row) => Math.abs(value - want[row]))
				.sort((left, right) => left - right);
			const at = (share: number) =>
				errors[Math.min(errors.length - 1, Math.floor(share * errors.length))];
			const moved = Math.max(
				...shown.map((value, row) => Math.abs(value - (row + 0.5)))
			);
			const uncovered = expected.filter((value) => value === null).length;
			console.log(
				`clip ${index} (${stretch.intensity}): row error median ${at(0.5).toFixed(2)} p99 ${at(0.99).toFixed(2)} max ${at(1).toFixed(2)} px; moved up to ${moved.toFixed(1)} px; uncovered rows ${uncovered}`
			);
			// Within the export's coding noise of the engine's own rows...
			expect(at(0.5), `clip ${index} median`).toBeLessThan(0.5);
			expect(at(0.99), `clip ${index} p99`).toBeLessThan(1);
			expect(at(1), `clip ${index} max`).toBeLessThan(2);
			// ...and far from an unstretched frame.
			expect(moved, `clip ${index} stretched`).toBeGreaterThan(5);
			if (stretch.intensity < 0) expect(uncovered).toBeGreaterThan(0);
		}
		// With no engine named, clips whose only portrait edit is a stretch band
		// must still go to the renderer (the route once sent them to native,
		// which exports portrait edits as if there were none).
		const autoPath = path.resolve(
			"output/playwright/portrait-independent-stretch/stretch-auto.mp4"
		);
		rmSync(autoPath, { force: true });
		const autoJob = cli<{ engine?: string }>({
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
				autoPath,
				"--poll",
			],
		});
		console.log("auto export engine", autoJob.engine);
		expect(autoJob.engine, "auto export engine").toBe("renderer-muxer");
		const autoWant = engineRows(CLIPS[0]).map(
			(value, row) => value ?? row + 0.5
		);
		const autoShown = shownRows({ file: autoPath, time: 0.25, near: autoWant });
		const autoWorst = Math.max(
			...autoShown.map((value, row) => Math.abs(value - autoWant[row]))
		);
		expect(autoWorst, "auto export stretched").toBeLessThan(2);
		expect(elementIds).toHaveLength(2);
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
});
