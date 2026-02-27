"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { TimelineElement } from "../timeline-element";
import type { TimelineTrackContentProps } from "./types";
import { useTimelineTrackHooks } from "./use-timeline-track-hooks";
import { createEventHandlers } from "./event-handlers";
import { createDropHandler } from "./drop-handler";
import { withErrorBoundary } from "@/components/error-boundary";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";

function TimelineTrackContentComponent({
	track,
	zoomLevel,
	onSnapPointChange,
}: TimelineTrackContentProps) {
	// Initialize all hooks
	const hooks = useTimelineTrackHooks(track, zoomLevel, onSnapPointChange);

	// Create event handlers
	const {
		handleElementMouseDown,
		handleElementClick,
		handleTrackDragOver,
		handleTrackDragEnter,
		handleTrackDragLeave,
	} = createEventHandlers(track, zoomLevel, hooks);

	// Create drop handler
	const handleTrackDrop = createDropHandler(track, zoomLevel, hooks);

	// Set up mouse event listeners for drag - moved before early return to fix hook order
	useEffect(() => {
		const {
			dragState,
			selectedElements,
			selectElement,
			timelineRef,
			updateElementStartTime,
			updateElementStartTimeWithRipple,
			moveElementToTrack,
			endDragAction,
			updateDragTime,
			onSnapPointChange,
			rippleEditingEnabled,
			snappingEnabled,
			snapElementEdge,
			currentTime,
			tracks,
		} = hooks;

		if (!dragState.isDragging) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (!timelineRef.current) return;

			// On first mouse move during drag, ensure the element is selected
			if (dragState.elementId && dragState.trackId) {
				const isSelected = selectedElements.some(
					(c: any) =>
						c.trackId === dragState.trackId &&
						c.elementId === dragState.elementId
				);

				if (!isSelected) {
					// Select this element (replacing other selections) since we're dragging it
					selectElement(dragState.trackId, dragState.elementId, false);
				}
			}

			const timelineRect = timelineRef.current.getBoundingClientRect();
			const mouseX = e.clientX - timelineRect.left;
			const mouseTime = Math.max(
				0,
				mouseX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
			);
			const adjustedTime = Math.max(0, mouseTime - dragState.clickOffsetTime);

			// Apply snapping if enabled
			let finalTime = adjustedTime;
			let snapPoint = null;
			if (snappingEnabled) {
				// Find the element being dragged to get its duration
				let elementDuration = 5; // fallback duration
				if (dragState.elementId && dragState.trackId) {
					const sourceTrack = tracks.find((t: any) => t.id === dragState.trackId);
					const element = sourceTrack?.elements.find(
						(e: any) => e.id === dragState.elementId
					);
					if (element) {
						elementDuration =
							element.duration - element.trimStart - element.trimEnd;
					}
				}

				// Try snapping both start and end edges
				const startSnapResult = snapElementEdge(
					adjustedTime,
					elementDuration,
					tracks,
					currentTime,
					zoomLevel,
					dragState.elementId || undefined,
					true // snap to start edge
				);

				const endSnapResult = snapElementEdge(
					adjustedTime,
					elementDuration,
					tracks,
					currentTime,
					zoomLevel,
					dragState.elementId || undefined,
					false // snap to end edge
				);

				// Choose the snap result with the smaller distance (closer snap)
				let bestSnapResult = startSnapResult;
				if (
					endSnapResult.snapPoint &&
					(!startSnapResult.snapPoint ||
						endSnapResult.snapDistance < startSnapResult.snapDistance)
				) {
					bestSnapResult = endSnapResult;
				}

				finalTime = bestSnapResult.snappedTime;
				snapPoint = bestSnapResult.snapPoint;

				// Notify parent component about snap point change
				onSnapPointChange?.(snapPoint);
			} else {
				// Use frame snapping if project has FPS, otherwise use decimal snapping
				const { useProjectStore } = require("@/stores/project-store");
				const projectStore = useProjectStore.getState();
				const projectFps = projectStore.activeProject?.fps || 30;
				const { snapTimeToFrame } = require("@/constants/timeline-constants");
				finalTime = snapTimeToFrame(adjustedTime, projectFps);

				// Clear snap point when not snapping
				onSnapPointChange?.(null);
			}

			updateDragTime(finalTime);
		};

		const handleMouseUp = (e: MouseEvent) => {
			if (!dragState.elementId || !dragState.trackId) return;

			// If this track initiated the drag, we should handle the mouse up regardless of where it occurs
			const isTrackThatStartedDrag = dragState.trackId === track.id;

			const timelineRect = timelineRef.current?.getBoundingClientRect();
			if (!timelineRect) {
				if (isTrackThatStartedDrag) {
					if (rippleEditingEnabled) {
						updateElementStartTimeWithRipple(
							track.id,
							dragState.elementId,
							dragState.currentTime
						);
					} else {
						updateElementStartTime(
							track.id,
							dragState.elementId,
							dragState.currentTime
						);
					}
					endDragAction();
					// Clear snap point when drag ends
					onSnapPointChange?.(null);
				}
				return;
			}

			const isMouseOverThisTrack =
				e.clientY >= timelineRect.top && e.clientY <= timelineRect.bottom;

			if (!isMouseOverThisTrack && !isTrackThatStartedDrag) return;

			const finalTime = dragState.currentTime;

			if (isMouseOverThisTrack) {
				const sourceTrack = tracks.find((t: any) => t.id === dragState.trackId);
				const movingElement = sourceTrack?.elements.find(
					(c: any) => c.id === dragState.elementId
				);

				if (movingElement) {
					const movingElementDuration =
						movingElement.duration -
						movingElement.trimStart -
						movingElement.trimEnd;
					const movingElementEnd = finalTime + movingElementDuration;

					const targetTrack = tracks.find((t: any) => t.id === track.id);
					const hasOverlap = targetTrack?.elements.some((existingElement: any) => {
						if (
							dragState.trackId === track.id &&
							existingElement.id === dragState.elementId
						) {
							return false;
						}
						const existingStart = existingElement.startTime;
						const existingEnd =
							existingElement.startTime +
							(existingElement.duration -
								existingElement.trimStart -
								existingElement.trimEnd);
						return finalTime < existingEnd && movingElementEnd > existingStart;
					});

					if (!hasOverlap) {
						if (dragState.trackId === track.id) {
							if (rippleEditingEnabled) {
								updateElementStartTimeWithRipple(
									track.id,
									dragState.elementId,
									finalTime
								);
							} else {
								updateElementStartTime(
									track.id,
									dragState.elementId,
									finalTime
								);
							}
						} else {
							moveElementToTrack(
								dragState.trackId,
								track.id,
								dragState.elementId
							);
							requestAnimationFrame(() => {
								if (rippleEditingEnabled) {
									updateElementStartTimeWithRipple(
										track.id,
										dragState.elementId!,
										finalTime
									);
								} else {
									updateElementStartTime(
										track.id,
										dragState.elementId!,
										finalTime
									);
								}
							});
						}
					}
				}
			} else if (isTrackThatStartedDrag) {
				// Mouse is not over this track, but this track started the drag
				// This means user released over ruler/outside - update position within same track
				const sourceTrack = tracks.find((t: any) => t.id === dragState.trackId);
				const movingElement = sourceTrack?.elements.find(
					(c: any) => c.id === dragState.elementId
				);

				if (movingElement) {
					const movingElementDuration =
						movingElement.duration -
						movingElement.trimStart -
						movingElement.trimEnd;
					const movingElementEnd = finalTime + movingElementDuration;

					const hasOverlap = track.elements.some((existingElement) => {
						if (existingElement.id === dragState.elementId) {
							return false;
						}
						const existingStart = existingElement.startTime;
						const existingEnd =
							existingElement.startTime +
							(existingElement.duration -
								existingElement.trimStart -
								existingElement.trimEnd);
						return finalTime < existingEnd && movingElementEnd > existingStart;
					});

					if (!hasOverlap) {
						if (rippleEditingEnabled) {
							updateElementStartTimeWithRipple(
								track.id,
								dragState.elementId,
								finalTime
							);
						} else {
							updateElementStartTime(track.id, dragState.elementId, finalTime);
						}
					}
				}
			}

			if (isTrackThatStartedDrag) {
				endDragAction();
				// Clear snap point when drag ends
				onSnapPointChange?.(null);
			}
		};

		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);

		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
		};
	}, [hooks, track.id, track.elements, zoomLevel, onSnapPointChange]);

	// Handle media loading states
	if (hooks.mediaItemsError) {
		console.error(
			"Failed to load media items in timeline track:",
			hooks.mediaItemsError
		);
		// Return a placeholder that maintains track structure
		return (
			<div className="relative w-full h-full border border-red-300 bg-red-50 rounded text-red-600 text-xs p-2">
				Error loading media items
			</div>
		);
	}

	const { 
		isDropping, 
		wouldOverlap, 
		selectedElements, 
		clearSelectedElements,
		splitElement,
		currentTime 
	} = hooks;

	return (
		<div
			className="w-full h-full hover:bg-muted/20"
			onClick={(e) => {
				// If clicking empty area (not on an element), deselect all elements
				if (!(e.target as HTMLElement).closest(".timeline-element")) {
					clearSelectedElements();
				}
			}}
			onDragOver={handleTrackDragOver}
			onDragEnter={handleTrackDragEnter}
			onDragLeave={handleTrackDragLeave}
			onDrop={handleTrackDrop}
		>
			<div
				ref={hooks.timelineRef}
				className="h-full relative track-elements-container min-w-full"
				data-testid="timeline-track"
				data-track-type={track.type}
			>
				{track.elements.length === 0 ? (
					<div
						className={`h-full w-full rounded-sm border-2 border-dashed flex items-center justify-center text-xs text-muted-foreground transition-colors ${
							isDropping
								? wouldOverlap
									? "border-red-500 bg-red-500/10 text-red-600"
									: "border-blue-500 bg-blue-500/10 text-blue-600"
								: "border-muted/30"
						}`}
					>
						{isDropping
							? wouldOverlap
								? "Cannot drop - would overlap"
								: "Drop element here"
							: ""}
					</div>
				) : (
					<>
						{track.elements.map((element) => {
							const isSelected = selectedElements.some(
								(c: any) => c.trackId === track.id && c.elementId === element.id
							);

							const handleElementSplit = () => {
								const splitTime = currentTime;
								const effectiveStart = element.startTime;
								const effectiveEnd =
									element.startTime +
									(element.duration - element.trimStart - element.trimEnd);

								if (splitTime > effectiveStart && splitTime < effectiveEnd) {
									const secondElementId = splitElement(
										track.id,
										element.id,
										splitTime
									);
									if (!secondElementId) {
										toast.error("Failed to split element");
									}
								} else {
									toast.error("Playhead must be within element to split");
								}
							};

							const handleElementDuplicate = () => {
								const { addElementToTrack } = require("@/stores/timeline/timeline-store").useTimelineStore.getState();
								const { id, ...elementWithoutId } = element;
								addElementToTrack(track.id, {
									...elementWithoutId,
									name: element.name + " (copy)",
									startTime:
										element.startTime +
										(element.duration - element.trimStart - element.trimEnd) +
										0.1,
								});
							};

							const handleElementDelete = () => {
								const { removeElementFromTrack } = require("@/stores/timeline/timeline-store").useTimelineStore.getState();
								removeElementFromTrack(track.id, element.id);
							};

							return (
								<TimelineElement
									key={element.id}
									element={element}
									track={track}
									zoomLevel={zoomLevel}
									isSelected={isSelected}
									onElementMouseDown={handleElementMouseDown}
									onElementClick={handleElementClick}
								/>
							);
						})}
					</>
				)}
			</div>
		</div>
	);
}

// Error Fallback Component for Timeline Track
const TimelineTrackErrorFallback = ({
	resetError,
}: {
	resetError: () => void;
}) => (
	<div className="h-16 bg-destructive/10 border border-destructive/20 rounded flex items-center justify-center text-sm text-destructive m-2">
		<span className="mr-2">Track Error</span>
		<button
			onClick={resetError}
			className="underline hover:no-underline"
			type="button"
		>
			Retry
		</button>
	</div>
);

// Export wrapped component with error boundary
export const TimelineTrackContent = withErrorBoundary(
	TimelineTrackContentComponent,
	{
		isolate: true, // Only affects this track, not the entire timeline
		fallback: TimelineTrackErrorFallback,
	}
);