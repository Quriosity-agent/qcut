import { describe, expect, it } from "vitest";
import {
	basicGradeIsAnimated,
	timelineRequiresRendererColorKeyframeExport,
	tonalControlsInUse,
} from "../types/color-keyframe-export-policy.js";

const keyframe = (value: number) => ({
	id: `k${value}`,
	frame: 0,
	value,
	easing: "linear",
});

function timelineWith({
	element,
	hidden = false,
}: {
	element: Record<string, unknown>;
	hidden?: boolean;
}) {
	return { tracks: [{ hidden, elements: [element] }] };
}

/**
 * The per-frame eq path cannot lift shadows or fade toward grey; a timeline
 * that animates a grade with those controls must export through the renderer.
 */
describe("timelineRequiresRendererColorKeyframeExport", () => {
	it("forces the renderer when an animated grade uses a tonal control", () => {
		const color = {
			enabled: true,
			basic: { enabled: true, shadows: 60 },
			keyframes: { "basic.exposure": [keyframe(0), keyframe(1)] },
		};
		expect(basicGradeIsAnimated({ color })).toBe(true);
		expect(tonalControlsInUse({ color })).toBe(true);
		expect(
			timelineRequiresRendererColorKeyframeExport({
				timeline: timelineWith({
					element: { type: "media", colorSettings: color },
				}),
			})
		).toBe(true);
		// A keyframed tonal control with a zero static value counts too.
		expect(
			timelineRequiresRendererColorKeyframeExport({
				timeline: timelineWith({
					element: {
						type: "adjustment",
						colorSettings: {
							basic: { enabled: true },
							keyframes: { "basic.fade": [keyframe(0), keyframe(40)] },
						},
					},
				}),
			})
		).toBe(true);
	});

	it("keeps static grades and animated non-tonal grades on the native path", () => {
		expect(
			timelineRequiresRendererColorKeyframeExport({
				timeline: timelineWith({
					element: {
						type: "media",
						colorSettings: { basic: { enabled: true, shadows: 100 } },
					},
				}),
			})
		).toBe(false);
		expect(
			timelineRequiresRendererColorKeyframeExport({
				timeline: timelineWith({
					element: {
						type: "media",
						colorSettings: {
							basic: { enabled: true, contrast: 20 },
							keyframes: { "basic.exposure": [keyframe(0), keyframe(1)] },
						},
					},
				}),
			})
		).toBe(false);
	});

	it("ignores hidden, disabled and non-visual elements", () => {
		const color = {
			basic: { enabled: true, blacks: -30 },
			keyframes: { "smart.intensity": [keyframe(0), keyframe(100)] },
		};
		expect(
			timelineRequiresRendererColorKeyframeExport({
				timeline: timelineWith({
					element: { type: "media", colorSettings: color },
					hidden: true,
				}),
			})
		).toBe(false);
		expect(
			timelineRequiresRendererColorKeyframeExport({
				timeline: timelineWith({
					element: { type: "media", hidden: true, colorSettings: color },
				}),
			})
		).toBe(false);
		expect(
			timelineRequiresRendererColorKeyframeExport({
				timeline: timelineWith({
					element: {
						type: "media",
						colorSettings: { ...color, enabled: false },
					},
				}),
			})
		).toBe(false);
		expect(
			timelineRequiresRendererColorKeyframeExport({
				timeline: timelineWith({
					element: { type: "text", colorSettings: color },
				}),
			})
		).toBe(false);
	});
});
