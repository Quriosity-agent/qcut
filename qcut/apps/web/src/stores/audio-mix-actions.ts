import {
	MASTER_AUDIO_BUS_ID,
	normalizeProjectAudioMixSettings,
	normalizeTrackAudioSettings,
} from "@/lib/audio/audio-mix-settings";
import {
	type AudioBusPatch,
	AudioMixBusError,
	type TrackAudioPatch,
	createAudioBus,
	mergeTrackAudioPatch,
	removeAudioBus,
	updateAudioBus,
} from "@/lib/audio/audio-mix-patch";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type {
	AudioMixBusSettings,
	ProjectAudioMixSettings,
	TimelineTrack,
} from "@/types/timeline";

/**
 * Every mixer change, for the mixer panel, the track headers and the editor
 * API alike: one implementation with the same checks, history and saving.
 *
 * A fader drag marks one undo point when it starts (`markTrackMixUndoPoint`)
 * and then changes a track with `history: false` on every move. Bus and
 * master moves pass `save: false`, which changes what plays without saving,
 * and the drag's last move saves.
 */

export { AudioMixBusError as AudioMixActionError };

function refuse(reason: "not-found" | "invalid", message: string): never {
	throw new AudioMixBusError(reason, message);
}

export function carriesAudio(track: TimelineTrack): boolean {
	return track.type === "audio" || track.type === "media";
}

export function readProjectAudioMix(): ProjectAudioMixSettings {
	return normalizeProjectAudioMixSettings({
		audioMix: useProjectStore.getState().activeProject?.audioMix,
	});
}

function findTrack(trackId: string): TimelineTrack | undefined {
	return useTimelineStore
		.getState()
		.tracks.find((candidate) => candidate.id === trackId);
}

function assertTrackPatch({
	track,
	patch,
}: {
	track: TimelineTrack;
	patch: TrackAudioPatch;
}) {
	if (!carriesAudio(track)) {
		refuse(
			"invalid",
			`Track "${track.name}" is a ${track.type} track and carries no audio`
		);
	}
	const mix = readProjectAudioMix();
	if (
		patch.busId !== undefined &&
		patch.busId !== MASTER_AUDIO_BUS_ID &&
		!mix.buses.some((bus) => bus.id === patch.busId)
	) {
		refuse(
			"not-found",
			`No bus "${patch.busId}"; buses: ${[MASTER_AUDIO_BUS_ID, ...mix.buses.map((bus) => bus.id)].join(", ")}`
		);
	}
	for (const sourceTrackId of patch.ducking?.sourceTrackIds ?? []) {
		if (sourceTrackId === track.id) {
			refuse("invalid", "A track cannot duck under itself");
		}
		const source = findTrack(sourceTrackId);
		if (!source || !carriesAudio(source)) {
			refuse(
				"not-found",
				`Ducking source ${sourceTrackId} is not an audio track on the timeline`
			);
		}
	}
}

/** One undo step for the track changes that follow (a fader drag). */
export function markTrackMixUndoPoint(): void {
	useTimelineStore.getState().pushHistory();
}

/** Changes a track's mixer settings and, with `muted`, its mute. */
export function setTrackMix({
	trackId,
	patch,
	history = true,
}: {
	trackId: string;
	patch: TrackAudioPatch & { muted?: boolean };
	history?: boolean;
}): void {
	const track = findTrack(trackId);
	if (!track) refuse("not-found", `Track ${trackId} is not on the timeline`);
	const { muted, ...audioPatch } = patch;
	assertTrackPatch({ track, patch: audioPatch });

	const store = useTimelineStore.getState();
	if (Object.keys(audioPatch).length > 0) {
		store.updateTrackAudio(
			trackId,
			mergeTrackAudioPatch({
				settings: normalizeTrackAudioSettings({ audio: track.audio }),
				patch: audioPatch,
			}),
			history
		);
	}
	if (muted !== undefined && (track.muted === true) !== muted) {
		store.toggleTrackMute(trackId);
	}
}

/** Replaces the project's mix, saving it unless `save` is false. */
async function applyMix({
	audioMix,
	save,
}: {
	audioMix: ProjectAudioMixSettings;
	save: boolean;
}) {
	const projectStore = useProjectStore.getState();
	if (save) {
		await projectStore.updateProjectAudioMix(audioMix);
		return;
	}
	const project = projectStore.activeProject;
	if (!project) return;
	useProjectStore.setState({
		activeProject: {
			...project,
			audioMix: normalizeProjectAudioMixSettings({ audioMix }),
		},
	});
}

export async function createMixBus({
	id,
	patch,
}: {
	id?: string;
	patch: AudioBusPatch & { name: string };
}): Promise<AudioMixBusSettings> {
	const { audioMix, bus } = createAudioBus({
		audioMix: readProjectAudioMix(),
		id,
		patch,
	});
	await applyMix({ audioMix, save: true });
	return bus;
}

/** Changes a bus, or the master when `busId` is "master". */
export async function updateMixBus({
	busId,
	patch,
	save = true,
}: {
	busId: string;
	patch: AudioBusPatch;
	save?: boolean;
}): Promise<void> {
	await applyMix({
		audioMix: updateAudioBus({ audioMix: readProjectAudioMix(), busId, patch }),
		save,
	});
}

/** Removes a bus and sends its tracks back to the master; returns them. */
export async function removeMixBus({
	busId,
}: {
	busId: string;
}): Promise<string[]> {
	const audioMix = removeAudioBus({ audioMix: readProjectAudioMix(), busId });
	const store = useTimelineStore.getState();
	const routed = store.tracks.filter(
		(track) =>
			carriesAudio(track) &&
			normalizeTrackAudioSettings({ audio: track.audio }).busId === busId
	);
	if (routed.length > 0) {
		store.pushHistory();
		for (const track of routed) {
			store.updateTrackAudio(track.id, { busId: MASTER_AUDIO_BUS_ID }, false);
		}
	}
	await applyMix({ audioMix, save: true });
	return routed.map((track) => track.id);
}
