import { describe, expect, it } from "vitest";
import { DEFAULT_MEDIA_COLOR_SETTINGS } from "../color-properties";
import {
	mergeMediaColorSettings,
	readMediaAdjustmentsPatch,
} from "../color-settings-merge";

describe("mergeMediaColorSettings", () => {
	it("changes only the fields the patch names, at any depth", () => {
		const current = structuredClone(DEFAULT_MEDIA_COLOR_SETTINGS);
		current.basic.saturation = -35;
		current.hsl.ranges.red.hue = 12;
		const next = mergeMediaColorSettings({
			current,
			patch: {
				enabled: true,
				basic: { contrast: 20 },
				hsl: { enabled: true, ranges: { blue: { saturation: 10 } } },
			},
		});
		expect(next.basic.contrast).toBe(20);
		expect(next.basic.saturation).toBe(-35);
		expect(next.hsl.enabled).toBe(true);
		expect(next.hsl.ranges.red.hue).toBe(12);
		expect(next.hsl.ranges.blue.saturation).toBe(10);
		// Arrays replace rather than merge.
		const curves = mergeMediaColorSettings({
			current,
			patch: { curves: { master: [{ id: "a", x: 0, y: 0 }] } },
		});
		expect(curves.curves.master).toEqual([{ id: "a", x: 0, y: 0 }]);
	});
});

describe("readMediaAdjustmentsPatch", () => {
	it("takes the eight legacy fields and refuses typos", () => {
		expect(
			readMediaAdjustmentsPatch({ value: { contrast: 20, saturation: -35 } })
		).toEqual({ contrast: 20, saturation: -35 });
		expect(() =>
			readMediaAdjustmentsPatch({ value: { brightnes: 1 } })
		).toThrow("adjustments.brightnes is not a field");
		expect(() =>
			readMediaAdjustmentsPatch({ value: { contrast: "20" } })
		).toThrow("adjustments.contrast must be a number");
		expect(() => readMediaAdjustmentsPatch({ value: [] })).toThrow(
			"adjustments must be an object"
		);
	});
});
