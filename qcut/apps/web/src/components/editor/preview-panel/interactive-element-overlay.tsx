"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { TimelineElement } from "@/types/timeline";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { useEffectsStore } from "@/stores/ai/effects-store";
import { cn } from "@/lib/utils";
import { Move, RotateCw } from "lucide-react";

interface InteractiveElementOverlayProps {
	element: TimelineElement;
	previewScale: number;
	containerRef: React.RefObject<HTMLDivElement>;
	isActive: boolean;
	effectsEnabled?: boolean;
}

interface DragState {
	isDragging: boolean;
	startX: number;
	startY: number;
	initialX: number;
	initialY: number;
}

interface ResizeState {
	isResizing: boolean;
	handle: ResizeHandle;
	startX: number;
	startY: number;
	initialWidth: number;
	initialHeight: number;
	initialX: number;
	initialY: number;
}

interface RotateState {
	isRotating: boolean;
	startAngle: number;
	initialRotation: number;
}

type ResizeHandle =
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right"
	| "top"
	| "bottom"
	| "left"
	| "right";

export function InteractiveElementOverlay({
	element,
	previewScale,
	containerRef,
	isActive,
	effectsEnabled = false,
}: InteractiveElementOverlayProps) {
	// Note: We use updateElementTransform directly via getState() for batched updates
	// Individual update methods are still imported for direct user interactions
	const { updateElementPosition, updateElementRotation } = useTimelineStore();
	const overlayRef = useRef<HTMLDivElement>(null);
	const rafRef = useRef<number | null>(null);
	const pendingUpdateRef = useRef<{
		position?: { x: number; y: number };
		size?: { width: number; height: number; x: number; y: number };
		rotation?: number;
	} | null>(null);

	const [dragState, setDragState] = useState<DragState>({
		isDragging: false,
		startX: 0,
		startY: 0,
		initialX: element.x || 0,
		initialY: element.y || 0,
	});

	const [resizeState, setResizeState] = useState<ResizeState>({
		isResizing: false,
		handle: "bottom-right",
		startX: 0,
		startY: 0,
		initialWidth: element.width || 100,
		initialHeight: element.height || 100,
		initialX: element.x || 0,
		initialY: element.y || 0,
	});

	const [rotateState, setRotateState] = useState<RotateState>({
		isRotating: false,
		startAngle: 0,
		initialRotation: element.rotation || 0,
	});

	// Check if element has effects (reactive to store changes)
	const effectCount = useEffectsStore(
		(s) => (s.activeEffects.get(element.id) ?? []).length
	);
	const hasEffects = effectsEnabled && effectCount > 0;

	// Throttled update function using requestAnimationFrame
	// Uses batched updateElementTransform to avoid multiple history entries
	const flushPendingUpdates = useCallback(() => {
		if (!pendingUpdateRef.current) return;

		const updates = pendingUpdateRef.current;

		// Batch all updates into a single store write to avoid multiple history entries
		useTimelineStore.getState().updateElementTransform(
			element.id,
			{
				...(updates.position && { position: updates.position }),
				...(updates.size && { size: updates.size }),
				...(updates.rotation !== undefined && { rotation: updates.rotation }),
			},
			{ pushHistory: true }
		);

		pendingUpdateRef.current = null;
		rafRef.current = null;
	}, [element.id]);

	const scheduleUpdate = useCallback(
		(type: "position" | "size" | "rotation", data: any) => {
			if (!pendingUpdateRef.current) {
				pendingUpdateRef.current = {};
			}

			if (type === "position") {
				pendingUpdateRef.current.position = data;
			} else if (type === "size") {
				pendingUpdateRef.current.size = data;
			} else if (type === "rotation") {
				pendingUpdateRef.current.rotation = data;
			}

			if (!rafRef.current) {
				rafRef.current = requestAnimationFrame(flushPendingUpdates);
			}
		},
		[flushPendingUpdates]
	);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			// Cancel any pending RAF on unmount
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			// Flush any pending updates
			if (pendingUpdateRef.current) {
				flushPendingUpdates();
			}
		};
	}, [flushPendingUpdates]);

	// Handle drag start
	const handleDragStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			setDragState({
				isDragging: true,
				startX: e.clientX,
				startY: e.clientY,
				initialX: element.x || 0,
				initialY: element.y || 0,
			});
		},
		[element.x, element.y]
	);

	// Handle resize start
	const handleResizeStart = useCallback(
		(e: React.MouseEvent, handle: ResizeHandle) => {
			e.preventDefault();
			e.stopPropagation();

			setResizeState({
				isResizing: true,
				handle,
				startX: e.clientX,
				startY: e.clientY,
				initialWidth: element.width || 100,
				initialHeight: element.height || 100,
				initialX: element.x || 0,
				initialY: element.y || 0,
			});
		},
		[element]
	);

	// Handle rotation start
	const handleRotateStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			if (!containerRef.current || !overlayRef.current) return;

			const rect = overlayRef.current.getBoundingClientRect();
			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + rect.height / 2;

			const startAngle =
				Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);

			setRotateState({
				isRotating: true,
				startAngle,
				initialRotation: element.rotation || 0,
			});
		},
		[element.rotation, containerRef]
	);

	// Handle mouse move for drag, resize, and rotate
	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (dragState.isDragging) {
				const deltaX = (e.clientX - dragState.startX) / previewScale;
				const deltaY = (e.clientY - dragState.startY) / previewScale;

				scheduleUpdate("position", {
					x: dragState.initialX + deltaX,
					y: dragState.initialY + deltaY,
				});
			}

			if (resizeState.isResizing) {
				const deltaX = (e.clientX - resizeState.startX) / previewScale;
				const deltaY = (e.clientY - resizeState.startY) / previewScale;

				let newWidth = resizeState.initialWidth;
				let newHeight = resizeState.initialHeight;
				let newX = resizeState.initialX;
				let newY = resizeState.initialY;

				switch (resizeState.handle) {
					case "bottom-right":
						newWidth = Math.max(20, resizeState.initialWidth + deltaX);
						newHeight = Math.max(20, resizeState.initialHeight + deltaY);
						break;
					case "bottom-left":
						newWidth = Math.max(20, resizeState.initialWidth - deltaX);
						newHeight = Math.max(20, resizeState.initialHeight + deltaY);
						newX = resizeState.initialX + deltaX;
						break;
					case "top-right":
						newWidth = Math.max(20, resizeState.initialWidth + deltaX);
						newHeight = Math.max(20, resizeState.initialHeight - deltaY);
						newY = resizeState.initialY + deltaY;
						break;
					case "top-left":
						newWidth = Math.max(20, resizeState.initialWidth - deltaX);
						newHeight = Math.max(20, resizeState.initialHeight - deltaY);
						newX = resizeState.initialX + deltaX;
						newY = resizeState.initialY + deltaY;
						break;
					case "right":
						newWidth = Math.max(20, resizeState.initialWidth + deltaX);
						break;
					case "left":
						newWidth = Math.max(20, resizeState.initialWidth - deltaX);
						newX = resizeState.initialX + deltaX;
						break;
					case "bottom":
						newHeight = Math.max(20, resizeState.initialHeight + deltaY);
						break;
					case "top":
						newHeight = Math.max(20, resizeState.initialHeight - deltaY);
						newY = resizeState.initialY + deltaY;
						break;
				}

				scheduleUpdate("size", {
					width: newWidth,
					height: newHeight,
					x: newX,
					y: newY,
				});
			}

			if (rotateState.isRotating && overlayRef.current) {
				const rect = overlayRef.current.getBoundingClientRect();
				const centerX = rect.left + rect.width / 2;
				const centerY = rect.top + rect.height / 2;

				const currentAngle =
					Math.atan2(e.clientY - centerY, e.clientX - centerX) *
					(180 / Math.PI);

				const deltaAngle = currentAngle - rotateState.startAngle;
				const newRotation = rotateState.initialRotation + deltaAngle;

				scheduleUpdate("rotation", newRotation);
			}
		};

		const handleMouseUp = () => {
			// Flush any pending updates immediately on mouse up
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			flushPendingUpdates();

			setDragState((prev) => ({ ...prev, isDragging: false }));
			setResizeState((prev) => ({ ...prev, isResizing: false }));
			setRotateState((prev) => ({ ...prev, isRotating: false }));
		};

		// Helper function to get proper cursor based on resize handle
		const getResizeCursor = (handle: ResizeHandle): string => {
			switch (handle) {
				case "top-left":
				case "bottom-right":
					return "nwse-resize";
				case "top-right":
				case "bottom-left":
					return "nesw-resize";
				case "left":
				case "right":
					return "ew-resize";
				case "top":
				case "bottom":
					return "ns-resize";
				default:
					return "nwse-resize";
			}
		};

		if (
			dragState.isDragging ||
			resizeState.isResizing ||
			rotateState.isRotating
		) {
			document.addEventListener("mousemove", handleMouseMove);
			document.addEventListener("mouseup", handleMouseUp);

			// Set proper cursor and disable text selection during operations
			if (dragState.isDragging) {
				document.body.style.cursor = "move";
			} else if (resizeState.isResizing) {
				document.body.style.cursor = getResizeCursor(resizeState.handle);
			} else if (rotateState.isRotating) {
				document.body.style.cursor = "grabbing";
			}

			// Disable text selection during drag operations
			document.body.style.userSelect = "none";

			return () => {
				document.removeEventListener("mousemove", handleMouseMove);
				document.removeEventListener("mouseup", handleMouseUp);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";

				// Clean up any pending RAF
				if (rafRef.current) {
					cancelAnimationFrame(rafRef.current);
					rafRef.current = null;
				}
			};
		}
	}, [
		dragState,
		resizeState,
		rotateState,
		previewScale,
		scheduleUpdate,
		flushPendingUpdates,
	]);

	// Only show interactive overlay if element has effects or is selected
	if (!hasEffects && !isActive) {
		return null;
	}

	const elementStyle = {
		left: `${(element.x || 0) * previewScale}px`,
		top: `${(element.y || 0) * previewScale}px`,
		width: `${(element.width || 100) * previewScale}px`,
		height: `${(element.height || 100) * previewScale}px`,
		transform: `rotate(${element.rotation || 0}deg)`,
	};

	return (
		<div
			ref={overlayRef}
			className={cn(
				"absolute pointer-events-auto",
				"border-2 border-primary/50",
				hasEffects && "border-purple-500/50",
				isActive && "border-primary"
			)}
			style={elementStyle}
		>
			{/* Drag handle - center */}
			<button
				type="button"
				aria-label="Drag element. Use arrow keys to move"
				className="absolute inset-0 cursor-move focus:outline-none focus:ring-2 focus:ring-primary bg-transparent"
				onMouseDown={handleDragStart}
				onKeyDown={(e) => {
					// Only handle arrow keys, let other keys pass through for navigation
					const handled =
						e.key === "ArrowUp" ||
						e.key === "ArrowDown" ||
						e.key === "ArrowLeft" ||
						e.key === "ArrowRight";

					if (!handled) return;

					e.preventDefault();
					const step = 5 / previewScale;
					const largeStep = 20 / previewScale;
					const currentStep = e.shiftKey ? largeStep : step;

					if (e.key === "ArrowUp") {
						updateElementPosition(element.id, {
							x: element.x ?? 0,
							y: (element.y ?? 0) - currentStep,
						});
					} else if (e.key === "ArrowDown") {
						updateElementPosition(element.id, {
							x: element.x ?? 0,
							y: (element.y ?? 0) + currentStep,
						});
					} else if (e.key === "ArrowLeft") {
						updateElementPosition(element.id, {
							x: (element.x ?? 0) - currentStep,
							y: element.y ?? 0,
						});
					} else if (e.key === "ArrowRight") {
						updateElementPosition(element.id, {
							x: (element.x ?? 0) + currentStep,
							y: element.y ?? 0,
						});
					}
				}}
			>
				<span className="sr-only">Drag element</span>
				<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
					<Move className="w-6 h-6 text-primary" />
				</div>
			</button>

			{/* Resize handles */}
			<button
				type="button"
				aria-label="Resize from top-left corner"
				className="absolute -top-1 -left-1 w-3 h-3 bg-primary cursor-nw-resize focus:outline-none focus:ring-2 focus:ring-primary rounded-full"
				onMouseDown={(e) => handleResizeStart(e, "top-left")}
			/>
			<button
				type="button"
				aria-label="Resize from top-right corner"
				className="absolute -top-1 -right-1 w-3 h-3 bg-primary cursor-ne-resize focus:outline-none focus:ring-2 focus:ring-primary rounded-full"
				onMouseDown={(e) => handleResizeStart(e, "top-right")}
			/>
			<button
				type="button"
				aria-label="Resize from bottom-left corner"
				className="absolute -bottom-1 -left-1 w-3 h-3 bg-primary cursor-sw-resize focus:outline-none focus:ring-2 focus:ring-primary rounded-full"
				onMouseDown={(e) => handleResizeStart(e, "bottom-left")}
			/>
			<button
				type="button"
				aria-label="Resize from bottom-right corner"
				className="absolute -bottom-1 -right-1 w-3 h-3 bg-primary cursor-se-resize focus:outline-none focus:ring-2 focus:ring-primary rounded-full"
				onMouseDown={(e) => handleResizeStart(e, "bottom-right")}
			/>

			{/* Edge resize handles */}
			<button
				type="button"
				aria-label="Resize from left edge"
				className="absolute top-1/2 -left-1 w-3 h-6 -translate-y-1/2 bg-primary cursor-ew-resize focus:outline-none focus:ring-2 focus:ring-primary rounded"
				onMouseDown={(e) => handleResizeStart(e, "left")}
			/>
			<button
				type="button"
				aria-label="Resize from right edge"
				className="absolute top-1/2 -right-1 w-3 h-6 -translate-y-1/2 bg-primary cursor-ew-resize focus:outline-none focus:ring-2 focus:ring-primary rounded"
				onMouseDown={(e) => handleResizeStart(e, "right")}
			/>
			<button
				type="button"
				aria-label="Resize from top edge"
				className="absolute -top-1 left-1/2 w-6 h-3 -translate-x-1/2 bg-primary cursor-ns-resize focus:outline-none focus:ring-2 focus:ring-primary rounded"
				onMouseDown={(e) => handleResizeStart(e, "top")}
			/>
			<button
				type="button"
				aria-label="Resize from bottom edge"
				className="absolute -bottom-1 left-1/2 w-6 h-3 -translate-x-1/2 bg-primary cursor-ns-resize focus:outline-none focus:ring-2 focus:ring-primary rounded"
				onMouseDown={(e) => handleResizeStart(e, "bottom")}
			/>

			{/* Rotation handle */}
			<button
				type="button"
				aria-label="Rotate element. Use left/right arrow keys to rotate"
				className="absolute -top-8 left-1/2 -translate-x-1/2 w-6 h-6 bg-primary rounded-full cursor-grab hover:cursor-grabbing flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-primary"
				onMouseDown={handleRotateStart}
				onKeyDown={(e) => {
					if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
						e.preventDefault();
						const rotationStep = e.shiftKey ? 15 : 5;
						const direction = e.key === "ArrowLeft" ? -1 : 1;
						const currentRotation = element.rotation ?? 0;
						updateElementRotation(
							element.id,
							currentRotation + direction * rotationStep
						);
					}
				}}
			>
				<RotateCw className="w-4 h-4 text-primary-foreground" />
			</button>

			{/* Effect indicator */}
			{hasEffects && (
				<div className="absolute top-2 left-2 px-2 py-1 bg-purple-500/20 rounded text-xs text-purple-300">
					✨ Effects Applied
				</div>
			)}
		</div>
	);
}
