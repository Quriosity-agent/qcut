import { describe, expect, it } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { describeTransitionRefusal } from "../claude-transition-refusal";

function clip({
	id,
	startTime,
	duration = 4,
}: {
	id: string;
	startTime: number;
	duration?: number;
}): MediaElement {
	return {
		id,
		name: id,
		type: "media",
		mediaId: `${id}-media`,
		duration,
		startTime,
		trimStart: 0,
		trimEnd: 0,
	};
}

function track(elements: MediaElement[]): TimelineTrack {
	return { id: "main", name: "Main", type: "media", isMain: true, elements };
}

const videoMediaIds = new Set(["a-media", "b-media"]);
const mediaTypeOf = () => "video";

describe("describeTransitionRefusal", () => {
	const adjacent = {
		track: track([
			clip({ id: "a", startTime: 0 }),
			clip({ id: "b", startTime: 4 }),
		]),
		fromElementId: "a",
		toElementId: "b",
		type: "dissolve",
		videoMediaIds,
		mediaTypeOf,
	};

	it("names a missing or non-numeric duration instead of blaming the neighbours", () => {
		expect(describeTransitionRefusal(adjacent)).toBe(
			"duration must be a number of seconds between 0.1 and 5, got none"
		);
		expect(describeTransitionRefusal({ ...adjacent, duration: "1" })).toContain(
			'got "1"'
		);
		expect(
			describeTransitionRefusal({ ...adjacent, duration: Number.NaN })
		).toContain("got NaN");
	});

	it("falls back to the neighbouring transitions once the duration is valid", () => {
		expect(describeTransitionRefusal({ ...adjacent, duration: 1 })).toBe(
			"neighbouring transitions leave no room at this cut"
		);
	});

	it("reports a gap between the clips before looking at the duration", () => {
		expect(
			describeTransitionRefusal({
				...adjacent,
				track: track([
					clip({ id: "a", startTime: 0 }),
					clip({ id: "b", startTime: 5 }),
				]),
			})
		).toContain("gap of 1.000 s");
	});
});
