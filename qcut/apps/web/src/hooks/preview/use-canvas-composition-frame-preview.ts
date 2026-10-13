import { useEffect, useMemo, useRef, useState } from "react";
import {
	renderCanvasCompositionFrame,
	type CanvasCompositionPreviewPlan,
	type CanvasCompositionFrame,
} from "@/lib/preview/canvas-composition-frame";
import { revokeObjectUrlAfterCommit } from "./preview-frame-url";

interface CanvasCompositionPreviewRequest {
	plan: CanvasCompositionPreviewPlan;
	frame: number;
	backgroundColor?: string;
}

export interface CanvasCompositionPreviewState {
	status: "idle" | "rendering" | "ready" | "error";
	url?: string;
	error?: string;
	frame?: number;
	timeSeconds?: number;
	width?: number;
	height?: number;
}

export function useCanvasCompositionFramePreview({
	enabled,
	plan,
	currentTime,
	totalDuration,
	backgroundColor,
}: {
	enabled: boolean;
	plan: CanvasCompositionPreviewPlan | null;
	currentTime: number;
	totalDuration: number;
	backgroundColor?: string;
}): CanvasCompositionPreviewState {
	const frame =
		plan &&
		Number.isFinite(currentTime) &&
		Number.isFinite(totalDuration) &&
		totalDuration > 0
			? Math.max(
					0,
					Math.min(
						Math.round(currentTime * plan.fps),
						Math.ceil(totalDuration * plan.fps) - 1
					)
				)
			: null;
	const request = useMemo<CanvasCompositionPreviewRequest | null>(
		() =>
			enabled && plan && frame !== null
				? { plan, frame, backgroundColor }
				: null,
		[enabled, plan, frame, backgroundColor]
	);
	const tail = useRef<Promise<void>>(Promise.resolve());
	const [result, setResult] = useState<{
		request: CanvasCompositionPreviewRequest;
		state: CanvasCompositionPreviewState;
	} | null>(null);
	useEffect(() => {
		if (!request) return;
		const controller = new AbortController();
		let url: string | undefined;
		const timer = window.setTimeout(() => {
			// An aborted renderer must finish disposal before the newest request begins.
			tail.current = tail.current
				.catch(() => {})
				.then(async () => {
					if (controller.signal.aborted) return;
					try {
						const capture: CanvasCompositionFrame =
							await renderCanvasCompositionFrame({
								...request,
								signal: controller.signal,
							});
						if (controller.signal.aborted) return;
						url = URL.createObjectURL(capture.blob);
						setResult({
							request,
							state: {
								status: "ready",
								url,
								frame: capture.frame,
								timeSeconds: capture.timeSeconds,
								width: capture.width,
								height: capture.height,
							},
						});
					} catch (error) {
						if (controller.signal.aborted) return;
						setResult({
							request,
							state: {
								status: "error",
								error: error instanceof Error ? error.message : String(error),
								frame: request.frame,
							},
						});
					}
				});
		}, 120);
		return () => {
			window.clearTimeout(timer);
			controller.abort();
			revokeObjectUrlAfterCommit({ url });
		};
	}, [request]);
	if (!request) return { status: "idle" };
	return result?.request === request
		? result.state
		: { status: "rendering", frame: request.frame };
}
