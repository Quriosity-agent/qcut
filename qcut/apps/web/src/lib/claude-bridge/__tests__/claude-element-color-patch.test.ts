import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyElementChanges } from "../claude-timeline-bridge-elements";
import {
	formatTracksForExport,
	getClaudeAdjustmentFields,
} from "../claude-timeline-bridge-helpers";
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
				changes: { wobble: 3, glow: true } as never,
				pushHistory: false,
			})
		).toMatchObject({
			applied: false,
			error: "No supported field for a media element in: wobble, glow",
		});
		expect(storeMocks.state.updateMediaElement).not.toHaveBeenCalled();
	});

	it("applies the supported fields and reports the rest", () => {
		expect(
			applyElementChanges({
				elementId: "clip",
				changes: {
					adjustments: { contrast: 10 },
					name: "Intro",
					wobble: 3,
				} as never,
				pushHistory: false,
			})
		).toEqual({ applied: true, ignoredFields: ["wobble"] });
		expect(storeMocks.state.updateMediaElement).toHaveBeenCalledTimes(1);
		expect(lastMediaUpdate()).toMatchObject({ name: "Intro" });
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

/** Q4/Q5 (问题记录_片中文字_QCut1702): precedence and range rules for grades. */
describe("grade precedence and ranges through element patch", () => {
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

	it("lets color.basic win over a stale exported adjustments mirror", () => {
		// A timeline-export round trip: the user edited color.basic.contrast
		// but the manifest still carries the old all-zero adjustments mirror.
		const result = applyElementChanges({
			elementId: "clip",
			changes: {
				color: {
					enabled: true,
					basic: { enabled: true, contrast: 25, saturation: 15 },
				},
				adjustments: {
					brightness: 0,
					contrast: 0,
					saturation: 0,
					temperature: 0,
					tint: 0,
					sharpness: 0,
					fade: 0,
					vignette: 0,
				},
			} as never,
			pushHistory: false,
		});
		expect(result).toEqual({ applied: true });
		const update = lastMediaUpdate();
		expect(update.color.basic).toMatchObject({ contrast: 25, saturation: 15 });
		// The stored mirror follows the effective grade, not the stale input.
		expect(update.adjustments).toMatchObject({ contrast: 25, saturation: 15 });
	});

	it("still applies an adjustments-only patch", () => {
		const result = applyElementChanges({
			elementId: "clip",
			changes: { adjustments: { contrast: 12 } } as never,
			pushHistory: false,
		});
		expect(result).toEqual({ applied: true });
		const update = lastMediaUpdate();
		expect(update.color.basic).toMatchObject({ contrast: 12 });
		expect(update.adjustments).toMatchObject({ contrast: 12 });
	});

	it("refuses an out-of-range basic control instead of storing it", () => {
		expect(
			applyElementChanges({
				elementId: "clip",
				changes: { color: { basic: { exposure: 20 } } } as never,
				pushHistory: false,
			})
		).toMatchObject({
			applied: false,
			error: expect.stringContaining(
				"color.basic.exposure must be -5..5 (got 20)"
			),
		});
		expect(storeMocks.state.updateMediaElement).not.toHaveBeenCalled();
	});

	it("refuses an out-of-range legacy adjustments field", () => {
		expect(
			applyElementChanges({
				elementId: "clip",
				changes: { adjustments: { contrast: 2000 } } as never,
				pushHistory: false,
			})
		).toMatchObject({
			applied: false,
			error: expect.stringContaining(
				"adjustments.contrast must be -100..100 (got 2000)"
			),
		});
		expect(storeMocks.state.updateMediaElement).not.toHaveBeenCalled();
	});

	it("refuses an out-of-range colour wheel coordinate", () => {
		expect(
			applyElementChanges({
				elementId: "clip",
				changes: { color: { wheels: { shadows: { x: 4 } } } } as never,
				pushHistory: false,
			})
		).toMatchObject({
			applied: false,
			error: expect.stringContaining(
				"color.wheels.shadows.x must be -1..1 (got 4)"
			),
		});
	});

	it("refuses an out-of-range grade on an adjustment layer too", () => {
		expect(() =>
			getClaudeAdjustmentFields({
				element: {
					color: { basic: { exposure: 20 } },
				} as never,
			})
		).toThrow("color.basic.exposure must be -5..5 (got 20)");
		expect(() =>
			getClaudeAdjustmentFields({
				element: { adjustments: { vignette: 500 } } as never,
			})
		).toThrow("adjustments.vignette must be 0..100 (got 500)");
	});

	it("refuses non-numeric values on defined grade fields", () => {
		expect(
			applyElementChanges({
				elementId: "clip",
				changes: { color: { basic: { exposure: "20" } } } as never,
				pushHistory: false,
			})
		).toMatchObject({
			applied: false,
			error: expect.stringContaining(
				'color.basic.exposure must be -5..5 (got "20")'
			),
		});
		expect(() =>
			getClaudeAdjustmentFields({
				element: { adjustments: { brightness: "20" } } as never,
			})
		).toThrow('adjustments.brightness must be -100..100 (got "20")');
	});

	it("merges an adjustment-layer update into its current grade, basic wins", () => {
		const fields = getClaudeAdjustmentFields({
			element: {
				color: { basic: { saturation: 15 } },
				// Stale exported mirror naming a field the color patch also sets.
				adjustments: { saturation: 0, vignette: 35 },
			} as never,
			current: {
				color: {
					enabled: true,
					basic: { enabled: true, contrast: 25 },
					wheels: { enabled: true, shadows: { x: -0.018, y: 0.025 } },
				},
			} as never,
		});
		// The untouched parts of the current grade survive the partial patch.
		expect(fields.color?.basic).toMatchObject({ contrast: 25, saturation: 15 });
		expect(fields.color?.wheels.shadows).toMatchObject({ x: -0.018, y: 0.025 });
		// The mirror follows the merged grade: basic wins, legacy-only lands.
		expect(fields.adjustments).toMatchObject({
			contrast: 25,
			saturation: 15,
			vignette: 35,
		});
	});

	it("keeps completing a new layer's partial grade from defaults", () => {
		const fields = getClaudeAdjustmentFields({
			element: { adjustments: { contrast: 15 } } as never,
		});
		expect(fields.color).toBeUndefined();
		expect(fields.adjustments).toMatchObject({ contrast: 15, saturation: 0 });
	});

	it("keeps accepting in-range values at the range edges", () => {
		const result = applyElementChanges({
			elementId: "clip",
			changes: {
				color: {
					basic: { exposure: -5 },
					wheels: { shadows: { x: -0.018, y: 0.025 } },
				},
			} as never,
			pushHistory: false,
		});
		expect(result).toEqual({ applied: true });
		const update = lastMediaUpdate();
		expect(update.color.basic).toMatchObject({ exposure: -5 });
	});
});
