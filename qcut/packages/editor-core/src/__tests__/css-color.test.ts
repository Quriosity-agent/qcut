import { describe, expect, it } from "vitest";
import {
	CSS_NAMED_COLORS,
	cssColorAlpha,
	parseCssColor,
} from "../captions/css-color.js";
import { hexToRgba, rgbToASSColor } from "../captions/subtitle-style.js";

describe("parseCssColor", () => {
	it("reads the named colours, whatever their case", () => {
		expect(parseCssColor("red")).toEqual({ hex: "#ff0000" });
		expect(parseCssColor(" RebeccaPurple ")).toEqual({ hex: "#663399" });
		expect(parseCssColor("gray")).toEqual(parseCssColor("grey"));
		expect(Object.keys(CSS_NAMED_COLORS)).toHaveLength(148);
	});

	it("reads transparent as a colour with no opacity", () => {
		expect(parseCssColor("transparent")).toEqual({
			hex: "#000000",
			alpha: 0,
		});
	});

	it("reads each hex length, keeping an alpha only when it has one", () => {
		expect(parseCssColor("#F00")).toEqual({ hex: "#ff0000" });
		expect(parseCssColor("#FF0000")).toEqual({ hex: "#ff0000" });
		expect(parseCssColor("#f008")).toEqual({
			hex: "#ff0000",
			alpha: 136 / 255,
		});
		expect(parseCssColor("#ff000080")).toEqual({
			hex: "#ff0000",
			alpha: 128 / 255,
		});
	});

	it("reads rgb() in its comma, space and percentage spellings", () => {
		const red = { hex: "#ff0000" };
		expect(parseCssColor("rgb(255,0,0)")).toEqual(red);
		expect(parseCssColor("rgb(255 0 0)")).toEqual(red);
		expect(parseCssColor("rgb(100%, 0%, 0%)")).toEqual(red);
		expect(parseCssColor("rgba(255, 0, 0, 0.5)")).toEqual({
			...red,
			alpha: 0.5,
		});
		expect(parseCssColor("rgb(255 0 0 / 50%)")).toEqual({ ...red, alpha: 0.5 });
		expect(parseCssColor("rgb(300, -5, 0)")).toEqual(red);
	});

	it("reads hsl() in its angle units", () => {
		expect(parseCssColor("hsl(0, 100%, 50%)")).toEqual({ hex: "#ff0000" });
		expect(parseCssColor("hsl(120deg 100% 25%)")).toEqual({ hex: "#008000" });
		expect(parseCssColor("hsl(0.5turn 100% 50%)")).toEqual({ hex: "#00ffff" });
		expect(parseCssColor("hsla(240, 100%, 50%, 0.25)")).toEqual({
			hex: "#0000ff",
			alpha: 0.25,
		});
		expect(parseCssColor("hsl(-120, 100%, 50%)")).toEqual({ hex: "#0000ff" });
	});

	it("answers undefined for what it cannot read", () => {
		for (const value of [
			"redd",
			"",
			"#12345",
			"#1234567",
			"rgb(255, 0)",
			"rgb(a, b, c)",
			"oklch(0.6 0.2 30)",
			"currentColor",
			"constructor",
		]) {
			expect(parseCssColor(value), value).toBeUndefined();
		}
	});
});

describe("cssColorAlpha", () => {
	it("lets a colour's own alpha replace the opacity field", () => {
		expect(cssColorAlpha({ hex: "#000000" }, 0.5)).toBe(0.5);
		expect(cssColorAlpha({ hex: "#000000", alpha: 0.25 }, 0.5)).toBe(0.25);
	});

	it("hides the colour when the field is 0, as the preview does", () => {
		expect(cssColorAlpha({ hex: "#000000", alpha: 0.25 }, 0)).toBe(0);
	});
});

describe("colours written to ASS", () => {
	it("writes a name as the colour it means", () => {
		expect(rgbToASSColor("red", 1)).toBe("&H000000FF");
		expect(rgbToASSColor("#ff0000", 1)).toBe("&H000000FF");
	});

	it("takes a colour's own alpha over the opacity field", () => {
		expect(rgbToASSColor("rgba(255,0,0,0.5)", 1)).toBe("&H800000FF");
	});

	it("falls back for what it cannot read", () => {
		expect(rgbToASSColor("redd", 1)).toBe("&H00FFFFFF");
		expect(rgbToASSColor("redd", 1, "#000000")).toBe("&H00000000");
	});

	it("gives the canvas a real colour for a name", () => {
		expect(hexToRgba("red", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
		expect(hexToRgba("#00ff00", 1)).toBe("rgba(0, 255, 0, 1)");
	});
});
