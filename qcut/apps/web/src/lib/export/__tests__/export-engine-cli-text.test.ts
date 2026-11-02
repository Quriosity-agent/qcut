import { describe, expect, it } from "vitest";
import type {
	CaptionElement,
	TextElement,
	TimelineTrack,
} from "@/types/timeline";
import {
	assCanvasForExport,
	assFontFamiliesInTracks,
	buildTimelineAssLayers,
	unreadableTextColors,
} from "../export-engine-cli-text";

function createTextElement(): TextElement {
	return {
		id: "text-element",
		name: "Text",
		type: "text",
		content: "Top title",
		startTime: 0,
		duration: 3,
		trimStart: 0,
		trimEnd: 0,
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
	};
}

function createCaptionElement(): CaptionElement {
	return {
		id: "caption-element",
		name: "Caption",
		type: "captions",
		text: "Exported caption",
		language: "en",
		source: "manual",
		startTime: 0,
		duration: 3,
		trimStart: 0,
		trimEnd: 0,
	};
}

describe("assCanvasForExport", () => {
	it("is the project's canvas at another resolution of its shape", () => {
		expect(
			assCanvasForExport({
				project: { width: 1920, height: 1080 },
				frame: { width: 1280, height: 720 },
			})
		).toEqual({ width: 1920, height: 1080 });
		expect(
			assCanvasForExport({
				project: { width: 1470, height: 630 },
				frame: { width: 2520, height: 1080 },
			})
		).toEqual({ width: 1470, height: 630 });
	});

	it("keeps the frame's shape, so both axes scale alike", () => {
		expect(
			assCanvasForExport({
				project: { width: 1920, height: 1080 },
				frame: { width: 1080, height: 1080 },
			})
		).toEqual({ width: 1920, height: 1920 });
	});

	it("is the frame without a project to go by", () => {
		const frame = { width: 1280, height: 720 };
		expect(assCanvasForExport({ frame })).toEqual(frame);
		expect(
			assCanvasForExport({ project: { width: 0, height: 0 }, frame })
		).toEqual(frame);
	});
});

describe("unreadableTextColors", () => {
	const onTrack = (element: TextElement | CaptionElement): TimelineTrack => ({
		id: "track",
		name: "Track",
		type: element.type === "text" ? "text" : "captions",
		elements: [element],
	});

	it("names no colour it can read", () => {
		const element = createTextElement();
		element.color = "red";
		element.shadowColor = "rgb(0, 0, 0)";
		expect(unreadableTextColors({ tracks: [onTrack(element)] })).toEqual([]);
		expect(
			unreadableTextColors({ tracks: [onTrack(createCaptionElement())] })
		).toEqual([]);
	});

	it("names each colour it cannot read, with its field and element", () => {
		const element = createTextElement();
		element.color = "redd";
		element.glowColor = "oklch(0.6 0.2 30)";
		const caption = createCaptionElement();
		caption.style = { fontColor: "blu" } as CaptionElement["style"];
		expect(
			unreadableTextColors({ tracks: [onTrack(element), onTrack(caption)] })
		).toEqual([
			'color "redd" on text-element',
			'glowColor "oklch(0.6 0.2 30)" on text-element',
			'fontColor "blu" on caption-element',
			'secondary.fontColor "blu" on caption-element',
		]);
	});
});

describe("buildTimelineAssLayers", () => {
	it("builds ordered text and caption layers", () => {
		const tracks: TimelineTrack[] = [
			{
				id: "text-track",
				name: "Text",
				type: "text",
				order: 0,
				elements: [createTextElement()],
			},
			{
				id: "caption-track",
				name: "Captions",
				type: "captions",
				order: 1,
				elements: [createCaptionElement()],
			},
		];

		const result = buildTimelineAssLayers({
			tracks,
			canvasWidth: 1920,
			canvasHeight: 1080,
			fps: 30,
		});

		expect(result.layers).toHaveLength(2);
		expect(result.layers.map(({ trackOrder }) => trackOrder)).toEqual([0, 1]);
		expect(result.layers[0].content).toContain("Top title");
		expect(result.layers[1].content).toContain("Exported caption");
		expect(result.renderedTextElementIds).toEqual(new Set(["text-element"]));
	});

	it("stacks captions that overlap in time, as each is its own document", () => {
		const onTrack = (id: string, startTime: number): TimelineTrack => ({
			id: `track-${id}`,
			name: "Captions",
			type: "captions",
			elements: [
				{
					...createCaptionElement(),
					id,
					text: id,
					startTime,
					style: {
						bgOpacity: 0,
						position: { align: "bottom", x: 0, y: 90 },
					} as CaptionElement["style"],
				},
			],
		});
		const eventsOf = (content: string) =>
			content.split("\n").filter((line) => line.startsWith("Dialogue: "));
		const tracks = [
			onTrack("first", 0),
			onTrack("later", 1),
			onTrack("off", 5),
		];
		const result = buildTimelineAssLayers({
			tracks,
			canvasWidth: 1920,
			canvasHeight: 1080,
			fps: 30,
		});

		// The earliest keeps the edge and the one it shares it with moves up by
		// its block: one 48 px line at 1.4 spacing plus 16 px of padding, on top
		// of the 28 px inset. One that overlaps neither stays on the edge.
		expect(eventsOf(result.layers[0].content)[0]).toContain(",0,0,0,,");
		expect(eventsOf(result.layers[1].content)[0]).toContain(",0,0,111,,");
		expect(eventsOf(result.layers[2].content)[0]).toContain(",0,0,0,,");
	});

	it("omits hidden tracks", () => {
		const tracks: TimelineTrack[] = [
			{
				id: "caption-track",
				name: "Captions",
				type: "captions",
				order: 0,
				hidden: true,
				elements: [createCaptionElement()],
			},
		];

		const result = buildTimelineAssLayers({
			tracks,
			canvasWidth: 1920,
			canvasHeight: 1080,
			fps: 30,
		});

		expect(result.layers).toHaveLength(0);
	});

	it("selects a platform CJK font for Chinese ASS captions", () => {
		const chinese = createCaptionElement();
		chinese.text = "真实视频字幕";
		const result = buildTimelineAssLayers({
			tracks: [
				{
					id: "caption-track",
					name: "Captions",
					type: "captions",
					elements: [chinese],
				},
			],
			canvasWidth: 1080,
			canvasHeight: 1920,
			fps: 30,
			platform: "darwin",
		});

		expect(result.layers[0].content).toContain(
			"Style: Default,Hiragino Sans GB,"
		);
	});

	it("excludes rasterized text from ASS without affecting captions", () => {
		const result = buildTimelineAssLayers({
			tracks: [
				{
					id: "text-track",
					name: "Text",
					type: "text",
					order: 0,
					elements: [createTextElement()],
				},
				{
					id: "caption-track",
					name: "Captions",
					type: "captions",
					order: 1,
					elements: [createCaptionElement()],
				},
			],
			canvasWidth: 1920,
			canvasHeight: 1080,
			fps: 30,
			excludedTextElementIds: new Set(["text-element"]),
		});

		expect(result.layers).toHaveLength(1);
		expect(result.layers[0].content).toContain("Exported caption");
		expect(result.layers[0].content).not.toContain("Top title");
		expect(result.renderedTextElementIds).toEqual(new Set());
	});
});

describe("assFontFamiliesInTracks", () => {
	/**
	 * A family this misses gets no libass metrics, so its captions silently
	 * export at the nominal size again — the N31 defect, with no symptom until
	 * someone measures a frame.
	 */
	const tracksWith = (elements: TimelineTrack["elements"]): TimelineTrack[] => [
		{ id: "t", name: "T", type: "text", order: 0, elements },
	];

	it("collects a text element's family", () => {
		const element = { ...createTextElement(), fontFamily: "Futura" };
		expect(
			assFontFamiliesInTracks({ tracks: tracksWith([element]) })
		).toContain("Futura");
	});

	it("collects a caption's family and its second-language family", () => {
		const caption = createCaptionElement();
		caption.style = {
			fontFamily: "Songti SC",
			secondary: { fontFamily: "Futura" },
		} as CaptionElement["style"];

		const families = assFontFamiliesInTracks({
			tracks: [
				{ id: "c", name: "C", type: "captions", order: 0, elements: [caption] },
			],
		});

		expect(families).toContain("Songti SC");
		expect(families).toContain("Futura");
	});

	it("includes the platform's CJK fallback, which substitution can name", () => {
		expect(
			assFontFamiliesInTracks({
				tracks: tracksWith([createTextElement()]),
				platform: "darwin",
			})
		).toContain("Hiragino Sans GB");
	});

	it("lists each family once", () => {
		const families = assFontFamiliesInTracks({
			tracks: tracksWith([createTextElement(), createTextElement()]),
		});
		expect(families.filter((family) => family === "Arial")).toHaveLength(1);
	});
});
