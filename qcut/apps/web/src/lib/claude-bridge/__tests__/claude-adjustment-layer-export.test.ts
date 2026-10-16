import { describe, expect, it, vi } from "vitest";
import type { AdjustmentElement, TimelineTrack } from "@/types/timeline";
import {
	formatTracksForExport,
	getClaudeAdjustmentFields,
} from "../claude-timeline-bridge-helpers";

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: { getState: vi.fn(() => ({ tracks: [] })) },
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: { getState: vi.fn(() => ({ activeProject: null })) },
}));
vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
	debugError: vi.fn(),
}));

function adjustmentTrack({
	element,
}: {
	element: Partial<AdjustmentElement>;
}): TimelineTrack[] {
	return [
		{
			id: "adjust",
			name: "Adjustment",
			type: "adjustment",
			elements: [
				{
					id: "layer",
					type: "adjustment",
					name: "Grade",
					startTime: 0,
					duration: 163.33,
					trimStart: 0,
					trimEnd: 0,
					...element,
				} as AdjustmentElement,
			],
		},
	];
}

describe("adjustment layers in the export snapshot", () => {
	it("resolves the layer's grade the way a clip's is, so the export can render it", () => {
		const [track] = formatTracksForExport({
			tracks: adjustmentTrack({
				element: {
					adjustments: {
						brightness: -5,
						contrast: 15,
						saturation: -30,
						temperature: -20,
						tint: 0,
						sharpness: 0,
						fade: 5,
						vignette: 35,
					},
					opacity: 0.8,
				},
			}),
			fps: 24,
		});
		const [layer] = track.elements as Array<
			Record<string, unknown> & {
				colorSettings?: { enabled: boolean; basic: Record<string, unknown> };
			}
		>;
		expect(layer.type).toBe("adjustment");
		expect(layer.opacity).toBe(0.8);
		expect(layer.endTime).toBeCloseTo(163.33, 5);
		expect(layer.colorSettings?.enabled).toBe(true);
		expect(layer.colorSettings?.basic).toMatchObject({
			enabled: true,
			brightness: -5,
			contrast: 15,
			saturation: -30,
			temperature: -20,
			fade: 5,
			vignette: 35,
			exposure: 0,
		});
	});

	it("leaves a neutral layer without colorSettings", () => {
		const [track] = formatTracksForExport({
			tracks: adjustmentTrack({ element: {} }),
			fps: 24,
		});
		expect(
			(track.elements[0] as Record<string, unknown>).colorSettings
		).toBeUndefined();
	});
});

describe("getClaudeAdjustmentFields", () => {
	it("stores a partial grade complete, merged with the editor's defaults", () => {
		const fields = getClaudeAdjustmentFields({
			element: {
				adjustments: { brightness: -5, contrast: 15 },
				color: { enabled: true, basic: { enabled: true, contrast: 20 } },
			} as never,
		});
		expect(fields.adjustments).toEqual({
			brightness: -5,
			contrast: 15,
			saturation: 0,
			temperature: 0,
			tint: 0,
			sharpness: 0,
			fade: 0,
			vignette: 0,
		});
		expect(fields.color?.basic).toMatchObject({
			enabled: true,
			contrast: 20,
			saturation: 0,
			exposure: 0,
		});
		expect(fields.color?.lut.enabled).toBe(false);
		expect(fields.color?.hsl.enabled).toBe(false);
		expect(fields.color?.curves.enabled).toBe(false);
	});
});
