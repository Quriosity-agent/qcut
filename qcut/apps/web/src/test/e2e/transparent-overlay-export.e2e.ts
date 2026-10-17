/**
 * Transparent overlays on an upper media track, exported by both engines.
 *
 * One clip on the main track, and above it the same transparent card in the
 * four formats the editor accepts — VP9 WebM with alpha, ProRes 4444,
 * QuickTime Animation and PNG in MOV — at 1, 2, 3 and 4 s, plus a fifth,
 * scaled, faded and screened. The card is clear except for an opaque red box
 * and a half-transparent blue band. Both the native and the muxer export must
 * keep the timeline's length, show the picture through the clear pixels,
 * draw the box and band on exactly the clips' frames, and agree with each
 * other. `timeline export` → `apply --replace` keeps every overlay field, and
 * a clip that cannot be decoded fails either export by name.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readSync,
	closeSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const FFPROBE = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffprobe");
const EVIDENCE_DIR = path.resolve(
	"output/playwright/transparent-overlay-export"
);
const W = 1280;
const H = 720;
const FPS = 24;
const SECONDS = 6;
const BASE = [60, 140, 60];
const RED_BOX = { x: 180, y: 140 };
const CLEAR = { x: 1000, y: 500 };
const BLUE_BAND = { x: 640, y: 320 };
const CLIP_SECONDS = 0.75;
const FORMATS = [
	{ file: "card-vp9.webm", start: 1 },
	{ file: "card-prores.mov", start: 2 },
	{ file: "card-qtrle.mov", start: 3 },
	{ file: "card-png.mov", start: 4 },
];
const CARD_FRAME =
	`color=c=black@0:s=${W}x${H}:r=${FPS}:d=1,format=rgba,` +
	"drawbox=x=100:y=80:w=160:h=120:color=red@1:t=fill:replace=1," +
	`drawbox=x=0:y=300:w=${W}:h=40:color=blue@0.5:t=fill:replace=1`;

type Json = Record<string, unknown>;

interface ExportedTimeline {
	tracks: Array<
		Json & {
			id: string;
			type: string;
			isMain?: boolean;
			elements: Array<Json & { id: string; sourceName?: string }>;
		}
	>;
}

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

function ffmpeg(args: string[]) {
	execFileSync(FFMPEG, ["-v", "error", "-y", ...args]);
}

/** The frames at `indexes` (output frame numbers) as RGB bytes. */
function framesAt({
	file,
	indexes,
}: {
	file: string;
	indexes: number[];
}): Map<number, Buffer> {
	const sorted = [...new Set(indexes)].sort((a, b) => a - b);
	const select = sorted.map((index) => `eq(n\\,${index})`).join("+");
	const raw = execFileSync(
		FFMPEG,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vf",
			`select='${select}'`,
			"-fps_mode",
			"passthrough",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: 512 * 1024 * 1024 }
	);
	const size = W * H * 3;
	return new Map(
		sorted.map((index, order) => [
			index,
			raw.subarray(order * size, (order + 1) * size),
		])
	);
}

function pixel(frame: Buffer, { x, y }: { x: number; y: number }): number[] {
	const index = (y * W + x) * 3;
	return [frame[index], frame[index + 1], frame[index + 2]];
}

function near(actual: number[], expected: number[], tolerance: number) {
	return expected.every(
		(value, channel) => Math.abs(actual[channel] - value) <= tolerance
	);
}

function frameCount(file: string): number {
	const out = execFileSync(
		FFPROBE,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-count_frames",
			"-show_entries",
			"stream=nb_read_frames",
			"-of",
			"csv=p=0",
			file,
		],
		{ encoding: "utf8" }
	);
	return Number(out.trim());
}

/** Average PSNR of two videos of the same size, frame by frame. */
function psnr(left: string, right: string): number {
	const result = spawnSync(
		FFMPEG,
		["-i", left, "-i", right, "-lavfi", "psnr", "-f", "null", "-"],
		{ encoding: "utf8" }
	);
	const match = result.stderr.match(/average:([\d.]+|inf)/);
	if (!match) throw new Error(`no PSNR in: ${result.stderr.slice(-400)}`);
	return match[1] === "inf" ? 99 : Number(match[1]);
}

/** The preview element showing timeline clip `elementId`. */
const previewClip = (elementId: string) =>
	`[data-video-preview-source][data-timeline-element-id="${elementId}"]`;

/** RGB of a PNG screenshot at `x`, `y`, decoded with the bundled FFmpeg. */
function screenshotPixels({
	png,
	width,
	height,
	points,
}: {
	png: string;
	width: number;
	height: number;
	points: Array<{ x: number; y: number }>;
}): number[][] {
	const raw = execFileSync(
		FFMPEG,
		[
			"-v",
			"error",
			"-i",
			png,
			"-vf",
			`scale=${width}:${height}`,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	return points.map(({ x, y }) => {
		const index = (Math.round(y) * width + Math.round(x)) * 3;
		return [raw[index], raw[index + 1], raw[index + 2]];
	});
}

function makeFixtures(dir: string) {
	// Tagged BT.709, so both engines read the base's colour the same way
	// (untagged HD decodes as 709 in Chromium and as 601 in FFmpeg).
	ffmpeg([
		"-f",
		"lavfi",
		"-i",
		`color=c=0x3c8c3c:s=${W}x${H}:r=${FPS}:d=${SECONDS},format=rgb24,` +
			"scale=out_color_matrix=bt709:out_range=tv,format=yuv420p," +
			"setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
		"-f",
		"lavfi",
		"-i",
		`sine=frequency=440:sample_rate=48000:duration=${SECONDS}`,
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-colorspace",
		"bt709",
		"-color_primaries",
		"bt709",
		"-color_trc",
		"bt709",
		"-color_range",
		"tv",
		"-c:a",
		"aac",
		path.join(dir, "base.mp4"),
	]);
	const codecs: Record<string, string[]> = {
		"card-vp9.webm": [
			"-c:v",
			"libvpx-vp9",
			"-pix_fmt",
			"yuva420p",
			"-crf",
			"10",
			"-b:v",
			"0",
			"-auto-alt-ref",
			"0",
		],
		"card-prores.mov": [
			"-c:v",
			"prores_ks",
			"-profile:v",
			"4",
			"-pix_fmt",
			"yuva444p10le",
		],
		"card-qtrle.mov": ["-c:v", "qtrle", "-pix_fmt", "argb"],
		"card-png.mov": ["-c:v", "png", "-pix_fmt", "rgba"],
	};
	for (const [file, codec] of Object.entries(codecs)) {
		ffmpeg(["-f", "lavfi", "-i", CARD_FRAME, ...codec, path.join(dir, file)]);
	}
	copyFileSync(
		path.join(dir, "card-png.mov"),
		path.join(dir, "card-styled.mov")
	);
	// A MOV cut off before its index: no decoder can open it.
	const whole = path.join(dir, "card-qtrle.mov");
	const head = Buffer.alloc(4096);
	const fd = openSync(whole, "r");
	readSync(fd, head, 0, head.length, 0);
	closeSync(fd);
	writeFileSync(path.join(dir, "broken.mov"), head);
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("transparent overlays export from both engines and round-trip", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-overlay-"));
	try {
		makeFixtures(workDir);
		const { projectId } = run<{ projectId: string }>(
			"editor:project:create",
			"--name",
			"Transparent overlays",
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
		const { tracks } = run<{ tracks: Array<{ id: string; isMain?: boolean }> }>(
			"editor:track:list",
			...pid
		);
		const mainId = tracks.find((track) => track.isMain)?.id as string;
		const sources = [
			"base.mp4",
			...FORMATS.map((format) => format.file),
			"card-styled.mov",
		].map((file) => path.join(workDir, file));
		run("editor:media:batch-import", ...pid, "--sources", sources.join(","));
		run(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "media",
				sourceName: "base.mp4",
				trackId: mainId,
				startTime: 0,
				duration: SECONDS,
			})
		);
		const overlay = run<{ trackId: string }>(
			"editor:track:create",
			...pid,
			"--type",
			"media",
			"--name",
			"Overlay",
			"--index",
			"0"
		);
		for (const { file, start } of [
			...FORMATS,
			{ file: "card-styled.mov", start: 5 },
		]) {
			run(
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify({
					type: "media",
					sourceName: file,
					trackId: overlay.trackId,
					startTime: start,
					duration: CLIP_SECONDS,
				})
			);
		}
		const placed = run<ExportedTimeline>("editor:timeline:export", ...pid);
		const styled = placed.tracks
			.find((track) => track.id === overlay.trackId)
			?.elements.find((element) => element.sourceName === "card-styled.mov");
		if (!styled) throw new Error("styled card not placed");
		run(
			"editor:element:patch",
			...pid,
			"--element-id",
			styled.id,
			"--set",
			JSON.stringify({
				x: 200,
				y: -60,
				scaleX: 0.5,
				scaleY: 0.5,
				opacity: 0.8,
				blendMode: "screen",
			})
		);

		// The listing and the timeline both say which sources are transparent.
		const before = run<ExportedTimeline>("editor:timeline:export", ...pid);
		const overlayTrack = before.tracks.find(
			(track) => track.id === overlay.trackId
		);
		expect(overlayTrack?.elements.map((element) => element.hasAlpha)).toEqual([
			true,
			true,
			true,
			true,
			true,
		]);
		const mainClip = before.tracks.find((track) => track.id === mainId)
			?.elements[0];
		expect(mainClip?.hasAlpha).toBe(false);
		const info = run<Json>(
			"editor:media:info",
			...pid,
			"--media-id",
			String(overlayTrack?.elements[0].sourceId)
		);
		expect(info).toMatchObject({
			codec: "vp9",
			alphaMode: 1,
			hasAlpha: true,
		});

		// Export, wreck, apply: the overlay track comes back field for field.
		mkdirSync(EVIDENCE_DIR, { recursive: true });
		const manifestPath = path.join(workDir, "manifest.json");
		writeFileSync(manifestPath, JSON.stringify(before));
		const applied = run<{ verified: boolean }>(
			"editor:timeline:apply",
			...pid,
			"--manifest",
			`@${manifestPath}`,
			"--replace"
		);
		expect(applied.verified).toBe(true);
		const after = run<ExportedTimeline>("editor:timeline:export", ...pid);
		const overlayFields = (timeline: ExportedTimeline) =>
			timeline.tracks
				.filter((track) => track.type === "media")
				.map((track) =>
					track.elements.map((element) => ({
						sourceName: element.sourceName,
						startTime: element.startTime,
						duration: element.duration,
						x: element.x ?? 0,
						y: element.y ?? 0,
						scaleX: element.scaleX ?? 1,
						scaleY: element.scaleY ?? 1,
						opacity: element.opacity ?? 1,
						blendMode: element.blendMode ?? "normal",
						blendEnabled: element.blendEnabled ?? true,
						fitMode: element.fitMode ?? "cover",
						hasAlpha: element.hasAlpha,
					}))
				);
		expect(overlayFields(after)).toEqual(overlayFields(before));

		// The preview plays the QuickTime Animation card from its alpha proxy
		// and shows the picture through its clear pixels.
		const qtrle = after.tracks
			.flatMap((track) => track.elements)
			.find((element) => element.sourceName === "card-qtrle.mov");
		const base = after.tracks
			.flatMap((track) => track.elements)
			.find((element) => element.sourceName === "base.mp4");
		if (!qtrle || !base) throw new Error("clips not restored");
		run("editor:timeline:seek", ...pid, "--time", "3.4");
		const proxySource = await page.waitForFunction(
			(selector) => {
				const video = document.querySelector<HTMLVideoElement>(
					`${selector} video`
				);
				if (!video || video.readyState < 2) return null;
				const token = video.currentSrc.split("app://local-media/")[1];
				if (!token) return null;
				const bytes = Uint8Array.from(
					atob(token.replaceAll("-", "+").replaceAll("_", "/")),
					(char) => char.charCodeAt(0)
				);
				return new TextDecoder().decode(bytes);
			},
			previewClip(qtrle.id),
			{ timeout: 30_000 }
		);
		expect(await proxySource.jsonValue()).toContain("/cache/alpha-proxies/");
		await page.waitForTimeout(500);
		const canvasBox = await page.locator(previewClip(base.id)).boundingBox();
		if (!canvasBox) throw new Error("preview canvas not found");
		const previewPng = path.join(EVIDENCE_DIR, "preview-qtrle.png");
		await page.screenshot({ path: previewPng, clip: canvasBox });
		const [previewBox, previewClear] = screenshotPixels({
			png: previewPng,
			width: W,
			height: H,
			points: [RED_BOX, CLEAR],
		});
		expect(near(previewBox, [255, 0, 0], 48), `preview box ${previewBox}`).toBe(
			true
		);
		expect(near(previewClear, BASE, 24), `preview clear ${previewClear}`).toBe(
			true
		);

		const outputs: Record<string, string> = {};
		const measured: Record<string, Json> = {};
		for (const engine of ["native", "muxer"] as const) {
			const outputPath = path.join(EVIDENCE_DIR, `${engine}.mp4`);
			rmSync(outputPath, { force: true });
			cli({
				apiPort,
				timeout: 600_000,
				args: [
					"editor:export:start",
					...pid,
					"--preset",
					"youtube-720p",
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
			outputs[engine] = outputPath;
			const frames = frameCount(outputPath);
			expect(frames, `${engine} frame count`).toBe(SECONDS * FPS);
			const checks: number[] = [];
			for (const { start } of FORMATS) {
				const first = start * FPS;
				const last = first + CLIP_SECONDS * FPS - 1;
				checks.push(first - 1, first, first + 9, last, last + 1);
			}
			const sampled = framesAt({ file: outputPath, indexes: checks });
			const failures: string[] = [];
			for (const { file, start } of FORMATS) {
				const first = start * FPS;
				const last = first + CLIP_SECONDS * FPS - 1;
				for (const index of [first, first + 9, last]) {
					const frame = sampled.get(index) as Buffer;
					if (!near(pixel(frame, RED_BOX), [255, 0, 0], 32))
						failures.push(
							`${file} frame ${index} box ${pixel(frame, RED_BOX)}`
						);
					if (!near(pixel(frame, CLEAR), BASE, 10))
						failures.push(
							`${file} frame ${index} clear ${pixel(frame, CLEAR)}`
						);
					if (
						!near(
							pixel(frame, BLUE_BAND),
							[BASE[0] / 2, BASE[1] / 2, (BASE[2] + 255) / 2],
							20
						)
					)
						failures.push(
							`${file} frame ${index} band ${pixel(frame, BLUE_BAND)}`
						);
				}
				for (const index of [first - 1, last + 1]) {
					const frame = sampled.get(index) as Buffer;
					if (!near(pixel(frame, RED_BOX), BASE, 10))
						failures.push(
							`${file} frame ${index} outside ${pixel(frame, RED_BOX)}`
						);
				}
			}
			measured[engine] = { frames, failures };
			expect(failures, `${engine} overlay pixels`).toEqual([]);
		}
		const enginePsnr = psnr(outputs.native, outputs.muxer);
		measured.enginePsnr = enginePsnr;
		console.log("transparent overlay export", JSON.stringify(measured));
		writeFileSync(
			path.join(EVIDENCE_DIR, "measurements.json"),
			`${JSON.stringify(measured, null, 2)}\n`
		);
		expect(enginePsnr, "native vs muxer PSNR (dB)").toBeGreaterThan(35);

		// A clip no decoder can open fails both exports, by name.
		run(
			"editor:media:batch-import",
			...pid,
			"--sources",
			path.join(workDir, "broken.mov")
		);
		run(
			"editor:timeline:add-element",
			...pid,
			"--data",
			JSON.stringify({
				type: "media",
				sourceName: "broken.mov",
				trackId: overlay.trackId,
				startTime: 5.5,
				duration: 0.4,
			})
		);
		for (const engine of ["native", "muxer"] as const) {
			let failure = "";
			try {
				cli({
					apiPort,
					timeout: 600_000,
					args: [
						"editor:export:start",
						...pid,
						"--preset",
						"youtube-720p",
						"--fps",
						String(FPS),
						"--format",
						"mp4",
						"--output",
						path.join(workDir, `broken-${engine}.mp4`),
						"--engine",
						engine,
						"--poll",
					],
				});
			} catch (error) {
				failure = error instanceof Error ? error.message : String(error);
			}
			expect(failure, `${engine} names the broken clip`).toContain(
				"broken.mov"
			);
		}
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
});
