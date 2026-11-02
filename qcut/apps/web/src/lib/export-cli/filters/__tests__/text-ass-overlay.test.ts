import { describe, expect, it } from "vitest";
import type { TextElement, TimelineTrack } from "@/types/timeline";
import type { AssFontMetricsLookup } from "@qcut/editor-core";
import { buildTextASSOverlay } from "../text-ass-overlay";

function createTextElement(overrides: Partial<TextElement> = {}): TextElement {
	return {
		id: "text-1",
		type: "text",
		name: "Text",
		content: "QCut\nStudio",
		fontSize: 48,
		fontFamily: "Arial",
		color: "#ffffff",
		backgroundColor: "transparent",
		textAlign: "center",
		fontWeight: "normal",
		fontStyle: "normal",
		textDecoration: "none",
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

function createTrack(element: TextElement): TimelineTrack {
	return {
		id: "track-1",
		name: "Text",
		type: "text",
		elements: [element],
	};
}

describe("buildTextASSOverlay", () => {
	const face = { sizeFactor: 1.15, lineHeightEm: 1.1 };
	const build = (
		overrides: Partial<TextElement>,
		fontMetrics?: AssFontMetricsLookup
	) =>
		buildTextASSOverlay({
			tracks: [
				createTrack(createTextElement({ content: "QCut", ...overrides })),
			],
			canvasWidth: 1920,
			canvasHeight: 1080,
			measureTextWidth: ({ text }) => text.length * 20,
			fontMetrics,
		}).content;
	const styleFontSize = (content: string) =>
		Number(
			content
				.split("\n")
				.find((line) => line.startsWith("Style: "))
				?.split(",")[2]
		);

	it("scales the ASS size by the face's factor, as the native export does", () => {
		const content = build({ fontSize: 100 }, () => face);
		expect(styleFontSize(content)).toBe(115);
	});

	it("keeps the nominal size and position for a face it could not measure", () => {
		const measuredNothing = build(
			{ fontSize: 100, verticalAlign: "top" },
			() => undefined
		);
		expect(styleFontSize(measuredNothing)).toBe(100);
		expect(measuredNothing).toBe(
			build({ fontSize: 100, verticalAlign: "top" })
		);
	});

	it("moves a pinned edge by the half-leading of the two line boxes", () => {
		const shared = {
			fontSize: 100,
			lineHeight: 1.2,
			height: 400,
			backgroundPadding: 0,
		};
		// (100 × 1.2 − 100 × 1.1) / 2 = 5 px further in from the edge.
		expect(build({ ...shared, verticalAlign: "top" }, () => face)).toContain(
			"\\pos(960.00,345.00)"
		);
		expect(build({ ...shared, verticalAlign: "bottom" }, () => face)).toContain(
			"\\pos(960.00,735.00)"
		);
		expect(build({ ...shared, verticalAlign: "middle" }, () => face)).toContain(
			"\\pos(960.00,540.00)"
		);
	});

	it("reads CSS colours in every colour field", () => {
		const content = build({
			color: "red",
			strokeColor: "lime",
			strokeWidth: 2,
			shadowColor: "blue",
			shadowOpacity: 1,
			glowColor: "rgb(255, 255, 0)",
			glowOpacity: 1,
			backgroundColor: "hsl(0, 0%, 50%)",
			backgroundOpacity: 1,
		});
		const style = content
			.split("\n")
			.find((line) => line.startsWith("Style: "))
			?.split(",");
		expect(style?.[3]).toBe("&H000000FF");
		expect(style?.[5]).toBe("&H0000FF00");
		expect(style?.[6]).toBe("&H00FF0000");
		// The shadow, glow and box are override tags.
		expect(content).toContain("\\1c&HFF0000&");
		expect(content).toContain("\\3c&H00FFFF&");
		expect(content).toContain("\\1c&H808080&");
	});

	it("lets a colour's own alpha replace its opacity field", () => {
		const shadow = build({
			shadowColor: "rgba(0, 0, 0, 0.5)",
			shadowOpacity: 1,
		});
		expect(shadow).toContain("\\alpha&H80&");
		const box = build({
			backgroundColor: "#ff000080",
			backgroundOpacity: 1,
		});
		expect(box).toContain("\\alpha&H7F&");
	});

	it("draws no shadow when the field is 0, whatever alpha the colour has", () => {
		const content = build({
			shadowColor: "rgba(0, 0, 0, 0.5)",
			shadowOpacity: 0,
		});
		expect(content).not.toContain("\\blur");
	});

	it("keeps the outline's opacity apart from the fill's", () => {
		const content = build({
			strokeColor: "#ffffff",
			strokeWidth: 4,
			strokeOpacity: 0.5,
		});
		expect(content).toContain("\\1a&H00&\\3a&H80&");
		expect(content).not.toContain("\\alpha&H00&");
	});

	it("fades the fill and outline in to their own opacities", () => {
		const content = build({
			strokeColor: "#ffffff",
			strokeWidth: 4,
			strokeOpacity: 0.5,
			animationType: "fade",
			animationDuration: 0.5,
		});
		expect(content).toContain("\\alpha&HFF&\\t(0,500,\\1a&H00&\\3a&H80&)");
	});

	it("draws an unreadable colour white, or black for a shadow", () => {
		const content = build({
			color: "redd",
			shadowColor: "redd",
			shadowOpacity: 1,
		});
		expect(
			content
				.split("\n")
				.find((line) => line.startsWith("Style: "))
				?.split(",")[3]
		).toBe("&H00FFFFFF");
		expect(content).toContain("\\1c&H000000&");
	});

	it("exports multiline advanced text styling and motion", () => {
		const result = buildTextASSOverlay({
			tracks: [
				createTrack(
					createTextElement({
						rotation: 12,
						letterSpacing: 3,
						strokeWidth: 4,
						strokeColor: "#ffcc00",
						backgroundColor: "#112233",
						backgroundOpacity: 0.7,
						backgroundRadius: 16,
						glowColor: "#00ffff",
						glowOpacity: 0.5,
						glowBlur: 8,
						animationType: "slide-up",
						animationDuration: 0.5,
					})
				),
			],
			canvasWidth: 1920,
			canvasHeight: 1080,
		});

		expect(result.renderedElementIds.has("text-1")).toBe(true);
		expect(result.content).toContain("[V4+ Styles]");
		expect(result.content).toContain("}QCut");
		expect(result.content).toContain("}Studio");
		expect(result.content).toContain("\\frz-12");
		expect(result.content).toContain("\\move(");
		expect(result.content).toContain("\\p1");
		// The 8 px glow radius is the preview's σ 4; libass's \blur b is σ 0.849 b.
		expect(result.content).toContain("\\blur4.71");
		expect(result.content).not.toContain("\\N");
	});

	it("keeps a measured auto-fitted text box on one line", () => {
		const result = buildTextASSOverlay({
			tracks: [
				createTrack(
					createTextElement({
						content: "Default text",
						fontSize: 66,
						fontWeight: "bold",
						width: 400,
						height: 120,
						backgroundPadding: 20,
					})
				),
			],
			canvasWidth: 1920,
			canvasHeight: 1080,
			measureTextWidth: () => 359.390625,
		});

		expect(result.content.match(/Dialogue: 2/g)).toHaveLength(1);
		expect(result.content).toContain("}Default text");
	});

	it("exports curved text as individually positioned characters", () => {
		const result = buildTextASSOverlay({
			tracks: [createTrack(createTextElement({ content: "ARC", curve: 90 }))],
			canvasWidth: 1280,
			canvasHeight: 720,
		});

		expect(result.content.match(/Dialogue: 2/g)).toHaveLength(3);
		expect(result.content).toContain("}A");
		expect(result.content).toContain("}R");
		expect(result.content).toContain("}C");
	});

	it("samples property keyframes at export frame rate", () => {
		const result = buildTextASSOverlay({
			tracks: [
				createTrack(
					createTextElement({
						duration: 1,
						keyframes: {
							x: [
								{ id: "x0", frame: 0, value: -100, easing: "linear" },
								{ id: "x1", frame: 2, value: 100, easing: "linear" },
							],
							rotation: [
								{ id: "r0", frame: 0, value: 0, easing: "linear" },
								{ id: "r1", frame: 2, value: 30, easing: "linear" },
							],
						},
					})
				),
			],
			canvasWidth: 1000,
			canvasHeight: 600,
			fps: 2,
		});

		expect(result.content).toContain("Style: QCutText0");
		expect(result.content).toContain("Style: QCutText1");
		expect(result.content).toContain("\\org(400.00,300.00)");
		expect(result.content).toContain("\\org(500.00,300.00)");
		expect(result.content).toContain("\\pos(400.00,271.20)");
		expect(result.content).toContain("\\pos(500.00,328.80)");
		expect(result.content).toContain("\\frz-15");
	});

	it("binds text to a video transform during ASS export", () => {
		const textTrack = createTrack(
			createTextElement({ duration: 1, trackingTargetId: "video-1" })
		);
		const mediaTrack: TimelineTrack = {
			id: "media-track",
			name: "Main",
			type: "media",
			elements: [
				{
					id: "video-1",
					type: "media",
					mediaId: "asset-1",
					name: "Tracked video",
					duration: 1,
					startTime: 0,
					trimStart: 0,
					trimEnd: 0,
					keyframes: {
						x: [
							{ id: "x0", frame: 0, value: -50, easing: "linear" },
							{ id: "x1", frame: 2, value: 50, easing: "linear" },
						],
					},
				},
			],
		};
		const result = buildTextASSOverlay({
			tracks: [textTrack],
			allTracks: [mediaTrack, textTrack],
			canvasWidth: 1000,
			canvasHeight: 600,
			fps: 2,
		});

		expect(result.content).toContain("\\org(450.00,300.00)");
		expect(result.content).toContain("\\org(500.00,300.00)");
	});
});
