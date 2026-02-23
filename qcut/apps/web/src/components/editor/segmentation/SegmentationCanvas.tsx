"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import {
	useSegmentationStore,
	OBJECT_COLORS,
} from "@/stores/ai/segmentation-store";
import type { Sam3PointPrompt, Sam3BoxPrompt } from "@/types/sam3";
import { useBlobImage } from "@/hooks/use-blob-image";

const loadImage = (src: string) =>
	new Promise<HTMLImageElement>((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = src;
	});

/**
 * SegmentationCanvas
 *
 * Interactive canvas for displaying image and handling click/drag interactions.
 * Renders client-side mask overlays and prompts.
 */
export function SegmentationCanvas() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isDrawingBox, setIsDrawingBox] = useState(false);
	const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(
		null
	);
	const [currentBox, setCurrentBox] = useState<Sam3BoxPrompt | null>(null);
	const [maskBlobs, setMaskBlobs] = useState<Record<string, string>>({});

	const {
		sourceImageUrl,
		promptMode,
		currentPointPrompts,
		currentBoxPrompts,
		addPointPrompt,
		addBoxPrompt,
		objects,
		compositeImageUrl,
		maskOpacity,
		showBoundingBoxes,
		setImageDimensions,
		imageWidth,
		imageHeight,
		updateObject,
	} = useSegmentationStore();

	// Convert FAL URLs to blob URLs to bypass COEP restrictions (composite fallback)
	const { blobUrl: compositeBlobUrl } = useBlobImage(
		compositeImageUrl ?? undefined
	);

	// Fetch and cache mask blobs for COEP-safe drawing
	useEffect(() => {
		const missing = objects.filter(
			(obj) => obj.maskUrl && !maskBlobs[obj.maskUrl]
		);
		if (missing.length === 0) return;

		let cancelled = false;

		const fetchMasks = async () => {
			const newEntries: Record<string, string> = {};
			for (const obj of missing) {
				const url = obj.maskUrl!;
				try {
					const resp = await fetch(url);
					const blob = await resp.blob();
					if (cancelled) return;
					newEntries[url] = URL.createObjectURL(blob);
				} catch (error) {
					console.error("Failed to fetch mask blob", error);
				}
			}
			if (cancelled || Object.keys(newEntries).length === 0) return;
			setMaskBlobs((prev) => ({ ...prev, ...newEntries }));
			// Push blob URLs into store so other consumers can reuse
			missing.forEach((obj) => {
				const blobUrl = newEntries[obj.maskUrl ?? ""];
				if (blobUrl) {
					updateObject(obj.id, { maskBlobUrl: blobUrl });
				}
			});
		};

		fetchMasks();

		return () => {
			cancelled = true;
		};
	}, [objects, maskBlobs, updateObject]);

	// Cleanup blob URLs when objects are removed
	useEffect(() => {
		const maskUrls = new Set(
			objects.map((o) => o.maskUrl).filter(Boolean) as string[]
		);

		const toRemove = Object.entries(maskBlobs).filter(
			([url]) => !maskUrls.has(url)
		);

		if (toRemove.length === 0) return;

		const next = { ...maskBlobs };
		toRemove.forEach(([url, blobUrl]) => {
			URL.revokeObjectURL(blobUrl);
			delete next[url];
		});
		setMaskBlobs(next);
	}, [objects, maskBlobs]);

	// Load and display image with client-side mask compositing
	useEffect(() => {
		const canvas = canvasRef.current;
		const container = containerRef.current;
		if (!canvas || !container || !sourceImageUrl) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let cancelled = false;

		// Helper functions moved inside useEffect to avoid dependency issues
		const drawPointPrompts = (
			drawCtx: CanvasRenderingContext2D,
			points: Sam3PointPrompt[],
			scale: number
		) => {
			for (const point of points) {
				const x = point.x * scale;
				const y = point.y * scale;
				const color = point.label === 1 ? "#00FF00" : "#FF0000";

				drawCtx.beginPath();
				drawCtx.arc(x, y, 8, 0, Math.PI * 2);
				drawCtx.fillStyle = color;
				drawCtx.fill();
				drawCtx.strokeStyle = "#FFFFFF";
				drawCtx.lineWidth = 2;
				drawCtx.stroke();

				// Draw + or - symbol
				drawCtx.fillStyle = "#FFFFFF";
				drawCtx.font = "bold 12px sans-serif";
				drawCtx.textAlign = "center";
				drawCtx.textBaseline = "middle";
				drawCtx.fillText(point.label === 1 ? "+" : "-", x, y);
			}
		};

		const drawBoxPrompts = (
			drawCtx: CanvasRenderingContext2D,
			boxes: Sam3BoxPrompt[],
			scale: number
		) => {
			for (const box of boxes) {
				const x = box.x_min * scale;
				const y = box.y_min * scale;
				const width = (box.x_max - box.x_min) * scale;
				const height = (box.y_max - box.y_min) * scale;

				drawCtx.strokeStyle = "#00CED1";
				drawCtx.lineWidth = 2;
				drawCtx.setLineDash([5, 5]);
				drawCtx.strokeRect(x, y, width, height);
				drawCtx.setLineDash([]);
			}
		};

		const drawBoundingBoxes = (
			drawCtx: CanvasRenderingContext2D,
			objs: typeof objects,
			width: number,
			height: number
		) => {
			for (const obj of objs) {
				if (!obj.boundingBox) continue;

				const [cx, cy, w, h] = obj.boundingBox;
				const color = OBJECT_COLORS[obj.colorIndex];

				const x = (cx - w / 2) * width;
				const y = (cy - h / 2) * height;
				const boxWidth = w * width;
				const boxHeight = h * height;

				drawCtx.strokeStyle = color.hex;
				drawCtx.lineWidth = 2;
				drawCtx.strokeRect(x, y, boxWidth, boxHeight);
			}
		};

		const draw = async () => {
			try {
				const baseImg = await loadImage(sourceImageUrl);
				if (cancelled) return;

				// Calculate fit dimensions
				const containerRect = container.getBoundingClientRect();
				const scale = Math.min(
					containerRect.width / baseImg.width,
					containerRect.height / baseImg.height
				);

				const displayWidth = baseImg.width * scale;
				const displayHeight = baseImg.height * scale;

				canvas.width = displayWidth;
				canvas.height = displayHeight;

				setImageDimensions(baseImg.width, baseImg.height);

				ctx.clearRect(0, 0, displayWidth, displayHeight);
				ctx.drawImage(baseImg, 0, 0, displayWidth, displayHeight);

				const visibleObjects = objects.filter(
					(obj) => obj.visible !== false && (obj.maskBlobUrl || obj.maskUrl)
				);

				// If no visible objects but composite exists, fall back to composite preview
				if (visibleObjects.length === 0 && compositeBlobUrl) {
					const compositeImg = await loadImage(compositeBlobUrl);
					if (cancelled) return;
					if (maskOpacity >= 1.0) {
						ctx.drawImage(compositeImg, 0, 0, displayWidth, displayHeight);
					} else if (maskOpacity <= 0.0) {
						// already drew base image
					} else {
						ctx.drawImage(compositeImg, 0, 0, displayWidth, displayHeight);
						ctx.globalAlpha = 1 - maskOpacity;
						ctx.drawImage(baseImg, 0, 0, displayWidth, displayHeight);
						ctx.globalAlpha = 1.0;
					}
				} else {
					// Draw tinted masks for each visible object
					for (const obj of visibleObjects) {
						const maskSource =
							(obj.maskUrl && maskBlobs[obj.maskUrl]) ||
							obj.maskBlobUrl ||
							obj.maskUrl;
						if (!maskSource) continue;

						try {
							const maskImg = await loadImage(maskSource);
							if (cancelled) return;
							const tinted = tintMask(
								maskImg,
								OBJECT_COLORS[obj.colorIndex].hex
							);
							ctx.save();
							ctx.globalAlpha = maskOpacity;
							ctx.drawImage(tinted, 0, 0, displayWidth, displayHeight);
							ctx.restore();
						} catch (error) {
							console.error("Failed to draw mask", error);
						}
					}
				}

				// Draw prompts and boxes on top
				drawPointPrompts(ctx, currentPointPrompts, scale);
				drawBoxPrompts(ctx, currentBoxPrompts, scale);

				if (showBoundingBoxes) {
					drawBoundingBoxes(ctx, objects, displayWidth, displayHeight);
				}
			} catch (error) {
				console.error("Failed to render segmentation canvas", error);
			}
		};

		draw();

		return () => {
			cancelled = true;
		};
	}, [
		sourceImageUrl,
		compositeBlobUrl,
		currentPointPrompts,
		currentBoxPrompts,
		objects,
		maskOpacity,
		showBoundingBoxes,
		setImageDimensions,
		maskBlobs,
	]);

	const getCanvasCoordinates = useCallback(
		(e: React.MouseEvent<HTMLCanvasElement>) => {
			const canvas = canvasRef.current;
			if (!canvas || !imageWidth || !imageHeight) return null;

			const rect = canvas.getBoundingClientRect();
			const scaleX = imageWidth / canvas.width;
			const scaleY = imageHeight / canvas.height;

			const x = (e.clientX - rect.left) * scaleX;
			const y = (e.clientY - rect.top) * scaleY;

			return { x: Math.round(x), y: Math.round(y) };
		},
		[imageWidth, imageHeight]
	);

	const handleCanvasClick = useCallback(
		(e: React.MouseEvent<HTMLCanvasElement>) => {
			if (promptMode !== "point") return;

			const coords = getCanvasCoordinates(e);
			if (!coords) return;

			// Left click = foreground (1), Right click = background (0)
			const label = e.button === 2 ? 0 : 1;

			addPointPrompt({
				x: coords.x,
				y: coords.y,
				label: label as 0 | 1,
			});
		},
		[promptMode, getCanvasCoordinates, addPointPrompt]
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent<HTMLCanvasElement>) => {
			if (promptMode === "point") {
				handleCanvasClick(e);
				return;
			}

			if (promptMode !== "box") return;

			const coords = getCanvasCoordinates(e);
			if (!coords) return;

			setIsDrawingBox(true);
			setBoxStart(coords);
		},
		[promptMode, getCanvasCoordinates, handleCanvasClick]
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent<HTMLCanvasElement>) => {
			if (!isDrawingBox || !boxStart) return;

			const coords = getCanvasCoordinates(e);
			if (!coords) return;

			setCurrentBox({
				x_min: Math.min(boxStart.x, coords.x),
				y_min: Math.min(boxStart.y, coords.y),
				x_max: Math.max(boxStart.x, coords.x),
				y_max: Math.max(boxStart.y, coords.y),
			});
		},
		[isDrawingBox, boxStart, getCanvasCoordinates]
	);

	const handleMouseUp = useCallback(() => {
		if (!isDrawingBox || !currentBox) return;

		// Only add box if it has some size
		const width = currentBox.x_max - currentBox.x_min;
		const height = currentBox.y_max - currentBox.y_min;

		if (width > 10 && height > 10) {
			addBoxPrompt(currentBox);
		}

		setIsDrawingBox(false);
		setBoxStart(null);
		setCurrentBox(null);
	}, [isDrawingBox, currentBox, addBoxPrompt]);

	const handleContextMenu = useCallback(
		(e: React.MouseEvent<HTMLCanvasElement>) => {
			e.preventDefault();
			if (promptMode === "point") {
				handleCanvasClick(e);
			}
		},
		[promptMode, handleCanvasClick]
	);

	return (
		<div
			ref={containerRef}
			className="w-full h-full flex items-center justify-center bg-muted/30 rounded-lg overflow-hidden"
		>
			<canvas
				ref={canvasRef}
				className="max-w-full max-h-full cursor-crosshair"
				onMouseDown={handleMouseDown}
				onMouseMove={handleMouseMove}
				onMouseUp={handleMouseUp}
				onMouseLeave={handleMouseUp}
				onContextMenu={handleContextMenu}
			/>
		</div>
	);
}

const tintMask = (maskImg: HTMLImageElement, color: string) => {
	const offscreen = document.createElement("canvas");
	offscreen.width = maskImg.width;
	offscreen.height = maskImg.height;
	const ctx = offscreen.getContext("2d");
	if (!ctx) return offscreen;
	ctx.drawImage(maskImg, 0, 0);
	ctx.globalCompositeOperation = "source-in";
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, offscreen.width, offscreen.height);
	ctx.globalCompositeOperation = "source-over";
	return offscreen;
};
