import { describe, expect, it } from "vitest";
import { selectNativePreviewTracks } from "../native-preview-tracks";
import { buildTimelineAssLayers } from "@/lib/export/export-engine-cli-text";
import type {
	CaptionElement,
	MediaElement,
	TimelineTrack,
} from "@/types/timeline";

function clip({
	id,
	startTime = 0,
	...overrides
}: Partial<MediaElement> & { id: string }): MediaElement {
	return {
		id,
		startTime,
		type: "media",
		mediaId: "video",
		name: id,
		duration: 4,
		trimStart: 0,
		trimEnd: 0,
		...overrides,
	};
}

function track({
	elements,
	...overrides
}: Partial<TimelineTrack> & { elements: MediaElement[] }): TimelineTrack {
	return { id: "main", name: "Main", type: "media", elements, ...overrides };
}

describe("native preview track selection", () => {
	it("builds only the current caption instead of exceeding the native layer limit", () => {
		const elements: CaptionElement[] = Array.from(
			{ length: 1200 },
			(_, index) => ({
				id: `caption-${index}`,
				name: `Caption ${index}`,
				type: "captions",
				text: `Caption ${index}`,
				language: "en",
				source: "manual",
				startTime: index,
				duration: 0.8,
				trimStart: 0,
				trimEnd: 0,
			})
		);
		const tracks: TimelineTrack[] = [
			{ id: "captions", name: "Captions", type: "captions", elements },
		];
		const selected = selectNativePreviewTracks({
			tracks,
			timelineTime: 599.5,
			fps: 30,
		});
		const { layers } = buildTimelineAssLayers({
			tracks: selected,
			canvasWidth: 1920,
			canvasHeight: 1080,
			fps: 30,
		});
		expect(layers).toHaveLength(1);
		expect(layers[0].elementOrder).toBe(599);
		expect(layers[0].content).toContain("Caption 599");
		expect(layers[0].content).not.toContain("Caption 600");
	});

	it("excludes distant clips without changing indices, timing, or original tracks", () => {
		const elements = Array.from({ length: 600 }, (_, index) =>
			clip({ id: String(index), startTime: index * 4 })
		);
		const tracks = [track({ elements })];
		const selected = selectNativePreviewTracks({
			tracks,
			timelineTime: 10,
			fps: 30,
		});
		expect(selected[0].elements).toHaveLength(600);
		expect(selected[0].elements.filter((element) => !element.hidden)).toEqual([
			elements[2],
		]);
		expect(selected[0].elements[2]).toBe(elements[2]);
		expect(tracks[0].elements.every((element) => !element.hidden)).toBe(true);
	});

	it("uses trimmed, speed-adjusted media duration and excludes the end boundary", () => {
		const tracks = [
			track({
				elements: [
					clip({
						id: "speed",
						startTime: 10,
						duration: 10,
						trimStart: 2,
						trimEnd: 2,
						playbackRate: 2,
					}),
				],
			}),
		];
		expect(
			selectNativePreviewTracks({ tracks, timelineTime: 12.9, fps: 30 })[0]
				.elements[0].hidden
		).not.toBe(true);
		expect(
			selectNativePreviewTracks({ tracks, timelineTime: 13, fps: 30 })[0]
				.elements[0].hidden
		).toBe(true);
	});

	it("keeps transition source chains and existing hidden flags", () => {
		const elements = [
			clip({ id: "a" }),
			clip({ id: "b", startTime: 4 }),
			clip({ id: "hidden", startTime: 8, hidden: true }),
		];
		const tracks = [
			track({
				elements,
				transitions: [
					{
						id: "ab",
						fromElementId: "a",
						toElementId: "b",
						duration: 1,
						type: "dissolve",
						presetId: "dissolve",
						easing: "linear",
					},
				],
			}),
		];
		const selected = selectNativePreviewTracks({
			tracks,
			timelineTime: 0,
			fps: 30,
		});
		expect(selected[0].elements).toEqual(elements);
		expect(selected[0].transitions).toBe(tracks[0].transitions);
	});

	it("keeps empty/hidden tracks in stacking order but exports no hidden media", () => {
		const tracks = [
			track({ id: "empty", elements: [] }),
			track({ id: "hidden", hidden: true, elements: [clip({ id: "a" })] }),
			track({ id: "visible", elements: [clip({ id: "b" })] }),
		];
		const selected = selectNativePreviewTracks({
			tracks,
			timelineTime: 1,
			fps: 30,
		});
		expect(selected.map(({ id }) => id)).toEqual([
			"empty",
			"hidden",
			"visible",
		]);
		expect(selected[1].elements[0].hidden).toBe(true);
		expect(selected[2].elements[0].hidden).not.toBe(true);
	});

	it("does not cull on invalid timing input", () => {
		const tracks = [track({ elements: [clip({ id: "a" })] })];
		expect(
			selectNativePreviewTracks({ tracks, timelineTime: Number.NaN, fps: 30 })
		).toBe(tracks);
		expect(selectNativePreviewTracks({ tracks, timelineTime: 1, fps: 0 })).toBe(
			tracks
		);
	});
});
