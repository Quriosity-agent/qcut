import { useState, useEffect, useCallback } from "react";
import type { TimelineTrack, TimelineElement } from "@/types/timeline";
import type { TextElementDragState } from "@/types/editor";

interface UsePreviewDragParams {
	tracks: TimelineTrack[];
	previewWidth: number;
	canvasWidth: number;
	canvasHeight: number;
	updateTextElement: (
		trackId: string,
		elementId: string,
		updates: { x: number; y: number }
	) => void;
	updateElementPosition: (
		elementId: string,
		position: { x: number; y: number }
	) => void;
}

/**
 * Manages drag interactions for text/media elements within the preview panel.
 * Handles mouse down, move, and up events with proper constraint logic.
 */
export function usePreviewDrag({
	tracks,
	previewWidth,
	canvasWidth,
	canvasHeight,
	updateTextElement,
	updateElementPosition,
}: UsePreviewDragParams) {
	const [dragState, setDragState] = useState<TextElementDragState>({
		isDragging: false,
		elementId: null,
		trackId: null,
		startX: 0,
		startY: 0,
		initialElementX: 0,
		initialElementY: 0,
		currentX: 0,
		currentY: 0,
		elementWidth: 0,
		elementHeight: 0,
	});

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (!dragState.isDragging) return;

			const deltaX = e.clientX - dragState.startX;
			const deltaY = e.clientY - dragState.startY;

			const scaleRatio = previewWidth / canvasWidth;
			const newX = dragState.initialElementX + deltaX / scaleRatio;
			const newY = dragState.initialElementY + deltaY / scaleRatio;

			const halfWidth = dragState.elementWidth / scaleRatio / 2;
			const halfHeight = dragState.elementHeight / scaleRatio / 2;

			const constrainedX = Math.max(
				-canvasWidth / 2 + halfWidth,
				Math.min(canvasWidth / 2 - halfWidth, newX)
			);
			const constrainedY = Math.max(
				-canvasHeight / 2 + halfHeight,
				Math.min(canvasHeight / 2 - halfHeight, newY)
			);

			setDragState((prev) => ({
				...prev,
				currentX: constrainedX,
				currentY: constrainedY,
			}));
		};

		const handleMouseUp = () => {
			if (dragState.isDragging && dragState.trackId && dragState.elementId) {
				// Find element type to use appropriate update method
				const track = tracks.find((t) => t.id === dragState.trackId);
				const el = track?.elements.find((e) => e.id === dragState.elementId);
				if (el?.type === "text") {
					updateTextElement(dragState.trackId, dragState.elementId, {
						x: dragState.currentX,
						y: dragState.currentY,
					});
				} else {
					updateElementPosition(dragState.elementId, {
						x: dragState.currentX,
						y: dragState.currentY,
					});
				}
			}
			setDragState((prev) => ({ ...prev, isDragging: false }));
		};

		if (dragState.isDragging) {
			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "grabbing";
			document.body.style.userSelect = "none";
		}

		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
	}, [
		dragState,
		previewWidth,
		canvasWidth,
		canvasHeight,
		updateTextElement,
		tracks,
		updateElementPosition,
	]);

	const handleTextMouseDown = useCallback(
		(
			e: React.MouseEvent<HTMLDivElement>,
			element: Pick<TimelineElement, "id" | "x" | "y">,
			trackId: string
		) => {
			e.preventDefault();
			e.stopPropagation();

			const rect = e.currentTarget.getBoundingClientRect();

			setDragState({
				isDragging: true,
				elementId: element.id,
				trackId,
				startX: e.clientX,
				startY: e.clientY,
				initialElementX: element.x ?? 0,
				initialElementY: element.y ?? 0,
				currentX: element.x ?? 0,
				currentY: element.y ?? 0,
				elementWidth: rect.width,
				elementHeight: rect.height,
			});
		},
		[]
	);

	return { dragState, handleTextMouseDown };
}
