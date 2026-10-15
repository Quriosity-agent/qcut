import { describe, expect, it } from "vitest";
import type { ClaudeTimeline, ClaudeTrack } from "../types/claude-api.js";
import { describeRefusedMove } from "../claude/http/timeline-move-refusal.js";

function element({
	id,
	startTime,
	endTime,
}: {
	id: string;
	startTime: number;
	endTime: number;
}) {
	return {
		id,
		trackIndex: 0,
		startTime,
		endTime,
		duration: endTime - startTime,
		type: "video" as const,
		sourceName: `${id}.mp4`,
	};
}

function timelineWith({
	tracks,
	fps = 24,
}: {
	tracks: Array<Partial<ClaudeTrack> & Pick<ClaudeTrack, "id" | "name">>;
	fps?: number;
}): ClaudeTimeline {
	return {
		name: "Project",
		duration: 0,
		width: 1280,
		height: 720,
		fps,
		tracks: tracks.map((track, index) => ({
			index,
			type: "media",
			elements: [],
			...track,
		})),
	} as ClaudeTimeline;
}

const mainTrack = {
	id: "main",
	name: "Main",
	elements: [
		element({ id: "six", startTime: 100.208333, endTime: 117.25 }),
		element({ id: "eight", startTime: 133.291667, endTime: 140 }),
		element({ id: "seven", startTime: 240, endTime: 256.041667 }),
	],
};

describe("describeRefusedMove", () => {
	it("names the clip in the way and the next free start", () => {
		const message = describeRefusedMove({
			timeline: timelineWith({ tracks: [mainTrack] }),
			elementId: "seven",
			toTrackId: "main",
			startTime: 110,
		});
		expect(message).toBe(
			'The editor refused the move: 110s–126.041667s on track "Main" (main) overlaps "six.mp4" (100.208333s–117.25s). A track plays one element at a time; the next free start for this 16.041667s element is 117.25s. The element is still on track "Main" (main) at 240s.'
		);
	});

	it("says the lane is locked instead of occupied", () => {
		const message = describeRefusedMove({
			timeline: timelineWith({
				tracks: [mainTrack, { id: "b-roll", name: "B-roll", locked: true }],
			}),
			elementId: "seven",
			toTrackId: "b-roll",
			startTime: undefined,
		});
		expect(message).toBe(
			'The editor refused the move: track "B-roll" (b-roll) is locked. The element is still on track "Main" (main) at 240s.'
		);
	});

	it("reports a missing target track", () => {
		expect(
			describeRefusedMove({
				timeline: timelineWith({ tracks: [mainTrack] }),
				elementId: "seven",
				toTrackId: "nowhere",
				startTime: 0,
			})
		).toContain("track nowhere does not exist");
	});

	it("treats a sub-frame overlap as a seam, like the renderer", () => {
		// The span is free apart from float residue at the seam, so the refusal
		// cannot have been about occupancy.
		const message = describeRefusedMove({
			timeline: timelineWith({ tracks: [mainTrack] }),
			elementId: "seven",
			toTrackId: "main",
			startTime: 117.249997,
		});
		expect(message).not.toContain("overlaps");
		expect(message).toContain("check that the element type fits that track");
	});
});
