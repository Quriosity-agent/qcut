import { describe, expect, it } from "vitest";
import {
	assFontMetrics,
	assFontSizeFactor,
} from "../claude/handlers/claude-export-handler/ass-font-metrics.js";
import {
	buildTextAss,
	collectTextOverlays,
} from "../claude/handlers/claude-export-handler/text-overlay.js";
import { collectJianyingTextOverlays } from "../claude/handlers/claude-export-handler/jianying-text-overlay.js";
import type { ClaudeTimeline } from "../types/claude-api.js";

/**
 * libass stacks a font's own line height with the em at its bottom, CSS
 * centres the em in its line box: a pinned top or bottom edge moves by half
 * the difference. Computed from the installed font, so the expectation holds
 * on any machine (an uninstalled family counts as a one-em line).
 */
function halfLeading({
	family,
	fontSize,
	lineHeight,
	bold = false,
}: {
	family: string;
	fontSize: number;
	lineHeight: number;
	bold?: boolean;
}): number {
	const { lineHeightEm } = assFontMetrics({ family, bold });
	return (fontSize * lineHeight - fontSize * lineHeightEm) / 2;
}

describe("native export text overlays", () => {
	it("routes stable Jianying references away from ordinary ASS text", () => {
		const timeline: ClaudeTimeline = {
			name: "Original Jianying text",
			duration: 5,
			width: 1920,
			height: 1080,
			fps: 30,
			tracks: [
				{
					id: "jianying-titles",
					index: 3,
					name: "Jianying titles",
					type: "text",
					elements: [
						{
							id: "jianying-title",
							trackIndex: 3,
							startTime: 0,
							endTime: 5,
							duration: 5,
							type: "text",
							content: "花字",
							trimStart: 0.2,
							trimEnd: 0.3,
							width: 1024,
							height: 512,
							jianyingTextStyle: {
								schemaVersion: 1,
								source: "jianying-cache",
								packageKind: "ScriptInfoSticker",
								resourceId: "7328639616670649634",
								packageHash: "22192237621BA88A20B84176DDB9D22A",
								editMode: "runtime-with-preload-fallback",
								slotMapping: "line-to-widget",
								timeMapping: "stretch",
								templateDuration: 3,
							},
						},
					],
				},
			],
		};

		expect(collectTextOverlays(timeline)).toEqual([]);
		expect(collectJianyingTextOverlays({ timeline })).toEqual([
			expect.objectContaining({
				id: "jianying-title",
				startTime: 0.2,
				endTime: 4.7,
				sourceStart: 0.2,
				elementDuration: 5,
				width: 1024,
				height: 512,
				trackOrder: 3,
				reference: expect.objectContaining({
					packageHash: "22192237621ba88a20b84176ddb9d22a",
				}),
			}),
		]);
	});

	it("rejects an invalid Jianying reference instead of silently exporting plain text", () => {
		const timeline: ClaudeTimeline = {
			name: "Broken Jianying text",
			duration: 2,
			width: 1920,
			height: 1080,
			fps: 30,
			tracks: [
				{
					index: 0,
					name: "Titles",
					type: "text",
					elements: [
						{
							id: "broken",
							trackIndex: 0,
							startTime: 0,
							endTime: 2,
							duration: 2,
							type: "text",
							content: "花字",
							style: { jianyingTextStyle: { resourceId: "missing" } },
						},
					],
				},
			],
		};

		expect(collectTextOverlays(timeline)).toEqual([]);
		expect(() => collectJianyingTextOverlays({ timeline })).toThrow(
			"invalid stable resource reference"
		);
	});

	it("collects full text styling and ignores hidden text", () => {
		const timeline: ClaudeTimeline = {
			name: "Text audit",
			duration: 4,
			width: 1920,
			height: 1080,
			fps: 30,
			tracks: [
				{
					id: "titles",
					index: 0,
					name: "Titles",
					type: "text",
					elements: [
						{
							id: "title-1",
							trackIndex: 0,
							startTime: 0.5,
							endTime: 3.5,
							duration: 3,
							type: "text",
							content: "QCut\nCLI",
							fontSize: 72,
							fontFamily: "Helvetica Neue",
							color: "#ffcc00",
							backgroundColor: "#101010",
							backgroundOpacity: 0.8,
							fontWeight: "bold",
							fontStyle: "italic",
							x: 120,
							y: -80,
							rotation: 6,
							strokeWidth: 3,
							animationType: "fade",
							animationDuration: 0.4,
						},
						{
							id: "hidden",
							trackIndex: 0,
							startTime: 0,
							endTime: 1,
							duration: 1,
							type: "text",
							content: "Do not export",
							hidden: true,
						},
					],
				},
			],
		};

		const overlays = collectTextOverlays(timeline);
		expect(overlays).toHaveLength(1);
		expect(overlays[0]).toEqual(
			expect.objectContaining({
				content: "QCut\nCLI",
				fontSize: 72,
				color: "#ffcc00",
				backgroundOpacity: 0.8,
				fontWeight: "bold",
				animationType: "fade",
			})
		);

		const ass = buildTextAss({ overlays, width: 1920, height: 1080 });
		expect(ass).toContain("PlayResX: 1920");
		// libass sizes by win ascent + descent; the Fontsize carries the factor
		// that makes the em the preview's 72 px (1 where the font is unknown).
		const factor = assFontSizeFactor({
			family: "Helvetica Neue",
			bold: true,
			italic: true,
		});
		expect(ass).toContain(`Helvetica Neue,${(72 * factor).toFixed(2)}`);
		// The box is centred on (x, y) and the text is centred in the box.
		expect(ass).toContain("\\pos(1080.00,460.00)\\q1");
		expect(ass).toContain("\\frz-6.00\\fad(400,0)");
		expect(ass).toContain("QCut\\NCLI");
		expect(ass).not.toContain("Do not export");
	});

	it("wraps and aligns text in its box like the preview, with letter spacing", () => {
		const timeline: ClaudeTimeline = {
			name: "Box",
			duration: 4,
			width: 1280,
			height: 720,
			fps: 30,
			tracks: [
				{
					id: "titles",
					index: 0,
					name: "Titles",
					type: "text",
					elements: [
						{
							id: "title",
							trackIndex: 0,
							startTime: 0,
							endTime: 4,
							duration: 4,
							type: "text",
							content: "门的计划",
							fontFamily: "Songti SC",
							fontSize: 96,
							letterSpacing: 20,
							textAlign: "left",
							verticalAlign: "top",
							width: 800,
							height: 300,
							backgroundPadding: 10,
							x: 0,
							y: -140,
						},
					],
				},
			],
		};
		const ass = buildTextAss({
			overlays: collectTextOverlays(timeline),
			width: 1280,
			height: 720,
		});
		const style = ass.split("\n").find((line) => line.startsWith("Style:"));
		const event = ass.split("\n").find((line) => line.startsWith("Dialogue:"));
		// Fontsize, Spacing, alignment 7 (top-left).
		expect(style).toContain("Songti SC,96.00,");
		expect(style).toContain(",100,100,20.00,0,1,0,0,7,0,0,0,1");
		// Box centre (640, 220), 800 × 300, padding 10: content from x 250 to
		// 1030, top at 80 (plus the half-leading shift); margins keep lines
		// inside the box.
		const top =
			80 + halfLeading({ family: "Songti SC", fontSize: 96, lineHeight: 1.2 });
		expect(event).toContain(
			`,,250,250,0,,{\\pos(250.00,${top.toFixed(2)})\\q1`
		);
	});

	it("draws a glow as a blurred copy of the glyphs, not a wide border", () => {
		const timeline: ClaudeTimeline = {
			name: "Glow",
			duration: 2,
			width: 1280,
			height: 720,
			fps: 30,
			tracks: [
				{
					id: "titles",
					index: 0,
					name: "Titles",
					type: "text",
					elements: [
						{
							id: "glow",
							trackIndex: 0,
							startTime: 0,
							endTime: 2,
							duration: 2,
							type: "text",
							content: "QCUT",
							glowColor: "#4FA3FF",
							glowOpacity: 0.9,
							glowBlur: 24,
							strokeWidth: 4,
						},
					],
				},
			],
		};
		const ass = buildTextAss({
			overlays: collectTextOverlays(timeline),
			width: 1280,
			height: 720,
		});
		const events = ass
			.split("\n")
			.filter((line) => line.startsWith("Dialogue:"));
		expect(events).toHaveLength(2);
		// Layer 0: the glyphs in the glow colour (BGR FFA34F, alpha 0.9 → &H19),
		// no border or shadow, blurred by half the preview's blur radius.
		expect(events[0]).toMatch(/^Dialogue: 0,/);
		expect(events[0]).toContain(
			"\\1c&HFFA34F&\\1a&H19&\\4a&HFF&\\bord0\\shad0\\blur12.00}QCUT"
		);
		expect(events[0]).not.toContain("\\bord28");
		expect(events[1]).toMatch(/^Dialogue: 1,/);
	});

	it("keeps PlayRes in project-canvas units so text scales to any export size", () => {
		// Overlay x/y/fontSize are project-canvas coordinates. PlayRes must stay
		// in those units — libass scales to the export frame — otherwise a 4K
		// preset renders text undersized and mispositioned (regression test).
		const overlays = collectTextOverlays({
			name: "Canvas units",
			duration: 4,
			width: 1920,
			height: 1080,
			fps: 30,
			tracks: [
				{
					id: "titles",
					index: 0,
					name: "Titles",
					type: "text",
					elements: [
						{
							id: "caption",
							trackIndex: 0,
							startTime: 0,
							endTime: 3,
							duration: 3,
							type: "text",
							content: "Bottom caption",
							fontSize: 46,
							y: 400,
						},
					],
				},
			],
		});
		const ass = buildTextAss({ overlays, width: 1920, height: 1080 });
		expect(ass).toContain("PlayResX: 1920");
		expect(ass).toContain("PlayResY: 1080");
		expect(ass).toContain("\\pos(960.00,940.00)");
	});

	it("renders unstyled captions at the bottom instead of the text center", () => {
		const timeline: ClaudeTimeline = {
			name: "Caption placement",
			duration: 4,
			width: 1920,
			height: 1080,
			fps: 30,
			tracks: [
				{
					id: "captions",
					index: 0,
					name: "Captions",
					type: "captions",
					elements: [
						{
							id: "caption-1",
							trackIndex: 0,
							startTime: 0.5,
							endTime: 3.5,
							duration: 3,
							type: "captions",
							content: "Grace in motion and rhythm",
							language: "en",
						},
					],
				},
			],
		};

		const overlays = collectTextOverlays(timeline);
		expect(overlays).toEqual([
			expect.objectContaining({
				positioning: "caption-anchor",
				verticalAlign: "bottom",
				marginV: 90,
				backgroundColor: "#000000",
				backgroundOpacity: 0.8,
				strokeWidth: 2,
			}),
		]);

		const ass = buildTextAss({ overlays, width: 1920, height: 1080 });
		const captionStyle = ass
			.split("\n")
			.find((line) => line.startsWith("Style: QCutText0"));
		const captionEvent = ass
			.split("\n")
			.find((line) => line.startsWith("Dialogue:"));
		// Bottom-centre alignment, pinned where the preview draws captions:
		// 28 px plus the half-leading above the bottom edge, wrapping inside
		// the middle 80 %.
		expect(captionStyle).toContain(",2,0,0,0,1");
		const bottom =
			1052 - halfLeading({ family: "Arial", fontSize: 48, lineHeight: 1.4 });
		expect(captionEvent).toContain(
			`,,192,192,0,,{\\pos(960.00,${bottom.toFixed(2)})\\q1`
		);
		expect(captionEvent).toContain("Grace in motion and rhythm");
	});

	it("pins top and left captions at the preview's edge insets", () => {
		const timeline: ClaudeTimeline = {
			name: "Caption corners",
			duration: 4,
			width: 1280,
			height: 720,
			fps: 30,
			tracks: [
				{
					id: "captions",
					index: 0,
					name: "Captions",
					type: "captions",
					elements: [
						{
							id: "caption-top-left",
							trackIndex: 0,
							startTime: 0,
							endTime: 2,
							duration: 2,
							type: "captions",
							content: "Top left",
							language: "en",
							style: {
								textAlign: "left",
								position: { align: "top", x: 50, y: 10 },
								letterSpacing: 3,
							},
						},
					],
				},
			],
		};
		const ass = buildTextAss({
			overlays: collectTextOverlays(timeline),
			width: 1280,
			height: 720,
		});
		const style = ass.split("\n").find((line) => line.startsWith("Style:"));
		const event = ass.split("\n").find((line) => line.startsWith("Dialogue:"));
		expect(style).toContain(",100,100,3.00,0,3,2,1,7,0,0,0,1");
		// Top-left: 36 px in from the left, 28 px plus the half-leading down
		// from the top, wrapping inside the middle 80 %.
		const top =
			28 + halfLeading({ family: "Arial", fontSize: 48, lineHeight: 1.4 });
		expect(event).toContain(`,,128,128,0,,{\\pos(36.00,${top.toFixed(2)})\\q1`);
	});

	it("stacks a caption above an earlier one that shares its edge and time", () => {
		const timeline: ClaudeTimeline = {
			name: "Caption stack",
			duration: 4,
			width: 1280,
			height: 720,
			fps: 30,
			tracks: [
				{
					id: "lane-2",
					index: 0,
					name: "字幕 2",
					type: "captions",
					elements: [
						{
							id: "second",
							trackIndex: 0,
							startTime: 1,
							endTime: 2.4,
							duration: 1.4,
							type: "captions",
							content: "第二句",
							language: "zh",
						},
					],
				},
				{
					id: "lane-1",
					index: 1,
					name: "字幕 1",
					type: "captions",
					elements: [
						{
							id: "first",
							trackIndex: 1,
							startTime: 0.5,
							endTime: 2.6,
							duration: 2.1,
							type: "captions",
							content: "第一句",
							language: "zh",
						},
						{
							id: "later",
							trackIndex: 1,
							startTime: 3,
							endTime: 4,
							duration: 1,
							type: "captions",
							content: "之后",
							language: "zh",
						},
					],
				},
			],
		};
		const ass = buildTextAss({
			overlays: collectTextOverlays(timeline),
			width: 1280,
			height: 720,
		});
		const events = ass
			.split("\n")
			.filter((line) => line.startsWith("Dialogue:"));
		const yOf = (text: string) =>
			Number(
				events
					.find((line) => line.endsWith(text))
					?.match(/\\pos\(640\.00,([0-9.]+)\)/)?.[1]
			);
		// The first keeps the edge; the second sits one block (48 × 1.4 + 16 =
		// 83.2 px) above it; the later one, alone, is back at the edge.
		expect(yOf("第一句") - yOf("第二句")).toBeCloseTo(83.2, 1);
		expect(yOf("之后")).toBe(yOf("第一句"));
	});

	it("gives the edge to the higher track when two captions start together, like the preview", () => {
		const caption = ({
			id,
			trackIndex,
			content,
		}: {
			id: string;
			trackIndex: number;
			content: string;
		}) => ({
			id,
			trackIndex,
			startTime: 1,
			endTime: 2,
			duration: 1,
			type: "captions" as const,
			content,
			language: "zh",
		});
		const timeline: ClaudeTimeline = {
			name: "Same start",
			duration: 4,
			width: 1280,
			height: 720,
			fps: 30,
			tracks: [
				{
					id: "lower",
					index: 0,
					name: "字幕 A",
					type: "captions",
					elements: [caption({ id: "a", trackIndex: 0, content: "下层" })],
				},
				{
					id: "upper",
					index: 1,
					name: "字幕 B",
					type: "captions",
					elements: [caption({ id: "b", trackIndex: 1, content: "上层" })],
				},
			],
		};
		const ass = buildTextAss({
			overlays: collectTextOverlays(timeline),
			width: 1280,
			height: 720,
		});
		const events = ass
			.split("\n")
			.filter((line) => line.startsWith("Dialogue:"));
		const yOf = (text: string) =>
			Number(
				events
					.find((line) => line.endsWith(text))
					?.match(/\\pos\(640\.00,([0-9.]+)\)/)?.[1]
			);
		// caption-stacking.ts: equal starts → the higher track keeps the edge
		// (larger y at the bottom), the lower track stacks one block above it.
		expect(yOf("上层") - yOf("下层")).toBeCloseTo(48 * 1.4 + 16, 1);
	});

	it("substitutes an openable CJK family for CJK content", () => {
		const timeline: ClaudeTimeline = {
			name: "CJK",
			duration: 4,
			width: 1920,
			height: 1080,
			fps: 30,
			tracks: [
				{
					id: "titles",
					index: 0,
					name: "Titles",
					type: "text",
					elements: [
						{
							id: "zh",
							trackIndex: 0,
							startTime: 0,
							endTime: 3,
							duration: 3,
							type: "text",
							content: "六种预设,一键应用",
							fontFamily: "Arial",
						},
						{
							id: "latin",
							trackIndex: 0,
							startTime: 0,
							endTime: 3,
							duration: 3,
							type: "text",
							content: "Latin only",
							fontFamily: "Arial",
						},
					],
				},
			],
		};

		const ass = buildTextAss({
			overlays: collectTextOverlays(timeline),
			width: 1920,
			height: 1080,
		});
		// CoreText points libass at the reserved PingFangUI.ttc for CJK
		// fallback, which cannot be opened — CJK lines must name an openable
		// family directly while Latin lines keep the requested font.
		if (process.platform === "darwin") {
			expect(ass).toContain("Hiragino Sans GB");
		} else if (process.platform === "win32") {
			expect(ass).toContain("Microsoft YaHei");
		} else {
			expect(ass).toContain("Noto Sans CJK SC");
		}
		expect(ass).toContain("Arial");
	});
});
