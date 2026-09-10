import { easeClipTransitionProgress } from "@qcut/editor-core";
import { getTransitionLabRecipe } from "../../../../../electron/native-pipeline/transitions/transition-lab-catalog";
import type { ClipTransitionPreviewState } from "@/lib/transitions/clip-transition-preview";
import {
	createShaderTransitionCompositor,
	type ShaderTransitionCompositor,
} from "@/lib/transitions/shader-transition-compositor";
import type { TimelineTrack } from "@/types/timeline";
import type { ClipTransitionLayer } from "./export-clip-transitions";

/**
 * Canvas export path for GLSL (`type: "shader"`) clip transitions.
 *
 * The per-clip presentation model cannot express a shader that reads both
 * clips at once, so inside a shader transition window each clip is drawn into
 * its own offscreen frame instead of the export canvas. The `from` clip only
 * parks its frame; the `to` clip — always drawn after it on the same track —
 * runs the recipe over both frames and draws the composite. Nothing here falls
 * back to a cut: a missing recipe or WebGL context fails the export loudly.
 */

interface OffscreenFrame {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
}

let fromFrame: OffscreenFrame | null = null;
let toFrame: OffscreenFrame | null = null;
let compositor: ShaderTransitionCompositor | null = null;
/** Transition id whose `from` frame is parked for the current export frame. */
let parkedTransitionId: string | null = null;

function frameFor({
	slot,
	width,
	height,
}: {
	slot: "from" | "to";
	width: number;
	height: number;
}): OffscreenFrame {
	let frame = slot === "from" ? fromFrame : toFrame;
	if (
		!frame ||
		frame.canvas.width !== width ||
		frame.canvas.height !== height
	) {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Unable to allocate a shader transition frame");
		frame = { canvas, ctx };
		if (slot === "from") fromFrame = frame;
		else toFrame = frame;
	}
	frame.ctx.setTransform(1, 0, 0, 1, 0, 0);
	frame.ctx.globalAlpha = 1;
	frame.ctx.filter = "none";
	frame.ctx.clearRect(0, 0, width, height);
	return frame;
}

function requireCompositor(): ShaderTransitionCompositor {
	compositor ??= createShaderTransitionCompositor();
	if (!compositor) {
		throw new Error(
			"Shader transitions need WebGL to export; this renderer has no WebGL context."
		);
	}
	return compositor;
}

/** Shader transitions only exist on the canvas engines; the CLI cannot run GLSL. */
export function timelineHasShaderTransition({
	tracks,
}: {
	tracks: readonly TimelineTrack[];
}): boolean {
	return tracks.some((track) =>
		(track.transitions ?? []).some((transition) => transition.type === "shader")
	);
}

export function isShaderTransitionState({
	transitionState,
}: {
	transitionState: ClipTransitionPreviewState | undefined;
}): boolean {
	return transitionState?.transition.type === "shader";
}

/**
 * Routes one clip of a shader transition. The returned layer's `ctx` is an
 * offscreen frame the caller draws the clip into exactly as it would draw onto
 * the export canvas; `active` stays false so the clip keeps its own opacity.
 */
export function beginShaderTransitionLayer({
	ctx,
	width,
	height,
	transitionState,
}: {
	ctx: CanvasRenderingContext2D;
	width: number;
	height: number;
	transitionState: ClipTransitionPreviewState;
}): ClipTransitionLayer {
	const { transition, role } = transitionState;
	if (role === "from") {
		const frame = frameFor({ slot: "from", width, height });
		parkedTransitionId = transition.id;
		return { ctx: frame.ctx, active: false, finish: () => undefined };
	}
	const frame = frameFor({ slot: "to", width, height });
	return {
		ctx: frame.ctx,
		active: false,
		finish: () => {
			const recipe = getTransitionLabRecipe({ presetId: transition.presetId });
			if (!recipe) {
				throw new Error(
					`Shader transition "${transition.presetId}" has no Transition Lab recipe`
				);
			}
			// The from clip is forced active inside the window, so a missing parked
			// frame means the caller drew the pair out of order — surface it rather
			// than blend against a blank frame.
			if (parkedTransitionId !== transition.id || !fromFrame) {
				throw new Error(
					`Shader transition "${transition.presetId}" reached its "to" clip before its "from" clip`
				);
			}
			const result = requireCompositor().render({
				programKey: recipe.id,
				fragmentSource: recipe.shader.fragmentSource,
				from: fromFrame.canvas,
				to: frame.canvas,
				progress: easeClipTransitionProgress({
					progress: transitionState.progress,
					easing: transition.easing,
				}),
				intensity: transition.tuning?.intensity ?? 1,
				width,
				height,
			});
			parkedTransitionId = null;
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalAlpha = 1;
			ctx.filter = "none";
			ctx.drawImage(result, 0, 0, width, height);
			ctx.restore();
		},
	};
}

/** Releases the pooled frames and the WebGL context after an export. */
export function destroyShaderTransitionLayers(): void {
	fromFrame = null;
	toFrame = null;
	parkedTransitionId = null;
	compositor?.dispose();
	compositor = null;
}
