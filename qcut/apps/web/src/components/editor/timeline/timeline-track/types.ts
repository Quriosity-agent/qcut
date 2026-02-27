import type { TimelineElement, TimelineTrack } from "@/types/timeline";

export interface TimelineTrackContentProps {
	track: TimelineTrack;
	zoomLevel: number;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

export interface SnapPoint {
	time: number;
	type: string;
	distance: number;
}

export interface MouseDownLocation {
	x: number;
	y: number;
}

export interface DropPosition {
	position: "above" | "on" | "below";
	time: number;
}