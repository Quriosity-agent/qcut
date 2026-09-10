import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { ClipTransitionPreviewState } from "@/lib/transitions/clip-transition-preview";
import type { ClipTransition, TimelineTrack } from "@/types/timeline";
import {
	beginShaderTransitionLayer,
	destroyShaderTransitionLayers,
	isShaderTransitionState,
	timelineHasShaderTransition,
} from "../export-shader-transitions";

const SHADER: ClipTransition = {
	id: "t-1",
	fromElementId: "a",
	toElementId: "b",
	presetId: "gl-fade",
	type: "shader",
	duration: 0.8,
	easing: "linear",
};

function state({
	role,
	transition = SHADER,
}: {
	role: "from" | "to";
	transition?: ClipTransition;
}): ClipTransitionPreviewState {
	return {
		transition,
		role,
		progress: 0.5,
		cutTime: 1,
		windowStart: 0.6,
		windowEnd: 1.4,
		playbackWindow: { startTime: 0.6, endTime: 1.4 },
		isAudible: true,
	};
}

function track({
	transitions,
}: {
	transitions?: ClipTransition[];
}): TimelineTrack {
	return {
		id: "track-1",
		name: "Media",
		type: "media",
		locked: false,
		muted: false,
		elements: [],
		...(transitions ? { transitions } : {}),
	};
}

describe("shader transition export policy", () => {
	it("routes only shader-typed transitions to the canvas muxer", () => {
		expect(timelineHasShaderTransition({ tracks: [track({})] })).toBe(false);
		expect(
			timelineHasShaderTransition({
				tracks: [track({ transitions: [{ ...SHADER, type: "dissolve" }] })],
			})
		).toBe(false);
		expect(
			timelineHasShaderTransition({
				tracks: [track({ transitions: [SHADER] })],
			})
		).toBe(true);
		expect(isShaderTransitionState({ transitionState: undefined })).toBe(false);
		expect(
			isShaderTransitionState({ transitionState: state({ role: "to" }) })
		).toBe(true);
	});
});

// jsdom ships no canvas backend: hand it a 2D context stub so the offscreen
// frames can be allocated, and keep WebGL unavailable so the fail-closed path
// below is exercised for real.
const getContext = vi
	.spyOn(HTMLCanvasElement.prototype, "getContext")
	.mockImplementation(function (this: HTMLCanvasElement, contextId: string) {
		if (contextId !== "2d") return null;
		return {
			canvas: this,
			globalAlpha: 1,
			filter: "none",
			setTransform: () => undefined,
			clearRect: () => undefined,
			drawImage: () => undefined,
			save: () => undefined,
			restore: () => undefined,
		} as unknown as CanvasRenderingContext2D;
	} as never);
afterAll(() => getContext.mockRestore());

describe("shader transition export layer", () => {
	const ctx = document.createElement("canvas").getContext("2d");
	if (!ctx) throw new Error("2D context stub failed");
	afterEach(() => destroyShaderTransitionLayers());

	it("parks the from clip in an offscreen frame that keeps its own opacity", () => {
		const layer = beginShaderTransitionLayer({
			ctx,
			width: 64,
			height: 36,
			transitionState: state({ role: "from" }),
		});
		expect(layer.ctx).not.toBe(ctx);
		expect(layer.ctx.canvas.width).toBe(64);
		expect(layer.ctx.canvas.height).toBe(36);
		expect(layer.active).toBe(false);
		expect(() => layer.finish()).not.toThrow();
	});

	// Both clips are forced active inside the window and drawn in track order;
	// a to clip without its parked from clip is a real ordering bug, not a
	// case to paper over with a blank frame.
	it("refuses to composite a to clip before its from clip was drawn", () => {
		const layer = beginShaderTransitionLayer({
			ctx,
			width: 64,
			height: 36,
			transitionState: state({ role: "to" }),
		});
		expect(() => layer.finish()).toThrow(/before its "from" clip/);
	});

	it("refuses an unknown recipe instead of cutting", () => {
		beginShaderTransitionLayer({
			ctx,
			width: 64,
			height: 36,
			transitionState: state({
				role: "from",
				transition: { ...SHADER, presetId: "gl-does-not-exist" },
			}),
		});
		const layer = beginShaderTransitionLayer({
			ctx,
			width: 64,
			height: 36,
			transitionState: state({
				role: "to",
				transition: { ...SHADER, presetId: "gl-does-not-exist" },
			}),
		});
		expect(() => layer.finish()).toThrow(/no Transition Lab recipe/);
	});

	// jsdom has no WebGL: the layer must fail the export rather than degrade.
	it("fails closed when WebGL is unavailable", () => {
		beginShaderTransitionLayer({
			ctx,
			width: 64,
			height: 36,
			transitionState: state({ role: "from" }),
		});
		const layer = beginShaderTransitionLayer({
			ctx,
			width: 64,
			height: 36,
			transitionState: state({ role: "to" }),
		});
		expect(() => layer.finish()).toThrow(/need WebGL/);
	});
});
