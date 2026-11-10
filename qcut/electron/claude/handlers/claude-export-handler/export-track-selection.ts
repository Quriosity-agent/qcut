/**
 * Tracks an export leaves out (`export start --exclude-tracks`).
 *
 * A clean plate without the titles used to mean hiding tracks in the
 * project, exporting, and showing them again. The export now takes the list
 * itself and reads the timeline as if each named track were hidden and
 * muted; the project is not touched.
 *
 * @module electron/claude/handlers/claude-export-handler/export-track-selection
 */

import type { ClaudeTimeline } from "../../../types/claude-api";

/** The request's track ids: an array or a comma-separated string of them. */
export function readExcludedTrackIds({ value }: { value: unknown }): string[] {
	const ids =
		typeof value === "string"
			? value.split(",")
			: Array.isArray(value)
				? value
				: null;
	if (!ids || ids.some((id) => typeof id !== "string")) {
		throw new Error(
			"excludeTracks must be a list of track ids (see editor:track:list)"
		);
	}
	return [...new Set(ids.map((id: string) => id.trim()).filter(Boolean))];
}

/**
 * `timeline` without the named tracks: what is left to draw, which is what
 * decides the engine. (A hidden track still counts there; an excluded one is
 * not part of this export at all.)
 */
export function timelineWithoutTracks({
	timeline,
	trackIds,
}: {
	timeline: ClaudeTimeline;
	trackIds: string[];
}): ClaudeTimeline {
	if (trackIds.length === 0) return timeline;
	const excluded = new Set(trackIds);
	return {
		...timeline,
		tracks: timeline.tracks.filter(
			(track) => track.id === undefined || !excluded.has(track.id)
		),
	};
}

/**
 * `timeline` with the named tracks hidden and muted. A track id the timeline
 * does not have is refused, naming the tracks it does have.
 */
export function excludeTimelineTracks({
	timeline,
	trackIds,
}: {
	timeline: ClaudeTimeline;
	trackIds: string[];
}): ClaudeTimeline {
	if (trackIds.length === 0) return timeline;
	const unknown = trackIds.filter(
		(id) => !timeline.tracks.some((track) => track.id === id)
	);
	if (unknown.length > 0) {
		const known = timeline.tracks
			.map((track) => `${track.id} (${track.name})`)
			.join(", ");
		throw new Error(
			`No such track to exclude: ${unknown.join(", ")}. The timeline has: ${known}`
		);
	}
	const excluded = new Set(trackIds);
	return {
		...timeline,
		tracks: timeline.tracks.map((track) =>
			track.id !== undefined && excluded.has(track.id)
				? { ...track, hidden: true, muted: true }
				: track
		),
	};
}
