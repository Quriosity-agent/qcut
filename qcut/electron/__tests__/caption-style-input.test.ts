import { describe, expect, it } from "vitest";
import {
	captionStyleFromPatch,
	captionStyleWarnings,
	normalizeCaptionStyleInput,
} from "../types/caption-style-input.js";

/**
 * N8 (2026-10-28 trailer report): caption styles written with the text
 * element's field names, or at the element's top level, were dropped without
 * a word, and the export fell back to Arial 48 in an 80 % black box.
 */

describe("caption style input", () => {
	it("reads the report's own style file, naming what captions cannot use", () => {
		// 样式_英文.json from the report, as sent in `style`.
		const result = normalizeCaptionStyleInput({
			element: {
				type: "captions",
				content: "Round one.",
				style: {
					fontColor: "#ECE8DE",
					fontOpacity: 1,
					outlineColor: "#000000",
					outlineWidth: 1.6,
					backgroundColor: "transparent",
					bgOpacity: 0,
					shadowColor: "#000000",
					shadowOffsetX: 0,
					shadowOffsetY: 2.5,
					textAlign: "center",
					verticalAlign: "bottom",
					marginV: 34,
					animationDuration: 0.15,
					bold: false,
					fontFamily: "Futura",
					fontSize: 24,
				},
			},
		});
		expect(result.style).toEqual({
			fontColor: "#ECE8DE",
			fontOpacity: 1,
			outlineColor: "#000000",
			outlineWidth: 1.6,
			bgOpacity: 0,
			shadowColor: "#000000",
			shadowOffset: { x: 0, y: 2.5 },
			textAlign: "center",
			position: { align: "bottom" },
			animationDuration: 0.15,
			bold: false,
			fontFamily: "Futura",
			fontSize: 24,
		});
		expect(captionStyleWarnings(result)).toEqual([
			'Caption field "style.marginV" ignored: no effect on captions: captions sit 28 px from the edge position.align names (stacked captions move up by whole blocks)',
		]);
	});

	it("maps the text element's names onto the caption's", () => {
		const result = normalizeCaptionStyleInput({
			element: {
				style: {
					color: "#fff",
					strokeColor: "#101010",
					strokeWidth: 2,
					backgroundOpacity: 0.25,
					lineHeight: 1.2,
					fontWeight: "bold",
					fontStyle: "italic",
					textDecoration: "underline",
					verticalAlign: "middle",
				},
			},
		});
		expect(result.style).toEqual({
			fontColor: "#ffffff",
			outlineColor: "#101010",
			outlineWidth: 2,
			bgOpacity: 0.25,
			lineSpacing: 1.2,
			bold: true,
			italic: true,
			underline: true,
			position: { align: "center" },
		});
		expect(result.ignored).toEqual([]);
	});

	it("applies style fields given at the top level, which win over style", () => {
		const result = normalizeCaptionStyleInput({
			element: {
				type: "captions",
				trackId: "subs",
				startTime: 1,
				duration: 2,
				content: "x",
				fontFamily: "Avenir Next",
				fontSize: 34,
				color: "#FFFFFF",
				style: { fontSize: 20, bold: true },
			},
		});
		expect(result.style).toEqual({
			fontSize: 34,
			bold: true,
			fontFamily: "Avenir Next",
			fontColor: "#FFFFFF",
		});
		expect(result.ignored).toEqual([]);
	});

	it("takes the caption's own name when both spellings are given", () => {
		const result = normalizeCaptionStyleInput({
			element: { style: { fontColor: "#111111", color: "#222222" } },
		});
		expect(result.style).toEqual({ fontColor: "#111111" });
	});

	it("names unknown and unusable fields instead of dropping them silently", () => {
		const result = normalizeCaptionStyleInput({
			element: {
				type: "captions",
				glowBlur: 4,
				fontSzie: 30,
				style: { fontSize: "big", position: { align: "left" } },
			},
		});
		expect(result.style).toBeUndefined();
		expect(result.ignored.map((entry) => entry.field).sort()).toEqual([
			"fontSzie",
			"glowBlur",
			"style.fontSize",
			"style.position",
		]);
		expect(captionStyleWarnings(result)[0]).toContain("not a caption field");
	});

	it("keeps a stored style exactly, so a timeline export applies back", () => {
		const stored = {
			fontFamily: "Arial",
			fontSize: 48,
			letterSpacing: 0,
			textAlign: "center",
			fontColor: "#ffffff",
			fontOpacity: 1,
			bold: true,
			italic: false,
			underline: false,
			outlineColor: "transparent",
			outlineWidth: 3,
			shadowColor: "#000000",
			shadowOffset: { x: 1, y: 1 },
			backgroundColor: "#000000",
			bgOpacity: 0,
			position: { align: "bottom", x: 50, y: 86 },
			lineSpacing: 1.25,
			animationType: "none",
			animationDuration: 0.6,
			animationDelay: 0,
			karaokeMode: "none",
			highlightColor: "#ffde00",
			upcomingColor: "#ffffff",
			highlightScale: 1.12,
		};
		const result = normalizeCaptionStyleInput({ element: { style: stored } });
		expect(result.style).toEqual(stored);
		expect(result.ignored).toEqual([]);
	});

	it("reads a patch's top-level style fields and leaves its other fields alone", () => {
		const result = captionStyleFromPatch({
			changes: {
				elementId: "c1",
				content: "new",
				startTime: 3,
				strokeWidth: 1,
				style: { bgOpacity: 0 },
			},
		});
		expect(result.style).toEqual({ bgOpacity: 0, outlineWidth: 1 });
		expect(result.ignored).toEqual([]);
	});

	it("keeps the stored axis and position a patch to part of them leaves out", () => {
		const current = {
			shadowOffset: { x: 2, y: 4 },
			position: { align: "bottom", x: 0, y: 12 },
			fontSize: 48,
		};
		const result = captionStyleFromPatch({
			changes: { shadowOffsetX: 6, verticalAlign: "top" },
			current,
		});
		expect(result.style).toEqual({
			shadowOffset: { x: 6, y: 4 },
			position: { align: "top", x: 0, y: 12 },
		});
		// Without a stored style the patch stands as given.
		expect(
			captionStyleFromPatch({ changes: { shadowOffsetX: 6 } }).style
		).toEqual({ shadowOffset: { x: 6 } });
	});
});
