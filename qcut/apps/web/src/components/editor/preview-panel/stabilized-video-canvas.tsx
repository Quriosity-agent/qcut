import { useEffect, useRef } from "react";
import {
	type StabilizationPlan,
	drawStabilizedFrame,
	IDENTITY_STABILIZED_FRAME,
	lookupStabilizedFrame,
} from "@/lib/stabilization/stabilization-plan";
import { COLOR_PREVIEW_SOURCE_FRAME_EVENT } from "./color-preview-canvas";

/**
 * Draws the clip's `<video>` (or the paused native enhancement frame) through
 * the stabilization plan into a canvas that replaces the raw media in the
 * preview. Downstream canvases (colour, filters) read from this canvas via
 * `data-stabilized-source-id`, and it announces every new frame with the
 * shared frame event so they redraw.
 *
 * The canvas has the source's pixel size: the corrective transform lives in
 * source pixels and the element's object-fit is applied by the CSS on this
 * element exactly like the raw `<video>` it stands in for.
 */
export function StabilizedVideoCanvas({
	sourceId,
	sourceSelector,
	timeSourceSelector,
	sourceTimeOffset,
	plan,
	fitMode,
	filter,
	hidden,
}: {
	sourceId: string;
	sourceSelector: string;
	/** The `<video>` whose currentTime indexes the plan. */
	timeSourceSelector: string;
	/** Added to the video's currentTime when it plays a proxy chunk. */
	sourceTimeOffset: number;
	plan: StabilizationPlan;
	fitMode: "cover" | "contain" | "fill";
	filter?: string;
	/** Keeps drawing (colour canvases still read it) but shows nothing. */
	hidden: boolean;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const parent = canvas?.parentElement;
		if (!canvas || !parent) return;
		const source = parent.querySelector<HTMLVideoElement | HTMLImageElement>(
			sourceSelector
		);
		const timeSource =
			parent.querySelector<HTMLVideoElement>(timeSourceSelector);
		if (!source || !timeSource) return;
		const width = plan.sourceWidth;
		const height = plan.sourceHeight;
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) return;
		let cancelled = false;
		let animationFrame = 0;
		let lastDrawnTime = Number.NaN;
		const draw = () => {
			if (cancelled) return;
			if (source instanceof HTMLVideoElement && source.readyState < 2) return;
			if (source instanceof HTMLImageElement && !source.complete) return;
			const sourceTime = timeSource.currentTime + sourceTimeOffset;
			const frame =
				lookupStabilizedFrame({ plan, sourceTimeSeconds: sourceTime }) ??
				IDENTITY_STABILIZED_FRAME;
			drawStabilizedFrame({
				context,
				source,
				frame,
				cropScale: plan.cropScale,
				width,
				height,
			});
			lastDrawnTime = sourceTime;
			canvas.dataset.sourceTime = String(sourceTime);
			canvas.dispatchEvent(new Event(COLOR_PREVIEW_SOURCE_FRAME_EVENT));
		};
		const loop = () => {
			if (cancelled) return;
			const sourceTime = timeSource.currentTime + sourceTimeOffset;
			if (!timeSource.paused && Math.abs(sourceTime - lastDrawnTime) > 0.0005) {
				draw();
			}
			animationFrame = requestAnimationFrame(loop);
		};
		draw();
		source.addEventListener("loadeddata", draw);
		timeSource.addEventListener("seeked", draw);
		timeSource.addEventListener("loadeddata", draw);
		animationFrame = requestAnimationFrame(loop);
		return () => {
			cancelled = true;
			source.removeEventListener("loadeddata", draw);
			timeSource.removeEventListener("seeked", draw);
			timeSource.removeEventListener("loadeddata", draw);
			cancelAnimationFrame(animationFrame);
		};
	}, [plan, sourceSelector, sourceTimeOffset, timeSourceSelector]);

	return (
		<canvas
			ref={canvasRef}
			className="pointer-events-none absolute inset-0 size-full"
			data-stabilized-source-id={sourceId}
			data-testid="stabilized-video-canvas"
			style={{
				objectFit: fitMode,
				filter: filter || undefined,
				opacity: hidden ? 0 : undefined,
			}}
		/>
	);
}
