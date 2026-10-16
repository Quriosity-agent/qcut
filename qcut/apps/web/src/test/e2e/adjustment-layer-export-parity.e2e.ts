import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

/**
 * C3: an adjustment layer graded the preview but not the native export. The
 * same project is exported with both engines and the frames are measured:
 * inside the layer's window both are desaturated and darker, outside both are
 * untouched, and the two engines agree within codec tolerance.
 */

/** The 门的计划 clip; QCUT_SHOT_SPLIT_E2E_SOURCE points at it on other machines. */
const SOURCE =
	process.env.QCUT_SHOT_SPLIT_E2E_SOURCE ??
	"/Users/peter/Documents/QCut/Projects/481632c1-df20-4317-8c79-041922c3ab50/media/08_机甲滑索接战三种怪物.mp4";
const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
/** Per-channel agreement between the two export engines (8-bit levels). */
const ENGINE_TOLERANCE = 20;

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
		execFile(
			"bun",
			["--silent", "run", "qcut", "--", ...args, "--json", "--flat"],
			{
				cwd: path.resolve("."),
				env: { ...process.env, QCUT_API_PORT: String(apiPort) },
				maxBuffer: 8 * 1024 * 1024,
				timeout,
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

interface Rgb {
	r: number;
	g: number;
	b: number;
}

/** Mean RGB of the frame at `time`, from a 1×1 area downscale. */
function meanRgb({ file, time }: { file: string; time: number }): Rgb {
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
			"scale=1:1:flags=area",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: 1024 * 1024 }
	);
	if (result.status !== 0) {
		throw new Error(`ffmpeg sample failed: ${result.stderr?.toString()}`);
	}
	const [r, g, b] = result.stdout;
	return { r, g, b };
}

function luma({ r, g, b }: Rgb): number {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

interface Exported {
	tracks: Array<{
		id: string;
		elements: Array<{
			id: string;
			type: string;
			duration: number;
			colorSettings?: { enabled?: boolean };
		}>;
	}>;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("the native export grades adjustment layers the way the renderer does", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(SOURCE), "the 门的计划 clip is not on this machine");
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");

	const { projectId } = await cli<{ projectId: string }>({
		apiPort,
		args: ["editor:project:create", "--name", "Adjustment parity", "--open"],
	});
	const { tracks } = await cli<{
		tracks: Array<{ id: string; isMain?: boolean }>;
	}>({ apiPort, args: ["editor:track:list", "--project-id", projectId] });
	const mainId = tracks.find((track) => track.isMain)?.id as string;
	await cli({
		apiPort,
		args: [
			"editor:media:batch-import",
			"--project-id",
			projectId,
			"--sources",
			SOURCE,
			"--append-to-track",
			mainId,
		],
	});
	const before = await cli<Exported>({
		apiPort,
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	const clip = before.tracks.find((track) => track.id === mainId)?.elements[0];
	if (!clip) throw new Error("clip not placed");
	// Six seconds keeps both exports short.
	await cli({
		apiPort,
		args: [
			"editor:element:patch",
			"--project-id",
			projectId,
			"--element-id",
			clip.id,
			"--set",
			JSON.stringify({ trimEnd: clip.duration - 6 }),
		],
	});
	// The layer covers the first three seconds only.
	await cli({
		apiPort,
		args: [
			"editor:timeline:add-element",
			"--project-id",
			projectId,
			"--data",
			JSON.stringify({
				type: "adjustment",
				startTime: 0,
				duration: 3,
				adjustments: { saturation: -100, brightness: -30 },
			}),
		],
	});
	const after = await cli<Exported>({
		apiPort,
		args: ["editor:timeline:export", "--project-id", projectId],
	});
	const layer = after.tracks
		.flatMap((track) => track.elements)
		.find((element) => element.type === "adjustment");
	// The snapshot carries the resolved grade the native export renders.
	console.log("adjustment parity snapshot", JSON.stringify(layer));
	expect(layer?.colorSettings?.enabled).toBe(true);

	const outDir = mkdtempSync(path.join(tmpdir(), "qcut-adjustment-parity-"));
	try {
		const samples: Record<string, { inside: Rgb; outside: Rgb }> = {};
		for (const engine of ["native", "muxer"] as const) {
			const outputPath = path.join(outDir, `${engine}.mp4`);
			await cli({
				apiPort,
				timeout: 420_000,
				args: [
					"editor:export:start",
					"--project-id",
					projectId,
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
			samples[engine] = {
				inside: meanRgb({ file: outputPath, time: 1.5 }),
				outside: meanRgb({ file: outputPath, time: 4.5 }),
			};
		}
		console.log("adjustment parity samples", JSON.stringify(samples));

		for (const engine of ["native", "muxer"] as const) {
			const { inside, outside } = samples[engine];
			// Saturation −100: the channels collapse to grey.
			expect(
				Math.abs(inside.r - inside.g),
				`${engine} grey`
			).toBeLessThanOrEqual(10);
			expect(
				Math.abs(inside.g - inside.b),
				`${engine} grey`
			).toBeLessThanOrEqual(10);
			// Brightness −30: darker than the ungraded picture.
			expect(luma(inside), `${engine} darker`).toBeLessThan(luma(outside) - 10);
		}
		for (const where of ["inside", "outside"] as const) {
			for (const channel of ["r", "g", "b"] as const) {
				expect(
					Math.abs(
						samples.native[where][channel] - samples.muxer[where][channel]
					),
					`${where} ${channel}`
				).toBeLessThanOrEqual(ENGINE_TOLERANCE);
			}
		}
	} finally {
		rmSync(outDir, { recursive: true, force: true });
	}
});
