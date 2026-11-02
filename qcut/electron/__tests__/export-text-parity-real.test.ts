/**
 * The Export dialog's FFmpeg export and the native export draw one timeline's
 * text and captions alike. Renders both with the real FFmpeg and libass over
 * black and compares the frames: comparing against native rather than against
 * the old output, because a block that was too small moves its edges in
 * opposite directions, which reads as a placement regression when it is a
 * size one.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
	CaptionElement,
	TextElement,
	TimelineTrack,
} from "../../apps/web/src/types/timeline";
import { buildTimelineAssLayers } from "../../apps/web/src/lib/export/export-engine-cli-text";
import type { AssFontMetricsLookup } from "../../packages/editor-core/src/captions/ass-generator.js";
import {
	assFontFamilyInstalled,
	assFontMetrics,
} from "../claude/handlers/claude-export-handler/ass-font-metrics.js";
import { prepareAssFontsDirectory } from "../claude/handlers/claude-export-handler/ass-fonts-dir.js";
import {
	buildTextAss,
	collectTextOverlays,
} from "../claude/handlers/claude-export-handler/text-overlay.js";
import type { ClaudeTimeline } from "../types/claude-api.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ffmpegPath =
	process.env.QCUT_TEST_FFMPEG ??
	path.resolve(
		testDir,
		`../resources/ffmpeg/${process.platform}-${process.arch}/ffmpeg${
			process.platform === "win32" ? ".exe" : ""
		}`
	);
const tempDir = path.resolve(testDir, "../../.tmp/export-text-parity-test");
const WIDTH = 1280;
const HEIGHT = 720;
/** Antialiasing and the half-pixel rounding of two ASS documents. */
const EDGE_TOLERANCE = 2;

/** What the `ffmpeg-ass-font-metrics` IPC answers: nothing for a missing face. */
const measuredFaces: AssFontMetricsLookup = (request) =>
	assFontFamilyInstalled({ family: request.family })
		? assFontMetrics(request)
		: undefined;

/** A Windows path's backslashes and drive colon would end a filter option. */
function escapeFilterPath(filePath: string): string {
	return filePath.replace(/\\/g, "/").replace(/:/g, "\\:");
}

let renderIndex = 0;

function renderAss(scripts: string[], size = { width: WIDTH, height: HEIGHT }) {
	const name = `render-${renderIndex++}`;
	const fontsDirectory = prepareAssFontsDirectory({
		scripts,
		directory: path.join(tempDir, `${name}-fonts`),
	});
	const filters = scripts.map((script, index) => {
		const assPath = path.join(tempDir, `${name}-${index}.ass`);
		fs.writeFileSync(assPath, script, "utf8");
		return `ass='${escapeFilterPath(assPath)}'${fontsDirectory ? `:fontsdir='${escapeFilterPath(fontsDirectory)}'` : ""}`;
	});
	const result = spawnSync(
		ffmpegPath,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`color=c=black:s=${size.width}x${size.height}:d=1.1:r=25`,
			"-vf",
			filters.join(","),
			// Late enough that every element in these tests is on screen.
			"-ss",
			"1",
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: size.width * size.height * 4, timeout: 60_000 }
	);
	if (result.status !== 0) throw new Error(result.stderr?.toString());
	return result.stdout;
}

/** The box around every pixel above a dim threshold. */
function inkBounds(
	frame: Buffer,
	size = { width: WIDTH, height: HEIGHT }
): {
	left: number;
	right: number;
	top: number;
	bottom: number;
} {
	let [left, right, top, bottom] = [size.width, -1, size.height, -1];
	for (let y = 0; y < size.height; y++) {
		for (let x = 0; x < size.width; x++) {
			const at = (y * size.width + x) * 3;
			if (Math.max(frame[at], frame[at + 1], frame[at + 2]) <= 40) continue;
			left = Math.min(left, x);
			right = Math.max(right, x);
			top = Math.min(top, y);
			bottom = Math.max(bottom, y);
		}
	}
	return { left, right, top, bottom };
}

/** How many pixels are close to a colour. */
function pixelsNear(frame: Buffer, [r, g, b]: number[]): number {
	let count = 0;
	for (let at = 0; at < frame.length; at += 3) {
		if (
			Math.abs(frame[at] - r) < 12 &&
			Math.abs(frame[at + 1] - g) < 12 &&
			Math.abs(frame[at + 2] - b) < 12
		) {
			count++;
		}
	}
	return count;
}

function expectSameBounds(frames: { dialog: Buffer; native: Buffer }): void {
	const dialog = inkBounds(frames.dialog);
	const native = inkBounds(frames.native);
	expect(dialog.right, "no ink drawn").toBeGreaterThan(-1);
	for (const edge of ["left", "right", "top", "bottom"] as const) {
		expect(
			Math.abs(dialog[edge] - native[edge]),
			`${edge}: dialog ${JSON.stringify(dialog)} native ${JSON.stringify(native)}`
		).toBeLessThanOrEqual(EDGE_TOLERANCE);
	}
}

function textElement(overrides: Partial<TextElement> = {}): TextElement {
	return {
		id: "text-1",
		type: "text",
		name: "Text",
		content: "QCut Hxg",
		fontSize: 96,
		fontFamily: "Arial",
		color: "#ffffff",
		backgroundColor: "transparent",
		textAlign: "center",
		fontWeight: "normal",
		fontStyle: "normal",
		textDecoration: "none",
		width: 1100,
		height: 420,
		x: 0,
		y: 0,
		rotation: 0,
		opacity: 1,
		duration: 2,
		startTime: 0,
		trimStart: 0,
		trimEnd: 0,
		...overrides,
	};
}

function captionElement(overrides: Partial<CaptionElement>): CaptionElement {
	return {
		id: "caption-1",
		type: "captions",
		name: "Caption",
		text: "Line one",
		language: "en",
		duration: 2,
		startTime: 0,
		trimStart: 0,
		trimEnd: 0,
		...overrides,
	} as CaptionElement;
}

function bothPaths(tracks: TimelineTrack[]): {
	dialog: Buffer;
	native: Buffer;
} {
	const { layers } = buildTimelineAssLayers({
		tracks,
		canvasWidth: WIDTH,
		canvasHeight: HEIGHT,
		fps: 30,
		platform: process.platform as "darwin" | "win32" | "linux",
		fontMetrics: measuredFaces,
	});
	const timeline = {
		name: "Parity",
		duration: 2,
		width: WIDTH,
		height: HEIGHT,
		fps: 30,
		tracks,
	} as unknown as ClaudeTimeline;
	return {
		dialog: renderAss(layers.map((layer) => layer.content)),
		native: renderAss([
			buildTextAss({
				overlays: collectTextOverlays(timeline),
				width: WIDTH,
				height: HEIGHT,
			}),
		]),
	};
}

const textTrack = (...elements: TextElement[]): TimelineTrack => ({
	id: "text-track",
	name: "Text",
	type: "text",
	elements,
});

const captionTrack = (id: string, element: CaptionElement): TimelineTrack =>
	({
		id,
		name: "Captions",
		type: "captions",
		elements: [element],
	}) as TimelineTrack;

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"Export dialog and native export text parity - real FFmpeg",
	{ timeout: 60_000 },
	() => {
		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
		});

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		for (const family of ["Arial", "Helvetica", "Songti SC"]) {
			describe.skipIf(!assFontFamilyInstalled({ family }))(family, () => {
				for (const verticalAlign of ["top", "middle", "bottom"] as const) {
					it(`draws a text element ${verticalAlign}-aligned where native does`, () => {
						expectSameBounds(
							bothPaths([
								textTrack(textElement({ fontFamily: family, verticalAlign })),
							])
						);
					});
				}
			});
		}

		describe.skipIf(!assFontFamilyInstalled({ family: "Arial" }))(
			"stacked captions",
			() => {
				const style = (align: "top" | "bottom") => ({
					fontFamily: "Arial",
					fontSize: 48,
					bgOpacity: 0,
					shadowOffset: { x: 0, y: 0 },
					position: { align, y: 90 },
				});
				for (const align of ["bottom", "top"] as const) {
					it(`stacks overlapping ${align} captions where native does`, () => {
						const frames = bothPaths([
							captionTrack(
								"track-1",
								captionElement({
									id: "first",
									text: "Started first",
									style: style(align),
								})
							),
							captionTrack(
								"track-2",
								captionElement({
									id: "later",
									text: "Started later",
									startTime: 0.01,
									style: style(align),
								})
							),
						]);
						expectSameBounds(frames);
						// Two lines of 48 px with 1.2 spacing and 16 px of padding: more
						// than one line's ink, which is what one caption over the other
						// would leave.
						const { top, bottom } = inkBounds(frames.dialog);
						expect(bottom - top).toBeGreaterThan(80);
					});
				}
			}
		);

		describe.skipIf(!assFontFamilyInstalled({ family: "Arial" }))(
			"an export at another resolution than the project",
			() => {
				it("scales text, captions and their outlines with the frame", () => {
					const { layers } = buildTimelineAssLayers({
						tracks: [
							textTrack(textElement({ strokeWidth: 16, strokeOpacity: 1 })),
							captionTrack(
								"track-1",
								captionElement({
									style: {
										fontFamily: "Arial",
										fontSize: 48,
										bgOpacity: 0,
										outlineColor: "#ffffff",
										outlineWidth: 16,
										shadowOffset: { x: 0, y: 0 },
										position: { align: "bottom", y: 90 },
									},
								} as Partial<CaptionElement>)
							),
						],
						canvasWidth: WIDTH,
						canvasHeight: HEIGHT,
						fps: 30,
						platform: process.platform as "darwin" | "win32" | "linux",
						fontMetrics: measuredFaces,
					});
					const scripts = layers.map((layer) => layer.content);
					const half = { width: WIDTH / 2, height: HEIGHT / 2 };
					const full = inkBounds(renderAss(scripts));
					const scaled = inkBounds(renderAss(scripts, half), half);
					// Two blank frames would agree on every edge below.
					expect(full.right, "no ink at full size").toBeGreaterThan(-1);
					expect(scaled.right, "no ink at half size").toBeGreaterThan(-1);
					expect(Math.abs(scaled.left - full.left / 2)).toBeLessThanOrEqual(2);
					expect(Math.abs(scaled.right - full.right / 2)).toBeLessThanOrEqual(
						2
					);
					expect(Math.abs(scaled.top - full.top / 2)).toBeLessThanOrEqual(2);
					expect(Math.abs(scaled.bottom - full.bottom / 2)).toBeLessThanOrEqual(
						2
					);
				});
			}
		);

		describe.skipIf(!assFontFamilyInstalled({ family: "Arial" }))(
			"CSS colours",
			() => {
				const cases: Array<{
					name: string;
					element: Partial<TextElement>;
					rgb: number[];
				}> = [
					{ name: "a named fill", element: { color: "red" }, rgb: [255, 0, 0] },
					{
						name: "an hsl() fill",
						element: { color: "hsl(120, 100%, 50%)" },
						rgb: [0, 255, 0],
					},
					{
						name: "a named background",
						element: {
							backgroundColor: "rebeccapurple",
							backgroundOpacity: 1,
						},
						rgb: [102, 51, 153],
					},
					{
						name: "a named stroke",
						element: {
							color: "#000000",
							strokeColor: "yellow",
							strokeWidth: 6,
							strokeOpacity: 1,
						},
						rgb: [255, 255, 0],
					},
					{
						name: "a named hard shadow",
						element: {
							color: "#000000",
							shadowColor: "lime",
							shadowOpacity: 1,
							shadowBlur: 0,
							shadowOffsetX: 12,
							shadowOffsetY: 12,
						},
						rgb: [0, 255, 0],
					},
				];
				for (const { name, element, rgb } of cases) {
					it(`draws ${name} as that colour in both paths`, () => {
						const { dialog, native } = bothPaths([
							textTrack(textElement(element)),
						]);
						expect(pixelsNear(dialog, rgb), "dialog").toBeGreaterThan(500);
						expect(pixelsNear(native, rgb), "native").toBeGreaterThan(500);
					});
				}

				it("draws a half-transparent outline at its own opacity in both paths", () => {
					const element = textElement({
						color: "#000000",
						strokeColor: "#ffffff",
						strokeWidth: 8,
						strokeOpacity: 0.5,
					});
					const { dialog, native } = bothPaths([textTrack(element)]);
					// Half white over black, not full white.
					const grey = [128, 128, 128];
					expect(pixelsNear(dialog, grey), "dialog").toBeGreaterThan(500);
					expect(pixelsNear(native, grey), "native").toBeGreaterThan(500);
				});
			}
		);
	}
);
