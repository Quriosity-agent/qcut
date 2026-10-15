import type {
	ClaudeAudioMixRequest,
	ClaudeAudioMixResponse,
	ClaudeAudioMixSnapshot,
	ClaudeTrackAudioPatch,
} from "../../../../../electron/types/claude-audio-mix-api";
import { debugError } from "@/lib/debug/debug-config";
import {
	MASTER_AUDIO_BUS_ID,
	normalizeProjectAudioMixSettings,
	normalizeTrackAudioSettings,
} from "@/lib/audio/audio-mix-settings";
import { resolveAudioMixRouting } from "@/lib/audio/audio-mix-routing";
import {
	AudioMixBusError,
	createAudioBus,
	mergeTrackAudioPatch,
	removeAudioBus,
	updateAudioBus,
} from "@/lib/audio/audio-mix-patch";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { ProjectAudioMixSettings, TimelineTrack } from "@/types/timeline";
import type { ClaudeTimelineBridgeAPI } from "./claude-timeline-bridge";

/**
 * The mixer over the editor API. Changes go through the same store actions
 * as the track headers and mixer panel, and every answer is the mix read back
 * from the stores, so a caller sees what took effect.
 */

class MixRefusal extends Error {
	constructor(
		readonly reason: NonNullable<ClaudeAudioMixResponse["reason"]>,
		message: string
	) {
		super(message);
	}
}

function refuse(
	reason: NonNullable<ClaudeAudioMixResponse["reason"]>,
	message: string
): never {
	throw new MixRefusal(reason, message);
}

function carriesAudio(track: TimelineTrack): boolean {
	return track.type === "audio" || track.type === "media";
}

function currentMix(): ProjectAudioMixSettings {
	return normalizeProjectAudioMixSettings({
		audioMix: useProjectStore.getState().activeProject?.audioMix,
	});
}

function findTrack(trackId: string): TimelineTrack | undefined {
	return useTimelineStore
		.getState()
		.tracks.find((candidate) => candidate.id === trackId);
}

/** The whole mix as the stores hold it now. */
export function readAudioMixSnapshot({
	projectId,
}: {
	projectId: string;
}): ClaudeAudioMixSnapshot {
	const tracks = useTimelineStore.getState().tracks.filter(carriesAudio);
	const mix = currentMix();
	const routes = new Map(
		resolveAudioMixRouting({ tracks, audioMix: mix }).tracks.map((route) => [
			route.trackId,
			route,
		])
	);
	return {
		projectId,
		master: mix.master,
		buses: mix.buses,
		tracks: tracks.map((track) => {
			const route = routes.get(track.id);
			return {
				trackId: track.id,
				name: track.name,
				type: track.type,
				muted: track.muted === true,
				audio: normalizeTrackAudioSettings({ audio: track.audio }),
				effective: {
					silenced: route?.silenced ?? false,
					busId: route?.busId ?? MASTER_AUDIO_BUS_ID,
				},
			};
		}),
	};
}

function assertTrackPatchApplies({
	track,
	patch,
}: {
	track: TimelineTrack;
	patch: ClaudeTrackAudioPatch;
}) {
	if (!carriesAudio(track)) {
		refuse(
			"invalid",
			`Track "${track.name}" is a ${track.type} track and carries no audio`
		);
	}
	const mix = currentMix();
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

function setTrack({
	trackId,
	patch,
}: {
	trackId: string;
	patch: ClaudeTrackAudioPatch;
}) {
	const track = findTrack(trackId);
	if (!track) refuse("not-found", `Track ${trackId} is not on the timeline`);
	assertTrackPatchApplies({ track, patch });

	const { muted, ...audioPatch } = patch;
	const store = useTimelineStore.getState();
	if (Object.keys(audioPatch).length > 0) {
		store.updateTrackAudio(
			trackId,
			mergeTrackAudioPatch({
				settings: normalizeTrackAudioSettings({ audio: track.audio }),
				patch: audioPatch,
			})
		);
	}
	if (muted !== undefined && (track.muted === true) !== muted) {
		store.toggleTrackMute(trackId);
	}

	const after = findTrack(trackId);
	const settings = normalizeTrackAudioSettings({ audio: after?.audio });
	const applied =
		(patch.gainDb === undefined || settings.gainDb === patch.gainDb) &&
		(patch.pan === undefined || settings.pan === patch.pan) &&
		(patch.busId === undefined || settings.busId === patch.busId) &&
		(patch.solo === undefined || settings.solo === patch.solo) &&
		(muted === undefined || (after?.muted === true) === muted);
	if (!applied) refuse("invalid", "The editor did not apply the change");
}

async function saveMix(audioMix: ProjectAudioMixSettings) {
	await useProjectStore.getState().updateProjectAudioMix(audioMix);
}

async function applyAudioMixOperation(
	request: ClaudeAudioMixRequest
): Promise<ClaudeAudioMixResponse> {
	if (useProjectStore.getState().loadedProjectId !== request.projectId) {
		refuse(
			"not-open",
			`Project ${request.projectId} is not open in the editor; open it first (qcut editor navigator open --project-id ${request.projectId})`
		);
	}
	const answer = (fields: Partial<ClaudeAudioMixResponse> = {}) => ({
		success: true,
		...fields,
		mix: readAudioMixSnapshot({ projectId: request.projectId }),
	});

	switch (request.action) {
		case "get":
			return answer();
		case "set-track":
			setTrack({ trackId: request.trackId, patch: request.patch });
			return answer();
		case "create-bus": {
			const { audioMix, bus } = createAudioBus({
				audioMix: currentMix(),
				id: request.busId,
				patch: request.bus,
			});
			await saveMix(audioMix);
			if (!currentMix().buses.some((candidate) => candidate.id === bus.id)) {
				refuse("invalid", "The editor did not keep the new bus");
			}
			return answer({ busId: bus.id });
		}
		case "update-bus":
			await saveMix(
				updateAudioBus({
					audioMix: currentMix(),
					busId: request.busId,
					patch: request.patch,
				})
			);
			return answer();
		case "remove-bus": {
			const audioMix = removeAudioBus({
				audioMix: currentMix(),
				busId: request.busId,
			});
			const store = useTimelineStore.getState();
			const routed = store.tracks.filter(
				(track) =>
					carriesAudio(track) &&
					normalizeTrackAudioSettings({ audio: track.audio }).busId ===
						request.busId
			);
			if (routed.length > 0) {
				store.pushHistory();
				for (const track of routed) {
					store.updateTrackAudio(
						track.id,
						{ busId: MASTER_AUDIO_BUS_ID },
						false
					);
				}
			}
			await saveMix(audioMix);
			return answer({ reroutedTrackIds: routed.map((track) => track.id) });
		}
	}
}

export function setupAudioMixHandlers({
	claudeAPI,
}: {
	claudeAPI: ClaudeTimelineBridgeAPI;
}): void {
	const { onAudioMixOperation, sendAudioMixOperationResponse } = claudeAPI;
	if (!onAudioMixOperation || !sendAudioMixOperationResponse) return;

	onAudioMixOperation.call(claudeAPI, async (data) => {
		const respond = (response: ClaudeAudioMixResponse) =>
			sendAudioMixOperationResponse.call(claudeAPI, data.requestId, response);
		try {
			respond(
				await applyAudioMixOperation(data.request as ClaudeAudioMixRequest)
			);
		} catch (error) {
			if (error instanceof MixRefusal || error instanceof AudioMixBusError) {
				respond({
					success: false,
					reason: error.reason,
					error: error.message,
				});
				return;
			}
			debugError("[ClaudeAudioMixBridge] Mixer operation failed:", error);
			respond({
				success: false,
				error: error instanceof Error ? error.message : "Mixer change failed",
			});
		}
	});
}
