import { toast } from "sonner";
import type { TimelineTrack, DragData } from "@/types/timeline";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { snapTimeToFrame } from "@/constants/timeline-constants";
import { getMainTrack, canElementGoOnTrack } from "@/types/timeline";

export function createDropHandler(
	track: TimelineTrack,
	zoomLevel: number,
	hooks: any // Using any here to avoid circular dependency issues
) {
	const {
		tracks,
		moveElementToTrack,
		updateElementStartTime,
		updateElementStartTimeWithRipple,
		addElementToTrack,
		insertTrackAt,
		rippleEditingEnabled,
		mediaItems,
		dragCounterRef,
		setIsDropping,
		setWouldOverlap,
		setDropPosition,
		getDropSnappedTime,
	} = hooks;

	const handleTrackDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();

		// Debug logging
		console.log(
			JSON.stringify({
				message: "Drop event started in timeline track",
				dataTransferTypes: Array.from(e.dataTransfer.types),
				trackId: track.id,
				trackType: track.type,
			})
		);

		// Reset all drag states
		dragCounterRef.current = 0;
		setIsDropping(false);
		setWouldOverlap(false);

		const hasTimelineElement = e.dataTransfer.types.includes(
			"application/x-timeline-element"
		);
		const hasMediaItem = e.dataTransfer.types.includes(
			"application/x-media-item"
		);

		if (!hasTimelineElement && !hasMediaItem) return;

		const trackContainer = e.currentTarget.querySelector(
			".track-elements-container"
		) as HTMLElement;
		if (!trackContainer) return;

		const rect = trackContainer.getBoundingClientRect();
		const mouseX = Math.max(0, e.clientX - rect.left);
		const mouseY = e.clientY - rect.top; // Get Y position relative to this track
		const newStartTime =
			mouseX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);
		const projectStore = useProjectStore.getState();
		const projectFps = projectStore.activeProject?.fps || 30;
		const snappedTime = snapTimeToFrame(newStartTime, projectFps);

		// Calculate drop position relative to tracks
		const currentTrackIndex = tracks.findIndex((t: TimelineTrack) => t.id === track.id);

		// Determine drop zone within the track (top 20px, middle 20px, bottom 20px)
		let dropPosition: "above" | "on" | "below";
		if (mouseY < 20) {
			dropPosition = "above";
		} else if (mouseY > 40) {
			dropPosition = "below";
		} else {
			dropPosition = "on";
		}

		try {
			if (hasTimelineElement) {
				// Handle timeline element movement
				const timelineElementData = e.dataTransfer.getData(
					"application/x-timeline-element"
				);
				if (!timelineElementData) return;

				const {
					elementId,
					trackId: fromTrackId,
					clickOffsetTime = 0,
				} = JSON.parse(timelineElementData);

				// Find the element being moved
				const sourceTrack = tracks.find(
					(t: TimelineTrack) => t.id === fromTrackId
				);
				const movingElement = sourceTrack?.elements.find(
					(c: any) => c.id === elementId
				);

				if (!movingElement) {
					toast.error("Element not found");
					return;
				}

				// Check for overlaps with existing elements (excluding the moving element itself)
				const movingElementDuration =
					movingElement.duration -
					movingElement.trimStart -
					movingElement.trimEnd;

				// Adjust position based on where user clicked on the element
				const adjustedStartTime = newStartTime - clickOffsetTime;
				const snappedStartTime = getDropSnappedTime(
					adjustedStartTime,
					movingElementDuration,
					elementId
				);
				const finalStartTime = Math.max(0, snappedStartTime);
				const movingElementEnd = finalStartTime + movingElementDuration;

				const hasOverlap = track.elements.some((existingElement) => {
					// Skip the element being moved if it's on the same track
					if (fromTrackId === track.id && existingElement.id === elementId)
						return false;

					const existingStart = existingElement.startTime;
					const existingEnd =
						existingElement.startTime +
						(existingElement.duration -
							existingElement.trimStart -
							existingElement.trimEnd);

					// Check if elements overlap
					return (
						finalStartTime < existingEnd && movingElementEnd > existingStart
					);
				});

				if (hasOverlap) {
					toast.error(
						"Cannot move element here - it would overlap with existing elements"
					);
					return;
				}

				if (fromTrackId === track.id) {
					// Moving within same track
					if (rippleEditingEnabled) {
						updateElementStartTimeWithRipple(
							track.id,
							elementId,
							finalStartTime
						);
					} else {
						updateElementStartTime(track.id, elementId, finalStartTime);
					}
				} else {
					// Moving to different track
					moveElementToTrack(fromTrackId, track.id, elementId);
					requestAnimationFrame(() => {
						if (rippleEditingEnabled) {
							updateElementStartTimeWithRipple(
								track.id,
								elementId,
								finalStartTime
							);
						} else {
							updateElementStartTime(track.id, elementId, finalStartTime);
						}
					});
				}
			} else if (hasMediaItem) {
				// Handle media item drop
				const mediaItemData = e.dataTransfer.getData(
					"application/x-media-item"
				);
				if (!mediaItemData) return;

				const dragData: DragData = JSON.parse(mediaItemData);

				if (dragData.type === "text") {
					let targetTrackId = track.id;
					let targetTrack = track;

					// Handle position-aware track creation for text
					if (track.type !== "text" || dropPosition !== "on") {
						// Text tracks should go above the main track
						const mainTrack = getMainTrack(tracks);
						let insertIndex: number;

						if (dropPosition === "above") {
							insertIndex = currentTrackIndex;
						} else if (dropPosition === "below") {
							insertIndex = currentTrackIndex + 1;
						} else {
							// dropPosition === "on" but track is not text type
							// Insert above main track if main track exists, otherwise at top
							if (mainTrack) {
								const mainTrackIndex = tracks.findIndex(
									(t: TimelineTrack) => t.id === mainTrack.id
								);
								insertIndex = mainTrackIndex;
							} else {
								insertIndex = 0; // Top of timeline
							}
						}

						targetTrackId = insertTrackAt("text", insertIndex);
						// Get the updated tracks array after creating the new track
						const updatedTracks = useTimelineStore.getState().tracks;
						const newTargetTrack = updatedTracks.find(
							(t: TimelineTrack) => t.id === targetTrackId
						);
						if (!newTargetTrack) return;
						targetTrack = newTargetTrack;
					}

					// Check for overlaps with existing elements in target track
					const newElementDuration = 5; // Default text duration
					const textSnappedTime = getDropSnappedTime(
						newStartTime,
						newElementDuration
					);
					const newElementEnd = textSnappedTime + newElementDuration;

					const hasOverlap = targetTrack.elements.some((existingElement) => {
						const existingStart = existingElement.startTime;
						const existingEnd =
							existingElement.startTime +
							(existingElement.duration -
								existingElement.trimStart -
								existingElement.trimEnd);

						// Check if elements overlap
						return (
							textSnappedTime < existingEnd && newElementEnd > existingStart
						);
					});

					if (hasOverlap) {
						toast.error(
							"Cannot place element here - it would overlap with existing elements"
						);
						return;
					}

					addElementToTrack(targetTrackId, {
						type: "text",
						name: dragData.name || "Text",
						content: dragData.content || "Default Text",
						duration: TIMELINE_CONSTANTS.DEFAULT_TEXT_DURATION,
						startTime: textSnappedTime,
						trimStart: 0,
						trimEnd: 0,
						fontSize: 48,
						fontFamily: "Arial",
						color: "#ffffff",
						backgroundColor: "transparent",
						textAlign: "center",
						fontWeight: "normal",
						fontStyle: "normal",
						textDecoration: "none",
						x: 0,
						y: 0,
						rotation: 0,
						opacity: 1,
					});
				} else if (dragData.type === "markdown") {
					let targetTrackId = track.id;
					let targetTrack = track;

					if (track.type !== "markdown" || dropPosition !== "on") {
						const mainTrack = getMainTrack(tracks);
						let insertIndex: number;

						if (dropPosition === "above") {
							insertIndex = currentTrackIndex;
						} else if (dropPosition === "below") {
							insertIndex = currentTrackIndex + 1;
						} else if (mainTrack) {
							const mainTrackIndex = tracks.findIndex(
								(t: TimelineTrack) => t.id === mainTrack.id
							);
							insertIndex = mainTrackIndex;
						} else {
							insertIndex = 0;
						}

						targetTrackId = insertTrackAt("markdown", insertIndex);
						const updatedTracks = useTimelineStore.getState().tracks;
						const newTargetTrack = updatedTracks.find(
							(t: TimelineTrack) => t.id === targetTrackId
						);
						if (!newTargetTrack) return;
						targetTrack = newTargetTrack;
					}

					const markdownDuration = TIMELINE_CONSTANTS.MARKDOWN_DEFAULT_DURATION;
					const markdownSnappedTime = getDropSnappedTime(
						newStartTime,
						markdownDuration
					);
					const newElementEnd = markdownSnappedTime + markdownDuration;

					const hasOverlap = targetTrack.elements.some((existingElement) => {
						const existingStart = existingElement.startTime;
						const existingEnd =
							existingElement.startTime +
							(existingElement.duration -
								existingElement.trimStart -
								existingElement.trimEnd);
						return (
							markdownSnappedTime < existingEnd && newElementEnd > existingStart
						);
					});

					if (hasOverlap) {
						toast.error(
							"Cannot place element here - it would overlap with existing elements"
						);
						return;
					}

					addElementToTrack(targetTrackId, {
						type: "markdown",
						name: dragData.name || "Markdown",
						markdownContent:
							dragData.markdownContent || "# Title\n\nStart writing...",
						duration: markdownDuration,
						startTime: markdownSnappedTime,
						trimStart: 0,
						trimEnd: 0,
						theme: "dark",
						fontSize: 18,
						fontFamily: "Arial",
						padding: 16,
						backgroundColor: "rgba(0, 0, 0, 0.85)",
						textColor: "#ffffff",
						scrollMode: "static",
						scrollSpeed: 30,
						x: 0,
						y: 0,
						width: 720,
						height: 420,
						rotation: 0,
						opacity: 1,
					});
				} else {
					// Handle media items
					console.log("[TimelineTrack] Processing media item drop:", {
						dragDataId: dragData.id,
						dragDataType: dragData.type,
						dragDataName: dragData.name,
						mediaItemsCount: mediaItems.length,
					});

					const mediaItem = mediaItems.find((item: any) => item.id === dragData.id);

					console.log("[TimelineTrack] Found media item:", {
						found: !!mediaItem,
						mediaItemId: mediaItem?.id,
						mediaItemUrl: mediaItem?.url,
						isBlobUrl: mediaItem?.url?.startsWith("blob:"),
						mediaItemType: mediaItem?.type,
						mediaItemName: mediaItem?.name,
					});

					if (!mediaItem) {
						toast.error("Media item not found");
						return;
					}

					let targetTrackId = track.id;

					// Check if track type is compatible
					const isVideoOrImage =
						dragData.type === "video" || dragData.type === "image";
					const isAudio = dragData.type === "audio";
					const isCompatible = isVideoOrImage
						? canElementGoOnTrack("media", track.type)
						: isAudio
							? canElementGoOnTrack("media", track.type)
							: false;

					let targetTrack = tracks.find((t: TimelineTrack) => t.id === targetTrackId);

					// Handle position-aware track creation for media elements
					if (!isCompatible || dropPosition !== "on") {
						if (isVideoOrImage) {
							// For video/image, check if we need a main track or additional media track
							const mainTrack = getMainTrack(tracks);

							if (!mainTrack) {
								// No main track exists, create it
								const { addTrack } = useTimelineStore.getState();
								targetTrackId = addTrack("media");
								const updatedTracks = useTimelineStore.getState().tracks;
								const newTargetTrack = updatedTracks.find(
									(t: TimelineTrack) => t.id === targetTrackId
								);
								if (!newTargetTrack) return;
								targetTrack = newTargetTrack;
							} else if (
								mainTrack.elements.length === 0 &&
								dropPosition === "on"
							) {
								// Main track exists and is empty, use it
								targetTrackId = mainTrack.id;
								targetTrack = mainTrack;
							} else {
								// Create new media track
								let insertIndex: number;

								if (dropPosition === "above") {
									insertIndex = currentTrackIndex;
								} else if (dropPosition === "below") {
									insertIndex = currentTrackIndex + 1;
								} else {
									// Insert above main track
									const mainTrackIndex = tracks.findIndex(
										(t: TimelineTrack) => t.id === mainTrack.id
									);
									insertIndex = mainTrackIndex;
								}

								targetTrackId = insertTrackAt("media", insertIndex);
								const updatedTracks = useTimelineStore.getState().tracks;
								const newTargetTrack = updatedTracks.find(
									(t: TimelineTrack) => t.id === targetTrackId
								);
								if (!newTargetTrack) return;
								targetTrack = newTargetTrack;
							}
						} else if (isAudio) {
							// Audio tracks go at the bottom
							const mainTrack = getMainTrack(tracks);
							let insertIndex: number;

							if (dropPosition === "above") {
								insertIndex = currentTrackIndex;
							} else if (dropPosition === "below") {
								insertIndex = currentTrackIndex + 1;
							} else {
								// Insert after main track (bottom area)
								if (mainTrack) {
									const mainTrackIndex = tracks.findIndex(
										(t: TimelineTrack) => t.id === mainTrack.id
									);
									insertIndex = mainTrackIndex + 1;
								} else {
									insertIndex = tracks.length; // Bottom of timeline
								}
							}

							targetTrackId = insertTrackAt("audio", insertIndex);
							const updatedTracks = useTimelineStore.getState().tracks;
							const newTargetTrack = updatedTracks.find(
								(t: TimelineTrack) => t.id === targetTrackId
							);
							if (!newTargetTrack) return;
							targetTrack = newTargetTrack;
						}
					}

					if (!targetTrack) return;

					// Check for overlaps with existing elements in target track
					const newElementDuration = mediaItem.duration || 5;
					const mediaSnappedTime = getDropSnappedTime(
						newStartTime,
						newElementDuration
					);
					const newElementEnd = mediaSnappedTime + newElementDuration;

					const hasOverlap = targetTrack.elements.some((existingElement) => {
						const existingStart = existingElement.startTime;
						const existingEnd =
							existingElement.startTime +
							(existingElement.duration -
								existingElement.trimStart -
								existingElement.trimEnd);

						// Check if elements overlap
						return (
							mediaSnappedTime < existingEnd && newElementEnd > existingStart
						);
					});

					if (hasOverlap) {
						toast.error(
							"Cannot place element here - it would overlap with existing elements"
						);
						return;
					}

					addElementToTrack(targetTrackId, {
						type: "media",
						mediaId: mediaItem.id,
						name: mediaItem.name,
						duration: mediaItem.duration || 5,
						startTime: mediaSnappedTime,
						trimStart: 0,
						trimEnd: 0,
					});
				}
			}
		} catch (error) {
			console.error("Error handling drop:", error);
			toast.error("Failed to add media to track");
		}
	};

	return handleTrackDrop;
}