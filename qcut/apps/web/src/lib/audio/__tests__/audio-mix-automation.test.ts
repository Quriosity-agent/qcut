import { describe, expect, it } from "vitest";
import {
	automationValueAt,
	hasAutomation,
	normalizeAutomation,
	normalizeAutomationPoints,
	rippleAutomation,
	ripplePoints,
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

describe("automation after a ripple delete", () => {
	it("drops the span, moves later points up and pins the join value", () => {
		// A fade from 0 dB at 10 s to -12 dB at 20 s; the span 12–16 s is cut.
		const points = [
			{ time: 10, value: 0 },
			{ time: 14, value: -4.8 },
			{ time: 20, value: -12 },
		];
		const rippled = ripplePoints({ points, startTime: 12, endTime: 16 });
		// The value the curve had at 16 s (-7.2 dB) now sits at 12 s, so the
		// fade continues from there instead of interpolating across the cut.
		expect(rippled).toEqual([
			{ time: 10, value: 0 },
			{ time: 12, value: expect.closeTo(-7.2, 5) },
			{ time: 16, value: -12 },
		]);
	});

	it("only shifts when the span is before the points", () => {
		const points = [
			{ time: 209.25, value: 0 },
			{ time: 212.25, value: -60 },
		];
		expect(
			ripplePoints({ points, startTime: 48.125, endTime: 60.708 })
		).toEqual([
			{ time: expect.closeTo(196.667, 3), value: 0 },
			{ time: expect.closeTo(199.667, 3), value: -60 },
		]);
		expect(ripplePoints({ points, startTime: 300, endTime: 310 })).toEqual(
			points
		);
	});

	it("leaves a curve alone for an empty span and drops curves that end up empty", () => {
		const automation = { gainDb: [{ time: 5, value: -6 }], pan: [] };
		expect(
			rippleAutomation({ automation, startTime: 10, endTime: 10 })?.gainDb
		).toEqual([{ time: 5, value: -6 }]);
		expect(
			rippleAutomation({
				automation: { gainDb: [{ time: 5, value: -6 }] },
				startTime: 4,
				endTime: 6,
			})
		).toBeUndefined();
	});
});
