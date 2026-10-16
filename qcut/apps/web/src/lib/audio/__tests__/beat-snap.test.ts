import { describe, expect, it } from "vitest";
import { nearestBeat, planBeatSnaps } from "../beat-snap";

const beats = [0.5, 1.0, 1.5, 2.0, 2.5];

describe("beat snapping", () => {
	it("finds the nearest beat within reach", () => {
		expect(nearestBeat({ beats, time: 1.6, maxDistance: 0.5 })).toBe(1.5);
		expect(nearestBeat({ beats, time: 1.26, maxDistance: 0.5 })).toBe(1.5);
		expect(nearestBeat({ beats, time: 4, maxDistance: 0.5 })).toBeNull();
		expect(nearestBeat({ beats: [], time: 1, maxDistance: 1 })).toBeNull();
	});

	it("moves a clip's start onto the beat and reports the distance", () => {
		const [plan] = planBeatSnaps({
			elements: [{ elementId: "a", trackId: "t", startTime: 1.4, duration: 2 }],
			beats,
		});
		expect(plan).toMatchObject({ from: 1.4, to: 1.5, beat: 1.5 });
		expect(plan.moved).toBeCloseTo(0.1, 6);
	});

	it("can land the clip's end on the beat instead", () => {
		const [plan] = planBeatSnaps({
			elements: [{ elementId: "a", trackId: "t", startTime: 0.3, duration: 1 }],
			beats,
			edge: "end",
		});
		// End at 1.3 → nearest beat 1.5 → start 0.5.
		expect(plan).toMatchObject({ to: 0.5, beat: 1.5 });
	});

	it("leaves a clip with no beat near its edge, saying why", () => {
		const [plan] = planBeatSnaps({
			elements: [{ elementId: "a", trackId: "t", startTime: 9, duration: 1 }],
			beats,
			maxDistance: 0.25,
		});
		expect(plan).toMatchObject({ from: 9, to: 9, moved: 0, beat: null });
		expect(plan.reason).toContain("no beat within 0.25 s");
	});
});
