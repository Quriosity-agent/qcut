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

/**
 * A caption line's half-leading: libass makes the line as tall as its ASS
 * size, the font size × the size factor (the font's Windows height).
 */
function captionLeading({
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
	const { sizeFactor } = assFontMetrics({ family, bold });
	return (fontSize * lineHeight - fontSize * sizeFactor) / 2;
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
		// no border or shadow, blurred like the preview: its 24 px blur radius is
		// a σ of 12, and libass's \blur b a σ of 0.849 b, so \blur 14.13.
		expect(events[0]).toMatch(/^Dialogue: 0,/);
		expect(events[0]).toContain(
			"\\1c&HFFA34F&\\1a&H19&\\4a&HFF&\\bord0\\shad0\\blur14.13}QCUT"
		);
		expect(events[0]).not.toContain("\\bord28");
		expect(events[1]).toMatch(/^Dialogue: 1,/);
	});

	it("draws a soft shadow at zero offset, which ASS's hard one cannot", () => {
		// N32: the reported case — blur 24, white, no offset. The style's Shadow
		// column offsets a hard copy by one distance on both axes, so (0, 0)
		// drew nothing and shadowBlur never reached the export at all.
		const timeline: ClaudeTimeline = {
			name: "Shadow",
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
							id: "soft",
							trackIndex: 0,
							startTime: 0,
							endTime: 2,
							duration: 2,
							type: "text",
							content: "QCUT",
							shadowColor: "#ffffff",
							shadowOpacity: 1,
							shadowBlur: 24,
							shadowOffsetX: 0,
							shadowOffsetY: 0,
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
		const style = ass
			.split("\n")
			.find((line) => line.startsWith("Style:")) as string;
		const events = ass
			.split("\n")
			.filter((line) => line.startsWith("Dialogue:"));
		// The hard shadow is off, because a soft layer replaces it.
		expect(style.split(",").at(-6)).toBe("0");
		expect(events).toHaveLength(2);
		// Layer 0 is the glyphs in the shadow colour, blurred like the preview:
		// a 24 px radius is a σ of 12, and libass's \blur b a σ of 0.849 b.
		expect(events[0]).toMatch(/^Dialogue: 0,/);
		expect(events[0]).toContain(
			"\\1c&HFFFFFF&\\1a&H00&\\3a&HFF&\\4a&HFF&\\bord0\\shad0\\blur14.13}QCUT"
		);
		expect(events[1]).toMatch(/^Dialogue: 1,/);
	});

	it("puts a shadow exactly on its own offset, not on ASS's diagonal", () => {
		const timeline: ClaudeTimeline = {
			name: "Shadow offset",
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
							id: "offset",
							trackIndex: 0,
							startTime: 0,
							endTime: 2,
							duration: 2,
							type: "text",
							content: "QCUT",
							x: 0,
							y: 0,
							shadowColor: "#000000",
							shadowOpacity: 0.5,
							shadowBlur: 0,
							shadowOffsetX: 12,
							shadowOffsetY: 0,
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
		const positionOf = (line: string): [number, number] => {
			const match = /\\pos\(([-\d.]+),([-\d.]+)\)/.exec(line);
			if (!match) throw new Error("no \\pos in " + line);
			return [Number(match[1]), Number(match[2])];
		};
		const [shadowX, shadowY] = positionOf(events[0]);
		const [textX, textY] = positionOf(events[1]);
		// ASS's hard shadow would have moved it by (12, 12); the preview moves
		// it by the offsets it was given.
		expect(shadowX - textX).toBeCloseTo(12, 2);
		expect(shadowY - textY).toBeCloseTo(0, 2);
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
			1052 - captionLeading({ family: "Arial", fontSize: 48, lineHeight: 1.4 });
		expect(captionEvent).toContain(
			`,,192,192,0,,{\\pos(960.00,${bottom.toFixed(2)})\\q1`
		);
		expect(captionEvent).toContain("Grace in motion and rhythm");
	});

	it("draws no empty line for a caption's leading or trailing line break", () => {
		const overlays = collectTextOverlays({
			name: "Caption trim",
			duration: 2,
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
							startTime: 0,
							endTime: 2,
							duration: 2,
							type: "captions",
							content: "\nFirst line\nSecond line\n",
							language: "en",
						},
					],
				},
			],
		});

		expect(overlays[0]?.content).toBe("First line\nSecond line");
		const event = buildTextAss({ overlays, width: 1920, height: 1080 })
			.split("\n")
			.find((line) => line.startsWith("Dialogue:"));
		// The text starts with its first line and ends with its last.
		expect(event).toMatch(/\}First line\\N/);
		expect(event).toMatch(/\}Second line$/);
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
			28 + captionLeading({ family: "Arial", fontSize: 48, lineHeight: 1.4 });
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

	it("lifts the caption above by every line of a two-line caption under it (N11)", () => {
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
			name: "Bilingual",
			duration: 4,
			width: 1280,
			height: 720,
			fps: 30,
			tracks: [
				{
					id: "zh",
					index: 0,
					name: "字幕 中文",
					type: "captions",
					// Latin like the line under it, so both get the same font (and
					// half-leading) and only the block height differs.
					elements: [
						caption({ id: "zh", trackIndex: 0, content: "Not anymore?" }),
					],
				},
				{
					id: "en",
					index: 1,
					name: "字幕 英文",
					type: "captions",
					elements: [
						caption({
							id: "en",
							trackIndex: 1,
							content: "Don't fight anymore?\nYour fists are more honest.",
						}),
					],
				},
			],
		};
		const ass = buildTextAss({
			overlays: collectTextOverlays(timeline),
			width: 1280,
			height: 720,
		});
		const yOf = (text: string) =>
			Number(
				ass
					.split("\n")
					.find((line) => line.startsWith("Dialogue:") && line.includes(text))
					?.match(/\\pos\(640\.00,([0-9.]+)\)/)?.[1]
			);
		// Two 48 px lines at 1.4 spacing plus 16 px of box padding.
		expect(yOf("Don't fight") - yOf("Not anymore")).toBeCloseTo(
			2 * 48 * 1.4 + 16,
			1
		);
	});

	it("draws a bilingual caption's second line in its own font, pinned by its own leading", () => {
		const caption = (
			id: string,
			trackIndex: number,
			fields: Record<string, unknown>
		) => ({
			id,
			trackIndex,
			startTime: trackIndex === 0 ? 0 : 0.5,
			endTime: 2,
			duration: trackIndex === 0 ? 2 : 1.5,
			type: "captions" as const,
			language: "en",
			...fields,
		});
		const timeline: ClaudeTimeline = {
			name: "Bilingual line",
			duration: 4,
			width: 1280,
			height: 720,
			fps: 30,
			tracks: [
				{
					id: "subs",
					index: 0,
					name: "字幕",
					type: "captions",
					elements: [
						caption("duo", 0, {
							content: "Round one",
							secondaryContent: "Fight",
							style: {
								fontFamily: "Arial",
								fontSize: 40,
								bgOpacity: 0,
								secondary: {
									fontFamily: "Futura",
									fontSize: 24,
									fontColor: "#ffcc00",
									bold: true,
								},
							},
						}),
					],
				},
				{
					id: "later",
					index: 1,
					name: "字幕 2",
					type: "captions",
					elements: [
						caption("above", 1, {
							content: "Above",
							style: { fontFamily: "Arial", fontSize: 40, bgOpacity: 0 },
						}),
					],
				},
			],
		};

		const overlays = collectTextOverlays(timeline);
		expect(overlays.find((overlay) => overlay.id === "duo")?.secondary).toEqual(
			{
				content: "Fight",
				fontFamily: "Futura",
				fontSize: 24,
				color: "#ffcc00",
				fontWeight: "bold",
				fontStyle: "normal",
				// The caption's own spacing, as nothing else is given.
				letterSpacing: 0,
			}
		);
		const ass = buildTextAss({ overlays, width: 1280, height: 720 });
		const event = (text: string) =>
			ass
				.split("\n")
				.find((line) => line.startsWith("Dialogue:") && line.includes(text)) ??
			"";
		const yOf = (text: string) =>
			Number(event(text).match(/\\pos\(640\.00,([0-9.]+)\)/)?.[1]);
		expect(event("Round one")).toMatch(
			/Round one\\N.*\{\\fnFutura\\b1\\i0\\c&H00CCFF&\\fs[0-9.]+\}Fight$/
		);
		// The bottom line is the second-language one, so its leading pins it.
		const secondLeading = captionLeading({
			family: "Futura",
			fontSize: 24,
			lineHeight: 1.4,
			bold: true,
		});
		expect(yOf("Round one")).toBeCloseTo(720 - 28 - secondLeading, 1);
		// A later caption on that edge sits above the whole two-line block.
		expect(yOf("Round one") - yOf("Above")).toBeCloseTo(
			(40 + 24) * 1.4 +
				16 +
				captionLeading({ family: "Arial", fontSize: 40, lineHeight: 1.4 }) -
				secondLeading,
			1
		);
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
