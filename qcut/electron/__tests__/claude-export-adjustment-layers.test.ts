import { describe, expect, it } from "vitest";
import {
	buildAdjustmentLayerPass,
	collectAdjustmentLayers,
} from "../claude/handlers/claude-export-handler/adjustment-layer-pass.js";
import { DEFAULT_VIDEO_COLOR_SETTINGS } from "../ffmpeg/color-settings.js";
import type { ClaudeTimeline } from "../types/claude-api.js";
import { timelineRequiresRendererAdjustmentLayerExport } from "../types/adjustment-layer-export-policy.js";

function grade({ saturation = -100 }: { saturation?: number } = {}) {
	const color = structuredClone(DEFAULT_VIDEO_COLOR_SETTINGS);
	color.enabled = true;
	color.basic = { ...color.basic, enabled: true, saturation };
	return color as unknown as Record<string, unknown>;
}

function timeline({
	tracks,
}: {
	tracks: Array<{
		hidden?: boolean;
		elements: Array<Record<string, unknown>>;
	}>;
}): ClaudeTimeline {
	return {
		name: "t",
		duration: 10,
		width: 64,
		height: 36,
		fps: 24,
		tracks: tracks.map((track, index) => ({
			id: `track-${index}`,
			index,
			name: `Track ${index}`,
			type: "media",
			hidden: track.hidden,
			elements: track.elements.map((element, order) => ({
				id: `el-${index}-${order}`,
				trackIndex: index,
				startTime: 0,
				endTime: 10,
				duration: 10,
				type: "media",
				...element,
			})),
		})),
	} as unknown as ClaudeTimeline;
}

describe("collectAdjustmentLayers", () => {
	it("keeps graded, visible layers, lowest track first, and marks those above the overlays", () => {
		const layers = collectAdjustmentLayers({
			timeline: timeline({
				tracks: [
					{
						elements: [
							{
								type: "adjustment",
								colorSettings: grade(),
								startTime: 2,
								endTime: 4,
							},
						],
					},
					{ elements: [{ type: "text", content: "title" }] },
					{
						elements: [
							{ type: "adjustment", colorSettings: grade(), opacity: 0.5 },
							{ type: "adjustment", startTime: 5, endTime: 6 },
							{ type: "adjustment", colorSettings: grade(), hidden: true },
							{ type: "adjustment", colorSettings: grade(), opacity: 0 },
						],
					},
					{
						hidden: true,
						elements: [{ type: "adjustment", colorSettings: grade() }],
					},
					{ elements: [{ type: "media" }] },
				],
			}),
		});
		expect(layers).toEqual([
			expect.objectContaining({
				elementId: "el-2-0",
				trackOrder: 2,
				opacity: 0.5,
				aboveOverlays: false,
			}),
			expect.objectContaining({
				elementId: "el-0-0",
				trackOrder: 0,
				startTime: 2,
				endTime: 4,
				opacity: 1,
				aboveOverlays: true,
			}),
		]);
	});

	it("treats every layer as below the overlays when there are none", () => {
		const layers = collectAdjustmentLayers({
			timeline: timeline({
				tracks: [
					{ elements: [{ type: "adjustment", colorSettings: grade() }] },
					{ elements: [{ type: "media" }] },
				],
			}),
		});
		expect(layers.map((layer) => layer.aboveOverlays)).toEqual([false]);
	});
});

describe("buildAdjustmentLayerPass", () => {
	const layer = {
		elementId: "adj",
		trackOrder: 0,
		startTime: 1,
		endTime: 2.5,
		color: grade() as never,
		opacity: 1,
		aboveOverlays: false,
	};

	it("grades a copy and overlays it only inside the layer's window", () => {
		const pass = buildAdjustmentLayerPass({
			inputPath: "/tmp/in.mp4",
			outputPath: "/tmp/out.mp4",
			layers: [
				layer,
				{ ...layer, elementId: "adj2", startTime: 4, endTime: 6, opacity: 0.4 },
			],
			codec: "libx264",
			bitrate: "8000k",
		});
		expect(pass).not.toBeNull();
		const steps = pass?.filterComplex.split(";") ?? [];
		expect(steps[0]).toBe("[0:v]split=2[adj_b0][adj_s0]");
		expect(steps[1]).toMatch(/^\[adj_s0\].*eq=.*\[adj_g0\]$/);
		expect(steps[2]).toBe(
			"[adj_b0][adj_g0]overlay=enable='between(t,1,2.5)'[adj_o0]"
		);
		expect(steps[3]).toBe("[adj_o0]split=2[adj_b1][adj_s1]");
		expect(steps[5]).toBe(
			"[adj_g1]format=rgba,colorchannelmixer=aa=0.4[adj_a1]"
		);
		expect(steps[6]).toBe(
			"[adj_b1][adj_a1]overlay=enable='between(t,4,6)'[adj_o1]"
		);
		expect(pass?.args).toEqual(
			expect.arrayContaining([
				"-map",
				"[adj_o1]",
				"-map",
				"0:a?",
				"-c:a",
				"copy",
			])
		);
		expect(pass?.args.at(-1)).toBe("/tmp/out.mp4");
	});

	it("is a no-op for layers whose grade is disabled", () => {
		const disabled = structuredClone(DEFAULT_VIDEO_COLOR_SETTINGS);
		disabled.enabled = false;
		expect(
			buildAdjustmentLayerPass({
				inputPath: "/tmp/in.mp4",
				outputPath: "/tmp/out.mp4",
				layers: [{ ...layer, color: disabled }],
				codec: "libx264",
				bitrate: "8000k",
			})
		).toBeNull();
	});
});

describe("timelineRequiresRendererAdjustmentLayerExport", () => {
	it("forces the renderer for masked or multi-pass layers only", () => {
		const base = { type: "adjustment", colorSettings: grade() };
		expect(
			timelineRequiresRendererAdjustmentLayerExport({
				timeline: { tracks: [{ elements: [base] }] },
			})
		).toBe(false);
		expect(
			timelineRequiresRendererAdjustmentLayerExport({
				timeline: {
					tracks: [
						{
							elements: [
								{ ...base, masks: [{ type: "ellipse", enabled: true }] },
							],
						},
					],
				},
			})
		).toBe(true);
		expect(
			timelineRequiresRendererAdjustmentLayerExport({
				timeline: {
					tracks: [
						{
							elements: [
								{
									...base,
									masks: [
										{ type: "none" },
										{ type: "rectangle", enabled: false },
									],
								},
							],
						},
					],
				},
			})
		).toBe(false);
		expect(
			timelineRequiresRendererAdjustmentLayerExport({
				timeline: {
					tracks: [
						{
							elements: [
								{
									...base,
									colorSettings: {
										...grade(),
										multiPass: { enabled: true, passes: [] },
									},
								},
							],
						},
					],
				},
			})
		).toBe(true);
		expect(
			timelineRequiresRendererAdjustmentLayerExport({
				timeline: {
					tracks: [
						{
							hidden: true,
							elements: [{ ...base, masks: [{ type: "ellipse" }] }],
						},
						{
							elements: [
								{ ...base, hidden: true, masks: [{ type: "ellipse" }] },
							],
						},
					],
				},
			})
		).toBe(false);
	});
});
