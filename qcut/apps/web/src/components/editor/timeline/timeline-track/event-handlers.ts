import { toast } from "sonner";
import type { TimelineElement, TimelineTrack, DragData } from "@/types/timeline";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { getMainTrack } from "@/types/timeline";

export function createEventHandlers(
	track: TimelineTrack,
	zoomLevel: number,
	hooks: any // Using any here to avoid circular dependency issues
) {
	const {
		tracks,
		selectedElements,
		selectElement,
		dragState,
		startDragAction,
		updateElementStartTime,
		updateElementStartTimeWithRipple,
		moveElementToTrack,
		endDragAction,
		updateDragTime,
		addElementToTrack,
		insertTrackAt,
		rippleEditingEnabled,
		snappingEnabled,
		snapElementEdge,
		currentTime,
		mediaItems,
		timelineRef,
		dragCounterRef,
		setIsDropping,
		setDropPosition,
		setWouldOverlap,
		setMouseDownLocation,
		getDropSnappedTime,
	} = hooks;

	const handleElementMouseDown = (
		e: React.MouseEvent,
		element: TimelineElement
	) => {
		setMouseDownLocation({ x: e.clientX, y: e.clientY });

		// Detect right-click (button 2) and handle selection without starting drag
		const isRightClick = e.button === 2;
		const isMultiSelect = e.metaKey || e.ctrlKey || e.shiftKey;

		if (isRightClick) {
			// Handle right-click selection
			const isSelected = selectedElements.some(
				(c: any) => c.trackId === track.id && c.elementId === element.id
			);

			// If element is not selected, select it (keep other selections if multi-select)
			if (!isSelected) {
				selectElement(track.id, element.id, isMultiSelect);
			}
			// If element is already selected, keep it selected

			// Don't start drag action for right-clicks
			return;
		}

		// Handle multi-selection for left-click with modifiers
		if (isMultiSelect) {
			selectElement(track.id, element.id, true);
		}

		// Calculate the offset from the left edge of the element to where the user clicked
		const elementElement = e.currentTarget as HTMLElement;
		const elementRect = elementElement.getBoundingClientRect();
		const clickOffsetX = e.clientX - elementRect.left;
		const clickOffsetTime =
			clickOffsetX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);

		startDragAction(
			element.id,
			track.id,
			e.clientX,
			element.startTime,
			clickOffsetTime
		);
	};

	const handleElementClick = (
		e: React.MouseEvent,
		element: TimelineElement
	) => {
		e.stopPropagation();

		// Check if mouse moved significantly
		const mouseDownLocation = hooks.mouseDownLocation;
		if (mouseDownLocation) {
			const deltaX = Math.abs(e.clientX - mouseDownLocation.x);
			const deltaY = Math.abs(e.clientY - mouseDownLocation.y);
			// If it moved more than a few pixels, consider it a drag and not a click.
			if (deltaX > 5 || deltaY > 5) {
				setMouseDownLocation(null); // Reset for next interaction
				return;
			}
		}

		// Skip selection logic for multi-selection (handled in mousedown)
		if (e.metaKey || e.ctrlKey || e.shiftKey) {
			return;
		}

		// Handle single selection
		const isSelected = selectedElements.some(
			(c: any) => c.trackId === track.id && c.elementId === element.id
		);

		if (!isSelected) {
			// If element is not selected, select it (replacing other selections)
			selectElement(track.id, element.id, false);
		}
		// If element is already selected, keep it selected (do nothing)
	};

	const handleTrackDragOver = (e: React.DragEvent) => {
		e.preventDefault();

		// Handle both timeline elements and media items
		const hasTimelineElement = e.dataTransfer.types.includes(
			"application/x-timeline-element"
		);
		const hasMediaItem = e.dataTransfer.types.includes(
			"application/x-media-item"
		);

		if (!hasTimelineElement && !hasMediaItem) return;

		// Calculate drop position for overlap checking
		const trackContainer = e.currentTarget.querySelector(
			".track-elements-container"
		) as HTMLElement;
		let dropTime = 0;
		if (trackContainer) {
			const rect = trackContainer.getBoundingClientRect();
			const mouseX = Math.max(0, e.clientX - rect.left);
			dropTime = mouseX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);
		}

		// Check for potential overlaps and show appropriate feedback
		let wouldOverlap = false;

		if (hasMediaItem) {
			try {
				const mediaItemData = e.dataTransfer.getData(
					"application/x-media-item"
				);
				if (mediaItemData) {
					const dragData: DragData = JSON.parse(mediaItemData);

					if (dragData.type === "text") {
						// Text elements have default duration of 5 seconds
						const newElementDuration = 5;
						const snappedTime = getDropSnappedTime(
							dropTime,
							newElementDuration
						);
						const newElementEnd = snappedTime + newElementDuration;

						wouldOverlap = track.elements.some((existingElement) => {
							const existingStart = existingElement.startTime;
							const existingEnd =
								existingElement.startTime +
								(existingElement.duration -
									existingElement.trimStart -
									existingElement.trimEnd);
							return snappedTime < existingEnd && newElementEnd > existingStart;
						});
					} else if (dragData.type === "markdown") {
						const newElementDuration =
							TIMELINE_CONSTANTS.MARKDOWN_DEFAULT_DURATION;
						const snappedTime = getDropSnappedTime(
							dropTime,
							newElementDuration
						);
						const newElementEnd = snappedTime + newElementDuration;

						wouldOverlap = track.elements.some((existingElement) => {
							const existingStart = existingElement.startTime;
							const existingEnd =
								existingElement.startTime +
								(existingElement.duration -
									existingElement.trimStart -
									existingElement.trimEnd);
							return snappedTime < existingEnd && newElementEnd > existingStart;
						});
					} else {
						// Media elements
						const mediaItem = mediaItems.find(
							(item: any) => item.id === dragData.id
						);
						if (mediaItem) {
							const newElementDuration = mediaItem.duration || 5;
							const snappedTime = getDropSnappedTime(
								dropTime,
								newElementDuration
							);
							const newElementEnd = snappedTime + newElementDuration;

							wouldOverlap = track.elements.some((existingElement) => {
								const existingStart = existingElement.startTime;
								const existingEnd =
									existingElement.startTime +
									(existingElement.duration -
										existingElement.trimStart -
										existingElement.trimEnd);
								return (
									snappedTime < existingEnd && newElementEnd > existingStart
								);
							});
						}
					}
				}
			} catch (error) {
				// Continue with default behavior
			}
		} else if (hasTimelineElement) {
			try {
				const timelineElementData = e.dataTransfer.getData(
					"application/x-timeline-element"
				);
				if (timelineElementData) {
					const { elementId, trackId: fromTrackId } =
						JSON.parse(timelineElementData);
					const sourceTrack = tracks.find(
						(t: TimelineTrack) => t.id === fromTrackId
					);
					const movingElement = sourceTrack?.elements.find(
						(c: any) => c.id === elementId
					);

					if (movingElement) {
						const movingElementDuration =
							movingElement.duration -
							movingElement.trimStart -
							movingElement.trimEnd;
						const snappedTime = getDropSnappedTime(
							dropTime,
							movingElementDuration,
							elementId
						);
						const movingElementEnd = snappedTime + movingElementDuration;

						wouldOverlap = track.elements.some((existingElement) => {
							if (fromTrackId === track.id && existingElement.id === elementId)
								return false;

							const existingStart = existingElement.startTime;
							const existingEnd =
								existingElement.startTime +
								(existingElement.duration -
									existingElement.trimStart -
									existingElement.trimEnd);
							return (
								snappedTime < existingEnd && movingElementEnd > existingStart
							);
						});
					}
				}
			} catch (error) {
				// Continue with default behavior
			}
		}

		if (wouldOverlap) {
			e.dataTransfer.dropEffect = "none";
			setWouldOverlap(true);
			// Use default duration for position indicator
			setDropPosition(getDropSnappedTime(dropTime, 5));
			return;
		}

		e.dataTransfer.dropEffect = hasTimelineElement ? "move" : "copy";
		setWouldOverlap(false);
		// Use default duration for position indicator
		setDropPosition(getDropSnappedTime(dropTime, 5));
	};

	const handleTrackDragEnter = (e: React.DragEvent) => {
		e.preventDefault();

		const hasTimelineElement = e.dataTransfer.types.includes(
			"application/x-timeline-element"
		);
		const hasMediaItem = e.dataTransfer.types.includes(
			"application/x-media-item"
		);

		if (!hasTimelineElement && !hasMediaItem) return;

		dragCounterRef.current++;
		setIsDropping(true);
	};

	const handleTrackDragLeave = (e: React.DragEvent) => {
		e.preventDefault();

		const hasTimelineElement = e.dataTransfer.types.includes(
			"application/x-timeline-element"
		);
		const hasMediaItem = e.dataTransfer.types.includes(
			"application/x-media-item"
		);

		if (!hasTimelineElement && !hasMediaItem) return;

		dragCounterRef.current--;

		if (dragCounterRef.current === 0) {
			setIsDropping(false);
			setWouldOverlap(false);
			setDropPosition(null);
		}
	};

	return {
		handleElementMouseDown,
		handleElementClick,
		handleTrackDragOver,
		handleTrackDragEnter,
		handleTrackDragLeave,
	};
}