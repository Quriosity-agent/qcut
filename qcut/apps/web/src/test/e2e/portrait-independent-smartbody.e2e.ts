/**
 * The independent engine's smart body on a timeline photo, through a real export: long
 * legs, slim waist and small head together. The exported frame must match the engine's
 * own render of the same photo (`body_smart_render.py`) within coding noise in both the
 * lower and the upper body, and differ clearly from the photo in both. The fixture is a
 * local full-body photo (not in Git); the test skips without it or without the private
 * body networks.
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
const CONTROLS = { StretchLeg: 100, SlimWaist: 80, SmallHead: 60 };
const BODY_CONTROLS = [
	"SmallHead",
	"SwanNeck",
	"SlimArm",
	"OrthoShoulder",
	"WidenShoulderTest",
	"SlimBody",
	"SlimWaist",
	"StretchLeg",
	"SlimBreast",
	"SlimHip",
].map((name) => `body_adjust_${name}`);

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

/**
 * Mean channel difference of the export from the engine and from the photo, over the
 * pixels the engine moved (any channel more than `threshold` from the photo).
 */
function warpedDifference({
	exported,
	engine,
	original,
	from,
	to,
	threshold = 24,
}: {
	exported: Buffer;
	engine: Buffer;
	original: Buffer;
	from: number;
	to: number;
	threshold?: number;
}) {
	let pixels = 0;
	let vsEngine = 0;
	let vsOriginal = 0;
	for (let pixel = from * WIDTH; pixel < to * WIDTH; pixel += 1) {
		const index = pixel * 3;
		let moved = false;
		for (let channel = 0; channel < 3; channel += 1)
			moved ||=
				Math.abs(engine[index + channel] - original[index + channel]) >
				threshold;
		if (!moved) continue;
		pixels += 1;
		for (let channel = 0; channel < 3; channel += 1) {
			vsEngine += Math.abs(exported[index + channel] - engine[index + channel]);
			vsOriginal += Math.abs(
				exported[index + channel] - original[index + channel]
			);
		}
	}
	return {
		share: pixels / ((to - from) * WIDTH),
		vsEngine: vsEngine / Math.max(1, pixels * 3),
		vsOriginal: vsOriginal / Math.max(1, pixels * 3),
	};
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("independent smart body exports the engine's render on a timeline photo", async ({
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
		!status?.available ||
			!BODY_CONTROLS.every((key) => status.controls.includes(key)),
		`independent smart body unavailable: ${status?.message}`
	);
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(
		path.join(tmpdir(), "qcut-independent-smartbody-")
	);
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
				path.join(ENGINE, "body_smart_render.py"),
				"--image",
				photo,
				"--controls",
				JSON.stringify(CONTROLS),
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
			"Independent smart body",
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
					values: Object.fromEntries(
						Object.entries(CONTROLS).map(([name, value]) => [
							`body_adjust_${name}`,
							value,
						])
					),
				},
			})
		);

		// Kept as evidence beside the other Playwright outputs.
		const outputPath = path.resolve(
			"output/playwright/portrait-independent-smartbody/smartbody.mp4"
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
		const half = HEIGHT / 2;
		const lowerVsEngine = meanDifference({
			left: exported,
			right: expected,
			from: half,
			to: HEIGHT,
		});
		const lowerVsOriginal = meanDifference({
			left: exported,
			right: original,
			from: half,
			to: HEIGHT,
		});
		console.log(
			`lower body: export vs engine ${lowerVsEngine.toFixed(2)}, export vs original ${lowerVsOriginal.toFixed(2)}`
		);
		// The export carries the engine's warp within coding noise (about 2.3 at the
		// TikTok bitrate), and the long legs move the lower body far more than that.
		expect(lowerVsEngine).toBeLessThan(4);
		expect(lowerVsOriginal).toBeGreaterThan(lowerVsEngine * 4);
		// The small head and slim waist move fewer pixels: on the ones the engine moved,
		// the export follows the engine, not the photo.
		for (const [name, rows] of Object.entries({
			upper: { from: 0, to: half },
			lower: { from: half, to: HEIGHT },
		})) {
			const warped = warpedDifference({
				exported,
				engine: expected,
				original,
				...rows,
			});
			console.log(
				`${name} body, ${(warped.share * 100).toFixed(2)}% of pixels moved: export vs engine ${warped.vsEngine.toFixed(2)}, export vs original ${warped.vsOriginal.toFixed(2)}`
			);
			expect(warped.share, `${name} body moved`).toBeGreaterThan(0.005);
			expect(
				warped.vsOriginal,
				`${name} body follows the engine`
			).toBeGreaterThan(warped.vsEngine * 3);
		}
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
});
