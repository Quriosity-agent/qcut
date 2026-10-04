import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import type {
	MediaColorSettings,
	MediaMask,
	MediaPortraitAdjustments,
} from "@/types/timeline";
import {
	drawColorGradedSourceStack,
	type BrowserColorGradeLayer,
} from "@/lib/color/browser-color-rendering";
import { subscribeColorDegradation } from "@/lib/color/color-degradation";
import {
	colorPreviewCanvasSize,
	portraitPreviewCanvasSize,
} from "@/lib/color/color-preview-resolution";
import { portraitPreviewSourceKey } from "@/lib/portrait/portrait-preview-source-key";
import { createPortraitSourcePreRollReader } from "@/lib/portrait/portrait-source-preroll";
import {
	portraitProcessingSize,
	portraitSourceDimensions,
} from "@/lib/portrait/portrait-processing-size";
import { cn } from "@/lib/utils";
import { useColorPickerStore } from "@/stores/editor/color-picker-store";
import { useColorPreviewStore } from "@/stores/editor/color-preview-store";
import { isIndependentFilterProvider } from "@qcut/editor-core";

type ColorPreviewSource =
	| HTMLVideoElement
	| HTMLImageElement
	| HTMLCanvasElement;

/** Dispatched by canvas sources (the stabilized frame canvas) after each draw. */
export const COLOR_PREVIEW_SOURCE_FRAME_EVENT = "qcut-frame";

/** Source time of the frame a canvas source currently shows. */
function sourceTimestampSeconds(source: ColorPreviewSource): number {
	if (source instanceof HTMLVideoElement) return source.currentTime;
	if (source instanceof HTMLCanvasElement) {
		return Number(source.dataset.sourceTime ?? 0) || 0;
	}
	return 0;
}

function drawObjectFit({
	context,
	source,
	width,
	height,
	fitMode,
}: {
	context: CanvasRenderingContext2D;
	source: ColorPreviewSource;
	width: number;
	height: number;
	fitMode: "cover" | "contain" | "fill";
}) {
	const dimensions = portraitSourceDimensions({ source });
	if (dimensions.width <= 0 || dimensions.height <= 0) return false;
	if (fitMode === "fill") {
		context.drawImage(source, 0, 0, width, height);
		return true;
	}
	const scale =
		fitMode === "cover"
			? Math.max(width / dimensions.width, height / dimensions.height)
			: Math.min(width / dimensions.width, height / dimensions.height);
	const drawWidth = dimensions.width * scale;
	const drawHeight = dimensions.height * scale;
	context.drawImage(
		source,
		(width - drawWidth) / 2,
		(height - drawHeight) / 2,
		drawWidth,
		drawHeight
	);
	return true;
}

export function ColorPreviewCanvas({
	sourceSelector,
	settings,
	masks,
	fitMode,
	frameSeed,
	filter,
	additionalLayers = [],
	portraitAdjustments,
	portraitRenderSize,
}: {
	sourceSelector: string;
	settings: MediaColorSettings;
	masks: MediaMask[];
	fitMode: "cover" | "contain" | "fill";
	frameSeed: number;
	filter?: string;
	additionalLayers?: BrowserColorGradeLayer[];
	portraitAdjustments?: MediaPortraitAdjustments;
	portraitRenderSize?: { width: number; height: number };
}) {
	const portraitWidth = portraitRenderSize?.width;
	const portraitHeight = portraitRenderSize?.height;
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const renderTailRef = useRef<Promise<void>>(Promise.resolve());
	const colorPickerActive = useColorPickerStore((state) => state.active);
	const completeColorPick = useColorPickerStore((state) => state.complete);
	const previewBypassed = useColorPreviewStore((state) => state.bypassed);
	const renderedLayers = useMemo<BrowserColorGradeLayer[]>(
		() =>
			previewBypassed
				? [{ settings: { ...settings, enabled: false }, masks }]
				: [{ settings, masks }, ...additionalLayers],
		[additionalLayers, masks, previewBypassed, settings]
	);
	const samplePreviewColor = useCallback(
		({ clientX, clientY }: { clientX: number; clientY: number }) => {
			const canvas = canvasRef.current;
			if (!canvas) return false;
			const bounds = canvas.getBoundingClientRect();
			if (
				clientX < bounds.left ||
				clientX > bounds.right ||
				clientY < bounds.top ||
				clientY > bounds.bottom
			) {
				return false;
			}
			const x = Math.min(
				canvas.width - 1,
				Math.max(
					0,
					Math.floor(
						((clientX - bounds.left) / Math.max(1, bounds.width)) * canvas.width
					)
				)
			);
			const y = Math.min(
				canvas.height - 1,
				Math.max(
					0,
					Math.floor(
						((clientY - bounds.top) / Math.max(1, bounds.height)) *
							canvas.height
					)
				)
			);
			const context = canvas.getContext("2d", { willReadFrequently: true });
			const pixel = context?.getImageData(x, y, 1, 1).data;
			if (!pixel || pixel[3] === 0) return false;
			completeColorPick({
				r: pixel[0] / 255,
				g: pixel[1] / 255,
				b: pixel[2] / 255,
			});
			return true;
		},
		[completeColorPick]
	);
	useEffect(() => {
		if (!colorPickerActive) return;
		const previousCursor = document.body.style.cursor;
		document.body.style.cursor = "crosshair";
		const capturePick = (event: PointerEvent) => {
			if (event.defaultPrevented) return;
			if (
				!samplePreviewColor({ clientX: event.clientX, clientY: event.clientY })
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
		};
		document.addEventListener("pointerdown", capturePick, true);
		return () => {
			document.body.style.cursor = previousCursor;
			document.removeEventListener("pointerdown", capturePick, true);
		};
	}, [colorPickerActive, samplePreviewColor]);
	useEffect(() => {
		return subscribeColorDegradation(({ detail, reason }) => {
			if (reason === "qcut-independent-filter-unavailable") {
				toast.error("QCut Metal 渲染失败，预览未更新", {
					description: detail,
					id: reason,
				});
				return;
			}
			const localPortraitFallback =
				reason === "jianying-local-portrait-fallback";
			const localEffectFallback = reason === "jianying-local-effect-fallback";
			const portraitAdjustmentFallback =
				reason === "jianying-portrait-adjustment-fallback";
			toast.warning(
				portraitAdjustmentFallback
					? "本机剪映美颜美体运行时不可用，已显示原始画面"
					: localPortraitFallback
						? "本机剪映人像运行时不可用，已使用近似肤色蒙版"
						: localEffectFallback
							? "本机剪映滤镜运行时不可用，已使用结构近似效果"
							: "调色预览已降级为近似效果（画面源受跨域限制）",
				{
					description: detail,
					id: portraitAdjustmentFallback
						? "jianying-portrait-adjustment-fallback"
						: localPortraitFallback
							? "jianying-local-portrait-fallback"
							: localEffectFallback
								? "jianying-local-effect-fallback"
								: "color-degradation-css-fallback",
				}
			);
		});
	}, []);
	useEffect(() => {
		const canvas = canvasRef.current;
		const parent = canvas?.parentElement;
		if (!canvas || !parent) return;
		const source = parent.querySelector<ColorPreviewSource>(sourceSelector);
		if (!source) return;
		const elementId = parent.closest<HTMLElement>("[data-preview-element-id]")
			?.dataset.previewElementId;
		const getSourceKey = () =>
			portraitPreviewSourceKey({
				elementId,
				mediaId: source.dataset.colorSourceKey,
				sourceSessionId: parent.closest<HTMLElement>(
					"[data-portrait-source-session]"
				)?.dataset.portraitSourceSession,
				sourceLocation:
					source instanceof HTMLCanvasElement
						? sourceSelector
						: source.currentSrc || source.src || sourceSelector,
				sourceSelector,
			});
		let cancelled = false;
		const abortController = new AbortController();
		let animationFrame = 0;
		let lastVideoTime = -1;
		let drawing = false;
		let queuedDraw = false;
		const resize = () => {
			// Native face detection must not change when the preview panel is resized.
			const portraitSize = portraitAdjustments?.enabled
				? portraitPreviewCanvasSize({
						width: portraitWidth ?? 0,
						height: portraitHeight ?? 0,
					})
				: null;
			const size = portraitSize?.width
				? portraitSize
				: colorPreviewCanvasSize({
						width: parent.clientWidth,
						height: parent.clientHeight,
					});
			const width = Math.max(1, size.width);
			const height = Math.max(1, size.height);
			if (canvas.width !== width) canvas.width = width;
			if (canvas.height !== height) canvas.height = height;
		};
		const draw = async () => {
			if (cancelled || canvas.width <= 0 || canvas.height <= 0) return;
			if (drawing) {
				queuedDraw = true;
				return;
			}
			if (source instanceof HTMLVideoElement && source.readyState < 2) return;
			if (source instanceof HTMLImageElement && !source.complete) return;
			drawing = true;
			// Effect cleanup cancels commits, but cannot cancel an IPC frame already running.
			const operation = renderTailRef.current.then(async () => {
				try {
					if (cancelled) return;
					const sourceKey = getSourceKey();
					if (source instanceof HTMLVideoElement)
						lastVideoTime = source.currentTime;
					const timestampSeconds = sourceTimestampSeconds(source);
					const readPortraitSourcePreRoll =
						source instanceof HTMLVideoElement
							? createPortraitSourcePreRollReader({
									source: source.currentSrc || source.src,
									fit: fitMode,
								})
							: undefined;
					const dimensions = portraitSourceDimensions({ source });
					const processing = portraitProcessingSize({
						width: canvas.width,
						height: canvas.height,
						sourceWidth: dimensions.width,
						sourceHeight: dimensions.height,
						adjustments: portraitAdjustments,
					});
					const fitted = document.createElement("canvas");
					fitted.width = processing.width;
					fitted.height = processing.height;
					const rendered = document.createElement("canvas");
					rendered.width = canvas.width;
					rendered.height = canvas.height;
					// Portrait fitting consumes these pixels; avoid GPU readback-dependent resizing.
					const fittedContext = fitted.getContext("2d", {
						willReadFrequently: Boolean(portraitAdjustments?.enabled),
					});
					const renderedContext = rendered.getContext("2d", {
						willReadFrequently: true,
					});
					const outputContext = canvas.getContext("2d", {
						willReadFrequently: true,
					});
					if (!fittedContext || !renderedContext || !outputContext) return;
					if (
						!drawObjectFit({
							context: fittedContext,
							source,
							width: fitted.width,
							height: fitted.height,
							fitMode,
						})
					)
						return;
					await drawColorGradedSourceStack({
						context: renderedContext,
						source: fitted,
						x: 0,
						y: 0,
						width: canvas.width,
						height: canvas.height,
						layers: renderedLayers,
						frameSeed,
						sourceKey,
						timestampSeconds,
						portraitAdjustments,
						readPortraitSourcePreRoll,
						signal: abortController.signal,
					});
					if (cancelled) return;
					if (
						rendered.width !== canvas.width ||
						rendered.height !== canvas.height
					) {
						return;
					}
					outputContext.clearRect(0, 0, canvas.width, canvas.height);
					outputContext.drawImage(rendered, 0, 0);
					canvas.dataset.renderedFrameCount = String(
						Number(canvas.dataset.renderedFrameCount ?? 0) + 1
					);
					canvas.dataset.renderedColorResources = renderedLayers
						.flatMap(({ settings }) => {
							const effect = settings.multiPass;
							return effect?.enabled && effect.nativeEffect
								? [`${effect.nativeEffect.resourceId}:${effect.intensity}`]
								: [];
						})
						.join(",");
				} catch (error) {
					if (abortController.signal.aborted) return;
					const independent = renderedLayers.some(
						({ settings }) =>
							settings.multiPass?.enabled &&
							isIndependentFilterProvider(
								settings.multiPass.nativeEffect?.provider
							)
					);
					// The color layer reports the failure; retain the last good preview.
					if (!independent) throw error;
				} finally {
					drawing = false;
					if (queuedDraw && !cancelled) {
						queuedDraw = false;
						void draw();
					}
				}
			});
			renderTailRef.current = operation.catch(() => {});
			await operation;
		};
		const loop = () => {
			if (cancelled) return;
			if (
				source instanceof HTMLVideoElement &&
				!source.paused &&
				Math.abs(source.currentTime - lastVideoTime) > 0.001
			) {
				void draw();
			}
			animationFrame = requestAnimationFrame(loop);
		};
		resize();
		void draw();
		const observer = new ResizeObserver(() => {
			resize();
			void draw();
		});
		observer.observe(parent);
		const redraw = () => void draw();
		source.addEventListener("loadeddata", redraw);
		source.addEventListener("load", redraw);
		source.addEventListener("seeked", redraw);
		source.addEventListener(COLOR_PREVIEW_SOURCE_FRAME_EVENT, redraw);
		animationFrame = requestAnimationFrame(loop);
		return () => {
			cancelled = true;
			abortController.abort();
			observer.disconnect();
			source.removeEventListener("loadeddata", redraw);
			source.removeEventListener("load", redraw);
			source.removeEventListener("seeked", redraw);
			source.removeEventListener(COLOR_PREVIEW_SOURCE_FRAME_EVENT, redraw);
			cancelAnimationFrame(animationFrame);
		};
	}, [
		fitMode,
		frameSeed,
		portraitAdjustments,
		portraitWidth,
		portraitHeight,
		renderedLayers,
		sourceSelector,
	]);
	return (
		<canvas
			ref={canvasRef}
			className={cn(
				"absolute inset-0 size-full",
				colorPickerActive
					? "pointer-events-auto z-20 cursor-crosshair"
					: "pointer-events-none"
			)}
			style={{ filter }}
			data-testid="color-preview-canvas"
			onPointerDown={(event) => {
				if (!colorPickerActive) return;
				if (
					!samplePreviewColor({
						clientX: event.clientX,
						clientY: event.clientY,
					})
				) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
			}}
		/>
	);
}
