/**
 * Opening empty time in the timeline (`editor editing insert-gap`).
 *
 * `deleteTimeRange` closes a span; there was no way to open one. Making room
 * for a title sequence at the head of a 182-clip timeline meant exporting
 * the timeline, adding five seconds to every clip in a script and applying
 * the whole thing back.
 *
 * @module stores/timeline/timeline-gap-ops
 */

import {
	openGapInAutomation,
	rippleAutomation,
} from "@/lib/audio/audio-mix-automation";
import { useProjectStore } from "@/stores/project-store";
import type { AudioMixAutomation, TimelineTrack } from "@/types/timeline";
import { openGapInElements } from "./timeline-collision-utils";
import type {
	OperationDeps,
	StoreGet,
	StoreSet,
} from "./timeline-store-operations";

export interface InsertTimeGapRequest {
	/** Where the empty time starts, in timeline seconds. */
	time: number;
	/** How long it is, in seconds. */
	duration: number;
	/** Tracks to open it on; every unlocked track when left out. */
	trackIds?: string[];
	/** Leave level and pan automation where it is. */
	keepAutomation?: boolean;
}

export type InsertTimeGapResult =
	| {
			ok: true;
			time: number;
			duration: number;
			trackIds: string[];
			movedElements: number;
			splitElements: number;
			/** Bus and master curves moved too (every unlocked track did). */
			mixAutomationMoved: boolean;
	  }
	| { ok: false; error: string };

/**
 * The tracks with `duration` seconds opened at `time` on the target tracks:
 * clips from there on move later, a clip spanning the point is split, and
 * each track's own automation opens with its clips.
 */
export function applyInsertGapToTracks({
	tracks,
	time,
	duration,
	targetTrackIds,
	fps,
	keepAutomation = false,
}: {
	tracks: TimelineTrack[];
	time: number;
	duration: number;
	targetTrackIds: ReadonlySet<string>;
	fps: number;
	keepAutomation?: boolean;
}): { tracks: TimelineTrack[]; movedElements: number; splitElements: number } {
	let movedElements = 0;
	let splitElements = 0;
	const opened = tracks.map((track) => {
		if (!targetTrackIds.has(track.id)) return track;
		const result = openGapInElements({
			elements: track.elements,
			time,
			duration,
			fps,
		});
		movedElements += result.movedElements;
		splitElements += result.splitElements;
		const automation =
			!keepAutomation && track.audio?.automation
				? openGapInAutomation({
						automation: track.audio.automation,
						time,
						duration,
					})
				: track.audio?.automation;
		const audio =
			track.audio && automation !== track.audio.automation
				? { ...track.audio, automation }
				: track.audio;
		return {
			...track,
			elements: result.elements,
			...(audio ? { audio } : {}),
		};
	});
	return { tracks: opened, movedElements, splitElements };
}

/** The project's bus and master automation, changed by `change`. */
function changeProjectMixAutomation({
	change,
}: {
	change: (
		automation: AudioMixAutomation | undefined
	) => AudioMixAutomation | undefined;
}): boolean {
	const projectStore = useProjectStore.getState();
	const audioMix = projectStore.activeProject?.audioMix;
	if (!audioMix) return false;
	const apply = <T extends { automation?: AudioMixAutomation }>(bus: T): T => {
		const automation = change(bus.automation);
		return automation === bus.automation ? bus : { ...bus, automation };
	};
	const master = apply(audioMix.master);
	const buses = audioMix.buses.map(apply);
	if (
		master === audioMix.master &&
		buses.every((bus, index) => bus === audioMix.buses[index])
	) {
		return false;
	}
	void projectStore.updateProjectAudioMix({ ...audioMix, master, buses });
	return true;
}

/** Moves the project's bus and master automation up by a removed span. */
export function rippleProjectMixAutomation({
	startTime,
	endTime,
}: {
	startTime: number;
	endTime: number;
}): void {
	changeProjectMixAutomation({
		change: (automation) =>
			rippleAutomation({ automation, startTime, endTime }),
	});
}

export function createGapOps(
	get: StoreGet,
	_set: StoreSet,
	deps: OperationDeps
) {
	const { getProjectFps, updateTracksAndSave } = deps;

	return {
		insertTimeGap: ({
			time,
			duration,
			trackIds,
			keepAutomation = false,
		}: InsertTimeGapRequest): InsertTimeGapResult => {
			if (!Number.isFinite(time) || time < 0) {
				return { ok: false, error: "time must be 0 seconds or more" };
			}
			if (!Number.isFinite(duration) || duration <= 0) {
				return { ok: false, error: "duration must be above 0 seconds" };
			}
			const { _tracks } = get();
			// Named tracks fail closed on a missing or locked one; the default
			// is every unlocked track, as a delete of all tracks takes them.
			const named = trackIds && trackIds.length > 0 ? trackIds : undefined;
			if (named) {
				for (const trackId of named) {
					const track = _tracks.find((candidate) => candidate.id === trackId);
					if (!track)
						return { ok: false, error: `Track not found: ${trackId}` };
					if (track.locked) {
						return {
							ok: false,
							error: `Track ${trackId} (${track.name}) is locked`,
						};
					}
				}
			}
			const targetTrackIds = new Set(
				named ??
					_tracks.filter((track) => !track.locked).map((track) => track.id)
			);

			get().pushHistory();
			const result = applyInsertGapToTracks({
				tracks: _tracks,
				time,
				duration,
				targetTrackIds,
				fps: getProjectFps(),
				keepAutomation,
			});
			updateTracksAndSave(result.tracks);
			// Bus and master curves belong to the whole programme, so they
			// follow only when every unlocked track moved. They live in the
			// project, outside the timeline's undo history.
			const wholeTimelineMoved = _tracks.every(
				(track) => track.locked || targetTrackIds.has(track.id)
			);
			const mixAutomationMoved =
				wholeTimelineMoved && !keepAutomation
					? changeProjectMixAutomation({
							change: (automation) =>
								openGapInAutomation({ automation, time, duration }),
						})
					: false;

			return {
				ok: true,
				time,
				duration,
				trackIds: [...targetTrackIds],
				movedElements: result.movedElements,
				splitElements: result.splitElements,
				mixAutomationMoved,
			};
		},
	};
}
