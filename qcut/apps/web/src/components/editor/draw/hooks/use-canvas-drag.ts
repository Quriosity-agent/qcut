/**
 * Canvas Drag Hook
 * Handles drag start/update/end for selected canvas objects.
 * Extracted from use-canvas-objects.ts to keep files under 800 lines.
 */

import { useState, useCallback, useRef } from "react";
import type { AnyCanvasObject } from "./canvas-object-types";

type SetObjectsFn = (
	updater: AnyCanvasObject[] | ((prev: AnyCanvasObject[]) => AnyCanvasObject[])
) => void;

export const useCanvasDrag = (
	selectedObjectIds: string[],
	setObjects: SetObjectsFn
) => {
	const [isDragging, setIsDragging] = useState(false);
	const dragState = useRef<{
		startX: number;
		startY: number;
		lastX: number;
		lastY: number;
		hasMoved: boolean;
	}>({ startX: 0, startY: 0, lastX: 0, lastY: 0, hasMoved: false });

	// Start dragging objects
	const startDrag = useCallback(
		(startX: number, startY: number) => {
			if (selectedObjectIds.length === 0) return false;

			dragState.current = {
				startX,
				startY,
				lastX: startX,
				lastY: startY,
				hasMoved: false,
			};
			setIsDragging(true);

			if (import.meta.env.DEV) {
				console.log("🖱️ Drag started:", {
					startX,
					startY,
					selectedCount: selectedObjectIds.length,
				});
			}

			return true;
		},
		[selectedObjectIds]
	);

	// Update drag position
	const updateDrag = useCallback(
		(currentX: number, currentY: number) => {
			if (import.meta.env.DEV) {
				console.log("🔄 updateDrag called:", {
					currentX,
					currentY,
					isDragging,
					selectedCount: selectedObjectIds.length,
					lastX: dragState.current.lastX,
					lastY: dragState.current.lastY,
				});
			}

			// Only check if we have selected objects - don't rely on isDragging state
			// since it might be out of sync between hooks
			if (selectedObjectIds.length === 0) {
				if (import.meta.env.DEV) {
					console.log("❌ updateDrag early return - no selected objects:", {
						selectedCount: selectedObjectIds.length,
					});
				}
				return;
			}

			// Ensure we have a valid start position
			if (dragState.current.lastX === 0 && dragState.current.lastY === 0) {
				// Initialize drag state if not set
				dragState.current.lastX = currentX;
				dragState.current.lastY = currentY;
				if (import.meta.env.DEV) {
					console.log("🔧 Initializing drag state:", {
						currentX,
						currentY,
					});
				}
				return;
			}

			const deltaX = currentX - dragState.current.lastX;
			const deltaY = currentY - dragState.current.lastY;

			// Only move if there's actual movement
			if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
				if (import.meta.env.DEV) {
					console.log("🚀 Applying movement:", {
						deltaX,
						deltaY,
						selectedIds: selectedObjectIds,
					});
				}

				setObjects((prev) =>
					prev.map((obj) => {
						if (selectedObjectIds.includes(obj.id)) {
							const newObj = {
								...obj,
								x: obj.x + deltaX,
								y: obj.y + deltaY,
							};
							if (import.meta.env.DEV) {
								console.log(`📦 Moving object ${obj.id}:`, {
									from: { x: obj.x, y: obj.y },
									to: { x: newObj.x, y: newObj.y },
								});
							}
							return newObj;
						}
						return obj;
					})
				);

				dragState.current.lastX = currentX;
				dragState.current.lastY = currentY;
				dragState.current.hasMoved = true;
			} else {
				if (import.meta.env.DEV) {
					console.log("⏸️ Movement too small:", { deltaX, deltaY });
				}
			}
		},
		[isDragging, selectedObjectIds, setObjects]
	);

	// End dragging
	const endDrag = useCallback(() => {
		if (isDragging) {
			setIsDragging(false);
			if (import.meta.env.DEV) {
				console.log("🏁 Drag ended:", {
					hasMoved: dragState.current.hasMoved,
				});
			}
			dragState.current = {
				startX: 0,
				startY: 0,
				lastX: 0,
				lastY: 0,
				hasMoved: false,
			};
		}
	}, [isDragging]);

	const resetDragState = useCallback(() => {
		setIsDragging(false);
		dragState.current = {
			startX: 0,
			startY: 0,
			lastX: 0,
			lastY: 0,
			hasMoved: false,
		};
	}, []);

	return {
		isDragging,
		setIsDragging,
		startDrag,
		updateDrag,
		endDrag,
		resetDragState,
	};
};
