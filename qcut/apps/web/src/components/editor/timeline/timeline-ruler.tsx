"use client";

import { Bookmark } from "lucide-react";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import { useProjectStore } from "@/stores/project-store";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { TimelineCacheIndicator } from "./timeline-cache-indicator";
import { BeatMarkers } from "./beat-markers";
import type { RefObject } from "react";
import type { TimelineTrack } from "@/types/timeline";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { TProject } from "@/types/project";
import type { WordItem } from "@/types/word-timeline";
import { TimelineWordLane } from "./timeline-word-lane";
import { TimelineTimeMarkers } from "./timeline-time-markers";

interface TimelineRulerProps {
	duration: number;
	zoomLevel: number;
	tracks: TimelineTrack[];
	mediaItems: MediaItem[];
	activeProject: TProject | null;
	getRenderStatus: (
		time: number,
		tracks: TimelineTrack[],
		mediaItems: MediaItem[],
		activeProject: TProject | null
	) => "cached" | "not-cached";
	rulerRef: RefObject<HTMLDivElement | null>;
	rulerScrollRef: RefObject<HTMLDivElement | null>;
	handleRulerPointerDown: (e: React.PointerEvent) => void;
	handleSelectionPointerDown: (e: React.PointerEvent) => void;
	handleTimelineContentClick: (e: React.MouseEvent) => void;
	handleWheel: (e: React.WheelEvent) => void;
	pinchHandlers: {
		onPointerDown: (e: React.PointerEvent) => void;
		onPointerMove: (e: React.PointerEvent) => void;
		onPointerUp: (e: React.PointerEvent) => void;
		onPointerCancel: (e: React.PointerEvent) => void;
	};
	dynamicTimelineWidth: number;
	words: WordItem[];
	silenceGapSegments: WordItem[];
}

/** Renders the timeline ruler with time markers, bookmarks, and word/silence indicators. */
export function TimelineRuler({
	duration,
	zoomLevel,
	tracks,
	mediaItems,
	activeProject,
	getRenderStatus,
	rulerRef,
	rulerScrollRef,
	handleRulerPointerDown,
	handleSelectionPointerDown,
	handleTimelineContentClick,
	handleWheel,
	pinchHandlers,
	dynamicTimelineWidth,
	words,
	silenceGapSegments,
}: TimelineRulerProps) {
	return (
		<div
			className="relative h-14 flex-1 touch-none overflow-hidden"
			onWheel={(e) => {
				// Check if this is horizontal scrolling - if so, don't handle it here
				if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
					return; // Let scroll container handle horizontal scrolling
				}
				handleWheel(e);
			}}
			onPointerDown={(e) => {
				pinchHandlers.onPointerDown(e);
				handleSelectionPointerDown(e);
			}}
			onPointerMove={pinchHandlers.onPointerMove}
			onPointerUp={pinchHandlers.onPointerUp}
			onPointerCancel={pinchHandlers.onPointerCancel}
			onClick={handleTimelineContentClick}
			data-ruler-area
		>
			<div
				ref={rulerScrollRef}
				className="w-full overflow-x-auto overflow-y-hidden scrollbar-hidden"
			>
				<div
					ref={rulerRef}
					className="relative h-14 cursor-default select-none"
					style={{
						width: `${dynamicTimelineWidth}px`,
					}}
					onPointerDown={handleRulerPointerDown}
				>
					{/* Cache indicator */}
					<TimelineCacheIndicator
						duration={duration}
						zoomLevel={zoomLevel}
						tracks={tracks}
						mediaItems={mediaItems}
						activeProject={activeProject}
						getRenderStatus={getRenderStatus}
					/>

					{/* Beat markers (overlay) */}
					<BeatMarkers zoomLevel={zoomLevel} />

					{/* Time markers */}
					<TimelineTimeMarkers
						duration={duration}
						zoomLevel={zoomLevel}
						scrollContainerRef={rulerScrollRef}
					/>

					{/* Bookmark markers */}
					<BookmarkMarkers zoomLevel={zoomLevel} />

					{/* Silence gap regions from AI filtering */}
					{silenceGapSegments.length > 0 &&
						silenceGapSegments.map((gap) => {
							const left =
								gap.start * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
							const width = Math.max(
								4,
								(gap.end - gap.start) *
									TIMELINE_CONSTANTS.PIXELS_PER_SECOND *
									zoomLevel
							);
							return (
								<div
									key={`gap-${gap.id}`}
									role="button"
									tabIndex={0}
									className="absolute top-0 h-full bg-orange-400/15 border-x border-orange-400/40 cursor-pointer hover:bg-orange-400/25 focus:ring-2 focus:ring-orange-400 focus:outline-none transition-colors"
									style={{
										left: `${left}px`,
										width: `${width}px`,
									}}
									aria-label={`Filtered silence gap ${gap.start.toFixed(2)} to ${gap.end.toFixed(2)} seconds`}
									onClick={(event) => {
										event.stopPropagation();
										usePlaybackStore.getState().seek(gap.start);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											event.stopPropagation();
											usePlaybackStore.getState().seek(gap.start);
										}
									}}
								/>
							);
						})}

					{words.length > 0 ? (
						<TimelineWordLane
							scrollContainerRef={rulerScrollRef}
							words={words}
							zoomLevel={zoomLevel}
						/>
					) : null}
				</div>
			</div>
		</div>
	);
}

const selectBookmarks = (state: { activeProject: TProject | null }) =>
	state.activeProject?.bookmarks;

function BookmarkMarkers({ zoomLevel }: { zoomLevel: number }) {
	const bookmarks = useProjectStore(selectBookmarks);
	if (!bookmarks?.length) return null;

	return (
		<>
			{bookmarks.map((bookmarkTime, i) => (
				<div
					key={`bookmark-${i}`}
					role="button"
					tabIndex={0}
					aria-label={`Bookmark at ${bookmarkTime.toFixed(1)}s`}
					className="absolute top-0 h-14 w-0.5 !bg-primary cursor-pointer focus:ring-2 focus:ring-primary focus:outline-none"
					style={{
						left: `${bookmarkTime * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel}px`,
					}}
					onClick={(e) => {
						e.stopPropagation();
						usePlaybackStore.getState().seek(bookmarkTime);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							e.stopPropagation();
							usePlaybackStore.getState().seek(bookmarkTime);
						}
					}}
				>
					<div className="absolute top-[-1px] left-[-5px] text-primary">
						<Bookmark className="h-3 w-3 fill-primary" />
					</div>
				</div>
			))}
		</>
	);
}
