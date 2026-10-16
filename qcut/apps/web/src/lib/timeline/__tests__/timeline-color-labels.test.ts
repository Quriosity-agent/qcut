import { describe, expect, it } from "vitest";
import { resolveEffectiveColorLabel } from "../timeline-color-labels";

describe("resolveEffectiveColorLabel", () => {
	it("prefers the clip's own colour", () => {
		expect(
			resolveEffectiveColorLabel({
				element: { colorLabel: "red" },
				track: { colorLabel: "green" },
			})
		).toBe("red");
	});

	it("falls back to the track's colour, then to none", () => {
		expect(
			resolveEffectiveColorLabel({
				element: {},
				track: { colorLabel: "green" },
			})
		).toBe("green");
		expect(resolveEffectiveColorLabel({ element: {}, track: {} })).toBe(
			undefined
		);
	});

	it("ignores a value that is not a colour label", () => {
		expect(
			resolveEffectiveColorLabel({
				element: { colorLabel: "teal" },
				track: { colorLabel: "violet" },
			})
		).toBe("violet");
	});
});
