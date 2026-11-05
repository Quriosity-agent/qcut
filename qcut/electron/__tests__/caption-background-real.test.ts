import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type {
	CaptionElement,
	TimelineTrack,
} from "../../packages/editor-core/src/types/timeline.js";
import { resolveSubtitleStyle } from "../../packages/editor-core/src/captions/subtitle-style.js";
import { generateASS } from "../../packages/editor-core/src/captions/ass-generator.js";
import * as coreLayout from "../../packages/editor-core/src/captions/caption-layout.js";
import * as nativeLayout from "../claude/handlers/claude-export-handler/caption-layout.js";
import { buildTimelineAssLayers } from "../../apps/web/src/lib/export/export-engine-cli-text";
import {
	assFontFamilyInstalled,
	assFontMetrics,
} from "../claude/handlers/claude-export-handler/ass-font-metrics.js";
import { createNativeCaptionMeasurer } from "../claude/handlers/claude-export-handler/caption-background.js";
import {
	buildTextAss,
	collectTextOverlays,
} from "../claude/handlers/claude-export-handler/text-overlay.js";
import type { ClaudeTimeline } from "../types/claude-api.js";
import { rgbBounds } from "./helpers/rgb-bounds.js";

const WIDTH = 960;
const HEIGHT = 540;
const ffmpeg =
	process.env.QCUT_TEST_FFMPEG ??
	path.resolve(
		`electron/resources/ffmpeg/${process.platform}-${process.arch}/ffmpeg${process.platform === "win32" ? ".exe" : ""}`
	);
const directory = fs.mkdtempSync(
	path.join(os.tmpdir(), "qcut-caption-background-")
);
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
const measureText = createNativeCaptionMeasurer();
let index = 0;

function render({
	scripts,
	time = 1,
}: {
	scripts: string[];
	time?: number;
}): Buffer {
	const filters = scripts.map((script) => {
		const file = path.join(directory, `${index++}.ass`);
		fs.writeFileSync(file, script);
		return `ass='${file.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;
	});
	const result = spawnSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`color=black:s=${WIDTH}x${HEIGHT}:d=2.1:r=30`,
			"-vf",
			filters.join(","),
			"-ss",
			String(time),
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: WIDTH * HEIGHT * 4, timeout: 30_000 }
	);
	if (result.status !== 0) throw new Error(result.stderr.toString());
	expect(result.stdout.length).toBe(WIDTH * HEIGHT * 3);
	return result.stdout;
}

function fixture({
	align = "bottom",
	textAlign = "center",
	...style
}: Partial<NonNullable<CaptionElement["style"]>> & {
	align?: "top" | "center" | "bottom";
} = {}): CaptionElement {
	return {
		id: "caption",
		type: "captions",
		name: "Caption",
		text: "Primary line\nSecond row",
		secondaryText: "Bilingual\nsmall line",
		language: "en",
		source: "manual",
		startTime: 0,
		duration: 2,
		trimStart: 0,
		trimEnd: 0,
		style: resolveSubtitleStyle({
			fontFamily: "Arial",
			fontSize: 40,
			lineSpacing: 1.4,
			fontColor: "white",
			fontOpacity: 1,
			backgroundColor: "#0080ff",
			bgOpacity: 1,
			outlineWidth: 0,
			shadowOffset: { x: 0, y: 0 },
			position: { x: 50, y: 90, align },
			textAlign,
			secondary: { fontSize: 26, fontFamily: "Arial", fontColor: "white" },
			...style,
		}),
	};
}

function paths({
	captions,
	time = 1,
}: {
	captions: CaptionElement[];
	time?: number;
}): { dialog: Buffer; native: Buffer; scripts: string[] } {
	const tracks = captions.map((caption, i) => ({
		id: `track-${i}`,
		name: "Captions",
		type: "captions",
		elements: [caption],
	})) as TimelineTrack[];
	const { layers } = buildTimelineAssLayers({
		tracks,
		canvasWidth: WIDTH,
		canvasHeight: HEIGHT,
		fps: 30,
		measureCaptionText: measureText,
		fontMetrics: assFontMetrics,
	});
	const timeline = {
		name: "Background parity",
		duration: 2,
		width: WIDTH,
		height: HEIGHT,
		fps: 30,
		tracks: tracks.map((track) => ({
			...track,
			elements: track.elements.map((element) => ({
				...element,
				secondaryContent: (element as CaptionElement).secondaryText,
			})),
		})),
	} as unknown as ClaudeTimeline;
	const native = buildTextAss({
		overlays: collectTextOverlays(timeline),
		width: WIDTH,
		height: HEIGHT,
	});
	const scripts = layers.map((layer) => layer.content);
	return {
		dialog: render({ scripts, time }),
		native: render({ scripts: [native], time }),
		scripts: [...scripts, native],
	};
}

function blueBounds({ frame }: { frame: Buffer }) {
	return rgbBounds({
		frame,
		width: WIDTH,
		height: HEIGHT,
		matches: ({ r, g, b }) => b >= 20 && b > r + 15 && b > g + 10,
	});
}

function expectedBox({
	caption,
	stackOffset = 0,
}: {
	caption: CaptionElement;
	stackOffset?: number;
}) {
	const style = caption.style!;
	const secondary = style.secondary!;
	const rows = [
		...caption.text
			.split("\n")
			.map((text) => ({ text, fontSize: style.fontSize })),
		...caption
			.secondaryText!.split("\n")
			.map((text) => ({ text, fontSize: secondary.fontSize! })),
	];
	return coreLayout.captionBackgroundBox({
		lineWidths: rows.map((row) =>
			measureText({
				...row,
				fontFamily: "Arial",
				fontWeight: 400,
				italic: false,
				letterSpacing: 0,
			})
		),
		lineHeights: rows.map((row) => row.fontSize * style.lineSpacing),
		width: WIDTH,
		height: HEIGHT,
		align: style.position.align,
		textAlign: style.textAlign,
		stackOffset,
	});
}

describe("caption geometry compilation boundary", () => {
	for (const { engine, wrap } of [
		{ engine: "core", wrap: coreLayout.wrapCaptionLines },
		{ engine: "native", wrap: nativeLayout.wrapCaptionLines },
	]) {
		it.each([
			{ text: "abcdefgh x", expected: ["abcde", "fgh x"] },
			{ text: "abcdef  x", expected: ["abcde", "f  x"] },
			{ text: "abcdefg 字幕", expected: ["abcde", "fg 字幕"] },
			{ text: "abcdefg 👩‍👩‍👧‍👧", expected: ["abcde", "fg 👩‍👩‍👧‍👧"] },
			{ text: "abcdefghij x", expected: ["abcde", "fghij", "x"] },
			{ text: "abcdefghij   ", expected: ["abcde", "fghij"] },
			{ text: "q\n  abcdefgh x", expected: ["q", "abcde", "fgh x"] },
			{
				text: "abcdefgh x\n\nabcdef  x",
				expected: ["abcde", "fgh x", "", "abcde", "f  x"],
			},
		])(`${engine} preserves separators and intentional lines in $text`, ({
			text,
			expected,
		}) => {
			const graphemes = new Intl.Segmenter(undefined, {
				granularity: "grapheme",
			});
			expect(
				wrap({
					request: {
						text,
						fontFamily: "monospace",
						fontSize: 1,
						fontWeight: 400,
						italic: false,
						letterSpacing: 0,
					},
					maxWidth: 5,
					measureText: ({ text }) => [...graphemes.segment(text)].length,
				})
			).toEqual(expected);
		});
	}

	it("keeps the native geometry/wrapping mirror equivalent", () => {
		const args = {
			lineWidths: [120, 280],
			lineHeights: [56, 36.4],
			width: WIDTH,
			height: HEIGHT,
			align: "bottom",
			textAlign: "right",
			stackOffset: 80,
		} as const;
		expect(
			nativeLayout.captionBackgroundBox({
				...args,
				lineWidths: [...args.lineWidths],
				lineHeights: [...args.lineHeights],
			})
		).toEqual(
			coreLayout.captionBackgroundBox({
				...args,
				lineWidths: [...args.lineWidths],
				lineHeights: [...args.lineHeights],
			})
		);
		const request = {
			text: "Long words and 字幕换行测试重复文字",
			fontFamily: "Arial",
			fontSize: 40,
			fontWeight: 400,
			italic: false,
			letterSpacing: 1,
		};
		const wrapping = { request, maxWidth: 200, measureText };
		expect(nativeLayout.wrapCaptionLines(wrapping)).toEqual(
			coreLayout.wrapCaptionLines(wrapping)
		);
		expect(coreLayout.wrapCaptionLines(wrapping).length).toBeGreaterThan(2);
	});
});

describe.skipIf(
	!fs.existsSync(ffmpeg) || !assFontFamilyInstalled({ family: "Arial" })
)("caption padded backgrounds through real libass", () => {
	for (const align of ["top", "bottom"] as const) {
		it.each([
			"none",
			"karaoke",
		] as const)(`reserves wrapped predecessor boxes at ${align} with %s timing`, (karaokeMode) => {
			const first = fixture({ align, karaokeMode });
			first.text = "MMMMMMMMMMMM WWWWWWWWWWWW";
			first.duration = 1.2;
			first.words = [
				{ id: "first", type: "word", text: "MMMMMMMMMMMM", start: 0, end: 0.5 },
				{
					id: "second",
					type: "word",
					text: "WWWWWWWWWWWW",
					start: 0.6,
					end: 1.2,
				},
			];
			const second = {
				...fixture({ align, backgroundColor: "red", fontSize: 26 }),
				id: "later",
				startTime: 0.3,
				duration: 1.7,
				text: "Later",
				secondaryText: "Second",
			};
			const firstBox = expectedBox({
				caption: { ...first, text: "MMMMMMMMMMMM\nWWWWWWWWWWWW" },
			});
			const secondBox = expectedBox({
				caption: second,
				stackOffset: firstBox.height,
			});
			for (const time of [0.8, 1.7]) {
				const result = paths({ captions: [first, second], time });
				for (const frame of [result.dialog, result.native]) {
					const {
						top,
						bottom,
						count: pixels,
					} = rgbBounds({
						frame,
						width: WIDTH,
						height: HEIGHT,
						matches: ({ r, g, b }) => r > g + 50 && r > b + 50,
					});
					expect(pixels).toBeGreaterThan(3000);
					expect(Math.abs(top - secondBox.y)).toBeLessThanOrEqual(2);
					expect(
						Math.abs(bottom + 1 - secondBox.y - secondBox.height)
					).toBeLessThanOrEqual(2);
					if (align === "top")
						expect(top).toBeGreaterThanOrEqual(
							Math.floor(firstBox.y + firstBox.height) - 1
						);
					else expect(bottom).toBeLessThanOrEqual(Math.ceil(firstBox.y) + 1);
				}
			}
		});
	}
	it.each([
		"top",
		"center",
		"bottom",
	] as const)("keeps wrapped karaoke glyphs inside their measured background at %s", (align) => {
		const caption = fixture({
			align,
			karaokeMode: "karaoke",
			highlightColor: "yellow",
			upcomingColor: "white",
		});
		caption.text = "stale transcript";
		caption.secondaryText = undefined;
		caption.words = [
			{ id: "first", type: "word", text: "MMMMMMMMMMMM", start: 0, end: 0.6 },
			{
				id: "second",
				type: "word",
				text: "WWWWWWWWWWWW",
				start: 0.8,
				end: 1.5,
			},
		];
		const script = generateASS([caption], {
			resolution: { width: WIDTH, height: HEIGHT },
			fps: 30,
			measureText,
			fontMetrics: assFontMetrics,
		});
		const style = caption.style!;
		const expected = coreLayout.captionBackgroundBox({
			lineWidths: caption.words.map((word) =>
				measureText({
					text: word.text,
					fontFamily: "Arial",
					fontSize: 40,
					fontWeight: 400,
					italic: false,
					letterSpacing: 0,
				})
			),
			lineHeights: [40 * style.lineSpacing, 40 * style.lineSpacing],
			width: WIDTH,
			height: HEIGHT,
			align,
			textAlign: "center",
			stackOffset: 0,
		});
		const highlighted = [0.1, 1.9].map((time) => {
			const frame = render({ scripts: [script], time });
			const background = blueBounds({ frame });
			expect(background.count).toBeGreaterThan(20_000);
			for (const [actual, target] of [
				[background.left, expected.x],
				[background.top, expected.y],
				[background.right + 1, expected.x + expected.width],
				[background.bottom + 1, expected.y + expected.height],
			])
				expect(Math.abs(actual - target)).toBeLessThanOrEqual(2);
			let glyphs = 0;
			let yellow = 0;
			for (let y = 0; y < HEIGHT; y++) {
				for (let x = 0; x < WIDTH; x++) {
					const at = (y * WIDTH + x) * 3;
					if (frame[at] < 160 || frame[at + 1] < 160) continue;
					glyphs++;
					expect(x).toBeGreaterThan(background.left + 4);
					expect(x).toBeLessThan(background.right - 4);
					expect(y).toBeGreaterThan(background.top + 2);
					expect(y).toBeLessThan(background.bottom - 2);
					if (frame[at + 2] < 80) yellow++;
				}
			}
			expect(glyphs).toBeGreaterThan(4000);
			return yellow;
		});
		expect(highlighted[0]).toBeGreaterThan(100);
		expect(highlighted[1]).toBeGreaterThan(highlighted[0] * 5);
		expect(script).toContain("{\\kf80}MMMMMMMMMMMM\\N");
		expect(script).toContain("{\\kf120}WWWWWWWWWWWW");
	});
	for (const align of ["top", "center", "bottom"] as const) {
		for (const textAlign of ["left", "center", "right"] as const) {
			it(`matches the preview box for ${align}/${textAlign} bilingual multiline captions`, () => {
				const caption = fixture({ align, textAlign });
				const box = expectedBox({ caption });
				const result = paths({ captions: [caption] });
				for (const frame of [result.dialog, result.native]) {
					const bounds = blueBounds({ frame });
					expect(bounds.count).toBeGreaterThan(box.width * box.height * 0.65);
					for (const [actual, expected] of [
						[bounds.left, box.x],
						[bounds.top, box.y],
						[bounds.right + 1, box.x + box.width],
						[bounds.bottom + 1, box.y + box.height],
					])
						expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2);
				}
			});
		}
	}
	it("multiplies the color alpha by element opacity and frame fade while sliding", () => {
		const caption = fixture({
			align: "top",
			textAlign: "left",
			backgroundColor: "rgba(0, 128, 255, 0.5)",
			bgOpacity: 0.2,
			fontOpacity: 0.8,
			fadeInFrames: 12,
			animationType: "slide-left",
			animationDuration: 0.6,
		});
		const { dialog, native } = paths({ captions: [caption], time: 0.2 });
		for (const frame of [dialog, native]) {
			const bounds = blueBounds({ frame });
			expect(bounds.count).toBeGreaterThan(10_000);
			expect(Math.abs(bounds.left - 100)).toBeLessThanOrEqual(2);
			const at = (25 * WIDTH + 120) * 3;
			expect(frame[at + 2]).toBeGreaterThanOrEqual(45);
			expect(frame[at + 2]).toBeLessThanOrEqual(55);
		}
	});
	it("stacks complete padded boxes and retains outline and soft shadow layers", () => {
		const first = fixture({
			fontSize: 26,
			lineSpacing: 1.2,
			outlineWidth: 2,
			outlineColor: "lime",
			shadows: [{ x: 4, y: 4, blur: 2, color: "#ff0000", opacity: 1 }],
		});
		first.text = "One";
		first.secondaryText = "First";
		const second = {
			...first,
			id: "second",
			startTime: 0.2,
			duration: 1.8,
			text: "Two",
			secondaryText: "Second",
		};
		const result = paths({ captions: [first, second] });
		const firstBox = expectedBox({ caption: first });
		const secondBox = expectedBox({
			caption: second,
			stackOffset: firstBox.height,
		});
		for (const frame of [result.dialog, result.native]) {
			const bounds = blueBounds({ frame });
			expect(bounds.count).toBeGreaterThan(5000);
			expect(Math.abs(bounds.top - secondBox.y)).toBeLessThanOrEqual(2);
			expect(
				Math.abs(bounds.bottom + 1 - (firstBox.y + firstBox.height))
			).toBeLessThanOrEqual(2);
			let green = 0;
			let red = 0;
			for (let at = 0; at < frame.length; at += 3)
				if (
					frame[at + 1] > frame[at] + 50 &&
					frame[at + 1] > frame[at + 2] + 50
				)
					green++;
			for (let at = 0; at < frame.length; at += 3) {
				if (frame[at] > frame[at + 1] + 40 && frame[at] > frame[at + 2] + 40)
					red++;
			}
			expect(
				green,
				"glyph outlines remain visible above the background"
			).toBeGreaterThan(100);
			expect(
				red,
				"soft shadows remain visible above the background"
			).toBeGreaterThan(30);
		}
		for (const script of result.scripts) expect(script).toContain("\\blur");
	});
});
