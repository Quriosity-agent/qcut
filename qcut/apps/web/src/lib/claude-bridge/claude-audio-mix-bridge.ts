import type {
	ClaudeAudioMixRequest,
	ClaudeAudioMixResponse,
	ClaudeAudioMixSnapshot,
	ClaudeTrackAudioPatch,
} from "../../../../../electron/types/claude-audio-mix-api";
import { debugError } from "@/lib/debug/debug-config";
import {
	MASTER_AUDIO_BUS_ID,
	normalizeTrackAudioSettings,
} from "@/lib/audio/audio-mix-settings";
import { resolveAudioMixRouting } from "@/lib/audio/audio-mix-routing";
import { measureProjectMixLoudness } from "@/lib/audio/project-mix-loudness";
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
import type { ClaudeTimelineBridgeAPI } from "./claude-timeline-bridge";

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

/** The whole mix as the stores hold it now. */
export function readAudioMixSnapshot({
	projectId,
}: {
	projectId: string;
}): ClaudeAudioMixSnapshot {
	const tracks = useTimelineStore.getState().tracks.filter(carriesAudio);
	const mix = readProjectAudioMix();
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
		case "remove-bus":
			return answer({
				reroutedTrackIds: await removeMixBus({ busId: request.busId }),
			});
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
