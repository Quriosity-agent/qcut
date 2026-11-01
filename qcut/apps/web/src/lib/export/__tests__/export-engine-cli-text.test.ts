import { describe, expect, it } from "vitest";
import type {
	CaptionElement,
	TextElement,
	TimelineTrack,
} from "@/types/timeline";
import {
	assFontFamiliesInTracks,
	buildTimelineAssLayers,
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
