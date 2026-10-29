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
import { measureProjectMixLoudness } from "@/lib/audio/project-mix-loudness";
import { renderProjectMixStems } from "@/lib/audio/project-mix-stems";
import {
	AudioMixActionError,
	carriesAudio,
	createMixBus,
	readProjectAudioMix,
	removeMixBus,
	setTrackMix,
	updateMixBus,
} from "@/stores/audio-mix-actions";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { ProjectAudioMixSettings, TimelineTrack } from "@/types/timeline";
import type { ClaudeTimelineBridgeAPI } from "./claude-timeline-bridge";
import {
	loadStoredProjectView,
	storedProjectNotFound,
} from "./claude-stored-project";

/**
 * The mixer over the editor API: the same actions as the mixer panel and the
 * track headers (stores/audio-mix-actions.ts), and every answer is the mix
 * read back from the stores, so a caller sees what took effect.
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

/** The whole mix as the stores hold it now, or as given (a stored project). */
export function readAudioMixSnapshot({
	projectId,
	tracks: allTracks = useTimelineStore.getState().tracks,
	mix = readProjectAudioMix(),
}: {
	projectId: string;
	tracks?: TimelineTrack[];
	mix?: ProjectAudioMixSettings;
}): ClaudeAudioMixSnapshot {
	const tracks = allTracks.filter(carriesAudio);
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

/**
 * Saves the timeline now rather than on its next autosave: a track's mix
 * lives there, and an answer means the change is stored.
 */
async function saveTrackMix(): Promise<void> {
	if (!(await useTimelineStore.getState().saveImmediate())) {
		throw new Error(
			"The track's mix changed in the editor but could not be saved"
		);
	}
}

/** Fails when the stores do not hold what the change asked for. */
function assertTrackApplied({
	trackId,
	patch,
}: {
	trackId: string;
	patch: ClaudeTrackAudioPatch;
}) {
	const track = useTimelineStore
		.getState()
		.tracks.find((candidate) => candidate.id === trackId);
	const settings = normalizeTrackAudioSettings({ audio: track?.audio });
	const applied =
		(patch.gainDb === undefined || settings.gainDb === patch.gainDb) &&
		(patch.pan === undefined || settings.pan === patch.pan) &&
		(patch.busId === undefined || settings.busId === patch.busId) &&
		(patch.solo === undefined || settings.solo === patch.solo) &&
		(patch.muted === undefined || (track?.muted === true) === patch.muted);
	if (!applied) refuse("invalid", "The editor did not apply the change");
}

async function applyAudioMixOperation(
	request: ClaudeAudioMixRequest
): Promise<ClaudeAudioMixResponse> {
	if (useProjectStore.getState().loadedProjectId !== request.projectId) {
		// Reading a project does not need it open: storage has its mix (N23).
		if (request.action === "get") {
			const stored = await loadStoredProjectView({
				projectId: request.projectId,
			});
			if (!stored) throw storedProjectNotFound(request.projectId);
			return {
				success: true,
				mix: readAudioMixSnapshot({
					projectId: request.projectId,
					tracks: stored.tracks,
					mix: normalizeProjectAudioMixSettings({
						audioMix: stored.project.audioMix,
					}),
				}),
			};
		}
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
			setTrackMix({ trackId: request.trackId, patch: request.patch });
			assertTrackApplied({ trackId: request.trackId, patch: request.patch });
			await saveTrackMix();
			return answer();
		case "create-bus": {
			const bus = await createMixBus({
				id: request.busId,
				patch: request.bus,
			});
			if (!readProjectAudioMix().buses.some((kept) => kept.id === bus.id)) {
				refuse("invalid", "The editor did not keep the new bus");
			}
			return answer({ busId: bus.id });
		}
		case "update-bus":
			await updateMixBus({ busId: request.busId, patch: request.patch });
			return answer();
		case "remove-bus": {
			const reroutedTrackIds = await removeMixBus({ busId: request.busId });
			if (reroutedTrackIds.length > 0) await saveTrackMix();
			return answer({ reroutedTrackIds });
		}
		case "render-stems":
			return {
				success: true,
				stems: await renderProjectMixStems({
					outputDir: request.outputDir,
					fileNamePrefix: request.fileNamePrefix,
				}),
			};
		case "measure-loudness": {
			const loudness = await measureProjectMixLoudness();
			if (!loudness) refuse("invalid", "The timeline has no audio to measure");
			return { success: true, loudness };
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
			if (error instanceof MixRefusal || error instanceof AudioMixActionError) {
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
