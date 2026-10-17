/**
 * The independent engine's smart long leg (长腿) on a timeline photo, through a real
 * export. The exported frame must match the engine's own render of the same photo
 * (`body_longleg_render.py`) within coding noise, show the legs moved, and leave the
 * upper body as it was. The fixture is a local full-body photo (not in Git); the test
 * skips without it or without the private body networks.
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
const PHOTO =
	process.env.QCUT_BODY_PHOTO ??
	path.resolve(
		"output/playwright/jianying-portrait-control-audit/fixtures/body-original.png"
	);
// The TikTok preset's size, so the photo fills the canvas pixel for pixel.
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 24;

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

/** RGB bytes of an image file, or of one video frame at `time`. */
function rgbFrame({ file, time }: { file: string; time?: number }): Buffer {
	return execFileSync(
		FFMPEG,
		[
			"-v",
			"error",
			...(time === undefined ? [] : ["-ss", String(time)]),
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
}

/** Mean absolute channel difference over rows [from, to). */
function meanDifference({
	left,
	right,
	from,
	to,
}: {
	left: Buffer;
	right: Buffer;
	from: number;
	to: number;
}) {
	let total = 0;
	for (let index = from * WIDTH * 3; index < to * WIDTH * 3; index += 1) {
		total += Math.abs(left[index] - right[index]);
	}
	return total / ((to - from) * WIDTH * 3);
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("independent smart long leg exports the engine's render on a timeline photo", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	test.skip(!existsSync(PYTHON), "independent engine environment missing");
	test.skip(!existsSync(PHOTO), "local full-body photo missing");
	await page.waitForLoadState("domcontentloaded");
	const status = await page.evaluate(() =>
		(
			window as unknown as {
				electronAPI?: {
					beautyLab?: {
						inspectIndependent?: () => Promise<{
							available: boolean;
							message: string;
							controls: string[];
						}>;
					};
				};
			}
		).electronAPI?.beautyLab?.inspectIndependent?.()
	);
	test.skip(
		!status?.available || !status.controls.includes("body_adjust_StretchLeg"),
		`independent smart long leg unavailable: ${status?.message}`
	);
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-independent-longleg-"));
	try {
		const photo = path.join(workDir, "body.png");
		execFileSync(FFMPEG, [
			"-v",
			"error",
			"-i",
			PHOTO,
			"-vf",
			`scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=rgb24`,
			photo,
		]);
		const reference = path.join(workDir, "reference.png");
		// Frames above 1280 render at original resolution, as the app does.
		execFileSync(
			PYTHON,
			[
				"-B",
				path.join(ENGINE, "body_longleg_render.py"),
				"--image",
				photo,
				"--controls",
				JSON.stringify({ StretchLeg: 100 }),
				"--output",
				reference,
				"--report",
				path.join(workDir, "reference.json"),
			],
			{ env: { ...process.env, BEAUTY_RENDER_RESOLUTION: "original" } }
		);
		const { projectId } = run<{ projectId: string }>(
			"editor:project:create",
			"--name",
			"Independent long leg",
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
		run("editor:media:batch-import", ...pid, "--sources", photo);
		const { elementId } = run<{ elementId: string }>(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "media",
				sourceName: path.basename(photo),
				trackId: mainId,
				startTime: 0,
				duration: 1,
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
					values: { body_adjust_StretchLeg: 100 },
				},
			})
		);

		// Kept as evidence beside the other Playwright outputs.
		const outputPath = path.resolve(
			"output/playwright/portrait-independent-longleg/longleg.mp4"
		);
		rmSync(outputPath, { force: true });
		const job = cli<{ engine?: string }>({
			apiPort,
			timeout: 600_000,
			args: [
				"editor:export:start",
				...pid,
				"--preset",
				"tiktok",
				"--fps",
				String(FPS),
				"--format",
				"mp4",
				"--output",
				outputPath,
				"--poll",
			],
		});
		// A clip whose only portrait edit is a body slider still needs the renderer.
		expect(job.engine, "auto export engine").toBe("renderer-muxer");
		expect(existsSync(outputPath), "export written").toBe(true);

		const exported = rgbFrame({ file: outputPath, time: 0.5 });
		const expected = rgbFrame({ file: reference });
		const original = rgbFrame({ file: photo });
		const legsVsEngine = meanDifference({
			left: exported,
			right: expected,
			from: HEIGHT / 2,
			to: HEIGHT,
		});
		const legsVsOriginal = meanDifference({
			left: exported,
			right: original,
			from: HEIGHT / 2,
			to: HEIGHT,
		});
		const upperVsOriginal = meanDifference({
			left: exported,
			right: original,
			from: 0,
			to: Math.round(HEIGHT * 0.4),
		});
		console.log(
			`legs: export vs engine ${legsVsEngine.toFixed(2)}, export vs original ${legsVsOriginal.toFixed(2)}; upper body vs original ${upperVsOriginal.toFixed(2)}`
		);
		// The export carries the engine's warp within coding noise (about 2.3 on
		// this photo at the TikTok bitrate)...
		expect(legsVsEngine).toBeLessThan(4);
		expect(legsVsOriginal).toBeGreaterThan(legsVsEngine * 4);
		// ...and the upper body is the photo's own.
		expect(upperVsOriginal).toBeLessThan(4);
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
});
