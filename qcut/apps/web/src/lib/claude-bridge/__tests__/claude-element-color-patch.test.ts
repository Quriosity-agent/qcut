import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyElementChanges } from "../claude-timeline-bridge-elements";
import { formatTracksForExport } from "../claude-timeline-bridge-helpers";
import type { MediaElement, TimelineTrack } from "@/types/timeline";

const storeMocks = vi.hoisted(() => {
	const state = {
		tracks: [
			{
				id: "track",
				name: "Media",
				type: "media",
				elements: [
					{
						id: "clip",
						type: "media" as const,
						mediaId: "media",
						name: "Clip",
						startTime: 0,
						duration: 8,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			},
		],
		pushHistory: vi.fn(),
		updateElementStartTime: vi.fn(),
		updateElementTrim: vi.fn(),
		updateElementDuration: vi.fn(),
		updateMarkdownElement: vi.fn(),
		updateTextElement: vi.fn(),
		updateMediaElement: vi.fn(),
		updateMediaTiming: vi.fn(),
	};
	return { state };
});

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: { getState: vi.fn(() => storeMocks.state) },
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: { getState: vi.fn(() => ({ activeProject: null })) },
}));
vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
	debugError: vi.fn(),
}));

function lastMediaUpdate() {
	const calls = storeMocks.state.updateMediaElement.mock.calls;
	return calls[calls.length - 1][2] as {
		color: { enabled: boolean; basic: Record<string, number | boolean> };
		adjustments: Record<string, number>;
	};
}

/** C1: `element patch --set '{"color":…}'` returned updated:true and changed nothing. */
describe("clip colour through element patch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		storeMocks.state.tracks[0].elements[0] = {
			id: "clip",
			type: "media",
			mediaId: "media",
			name: "Clip",
			startTime: 0,
			duration: 8,
			trimStart: 0,
			trimEnd: 0,
		};
	});

	it("merges a partial grade into the clip and mirrors it into adjustments", () => {
		const result = applyElementChanges({
			elementId: "clip",
			changes: {
				color: {
					enabled: true,
					basic: {
						enabled: true,
						contrast: 20,
						saturation: -35,
						temperature: -25,
					},
				},
			} as never,
			pushHistory: false,
		});
		expect(result).toEqual({ applied: true });
		const update = lastMediaUpdate();
		expect(update.color.enabled).toBe(true);
		expect(update.color.basic).toMatchObject({
			enabled: true,
			contrast: 20,
			saturation: -35,
			temperature: -25,
			exposure: 0,
		});
		expect(update.adjustments).toMatchObject({
			contrast: 20,
			saturation: -35,
			temperature: -25,
			brightness: 0,
		});
	});

	it("keeps the clip's other values when patching one field", () => {
		const element = storeMocks.state.tracks[0].elements[0] as MediaElement;
		storeMocks.state.tracks[0].elements[0] = {
			...element,
			color: {
				enabled: true,
				basic: { enabled: true, saturation: -35 },
			},
		} as MediaElement;
		applyElementChanges({
			elementId: "clip",
			changes: { color: { basic: { contrast: 20 } } } as never,
			pushHistory: false,
		});
		expect(lastMediaUpdate().color.basic).toMatchObject({
			contrast: 20,
			saturation: -35,
		});
	});

	it("folds legacy adjustments into the grade's basic settings", () => {
		applyElementChanges({
			elementId: "clip",
			changes: { adjustments: { brightness: -5, vignette: 35 } } as never,
			pushHistory: false,
		});
		const update = lastMediaUpdate();
		expect(update.color.basic).toMatchObject({ brightness: -5, vignette: 35 });
		expect(update.adjustments).toMatchObject({ brightness: -5, vignette: 35 });
	});

	it("rejects malformed colour payloads before touching the clip", () => {
		expect(
			applyElementChanges({
				elementId: "clip",
				changes: { adjustments: { brightnes: 1 } } as never,
				pushHistory: false,
			})
		).toMatchObject({
			applied: false,
			error: expect.stringContaining("adjustments.brightnes is not a field"),
		});
		expect(
			applyElementChanges({
				elementId: "clip",
				changes: { color: "red" } as never,
				pushHistory: false,
			})
		).toMatchObject({
			applied: false,
			error: expect.stringContaining("color must be an object"),
		});
		expect(storeMocks.state.updateMediaElement).not.toHaveBeenCalled();
	});
});

describe("unsupported patch fields", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("refuses a patch made only of fields a clip cannot use, naming them", () => {
		expect(
			applyElementChanges({
				elementId: "clip",
				changes: { name: "Intro", wobble: 3 } as never,
				pushHistory: false,
			})
		).toMatchObject({
			applied: false,
			error: "No supported field for a media element in: name, wobble",
		});
		expect(storeMocks.state.updateMediaElement).not.toHaveBeenCalled();
	});

	it("applies the supported fields and reports the rest", () => {
		expect(
			applyElementChanges({
				elementId: "clip",
				changes: { adjustments: { contrast: 10 }, name: "Intro" } as never,
				pushHistory: false,
			})
		).toEqual({ applied: true, ignoredFields: ["name"] });
		expect(storeMocks.state.updateMediaElement).toHaveBeenCalledTimes(1);
	});
});

describe("clip colour in the export snapshot", () => {
	it("reports the stored grade and adjustments beside the resolved colorSettings", () => {
		const tracks: TimelineTrack[] = [
			{
				id: "track",
				name: "Media",
				type: "media",
				elements: [
					{
						id: "clip",
						type: "media",
						mediaId: "media",
						name: "Clip",
						startTime: 0,
						duration: 8,
						trimStart: 0,
						trimEnd: 0,
						color: { enabled: true, basic: { enabled: true, contrast: 20 } },
						adjustments: { contrast: 20 },
					} as unknown as MediaElement,
				],
			},
		];
		const [element] = formatTracksForExport({ tracks, fps: 24 })[0]
			.elements as unknown as Array<Record<string, unknown>>;
		expect(element.color).toMatchObject({ enabled: true });
		expect(element.adjustments).toEqual({ contrast: 20 });
		expect(element.colorSettings).toMatchObject({
			basic: expect.objectContaining({ contrast: 20 }),
		});
	});
});
