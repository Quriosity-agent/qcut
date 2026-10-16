import { describe, expect, it } from "vitest";
import { timelineRequiresRendererShaderTransitionExport } from "../types/shader-transition-export-policy.js";

describe("timelineRequiresRendererShaderTransitionExport", () => {
	it("forces the renderer when any track holds a GL shader transition", () => {
		expect(
			timelineRequiresRendererShaderTransitionExport({
				timeline: {
					tracks: [
						{ transitions: [] },
						{
							transitions: [{ type: "dissolve" }, { type: "shader" }],
						},
					],
				},
			})
		).toBe(true);
	});

	it("leaves FFmpeg-renderable timelines alone", () => {
		expect(
			timelineRequiresRendererShaderTransitionExport({
				timeline: {
					tracks: [
						{},
						{ transitions: null },
						{ transitions: [{ type: "dissolve" }, { type: "cube" }] },
					],
				},
			})
		).toBe(false);
	});
});
