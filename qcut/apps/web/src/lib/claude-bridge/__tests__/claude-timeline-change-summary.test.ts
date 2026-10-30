import { describe, expect, it } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import {
	historyStepReport,
	summarizeTimelineChange,
} from "../claude-timeline-change-summary";

/**
 * N18 (2026-10-28 trailer report): an undo answered ok while it took back
 * an older step than the caller meant; the answer now says what changed.
 */

function track(id: string, elements: Array<[string, number]>): TimelineTrack {
	return {
		id,
		name: id,
		type: "media",
		elements: elements.map(([elementId, startTime]) => ({
			id: elementId,
			name: elementId,
			type: "media",
			mediaId: `${elementId}-m`,
			startTime,
			duration: 2,
			trimStart: 0,
			trimEnd: 0,
		})),
	} as TimelineTrack;
}

describe("what an undo changed", () => {
	it("lists the restored, removed and moved elements", () => {
		const before = [
			track("main", [
				["b", 0],
				["c", 2],
			]),
			track("sfx", [["hit", 106.3964]]),
		];
		const after = [
			track("main", [
				["a", 0],
				["b", 2],
				["c", 4],
			]),
			track("sfx", [["hit", 106.3804]]),
		];

		const summary = summarizeTimelineChange({ before, after });
		expect(summary).toMatchObject({ added: 1, removed: 0, moved: 3 });
		expect(summary.elements.map((element) => element.elementId)).toEqual([
			"a",
			"b",
			"c",
			"hit",
		]);
		expect(summary.elements.at(-1)).toMatchObject({
			change: "moved",
			startTime: 106.3804,
			from: { trackId: "sfx", startTime: 106.3964 },
		});
	});

	it("names the step from the history list it landed on", () => {
		const tracks = [track("main", [["a", 0]])];
		expect(
			historyStepReport({
				entries: [{ label: "Edit" }, { label: "Import captions" }],
				before: tracks,
				after: tracks,
			})
		).toEqual({
			label: "Import captions",
			changes: { added: 0, removed: 0, moved: 0, changed: 0, elements: [] },
		});
	});

	it("names what changed on a clip that kept its place (N28)", () => {
		// Undoing a replace-media: the clip stays at 2 s, its media goes back.
		const replaced = track("main", [["shot", 2]]);
		const restored = track("main", [["shot", 2]]);
		Object.assign(replaced.elements[0], { mediaId: "v2", trimEnd: 1 });

		const summary = summarizeTimelineChange({
			before: [replaced],
			after: [restored],
		});
		expect(summary).toMatchObject({ moved: 0, changed: 1 });
		expect(summary.elements).toEqual([
			{
				elementId: "shot",
				name: "shot",
				change: "changed",
				trackId: "main",
				startTime: 2,
				duration: 2,
				fields: ["mediaId", "trimEnd"],
			},
		]);
	});

	it("lists the other fields of a moved element", () => {
		const before = track("main", [["shot", 0]]);
		const after = track("main", [["shot", 4]]);
		Object.assign(after.elements[0], { mediaId: "v2" });
		expect(
			summarizeTimelineChange({ before: [before], after: [after] }).elements
		).toEqual([
			expect.objectContaining({
				change: "moved",
				from: { trackId: "main", startTime: 0, duration: 2 },
				fields: ["mediaId", "startTime"],
			}),
		]);
	});
});
