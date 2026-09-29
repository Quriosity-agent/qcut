"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	snapTimeToFrame,
	TIMELINE_CONSTANTS,
} from "@/constants/timeline-constants";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import { useProjectStore } from "@/stores/project-store";

export const HOVER_PREVIEW_DELAY_MS = 100;

interface TimelineHoverAxisProps {
	timelineRef: React.RefObject<HTMLDivElement | null>;
	tracksScrollRef: React.RefObject<HTMLDivElement | null>;
	trackLabelsRef?: React.RefObject<HTMLDivElement | null>;
	zoomLevel: number;
}

/**
 * Jianying-style hover preview axis: while no mouse button is held, a yellow
 * vertical line follows the pointer across the ruler and tracks, and the
 * paused preview quick-previews the hovered frame via previewScrubTime.
 *
 * Any held button hides it (event.buttons covers every timeline gesture,
 * including pointer-captured ones and the sub-threshold clip-drag window), and
 * native HTML5 drags hide it via dragover, so clips still move only while the
 * left button stays pressed. The line position is written imperatively so
 * pointer movement never re-renders the timeline tree.
 */
export function TimelineHoverAxis({
	timelineRef,
	tracksScrollRef,
	trackLabelsRef,
	zoomLevel,
}: TimelineHoverAxisProps) {
	const lineRef = useRef<HTMLDivElement | null>(null);
	const lastPointRef = useRef<{ x: number; y: number } | null>(null);
	const visibleRef = useRef(false);
	const [visible, setVisible] = useState(false);
	// A moving hover cursor must not enqueue full preview renders at display Hz.
	const pendingScrubRef = useRef<number | null | undefined>(undefined);
	const scrubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const zoomRef = useRef(zoomLevel);
	zoomRef.current = zoomLevel;

	const cancelScheduledScrub = useCallback(() => {
		pendingScrubRef.current = undefined;
		if (scrubTimerRef.current !== null) {
			clearTimeout(scrubTimerRef.current);
			scrubTimerRef.current = null;
		}
	}, []);

	const scheduleScrub = useCallback(
		(value: number | null) => {
			if (pendingScrubRef.current === value) return;
			cancelScheduledScrub();
			const playback = usePlaybackStore.getState();
			if (value === null || playback.previewScrubTime === value) return;
			pendingScrubRef.current = value;
			scrubTimerRef.current = setTimeout(() => {
				scrubTimerRef.current = null;
				pendingScrubRef.current = undefined;
				const latest = usePlaybackStore.getState();
				if (!latest.isPlaying) latest.setPreviewScrubTime(value);
			}, HOVER_PREVIEW_DELAY_MS);
		},
		[cancelScheduledScrub]
	);

	const hide = useCallback(() => {
		lastPointRef.current = null;
		if (visibleRef.current) {
			visibleRef.current = false;
			setVisible(false);
		}
		// Hiding accompanies gesture starts, so clear synchronously instead of
		// waiting a frame.
		cancelScheduledScrub();
		usePlaybackStore.getState().setPreviewScrubTime(null);
	}, [cancelScheduledScrub]);

	const update = useCallback(
		(clientX: number, clientY: number) => {
			const timeline = timelineRef.current;
			const tracksViewport = tracksScrollRef.current;
			const line = lineRef.current;
			if (!timeline || !tracksViewport || !line) {
				hide();
				return;
			}
			const timelineRect = timeline.getBoundingClientRect();
			const labelsWidth = trackLabelsRef?.current?.offsetWidth ?? 0;
			if (
				clientX < timelineRect.left + labelsWidth ||
				clientX > timelineRect.right ||
				clientY < timelineRect.top ||
				clientY > timelineRect.bottom
			) {
				hide();
				return;
			}
			const viewportRect = tracksViewport.getBoundingClientRect();
			const contentX = clientX - viewportRect.left + tracksViewport.scrollLeft;
			const pixelsPerSecond =
				TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomRef.current;
			const playback = usePlaybackStore.getState();
			const fps = useProjectStore.getState().activeProject?.fps || 30;
			const rawTime = Math.max(
				0,
				Math.min(playback.duration, contentX / pixelsPerSecond)
			);
			const time = snapTimeToFrame(rawTime, fps);
			lastPointRef.current = { x: clientX, y: clientY };
			const left = Math.max(
				labelsWidth,
				labelsWidth + time * pixelsPerSecond - tracksViewport.scrollLeft
			);
			line.style.left = `${left}px`;
			if (!visibleRef.current) {
				visibleRef.current = true;
				setVisible(true);
			}
			// During playback the axis stays visual-only: the advancing frame
			// keeps the preview, so no scrub override is published.
			scheduleScrub(playback.isPlaying ? null : time);
		},
		[hide, scheduleScrub, timelineRef, tracksScrollRef, trackLabelsRef]
	);

	useEffect(() => {
		const handlePointerMove = (event: PointerEvent) => {
			if (event.buttons !== 0) {
				hide();
				return;
			}
			update(event.clientX, event.clientY);
		};
		const handlePointerDown = () => hide();
		const handleDragOver = () => hide();
		const handleDocumentLeave = () => hide();
		const handleVisibility = () => {
			if (document.hidden) hide();
		};
		const unsubscribe = usePlaybackStore.subscribe((state, previous) => {
			if (state.isPlaying && !previous.isPlaying) cancelScheduledScrub();
		});
		document.addEventListener("pointermove", handlePointerMove);
		document.addEventListener("pointerdown", handlePointerDown, true);
		document.addEventListener("dragover", handleDragOver);
		window.addEventListener("blur", hide);
		document.addEventListener("visibilitychange", handleVisibility);
		document.documentElement.addEventListener(
			"mouseleave",
			handleDocumentLeave
		);
		return () => {
			document.removeEventListener("pointermove", handlePointerMove);
			document.removeEventListener("pointerdown", handlePointerDown, true);
			document.removeEventListener("dragover", handleDragOver);
			window.removeEventListener("blur", hide);
			document.removeEventListener("visibilitychange", handleVisibility);
			unsubscribe();
			document.documentElement.removeEventListener(
				"mouseleave",
				handleDocumentLeave
			);
			cancelScheduledScrub();
			usePlaybackStore.getState().setPreviewScrubTime(null);
		};
	}, [cancelScheduledScrub, hide, update]);

	// Keep the line honest when the tracks scroll or the zoom level changes
	// under a stationary pointer.
	useEffect(() => {
		zoomRef.current = zoomLevel;
		const point = lastPointRef.current;
		if (point) update(point.x, point.y);
		const viewport = tracksScrollRef.current;
		if (!viewport) return;
		const handleScroll = () => {
			const scrolledPoint = lastPointRef.current;
			if (scrolledPoint) update(scrolledPoint.x, scrolledPoint.y);
		};
		viewport.addEventListener("scroll", handleScroll);
		return () => viewport.removeEventListener("scroll", handleScroll);
	}, [tracksScrollRef, update, zoomLevel]);

	return (
		<div
			ref={lineRef}
			data-testid="timeline-hover-axis"
			className="pointer-events-none absolute top-0 bottom-0 z-[140] w-px bg-yellow-400/90"
			style={{ left: 0, display: visible ? undefined : "none" }}
		/>
	);
}
