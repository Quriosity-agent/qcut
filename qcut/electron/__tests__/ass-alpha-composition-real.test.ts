import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildFFmpegArgs,
	type BuildFFmpegArgsOptions,
} from "../ffmpeg-args-builder";
import { getFFmpegPath } from "../ffmpeg/paths";
import { buildAssAlphaLayer } from "../ffmpeg/ass-alpha-layer";
import { composePreparedVisualLayers } from "../ffmpeg/visual-layer-compositor";

const ffmpeg = getFFmpegPath();
const dir = mkdtempSync(path.join(tmpdir(), "qcut-ass-alpha-"));
const source = path.join(dir, "source.mkv");
const width = 160;
const height = 120;

function render({ args }: { args: string[] }) {
	const result = spawnSync(ffmpeg, ["-v", "error", ...args], {
		maxBuffer: 4 * 1024 * 1024,
		timeout: 20_000,
	});
	expect(result.status, result.stderr.toString()).toBe(0);
	return result.stdout;
}

beforeAll(() => {
	render({
		args: [
			"-f",
			"lavfi",
			"-i",
			`color=c=0x202020:s=${width}x${height}:r=10:d=1`,
			"-c:v",
			"ffv1",
			source,
		],
	});
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function assFile({
	alpha,
	color = "FFFF00",
	name,
}: {
	alpha: string;
	color?: string;
	name: string;
}) {
	const file = path.join(dir, `${name}.ass`);
	writeFileSync(
		file,
		`[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,24,&H00FFFFFF,&H00FFFFFF,&H800000FF,&H80000000,0,0,0,0,100,100,0,0,1,2,3,7,0,0,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.10,0:00:00.60,Default,,0,0,0,,{\\an7\\pos(10,10)\\p1\\bord0\\shad0\\1c&H${color}&\\1a&H${alpha}&}m 0 0 l 120 0 120 90 0 90
Dialogue: 1,0:00:00.20,0:00:00.50,Default,,0,0,0,,{\\pos(30,30)\\1a&H${alpha}&}Alpha
`
	);
	return file;
}

function graph({
	canonical,
	layers,
}: {
	canonical: boolean;
	layers: NonNullable<BuildFFmpegArgsOptions["textAssLayers"]>;
}) {
	const input = canonical
		? {
				videoSources: [
					{ path: source, startTime: 0, duration: 1, trackOrder: 2 },
				],
			}
		: { useVideoInput: true, videoInputPath: source };
	const args = buildFFmpegArgs({
		inputDir: dir,
		outputFile: path.join(dir, "unused.mp4"),
		width,
		height,
		fps: 10,
		duration: 1,
		quality: "high",
		includeEmbeddedAudio: false,
		textAssLayers: layers,
		...input,
	});
	const filterIndex = args.indexOf("-filter_complex");
	return {
		filter: filterIndex < 0 ? "" : args[filterIndex + 1],
		output: args[args.indexOf("-map") + 1].replace(/^\[|\]$/g, ""),
	};
}

function frames({ filter, output }: { filter: string; output: string }) {
	return render({
		args: [
			"-i",
			source,
			"-filter_complex",
			`${filter ? `${filter};` : ""}[${output}]format=rgb24[result]`,
			"-map",
			"[result]",
			"-frames:v",
			"10",
			"-f",
			"rawvideo",
			"-",
		],
	});
}

describe.each([false, true])("ASS compositing, canonical=%s", (canonical) => {
	it.each([
		"00",
		"4C",
		"80",
		"FF",
	])("matches direct opaque ASS exactly at alpha %s, including glyph edges and inactive frames", (alpha) => {
		const file = assFile({ alpha, name: `${canonical}-${alpha}` });
		const actual = frames(
			graph({
				canonical,
				layers: [{ path: file, blendMode: "normal", trackOrder: 0 }],
			})
		);
		const base = graph({ canonical, layers: [] });
		const direct = frames({
			filter: `${base.filter ? `${base.filter};` : ""}[${base.output}]format=yuva444p,ass=filename='${file}'[direct]`,
			output: "direct",
		});
		expect(actual.length).toBe(width * height * 3 * 10);
		expect(actual.equals(direct)).toBe(true);
		if (alpha === "4C") {
			const offset = width * height * 3 * 3 + (80 * width + 80) * 3;
			const [r, g, b] = actual.subarray(offset, offset + 3);
			expect(r).toBeLessThan(15);
			expect(g).toBeGreaterThan(180);
			expect(b).toBeGreaterThan(180);
		}
	});

	it("preserves track order when translucent ASS layers overlap", () => {
		const lower = assFile({ alpha: "4C", name: `${canonical}-lower` });
		const upper = assFile({
			alpha: "80",
			color: "0000FF",
			name: `${canonical}-upper`,
		});
		const actual = frames(
			graph({
				canonical,
				layers: [
					{ path: upper, blendMode: "normal", trackOrder: 0 },
					{ path: lower, blendMode: "normal", trackOrder: 1 },
				],
			})
		);
		const base = graph({ canonical, layers: [] });
		const direct = frames({
			filter: `${base.filter ? `${base.filter};` : ""}[${base.output}]format=yuva444p,ass=filename='${lower}',ass=filename='${upper}'[direct]`,
			output: "direct",
		});
		expect(actual.equals(direct)).toBe(true);
	});

	it.each([
		"multiply",
		"screen",
	] as const)("matches the direct opaque RGB %s reference for translucent shapes, glyphs and shadows", (blendMode) => {
		const file = assFile({ alpha: "4C", name: `${canonical}-${blendMode}` });
		const actual = frames(
			graph({ canonical, layers: [{ path: file, blendMode, trackOrder: 0 }] })
		);
		const referenceAss = path.join(
			dir,
			`${canonical}-${blendMode}-reference.ass`
		);
		writeFileSync(
			referenceAss,
			readFileSync(file, "utf8").replace(
				"[Script Info]",
				"[Script Info]\nYCbCr Matrix: None"
			)
		);
		const base = graph({ canonical, layers: [] });
		const matte = blendMode === "multiply" ? "white" : "black";
		const direct = frames({
			filter: [
				base.filter,
				`[${base.output}]format=rgba[reference_base]`,
				`color=c=${matte}:s=${width}x${height}:r=10:d=1,format=gbrp,ass=filename='${referenceAss}',format=rgba[matte]`,
				`[reference_base][matte]blend=all_mode=${blendMode}[direct]`,
			]
				.filter(Boolean)
				.join(";"),
			output: "direct",
		});
		expect(actual.length).toBe(width * height * 3 * 10);
		expect(actual.equals(direct)).toBe(true);
	});

	it.each([
		"overlay",
		"darken",
		"lighten",
	] as const)("matches known straight-RGBA coverage for %s", (blendMode) => {
		const file = assFile({ alpha: "4C", name: `${canonical}-${blendMode}` });
		const actual = frames(
			graph({ canonical, layers: [{ path: file, blendMode, trackOrder: 0 }] })
		);
		const base = graph({ canonical, layers: [] });
		const composed = composePreparedVisualLayers({
			baseLabel: base.output,
			layers: [
				{
					inputLabel: "ink",
					kind: "text",
					sourceOrder: 0,
					legacyOrder: 0,
					blendMode,
					startTime: 0.1,
					endTime: 0.5,
				},
			],
		});
		const reference = frames({
			filter: [
				base.filter,
				`color=c=0x00ffffb3:s=120x90:r=10:d=1,format=rgba,pad=${width}:${height}:10:10:color=black@0[ink]`,
				...composed.filterSteps,
			]
				.filter(Boolean)
				.join(";"),
			output: composed.outputLabel,
		});
		for (const frame of [0, 3, 8]) {
			const offset = (frame * width * height + 80 * width + 80) * 3;
			expect(actual.subarray(offset, offset + 3)).toEqual(
				reference.subarray(offset, offset + 3)
			);
		}
	});
});

describe("isolated ASS coverage", () => {
	it.each([
		"overlay",
		"darken",
		"lighten",
	] as const)("retains 70 percent alpha and straight cyan for %s", (blendMode) => {
		const file = assFile({ alpha: "4C", name: `isolated-${blendMode}` });
		const rgbAssPath = path.join(dir, `isolated-${blendMode}.rgb.ass`);
		const filters = buildAssAlphaLayer({
			sourcePath: file,
			rgbAssPath,
			assFilter: `ass=filename='${rgbAssPath}'`,
			outputLabel: "result",
			blendMode,
			width,
			height,
			duration: 1,
			fps: 10,
		});
		const rgba = render({
			args: [
				"-filter_complex",
				filters.join(";"),
				"-map",
				"[result]",
				"-frames:v",
				"10",
				"-pix_fmt",
				"rgba",
				"-f",
				"rawvideo",
				"-",
			],
		});
		const pixel = ({
			frame,
			x,
			y,
		}: {
			frame: number;
			x: number;
			y: number;
		}) => {
			const offset = (frame * width * height + y * width + x) * 4;
			return Array.from(rgba.subarray(offset, offset + 4));
		};
		expect(pixel({ frame: 3, x: 80, y: 80 })).toEqual([0, 255, 255, 179]);
		expect(pixel({ frame: 0, x: 80, y: 80 })).toEqual([0, 0, 0, 0]);
		expect(pixel({ frame: 3, x: 150, y: 110 })).toEqual([0, 0, 0, 0]);
		expect(readFileSync(file, "utf8")).not.toContain("YCbCr Matrix: None");
	});
});
