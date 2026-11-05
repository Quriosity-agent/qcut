import { describe, expect, it } from "vitest";
import {
	generateASS,
	parseASS,
	assStyleToSubtitleStyle,
	resolveSubtitleStyle,
	type SubtitleStyle,
} from "../native-pipeline/subtitle/subtitle-types.js";

function exportedStyle({
	overrides = {},
}: {
	overrides?: Partial<SubtitleStyle>;
} = {}) {
	const ass = generateASS(
		[
			{
				id: "caption",
				name: "Caption",
				type: "captions",
				text: "Native subtitle colors",
				language: "en",
				source: "manual",
				startTime: 0,
				duration: 2,
				trimStart: 0,
				trimEnd: 0,
				style: resolveSubtitleStyle(overrides),
			},
		],
		{ resolution: { width: 1280, height: 720 } }
	);
	return parseASS(ass).styles[0];
}

describe("native CLI subtitle CSS colors", () => {
	for (const { field, column } of [
		{ field: "fontColor", column: "PrimaryColour" },
		{ field: "outlineColor", column: "OutlineColour" },
		{ field: "shadowColor", column: "BackColour" },
		{ field: "backgroundColor", column: "BackColour" },
	] as const) {
		it.each([
			{ color: "red", bgr: "0000FF" },
			{ color: "#0f8", bgr: "88FF00" },
			{ color: "#112233", bgr: "332211" },
			{ color: "rgb(12, 34, 56)", bgr: "38220C" },
			{ color: "hsl(120, 100%, 50%)", bgr: "00FF00" },
		])(`keeps ${field} separate opacity for $color`, ({ color, bgr }) => {
			const style = exportedStyle({
				overrides: {
					[field]: color,
					fontOpacity: 0.2,
					bgOpacity: field === "backgroundColor" ? 0.2 : 0,
				},
			});
			const alpha =
				field === "fontColor" || field === "backgroundColor" ? "CC" : "00";
			expect(style[column]).toBe(`&H${alpha}${bgr}`);
		});

		it.each([
			{ color: "#1234", ass: "&HBB332211" },
			{ color: "#11223380", ass: "&H7F332211" },
			{ color: "rgba(255, 0, 0, 0.5)", ass: "&H800000FF" },
			{ color: "hsla(120, 100%, 50%, 0.25)", ass: "&HBF00FF00" },
		])(`retains ${field} intrinsic alpha from $color`, ({ color, ass }) => {
			const style = exportedStyle({
				overrides: {
					[field]: color,
					fontOpacity: 0.2,
					bgOpacity: field === "backgroundColor" ? 0.2 : 0,
				},
			});
			expect(style[column]).toBe(ass);
			if (field === "backgroundColor") expect(style.BorderStyle).toBe(4);
		});
	}

	it.each([
		{ color: "transparent", opacity: 0.8 },
		{ color: "rgba(12, 34, 56, 0)", opacity: 0.8 },
		{ color: "#11223300", opacity: 0.8 },
		{ color: "rgba(12, 34, 56, 0.5)", opacity: 0 },
	])("omits the background box for $color with bgOpacity=$opacity", ({
		color,
		opacity,
	}) => {
		const style = exportedStyle({
			overrides: {
				backgroundColor: color,
				bgOpacity: opacity,
				shadowColor: "rgba(0, 128, 255, 0.5)",
			},
		});
		expect(style.BorderStyle).toBe(1);
		expect(style.BackColour).toBe("&H80FF8000");
	});

	it("keeps a zero font opacity disabled even with intrinsic alpha", () => {
		expect(
			exportedStyle({
				overrides: {
					fontColor: "rgba(255, 0, 0, 0.5)",
					fontOpacity: 0,
				},
			}).PrimaryColour
		).toBe("&HFF0000FF");
	});

	it("preserves the default yellow text, black outline/shadow and disabled box", () => {
		expect(exportedStyle()).toMatchObject({
			PrimaryColour: "&H0000FFFF",
			OutlineColour: "&H00000000",
			BackColour: "&H00000000",
			BorderStyle: 1,
		});
	});

	it("uses white for unreadable colors and black for an unreadable shadow", () => {
		const overrides = {
			fontColor: "unreadable",
			outlineColor: "unreadable",
			shadowColor: "unreadable",
			backgroundColor: "unreadable",
		};
		expect(exportedStyle({ overrides })).toMatchObject({
			PrimaryColour: "&H00FFFFFF",
			OutlineColour: "&H00FFFFFF",
			BackColour: "&H00000000",
			BorderStyle: 1,
		});
		expect(
			exportedStyle({ overrides: { ...overrides, bgOpacity: 0.2 } })
		).toMatchObject({
			BackColour: "&HCCFFFFFF",
			BorderStyle: 4,
		});
	});

	it.each([
		3, 4,
	])("imports background colors from ASS border style %s", (borderStyle) => {
		const style = exportedStyle({
			overrides: { backgroundColor: "rgba(0, 128, 255, 0.5)", bgOpacity: 0.2 },
		});
		const imported = assStyleToSubtitleStyle({
			...style,
			BorderStyle: borderStyle,
		});
		expect(imported.backgroundColor).toBe("#0080ff");
		expect(imported.bgOpacity).toBeCloseTo(0.5, 2);
		expect(imported.outlineColor).toBe("#000000");
	});
});
