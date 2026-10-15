import type { SelectedElement } from "./types";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import { getTimelineElementDuration } from "@/lib/timeline";
import { findOccupyingElement } from "@/lib/timeline-occupancy";

export function groupTimelineElements({
	tracks,
	selectedElements,
	groupId,
}: {
	tracks: TimelineTrack[];
	selectedElements: SelectedElement[];
	groupId: string;
}): { tracks: TimelineTrack[]; groupedCount: number } {
	const selected = new Set(
		selectedElements.map(({ trackId, elementId }) => `${trackId}:${elementId}`)
	);
	let groupedCount = 0;
	const nextTracks = tracks.map((track) => {
		let changed = false;
		const elements = track.elements.map((element) => {
			if (!selected.has(`${track.id}:${element.id}`)) return element;
			changed = true;
			groupedCount += 1;
			return { ...element, groupId };
		});
		return changed ? { ...track, elements } : track;
	});
	return { tracks: nextTracks, groupedCount };
}

export function ungroupTimelineElements({
	tracks,
	groupId,
}: {
	tracks: TimelineTrack[];
	groupId: string;
}): { tracks: TimelineTrack[]; ungroupedCount: number } {
	let ungroupedCount = 0;
	const nextTracks = tracks.map((track) => {
		let changed = false;
		const elements = track.elements.map((element) => {
			if (element.groupId !== groupId) return element;
			changed = true;
			ungroupedCount += 1;
			const { groupId: _groupId, ...ungrouped } = element;
			return ungrouped;
		});
		return changed ? { ...track, elements } : track;
	});
	return { tracks: nextTracks, ungroupedCount };
}

/**
 * A groupId shared by exactly one media clip and its detached audio twin is
 * a timing link, not a user group: deleting the video must not take the
 * separated audio with it (QTL-008). Everything else deletes as a group.
 */
export function isSeparatedAudioPairGroup({
	tracks,
	groupId,
}: {
	tracks: TimelineTrack[];
	groupId: string;
}): boolean {
	const members: Array<{ element: TimelineElement; trackType: string }> = [];
	for (const track of tracks) {
		for (const element of track.elements) {
			if (element.groupId === groupId) {
				members.push({ element, trackType: track.type });
			}
		}
	}
	if (members.length !== 2) return false;
	const [first, second] = members;
	return (
		first.element.type === "media" &&
		second.element.type === "media" &&
		first.element.mediaId === second.element.mediaId &&
		(first.trackType === "audio") !== (second.trackType === "audio")
	);
}

function collidesOnTrack({
	track,
	movedElements,
	excludeIds,
	fps,
}: {
	track: TimelineTrack;
	movedElements: readonly TimelineElement[];
	excludeIds: ReadonlySet<string>;
	fps?: number;
}): boolean {
	const others = {
		...track,
		elements: track.elements.filter((element) => !excludeIds.has(element.id)),
	};
	return movedElements.some(
		(element) =>
			findOccupyingElement({
				track: others,
				startTime: element.startTime,
				duration: getTimelineElementDuration({ element, fps }),
				fps,
			}) !== null
	);
}

/**
 * Move an element (and its whole group) to a new start time. Returns the
 * unchanged input array when the move would create a same-track overlap
 * (QTL-002) — callers detect the rejection by reference equality.
 */
export function moveTimelineElementGroup({
	tracks,
	trackId,
	elementId,
	startTime,
	fps,
}: {
	tracks: TimelineTrack[];
	trackId: string;
	elementId: string;
	startTime: number;
	fps?: number;
}): TimelineTrack[] {
	const target = tracks
		.find((track) => track.id === trackId)
		?.elements.find((element) => element.id === elementId);
	if (!target) return tracks;
	if (!target.groupId) {
		const nextTracks = tracks.map((track) =>
			track.id === trackId
				? {
						...track,
						elements: track.elements.map((element) =>
							element.id === elementId
								? { ...element, startTime: Math.max(0, startTime) }
								: element
						),
					}
				: track
		);
		const movedTrack = nextTracks.find((track) => track.id === trackId);
		const movedElement = movedTrack?.elements.find(
			(element) => element.id === elementId
		);
		if (
			movedTrack &&
			movedElement &&
			collidesOnTrack({
				track: movedTrack,
				movedElements: [movedElement],
				excludeIds: new Set([elementId]),
				fps,
			})
		) {
			return tracks;
		}
		return nextTracks;
	}

	const groupElements = tracks.flatMap((track) =>
		track.elements.filter((element) => element.groupId === target.groupId)
	);
	const requestedDelta = startTime - target.startTime;
	const earliestStart = Math.min(
		...groupElements.map((element) => element.startTime)
	);
	const delta = Math.max(requestedDelta, -earliestStart);

	const groupElementIds = new Set(groupElements.map((element) => element.id));
	const nextTracks = tracks.map((track) => {
		let changed = false;
		const elements = track.elements.map((element) => {
			if (element.groupId !== target.groupId) return element;
			changed = true;
			return { ...element, startTime: element.startTime + delta };
		});
		return changed ? { ...track, elements } : track;
	});

	const wouldCollide = nextTracks.some((track) =>
		collidesOnTrack({
			track,
			movedElements: track.elements.filter((element) =>
				groupElementIds.has(element.id)
			),
			excludeIds: groupElementIds,
			fps,
		})
	);
	return wouldCollide ? tracks : nextTracks;
}
