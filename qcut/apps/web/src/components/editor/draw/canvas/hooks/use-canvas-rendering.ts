import { useEffect, type RefObject } from "react";
import type { CanvasObject, ImageObject } from "../../hooks/use-canvas-objects";

/**
 * Hook for canvas rendering effects: drawing objects on the main canvas
 * and images on the background canvas.
 */
export function useCanvasRendering({
	canvasRef,
	backgroundCanvasRef,
	objects,
	renderObjects,
}: {
	canvasRef: RefObject<HTMLCanvasElement | null>;
	backgroundCanvasRef: RefObject<HTMLCanvasElement | null>;
	objects: CanvasObject[];
	renderObjects: (
		ctx: CanvasRenderingContext2D,
		objectsToRender?: CanvasObject[]
	) => void;
}) {
	// Re-render canvas when objects change
	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!ctx || !canvas) {
			if (import.meta.env.DEV)
				console.error("❌ Canvas or context not available");
			return;
		}

		if (import.meta.env.DEV) {
			console.log("🎨 CANVAS LAYER DEBUG - Drawing canvas render:", {
				canvasElement: "Drawing Canvas (z-index: 2)",
				clearingWithTransparent: true,
				willShowBackgroundCanvas: true,
				backgroundCanvasHasImages:
					objects.filter((obj) => obj.type === "image").length > 0,
			});
		}

		// Clear and set white background for drawing canvas
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Set white background ONLY if there are no images
		const hasImages = objects.some((obj) => obj.type === "image");
		if (!hasImages) {
			ctx.fillStyle = "white";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		}

		// Render non-image objects to DRAWING canvas (strokes, shapes, text)
		const nonImageObjects = objects.filter((obj) => obj.type !== "image");

		if (nonImageObjects.length > 0) {
			if (import.meta.env.DEV) {
				const imageCount = objects.filter((obj) => obj.type === "image").length;
				console.log("🎨 DRAWING CANVAS - Rendering non-image objects:", {
					canvasElement: "Drawing Canvas (z-index: 2)",
					totalObjects: objects.length,
					renderingToDrawingCanvas: nonImageObjects.length,
					imagesSkipped: imageCount,
					renderingTypes: [...new Set(nonImageObjects.map((obj) => obj.type))],
					imagesHandledSeparately: "Background Canvas (z-index: 1)",
				});
			}

			renderObjects(ctx, nonImageObjects);

			if (import.meta.env.DEV) {
				console.log("✅ DRAWING CANVAS - Render completed:", {
					objectsRendered: nonImageObjects.length,
					timestamp: Date.now(),
				});
			}
		} else {
			if (import.meta.env.DEV) {
				console.log("🎨 DRAWING CANVAS - No non-image objects to render");
			}
		}
	}, [objects, renderObjects]);

	// Render images to BACKGROUND canvas (z-index: 1)
	useEffect(() => {
		const bgCanvas = backgroundCanvasRef.current;
		const bgCtx = bgCanvas?.getContext("2d");
		if (!bgCtx || !bgCanvas) {
			return;
		}

		// Clear background canvas
		bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

		// Set white background for background canvas
		bgCtx.fillStyle = "white";
		bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

		// Get only image objects
		const imageObjects = objects.filter((obj) => obj.type === "image");

		if (imageObjects.length > 0) {
			if (import.meta.env.DEV) {
				console.log("🖼️ BACKGROUND CANVAS - Rendering images:", {
					canvasElement: "Background Canvas (z-index: 1)",
					imageCount: imageObjects.length,
					images: imageObjects.map((img) => ({
						id: img.id,
						bounds: {
							x: img.x,
							y: img.y,
							width: img.width,
							height: img.height,
						},
					})),
				});
			}

			// Render each image to background canvas
			for (const obj of imageObjects) {
				bgCtx.save();
				bgCtx.globalAlpha = obj.opacity || 1;

				const image = obj as ImageObject;

				// Check if image is loaded
				if (!image.element.complete) {
					if (import.meta.env.DEV) {
						console.warn(
							"🖼️ BACKGROUND CANVAS - Image not fully loaded, skipping:",
							image.id
						);
					}
					bgCtx.restore();
					continue;
				}

				const centerX = obj.x + obj.width / 2;
				const centerY = obj.y + obj.height / 2;

				bgCtx.translate(centerX, centerY);
				bgCtx.rotate((image.rotation * Math.PI) / 180);
				bgCtx.translate(-centerX, -centerY);

				try {
					bgCtx.drawImage(image.element, obj.x, obj.y, obj.width, obj.height);
					if (import.meta.env.DEV) {
						console.log(
							"✅ BACKGROUND CANVAS - Image rendered successfully:",
							image.id
						);
					}
				} catch (error) {
					console.error("❌ BACKGROUND CANVAS - Failed to render image:", {
						id: image.id,
						error,
					});
				}

				bgCtx.restore();
			}
		}
	}, [objects]);
}
