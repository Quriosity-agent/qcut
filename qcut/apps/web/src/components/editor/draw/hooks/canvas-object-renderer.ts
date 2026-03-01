/**
 * Canvas Object Renderer
 * Pure function to render canvas objects to a 2D context.
 * Extracted from use-canvas-objects.ts to keep files under 800 lines.
 */

import type {
	AnyCanvasObject,
	StrokeObject,
	ShapeObject,
	TextObject,
	ImageObject,
} from "./canvas-object-types";

/** Render an array of canvas objects to a 2D rendering context. */
export function renderCanvasObjects(
	ctx: CanvasRenderingContext2D,
	objects: AnyCanvasObject[]
): void {
	// Sort by z-index
	const sortedObjects = [...objects].sort((a, b) => a.zIndex - b.zIndex);

	for (const obj of sortedObjects) {
		ctx.save();

		// Apply object opacity
		ctx.globalAlpha = obj.opacity || 1;

		switch (obj.type) {
			case "stroke": {
				const stroke = obj as StrokeObject;
				ctx.strokeStyle = stroke.strokeStyle;
				ctx.lineWidth = stroke.lineWidth;
				ctx.lineCap = stroke.lineCap as CanvasLineCap;
				ctx.lineJoin = stroke.lineJoin as CanvasLineJoin;
				ctx.globalCompositeOperation =
					stroke.globalCompositeOperation as GlobalCompositeOperation;

				if (stroke.points.length > 1) {
					ctx.beginPath();
					const firstPoint = stroke.points[0];
					const startX = obj.x + firstPoint.x;
					const startY = obj.y + firstPoint.y;
					ctx.moveTo(startX, startY);

					for (let i = 1; i < stroke.points.length; i++) {
						const point = stroke.points[i];
						const lineX = obj.x + point.x;
						const lineY = obj.y + point.y;
						ctx.lineTo(lineX, lineY);
					}
					ctx.stroke();
				}
				break;
			}

			case "shape": {
				const shape = obj as ShapeObject;
				ctx.strokeStyle = shape.strokeStyle;
				ctx.lineWidth = shape.lineWidth;
				if (shape.fillStyle) {
					ctx.fillStyle = shape.fillStyle;
				}

				ctx.beginPath();
				switch (shape.shapeType) {
					case "rectangle":
						ctx.rect(obj.x, obj.y, obj.width, obj.height);
						break;
					case "circle": {
						const centerX = obj.x + obj.width / 2;
						const centerY = obj.y + obj.height / 2;
						const radius = Math.min(obj.width, obj.height) / 2;
						ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
						break;
					}
					case "line":
						ctx.moveTo(obj.x, obj.y);
						ctx.lineTo(obj.x + obj.width, obj.y + obj.height);
						break;
				}

				if (shape.fillStyle) {
					ctx.fill();
				}
				ctx.stroke();
				break;
			}

			case "text": {
				const text = obj as TextObject;
				if (import.meta.env.DEV) {
					console.log("📝 TEXT DEBUG - Rendering text object:", {
						id: text.id,
						text: text.text,
						position: { x: obj.x, y: obj.y },
						font: text.font,
						fillStyle: text.fillStyle,
					});
				}
				ctx.fillStyle = text.fillStyle;
				ctx.font = text.font;
				ctx.fillText(text.text, obj.x, obj.y);
				break;
			}

			case "image": {
				const image = obj as ImageObject;

				// Check if image is loaded
				if (!image.element.complete) {
					console.warn(
						"🖼️ IMAGE DEBUG - Image not fully loaded, skipping render:",
						image.id
					);
					break;
				}

				const centerX = obj.x + obj.width / 2;
				const centerY = obj.y + obj.height / 2;

				ctx.translate(centerX, centerY);
				ctx.rotate((image.rotation * Math.PI) / 180);
				ctx.translate(-centerX, -centerY);

				try {
					ctx.drawImage(image.element, obj.x, obj.y, obj.width, obj.height);
				} catch (error) {
					console.error("❌ IMAGE DEBUG - Failed to render image:", {
						id: image.id,
						error,
						imageElement: image.element,
					});
				}
				break;
			}
		}

		// Draw selection indicator
		if (obj.selected) {
			ctx.strokeStyle = "#ff6b35";
			ctx.lineWidth = 3;
			ctx.setLineDash([]);
			ctx.globalCompositeOperation = "source-over";
			ctx.globalAlpha = 1;
			ctx.strokeRect(obj.x - 2, obj.y - 2, obj.width + 4, obj.height + 4);

			// Draw group indicator if part of a group
			if (obj.groupId) {
				ctx.strokeStyle = "#00ff88";
				ctx.lineWidth = 2;
				ctx.setLineDash([8, 4]);
				ctx.strokeRect(obj.x - 4, obj.y - 4, obj.width + 8, obj.height + 8);
			}
		}

		ctx.restore();
	}
}
