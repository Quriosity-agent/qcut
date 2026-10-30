import type { SubtitleStyle } from "@qcut/editor-core";
import { describe, expect, it } from "vitest";
import { StandaloneJianyingDraftRequestValidationError } from "../index.js";
import type { JsonValue } from "../runtime-json.js";
import { validateSubtitleStyle } from "../snapshot-caption-style-validation.js";

/**
 * N25 (2026-10-30 trailer report): a caption styled as a film subtitle
 * (weight, soft shadows, fade frames, the second line's own spacing and
 * weight) is a valid snapshot caption; a malformed one is refused at the
 * field that is wrong, before a draft is written.
 */

const FILM_STYLE: SubtitleStyle = {
	animationDelay: 0,
	animationDuration: 0.3,
	animationType: "none",
	backgroundColor: "#000000",
	bgOpacity: 0,
	bold: true,
	fontColor: "#f4efe6",
	fontFamily: "Source Han Serif CN",
	fontOpacity: 1,
	fontSize: 28,
	fontWeight: 600,
	italic: false,
	letterSpacing: 2.8,
	lineSpacing: 1.4,
	outlineColor: "#000000",
	outlineWidth: 0,
	position: { align: "bottom", x: 0, y: 90 },
	shadowColor: "#000000",
	shadowOffset: { x: 0, y: 0 },
	shadows: [
		{ color: "#000000", opacity: 0.75, blur: 3.2, x: 0, y: 2 },
		{ color: "#000000", opacity: 0.38, blur: 18, x: 0, y: 0 },
	],
	fadeInFrames: 4,
	fadeOutFrames: 3,
	textAlign: "center",
	underline: false,
	secondary: {
		fontFamily: "Gill Sans",
		fontSize: 22,
		fontWeight: 400,
		letterSpacing: 0.66,
		fontColor: "#ded6c6",
	},
};

function issuePath(value: unknown): string | undefined {
	try {
		validateSubtitleStyle({ path: "$.style", value: value as JsonValue });
		return undefined;
	} catch (error) {
		expect(error).toBeInstanceOf(StandaloneJianyingDraftRequestValidationError);
		return (error as StandaloneJianyingDraftRequestValidationError).issues[0]
			?.path;
	}
}

describe("film subtitle styles in a draft snapshot", () => {
	it("accepts the weight, shadows, fade frames and the second line's spacing", () => {
		expect(issuePath(FILM_STYLE)).toBeUndefined();
	});

	it("refuses the field that is wrong", () => {
		expect(issuePath({ ...FILM_STYLE, fontWeight: "semibold" })).toBe(
			"$.style.fontWeight"
		);
		expect(issuePath({ ...FILM_STYLE, fadeOutFrames: "3" })).toBe(
			"$.style.fadeOutFrames"
		);
		expect(
			issuePath({ ...FILM_STYLE, shadows: [{ color: "#000000", spread: 2 }] })
		).toBe("$.style.shadows[0]");
		expect(
			issuePath({
				...FILM_STYLE,
				shadows: [{ color: "#000000", blur: "soft" }],
			})
		).toBe("$.style.shadows[0].blur");
		expect(
			issuePath({
				...FILM_STYLE,
				secondary: { ...FILM_STYLE.secondary, letterSpacing: "wide" },
			})
		).toBe("$.style.secondary.letterSpacing");
	});
});
