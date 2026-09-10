import { easeClipTransitionProgress } from "@qcut/editor-core";
import { useEffect, useMemo, useRef } from "react";
import { getTransitionLabRecipe } from "../../../../../../electron/native-pipeline/transitions/transition-lab-catalog";
import {
	calculateElementBounds,
	drawWithMediaTransform,
} from "@/lib/export/export-engine-utils";
import type { ClipTransitionPreviewState } from "@/lib/transitions/clip-transition-preview";
import {
	createShaderTransitionCompositor,
	type ShaderTransitionCompositor,
} from "@/lib/transitions/shader-transition-compositor";
import { resolveMediaKeyframes } from "@/lib/video/video-properties";
import type {
	ClipTransition,
	MediaElement,
	TimelineTrack,
} from "@/types/timeline";

/**
 * Timeline preview for GLSL (`type: "shader"`) clip transitions.
 *
 * The DOM preview positions each clip with CSS, so a shader that needs both
 * clips as textures cannot run inside either clip's layer. This overlay sits on
 * the stage above both clips, samples their live `<video>`/`<img>` (or graded
 * canvas) through the same fit/transform math the canvas export uses, runs the
 * recipe and paints the composite. It is a preview approximation — per-clip
 * masks and filters are not sampled — while the export path is exact.
 */

interface MediaSource {
	source: CanvasImageSource;
	width: number;
	height: number;
}

interface ShaderPair {
	transition: ClipTransition;
	progress: number;
}

function findShaderPair({
	statesByElementId,
}: {
	statesByElementId: ReadonlyMap<string, ClipTransitionPreviewState>;
}): ShaderPair | null {
	for (const state of statesByElementId.values()) {
		if (state.transition.type === "shader") {
			return { transition: state.transition, progress: state.progress };
		}
	}
	return null;
}

function findMediaElement({
	tracks,
	elementId,
}: {
	tracks: readonly TimelineTrack[];
	elementId: string;
}): MediaElement | null {
	for (const track of tracks) {
		for (const element of track.elements) {
			if (element.id === elementId) {
				return element.type === "media" ? element : null;
			}
		}
	}
	return null;
}

/** Prefers graded pixels, then a native preview still, then the raw video. */
function findMediaSource({
	root,
	elementId,
}: {
	root: ParentNode;
	elementId: string;
}): MediaSource | null {
	const host = root.querySelector(`[data-timeline-element-id="${elementId}"]`);
	if (!host) return null;
	const canvas = host.querySelector("canvas");
	if (canvas instanceof HTMLCanvasElement && canvas.width > 0) {
		return { source: canvas, width: canvas.width, height: canvas.height };
	}
	const image = host.querySelector("img");
	if (
		image instanceof HTMLImageElement &&
		image.complete &&
		image.naturalWidth > 0
	) {
		return {
			source: image,
			width: image.naturalWidth,
			height: image.naturalHeight,
		};
	}
	const video = host.querySelector("video");
	if (
		video instanceof HTMLVideoElement &&
		video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
		video.videoWidth > 0
	) {
		return {
			source: video,
			width: video.videoWidth,
			height: video.videoHeight,
		};
	}
	return null;
}

async function drawClipFrame({
	ctx,
	element,
	media,
	canvasSize,
	currentTime,
	fps,
}: {
	ctx: CanvasRenderingContext2D;
	element: MediaElement;
	media: MediaSource;
	canvasSize: { width: number; height: number };
	currentTime: number;
	fps: number;
}): Promise<void> {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 1;
	ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
	const bounds = calculateElementBounds(
		element,
		media.width,
		media.height,
		canvasSize.width,
		canvasSize.height
	);
	const visual = resolveMediaKeyframes({ element, currentTime, fps });
	ctx.globalAlpha = visual.opacity;
	await drawWithMediaTransform({
		ctx,
		visual,
		bounds,
		draw: () =>
			ctx.drawImage(
				media.source,
				bounds.x,
				bounds.y,
				bounds.width,
				bounds.height
			),
	});
}

function frameCanvas({ width, height }: { width: number; height: number }): {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
} {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Unable to allocate a shader transition frame");
	return { canvas, ctx };
}

export function ShaderTimelineTransitionOverlay({
	tracks,
	statesByElementId,
	canvasSize,
	fps,
	currentTime,
}: {
	tracks: readonly TimelineTrack[];
	statesByElementId: ReadonlyMap<string, ClipTransitionPreviewState>;
	canvasSize: { width: number; height: number };
	fps: number;
	currentTime: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const compositorRef = useRef<ShaderTransitionCompositor | null>(null);
	const failedRef = useRef<string | null>(null);
	const pair = useMemo(
		() => findShaderPair({ statesByElementId }),
		[statesByElementId]
	);
	// The loop reads the latest time/progress from refs so it is not torn down
	// and rebuilt on every playback frame.
	const frameRef = useRef({ currentTime, progress: pair?.progress ?? 0 });
	frameRef.current = { currentTime, progress: pair?.progress ?? 0 };

	const transitionId = pair?.transition.id;
	const presetId = pair?.transition.presetId;
	const fromElementId = pair?.transition.fromElementId;
	const toElementId = pair?.transition.toElementId;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (
			!canvas ||
			!transitionId ||
			!presetId ||
			!fromElementId ||
			!toElementId
		) {
			return;
		}
		const recipe = getTransitionLabRecipe({ presetId });
		const fromElement = findMediaElement({ tracks, elementId: fromElementId });
		const toElement = findMediaElement({ tracks, elementId: toElementId });
		const transition = pair?.transition;
		if (!recipe || !fromElement || !toElement || !transition) return;
		compositorRef.current ??= createShaderTransitionCompositor();
		const compositor = compositorRef.current;
		if (!compositor) {
			if (failedRef.current !== "webgl") {
				failedRef.current = "webgl";
				console.warn(
					"Shader transition preview needs WebGL; showing a cut instead."
				);
			}
			return;
		}
		const overlayCtx = canvas.getContext("2d");
		if (!overlayCtx) return;
		const fromFrame = frameCanvas(canvasSize);
		const toFrame = frameCanvas(canvasSize);
		let cancelled = false;
		let busy = false;
		let handle = 0;
		const tick = async () => {
			if (cancelled) return;
			if (!busy) {
				busy = true;
				try {
					const root = canvas.parentElement;
					const from = root
						? findMediaSource({ root, elementId: fromElementId })
						: null;
					const to = root
						? findMediaSource({ root, elementId: toElementId })
						: null;
					if (from && to) {
						const { currentTime: time, progress } = frameRef.current;
						await drawClipFrame({
							ctx: fromFrame.ctx,
							element: fromElement,
							media: from,
							canvasSize,
							currentTime: time,
							fps,
						});
						await drawClipFrame({
							ctx: toFrame.ctx,
							element: toElement,
							media: to,
							canvasSize,
							currentTime: time,
							fps,
						});
						const result = compositor.render({
							programKey: recipe.id,
							fragmentSource: recipe.shader.fragmentSource,
							from: fromFrame.canvas,
							to: toFrame.canvas,
							progress: easeClipTransitionProgress({
								progress,
								easing: transition.easing,
							}),
							intensity: transition.tuning?.intensity ?? 1,
							width: canvasSize.width,
							height: canvasSize.height,
						});
						overlayCtx.clearRect(0, 0, canvas.width, canvas.height);
						overlayCtx.drawImage(result, 0, 0, canvas.width, canvas.height);
					}
				} catch (error) {
					if (failedRef.current !== recipe.id) {
						failedRef.current = recipe.id;
						console.error("Shader transition preview failed", error);
					}
				} finally {
					busy = false;
				}
			}
			if (!cancelled) handle = requestAnimationFrame(tick);
		};
		handle = requestAnimationFrame(tick);
		return () => {
			cancelled = true;
			cancelAnimationFrame(handle);
			overlayCtx.clearRect(0, 0, canvas.width, canvas.height);
		};
	}, [
		canvasSize,
		fps,
		fromElementId,
		pair?.transition,
		presetId,
		toElementId,
		tracks,
		transitionId,
	]);

	useEffect(
		() => () => {
			compositorRef.current?.dispose();
			compositorRef.current = null;
		},
		[]
	);

	if (!pair) return null;
	return (
		<canvas
			ref={canvasRef}
			width={canvasSize.width}
			height={canvasSize.height}
			className="pointer-events-none absolute inset-0 z-[36] size-full object-fill"
			aria-label="Shader 转场预览"
			data-testid="shader-timeline-transition-preview"
			data-transition-id={pair.transition.id}
		/>
	);
}
