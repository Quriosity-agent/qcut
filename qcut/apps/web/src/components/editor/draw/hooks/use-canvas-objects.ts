import { useState, useCallback, useRef } from "react";
import { generateUUID } from "@/lib/utils";
import type {
	AnyCanvasObject,
	StrokeObject,
	ShapeObject,
	TextObject,
	ImageObject,
	ObjectGroup,
} from "./canvas-object-types";
import { useCanvasDrag } from "./use-canvas-drag";
import { renderCanvasObjects } from "./canvas-object-renderer";

// Re-export all types so consumers don't need to change imports
export type {
	CanvasObject,
	StrokeObject,
	ShapeObject,
	TextObject,
	ImageObject,
	AnyCanvasObject,
	ObjectGroup,
} from "./canvas-object-types";

export const useCanvasObjects = () => {
	const [objects, setObjectsInternal] = useState<AnyCanvasObject[]>([]);

	// Wrapper to track all setObjects calls
	const setObjects = useCallback(
		(
			newObjects:
				| AnyCanvasObject[]
				| ((prev: AnyCanvasObject[]) => AnyCanvasObject[])
		) => {
			if (typeof newObjects === "function") {
				setObjectsInternal((prev) => {
					const result = newObjects(prev);
					return result;
				});
			} else {
				setObjectsInternal(newObjects);
			}
		},
		[]
	);
	const [groups, setGroups] = useState<ObjectGroup[]>([]);
	const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
	const [isDrawing, setIsDrawing] = useState(false);
	const zIndexCounter = useRef(1);

	// Drag sub-hook
	const {
		isDragging,
		setIsDragging,
		startDrag,
		updateDrag,
		endDrag,
		resetDragState,
	} = useCanvasDrag(selectedObjectIds, setObjects);

	// Add a new stroke object
	const addStroke = useCallback(
		(
			points: { x: number; y: number }[],
			style: {
				strokeStyle: string;
				lineWidth: number;
				opacity: number;
				tool: string;
				lineCap: string;
				lineJoin: string;
				globalCompositeOperation: string;
			}
		) => {
			if (import.meta.env.DEV) {
				console.log("🏗️ addStroke called:", {
					pointCount: points.length,
					tool: style.tool,
				});
			}

			if (points.length === 0) {
				console.error("❌ No points provided to addStroke");
				return null;
			}

			// Calculate bounding box
			const minX = Math.min(...points.map((p) => p.x));
			const maxX = Math.max(...points.map((p) => p.x));
			const minY = Math.min(...points.map((p) => p.y));
			const maxY = Math.max(...points.map((p) => p.y));

			const strokeObject: StrokeObject = {
				id: generateUUID(),
				type: "stroke",
				x: minX - style.lineWidth / 2,
				y: minY - style.lineWidth / 2,
				width: maxX - minX + style.lineWidth,
				height: maxY - minY + style.lineWidth,
				opacity: style.opacity,
				points: points.map((p) => ({
					x: p.x - minX,
					y: p.y - minY,
				})), // Relative to object origin
				strokeStyle: style.strokeStyle,
				lineWidth: style.lineWidth,
				tool: style.tool,
				lineCap: style.lineCap,
				lineJoin: style.lineJoin,
				globalCompositeOperation: style.globalCompositeOperation,
				selected: false,
				zIndex: zIndexCounter.current++,
				created: new Date(),
			};

			setObjects((prev) => [...prev, strokeObject]);

			if (import.meta.env.DEV) {
				console.log("✏️ Stroke object created:", {
					id: strokeObject.id,
					tool: style.tool,
				});
			}

			return strokeObject.id;
		},
		[setObjects]
	);

	// Add a new shape object
	// Note: 'square' should be normalized to 'rectangle' before calling this function
	const addShape = useCallback(
		(
			shapeType: "rectangle" | "circle" | "line", // Excludes 'square' - use 'rectangle' instead
			bounds: { x: number; y: number; width: number; height: number },
			style: {
				strokeStyle: string;
				fillStyle?: string;
				lineWidth: number;
				opacity: number;
			}
		) => {
			const shapeObject: ShapeObject = {
				id: generateUUID(),
				type: "shape",
				shapeType,
				x: bounds.x,
				y: bounds.y,
				width: bounds.width,
				height: bounds.height,
				opacity: style.opacity,
				strokeStyle: style.strokeStyle,
				fillStyle: style.fillStyle,
				lineWidth: style.lineWidth,
				selected: false,
				zIndex: zIndexCounter.current++,
				created: new Date(),
			};

			setObjects((prev) => [...prev, shapeObject]);

			if (import.meta.env.DEV) {
				console.log("🔲 Shape object created:", {
					id: shapeObject.id,
					type: shapeType,
				});
			}

			return shapeObject.id;
		},
		[setObjects]
	);

	// Add a new text object
	const addText = useCallback(
		(
			text: string,
			position: { x: number; y: number },
			style: {
				font: string;
				fillStyle: string;
				opacity: number;
			}
		) => {
			console.log("📝 TEXT DEBUG - addText called:", {
				text,
				position,
				style,
				currentObjectCount: objects.length,
				timestamp: Date.now(),
			});

			// Estimate text dimensions (rough calculation)
			const fontSize = parseInt(style.font, 10);
			const estimatedWidth = text.length * fontSize * 0.6;
			const estimatedHeight = fontSize * 1.2;

			console.log("📝 TEXT DEBUG - Calculated text dimensions:", {
				fontSize,
				estimatedWidth,
				estimatedHeight,
			});

			const textObject: TextObject = {
				id: generateUUID(),
				type: "text",
				text,
				x: position.x,
				y: position.y,
				width: estimatedWidth,
				height: estimatedHeight,
				opacity: style.opacity,
				font: style.font,
				fillStyle: style.fillStyle,
				selected: false,
				zIndex: zIndexCounter.current++,
				created: new Date(),
			};

			console.log("📝 TEXT DEBUG - Created text object:", {
				id: textObject.id,
				type: textObject.type,
				text: textObject.text,
				bounds: {
					x: textObject.x,
					y: textObject.y,
					width: textObject.width,
					height: textObject.height,
				},
				timestamp: Date.now(),
			});

			setObjects((prev) => {
				const newObjects = [...prev, textObject];
				console.log("📝 TEXT DEBUG - Updated objects array:", {
					previousCount: prev.length,
					newCount: newObjects.length,
					addedObject: { id: textObject.id, type: textObject.type },
					timestamp: Date.now(),
				});
				return newObjects;
			});

			console.log("✅ TEXT DEBUG - Text object creation completed:", {
				id: textObject.id,
				text,
				finalObjectCount: objects.length + 1,
			});

			return textObject.id;
		},
		[objects.length, setObjects]
	);

	// Add an image object (integrates with existing image system)
	const addImageObject = useCallback(
		(imageData: {
			id: string;
			element: HTMLImageElement;
			x: number;
			y: number;
			width: number;
			height: number;
			rotation: number;
		}) => {
			console.log("🖼️ IMAGE DEBUG - addImageObject called:", {
				imageId: imageData.id,
				dimensions: {
					x: imageData.x,
					y: imageData.y,
					width: imageData.width,
					height: imageData.height,
				},
				rotation: imageData.rotation,
				currentObjectCount: objects.length,
				timestamp: Date.now(),
			});

			const imageObject: ImageObject = {
				...imageData,
				type: "image",
				opacity: 1.0, // Default opacity for images
				selected: false,
				zIndex: zIndexCounter.current++,
				created: new Date(),
			};

			console.log("🖼️ IMAGE DEBUG - Created image object:", {
				id: imageObject.id,
				type: imageObject.type,
				bounds: {
					x: imageObject.x,
					y: imageObject.y,
					width: imageObject.width,
					height: imageObject.height,
				},
				zIndex: imageObject.zIndex,
				timestamp: Date.now(),
			});

			setObjects((prev) => {
				const newObjects = [...prev, imageObject];
				console.log("🖼️ IMAGE DEBUG - Updated objects array:", {
					previousCount: prev.length,
					newCount: newObjects.length,
					addedObject: {
						id: imageObject.id,
						type: imageObject.type,
					},
					timestamp: Date.now(),
				});
				return newObjects;
			});

			console.log("✅ IMAGE DEBUG - Image object creation completed:", {
				id: imageObject.id,
				finalObjectCount: objects.length + 1,
			});

			return imageObject.id;
		},
		[objects.length, setObjects]
	);

	// Select objects
	const selectObjects = useCallback(
		(ids: string[], addToSelection = false) => {
			if (addToSelection) {
				setSelectedObjectIds((prev) => {
					const newSelection = [...prev];
					for (const id of ids) {
						if (!newSelection.includes(id)) {
							newSelection.push(id);
						}
					}
					return newSelection;
				});
			} else {
				setSelectedObjectIds(ids);
			}

			setObjects((prev) =>
				prev.map((obj) => ({
					...obj,
					selected: addToSelection
						? obj.selected || ids.includes(obj.id)
						: ids.includes(obj.id),
				}))
			);
		},
		[setObjects]
	);

	// Get object at position (for selection)
	const getObjectAtPosition = useCallback(
		(x: number, y: number): AnyCanvasObject | null => {
			// Check from top to bottom (highest z-index first)
			const sortedObjects = [...objects].sort((a, b) => b.zIndex - a.zIndex);

			for (const obj of sortedObjects) {
				if (
					x >= obj.x &&
					x <= obj.x + obj.width &&
					y >= obj.y &&
					y <= obj.y + obj.height
				) {
					return obj;
				}
			}
			return null;
		},
		[objects]
	);

	// Create group from selected objects
	const createGroup = useCallback(
		(name?: string) => {
			if (selectedObjectIds.length < 2) return null;

			const groupId = generateUUID();
			const groupName = name || `Group ${groups.length + 1}`;

			const newGroup: ObjectGroup = {
				id: groupId,
				name: groupName,
				objectIds: [...selectedObjectIds],
				locked: false,
				visible: true,
			};

			setGroups((prev) => [...prev, newGroup]);
			setObjects((prev) =>
				prev.map((obj) =>
					selectedObjectIds.includes(obj.id) ? { ...obj, groupId } : obj
				)
			);

			if (import.meta.env.DEV) {
				console.log("🔗 Group created:", {
					groupId,
					name: groupName,
					objects: selectedObjectIds,
				});
			}

			return groupId;
		},
		[selectedObjectIds, groups.length, setObjects]
	);

	// Ungroup objects
	const ungroupObjects = useCallback(
		(groupId: string) => {
			setGroups((prev) => prev.filter((group) => group.id !== groupId));
			setObjects((prev) =>
				prev.map((obj) =>
					obj.groupId === groupId ? { ...obj, groupId: undefined } : obj
				)
			);

			if (import.meta.env.DEV) {
				console.log("🔓 Group dissolved:", { groupId });
			}
		},
		[setObjects]
	);

	// Clear all objects and groups
	const clearAll = useCallback(() => {
		if (import.meta.env.DEV) {
			console.log("🧹 clearAll called:", {
				currentObjectCount: objects.length,
				stackTrace: new Error("Debug stack trace for clearAll").stack
					?.split("\n")[2]
					?.trim(),
			});
		}
		setObjects([]);
		setGroups([]);
		setSelectedObjectIds([]);
		setIsDrawing(false);
		resetDragState();
	}, [objects.length, setObjects, resetDragState]);

	// Delete selected objects
	const deleteSelectedObjects = useCallback(() => {
		setObjects((prev) =>
			prev.filter((obj) => !selectedObjectIds.includes(obj.id))
		);
		setSelectedObjectIds([]);
	}, [selectedObjectIds, setObjects]);

	// Render objects to canvas (optionally filtered)
	const renderObjects = useCallback(
		(ctx: CanvasRenderingContext2D, objectsToRender?: AnyCanvasObject[]) => {
			renderCanvasObjects(ctx, objectsToRender || objects);
		},
		[objects]
	);

	return {
		objects,
		groups,
		selectedObjectIds,
		isDragging,
		isDrawing,
		addStroke,
		addShape,
		addText,
		addImageObject,
		selectObjects,
		getObjectAtPosition,
		createGroup,
		ungroupObjects,
		clearAll,
		startDrag,
		updateDrag,
		endDrag,
		deleteSelectedObjects,
		renderObjects,
		setIsDrawing,
		setIsDragging,
	};
};

export default useCanvasObjects;
