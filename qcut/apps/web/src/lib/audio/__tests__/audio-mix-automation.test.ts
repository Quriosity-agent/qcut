import { describe, expect, it } from "vitest";
import {
	automationValueAt,
	hasAutomation,
	normalizeAutomation,
	normalizeAutomationPoints,
	sampleAutomation,
} from "../audio-mix-automation";

describe("automation curves", () => {
	it("sorts points by time, keeps the last of a time, clamps and drops junk", () => {
		expect(
			normalizeAutomationPoints({
				param: "gainDb",
				points: [
					{ time: 2, value: -6 },
					{ time: 0, value: 20 },
					{ time: 2, value: -9 },
					{ time: -1, value: 0 },
					{ time: 1, value: "x" },
					null,
					{ time: 1, value: -80 },
				],
			})
		).toEqual([
			{ time: 0, value: 12 },
			{ time: 1, value: -60 },
			{ time: 2, value: -9 },
		]);
		expect(
			normalizeAutomationPoints({
				param: "pan",
				points: [{ time: 0, value: 3 }],
			})
		).toEqual([{ time: 0, value: 1 }]);
		expect(normalizeAutomationPoints({ param: "pan", points: "no" })).toEqual(
			[]
		);
	});

	it("keeps only curves with points", () => {
		expect(normalizeAutomation(undefined)).toBeUndefined();
		expect(normalizeAutomation({ gainDb: [], pan: null })).toBeUndefined();
		expect(
			normalizeAutomation({ gainDb: [{ time: 1, value: -3 }], pan: [] })
		).toEqual({ gainDb: [{ time: 1, value: -3 }] });
		expect(hasAutomation({ pan: [{ time: 0, value: 0 }] })).toBe(true);
		expect(hasAutomation({ gainDb: [] })).toBe(false);
	});

	it("holds before the first point and after the last, and is a straight line between", () => {
		const points = [
			{ time: 1, value: 0 },
			{ time: 3, value: -12 },
			{ time: 4, value: -12 },
			{ time: 6, value: 0 },
		];
		expect(automationValueAt({ points, time: 0 })).toBe(0);
		expect(automationValueAt({ points, time: 2 })).toBe(-6);
		expect(automationValueAt({ points, time: 3.5 })).toBe(-12);
		expect(automationValueAt({ points, time: 5.5 })).toBeCloseTo(-3, 10);
		expect(automationValueAt({ points, time: 60 })).toBe(0);
		expect(
			automationValueAt({ points: [{ time: 2, value: 0.5 }], time: 9 })
		).toBe(0.5);
	});

	it("finds the segment by search among many points", () => {
		const points = Array.from({ length: 1_000 }, (_, index) => ({
			time: index,
			value: index % 2,
		}));
		expect(automationValueAt({ points, time: 500.25 })).toBeCloseTo(0.25, 10);
		expect(automationValueAt({ points, time: 501.25 })).toBeCloseTo(0.75, 10);
	});

	it("subdivides sloped segments and leaves flat ones alone", () => {
		const points = [
			{ time: 0, value: 0 },
			{ time: 0.05, value: -10 },
			{ time: 1, value: -10 },
			{ time: 11, value: 0 },
		];
		const sampled = sampleAutomation({ points });
		// The 50 ms slope gets 5 steps, the flat second none, the 10 s slope is capped.
		expect(sampled.length).toBe(4 + 4 + 0 + 63);
		for (let index = 1; index < sampled.length; index += 1) {
			expect(sampled[index].time).toBeGreaterThan(sampled[index - 1].time);
			expect(sampled[index].value).toBeCloseTo(
				automationValueAt({ points, time: sampled[index].time }),
				10
			);
		}
	});
});
