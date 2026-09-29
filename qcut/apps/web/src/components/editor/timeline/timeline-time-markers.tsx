import type { RefObject } from "react";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { useTimelineViewport } from "@/hooks/timeline/use-timeline-viewport";

function getTimeInterval({
	zoom,
	duration,
}: {
	zoom: number;
	duration: number;
}) {
	const pixelsPerSecond = TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoom;
	if (duration <= 5) {
		if (pixelsPerSecond >= 100) return 0.1;
		if (pixelsPerSecond >= 50) return 0.25;
		return 0.5;
	}
	if (pixelsPerSecond >= 200) return 0.1;
	if (pixelsPerSecond >= 100) return 0.5;
	if (pixelsPerSecond >= 50) return 1;
	if (pixelsPerSecond >= 25) return 2;
	if (pixelsPerSecond >= 12) return 5;
	if (pixelsPerSecond >= 6) return 10;
	return 30;
}

function formatTime({
	seconds,
	interval,
}: {
	seconds: number;
	interval: number;
}) {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${Math.floor(secs).toString().padStart(2, "0")}`;
	}
	if (minutes > 0)
		return `${minutes}:${Math.floor(secs).toString().padStart(2, "0")}`;
	if (interval >= 1) return `${Math.floor(secs)}s`;
	return `${secs.toFixed(interval === 0.25 || interval < 0.1 ? 2 : 1)}s`;
}

export function getVisibleTimeMarkers({
	duration,
	zoomLevel,
	scrollLeft,
	width,
}: {
	duration: number;
	zoomLevel: number;
	scrollLeft: number;
	width: number;
}) {
	if (
		![duration, zoomLevel, scrollLeft, width].every(Number.isFinite) ||
		duration < 0 ||
		zoomLevel <= 0 ||
		width <= 0
	)
		return [];
	const pixelsPerSecond = TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
	const interval = getTimeInterval({ zoom: zoomLevel, duration });
	const stride = interval * pixelsPerSecond;
	const overscan = 100;
	const first = Math.max(0, Math.floor((scrollLeft - overscan) / stride));
	const last = Math.min(
		Math.floor(duration / interval + 1e-6),
		Math.ceil((scrollLeft + width + overscan) / stride)
	);
	return Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => {
		const index = first + offset;
		const time = index * interval;
		return {
			index,
			time,
			left: time * pixelsPerSecond,
			label: formatTime({ seconds: time, interval }),
			main: interval >= 1 || Math.abs(time - Math.round(time)) < 1e-7,
		};
	});
}

export function TimelineTimeMarkers({
	duration,
	zoomLevel,
	scrollContainerRef,
}: {
	duration: number;
	zoomLevel: number;
	scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
	const viewport = useTimelineViewport({ scrollContainerRef });
	const markers = getVisibleTimeMarkers({ duration, zoomLevel, ...viewport });
	return (
		<>
			{markers.map((marker) => (
				<div
					key={marker.index}
					data-timeline-marker={marker.time}
					className={`absolute top-0 h-4 ${marker.main ? "border-l border-muted-foreground/40" : "border-l border-muted-foreground/20"}`}
					style={{ left: `${marker.left}px` }}
				>
					<span
						className={`absolute top-1 left-1 text-[0.6rem] ${marker.main ? "text-muted-foreground font-medium" : "text-muted-foreground/70"}`}
					>
						{marker.label}
					</span>
				</div>
			))}
		</>
	);
}
