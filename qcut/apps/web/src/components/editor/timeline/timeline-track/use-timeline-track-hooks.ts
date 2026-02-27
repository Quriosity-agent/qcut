import { useRef, useState, useEffect, useCallback } from "react";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { useAsyncMediaItems } from "@/hooks/media/use-async-media-store";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import { useProjectStore } from "@/stores/project-store";
import {
	useTimelineSnapping,
	type SnapPoint,
} from "@/hooks/timeline/use-timeline-snapping";
import { snapTimeToFrame, TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import type { TimelineTrack, TimelineElement } from "@/types/timeline";
import type { MouseDownLocation } from "./types";

export function useTimelineTrackHooks(track: TimelineTrack, zoomLevel: number, onSnapPointChange?: (snapPoint: SnapPoint | null) => void) {
	// Store selectors
	const tracks = useTimelineStore((s) => s.tracks);
	const addTrack = useTimelineStore((s) => s.addTrack);
	const moveElementToTrack = useTimelineStore((s) => s.moveElementToTrack);
	const updateElementStartTime = useTimelineStore((s) => s.updateElementStartTime);
	const updateElementStartTimeWithRipple = useTimelineStore((s) => s.updateElementStartTimeWithRipple);
	const addElementToTrack = useTimelineStore((s) => s.addElementToTrack);
	const selectedElements = useTimelineStore((s) => s.selectedElements);
	const selectElement = useTimelineStore((s) => s.selectElement);
	const dragState = useTimelineStore((s) => s.dragState);
	const startDragAction = useTimelineStore((s) => s.startDrag);
	const updateDragTime = useTimelineStore((s) => s.updateDragTime);
	const endDragAction = useTimelineStore((s) => s.endDrag);
	const clearSelectedElements = useTimelineStore((s) => s.clearSelectedElements);
	const insertTrackAt = useTimelineStore((s) => s.insertTrackAt);
	const snappingEnabled = useTimelineStore((s) => s.snappingEnabled);
	const rippleEditingEnabled = useTimelineStore((s) => s.rippleEditingEnabled);
	const splitElement = useTimelineStore((s) => s.splitElement);

	const currentTime = usePlaybackStore((s) => s.currentTime);

	// Media items hook
	const {
		mediaItems,
		loading: mediaItemsLoading,
		error: mediaItemsError,
	} = useAsyncMediaItems();

	// Initialize snapping hook
	const { snapElementPosition, snapElementEdge } = useTimelineSnapping({
		snapThreshold: 10,
		enableElementSnapping: snappingEnabled,
		enablePlayheadSnapping: snappingEnabled,
	});

	// Local state
	const timelineRef = useRef<HTMLDivElement>(null);
	const [isDropping, setIsDropping] = useState(false);
	const [dropPosition, setDropPosition] = useState<number | null>(null);
	const [wouldOverlap, setWouldOverlap] = useState(false);
	const dragCounterRef = useRef(0);
	const [mouseDownLocation, setMouseDownLocation] = useState<MouseDownLocation | null>(null);

	// Helper function for drop snapping that tries both edges
	const getDropSnappedTime = useCallback((
		dropTime: number,
		elementDuration: number,
		excludeElementId?: string
	) => {
		if (!snappingEnabled) {
			// Use frame snapping if project has FPS, otherwise use decimal snapping
			const projectStore = useProjectStore.getState();
			const projectFps = projectStore.activeProject?.fps || 30;
			return snapTimeToFrame(dropTime, projectFps);
		}

		// Try snapping both start and end edges for drops
		const startSnapResult = snapElementEdge(
			dropTime,
			elementDuration,
			tracks,
			currentTime,
			zoomLevel,
			excludeElementId,
			true // snap to start edge
		);

		const endSnapResult = snapElementEdge(
			dropTime,
			elementDuration,
			tracks,
			currentTime,
			zoomLevel,
			excludeElementId,
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

		return bestSnapResult.snappedTime;
	}, [snappingEnabled, snapElementEdge, tracks, currentTime, zoomLevel]);

	return {
		// Store selectors
		tracks,
		addTrack,
		moveElementToTrack,
		updateElementStartTime,
		updateElementStartTimeWithRipple,
		addElementToTrack,
		selectedElements,
		selectElement,
		dragState,
		startDragAction,
		updateDragTime,
		endDragAction,
		clearSelectedElements,
		insertTrackAt,
		snappingEnabled,
		rippleEditingEnabled,
		splitElement,
		currentTime,
		
		// Media items
		mediaItems,
		mediaItemsLoading,
		mediaItemsError,
		
		// Snapping
		snapElementPosition,
		snapElementEdge,
		
		// Local state
		timelineRef,
		isDropping,
		setIsDropping,
		dropPosition,
		setDropPosition,
		wouldOverlap,
		setWouldOverlap,
		dragCounterRef,
		mouseDownLocation,
		setMouseDownLocation,
		
		// Helpers
		getDropSnappedTime,
	};
}