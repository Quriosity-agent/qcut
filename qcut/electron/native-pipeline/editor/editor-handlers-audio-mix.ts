/**
 * Mixer commands:
 *
 * - `editor:track:audio-get|audio-set|mute|solo` read or change one audio
 *   track's mixer settings;
 * - `editor:mix:export|bus-list|bus-create|bus-set|bus-remove|master-set`
 *   read the whole mix or change its buses and master.
 *
 * The editor checks every value and answers with what it now holds, which is
 * what these commands print.
 *
 * @module electron/native-pipeline/editor/editor-handlers-audio-mix
 */

import type {
	ClaudeAudioMixBus,
	ClaudeAudioMixSnapshot,
	ClaudeTrackAudioMix,
} from "../../types/claude-audio-mix-api.js";
import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";
import { resolveJsonInput } from "./editor-api-types.js";

export const TRACK_AUDIO_ACTIONS = new Set([
	"audio-get",
	"audio-set",
	"mute",
	"solo",
]);

class FlagError extends Error {}

function readNumberFlag(
	value: number | undefined,
	flag: string
): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isFinite(value)) throw new FlagError(`${flag} must be a number`);
	return value;
}

async function readJsonFlag(
	value: string | undefined,
	flag: string
): Promise<unknown> {
	if (value === undefined) return undefined;
	try {
		return await resolveJsonInput(value.trim());
	} catch (error) {
		throw new FlagError(
			`${flag}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/** Only the fields that were given. */
function given(fields: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value !== undefined)
	);
}

function mixPath(projectId: string): string {
	return `/api/claude/mix/${encodeURIComponent(projectId)}`;
}

async function readTrack({
	client,
	projectId,
	trackId,
}: {
	client: EditorApiClient;
	projectId: string;
	trackId: string;
}): Promise<ClaudeTrackAudioMix> {
	const mix = await client.get<ClaudeAudioMixSnapshot>(mixPath(projectId));
	const track = mix.tracks.find((candidate) => candidate.trackId === trackId);
	if (!track) {
		throw new FlagError(
			`Track ${trackId} is not an audio track on the timeline; audio tracks: ${mix.tracks.map((candidate) => `${candidate.trackId} (${candidate.name})`).join(", ") || "none"}`
		);
	}
	return track;
}

async function setTrack({
	client,
	projectId,
	trackId,
	body,
}: {
	client: EditorApiClient;
	projectId: string;
	trackId: string;
	body: Record<string, unknown>;
}): Promise<CLIResult> {
	const { track } = await client.patch<{ track: ClaudeTrackAudioMix }>(
		`${mixPath(projectId)}/tracks/${encodeURIComponent(trackId)}`,
		body
	);
	return { success: true, data: { projectId, track } };
}

/** Handle `editor:track:audio-get|audio-set|mute|solo`. */
export async function handleTrackAudioCommand({
	client,
	action,
	projectId,
	opts,
}: {
	client: EditorApiClient;
	action: string;
	projectId: string;
	opts: CLIRunOptions;
}): Promise<CLIResult> {
	if (!opts.trackId) return { success: false, error: "Missing --track-id" };
	const trackId = opts.trackId;
	try {
		switch (action) {
			case "audio-get":
				return {
					success: true,
					data: {
						projectId,
						track: await readTrack({ client, projectId, trackId }),
					},
				};
			case "audio-set": {
				const body = given({
					gainDb: readNumberFlag(opts.gainDb, "--gain-db"),
					pan: readNumberFlag(opts.pan, "--pan"),
					busId: opts.bus?.trim(),
					ducking: await readJsonFlag(opts.ducking, "--ducking"),
					effects: await readJsonFlag(opts.effects, "--effects"),
				});
				if (Object.keys(body).length === 0) {
					return {
						success: false,
						error: "Pass --gain-db, --pan, --bus, --ducking or --effects",
					};
				}
				return await setTrack({ client, projectId, trackId, body });
			}
			case "mute":
				return await setTrack({
					client,
					projectId,
					trackId,
					body: { muted: opts.off !== true },
				});
			case "solo":
				return await setTrack({
					client,
					projectId,
					trackId,
					body: { solo: opts.off !== true },
				});
			default:
				return { success: false, error: `Unknown track action: ${action}` };
		}
	} catch (error) {
		if (error instanceof FlagError) {
			return { success: false, error: error.message };
		}
		throw error;
	}
}

function busBody(
	opts: CLIRunOptions,
	effects: unknown
): Record<string, unknown> {
	return given({
		name: opts.trackName?.trim() || opts.name?.trim() || undefined,
		gainDb: readNumberFlag(opts.gainDb, "--gain-db"),
		pan: readNumberFlag(opts.pan, "--pan"),
		muted: opts.mute,
		solo: opts.solo,
		effects,
	});
}

function listBuses(mix: ClaudeAudioMixSnapshot) {
	const feeding = (busId: string) =>
		mix.tracks
			.filter((track) => track.effective.busId === busId)
			.map((track) => ({ trackId: track.trackId, name: track.name }));
	const describe = (bus: ClaudeAudioMixBus) => ({
		...bus,
		tracks: feeding(bus.id),
	});
	return {
		projectId: mix.projectId,
		master: describe(mix.master),
		buses: mix.buses.map(describe),
	};
}

/** Handle `editor:mix:*`. */
export async function handleAudioMixCommand({
	client,
	projectId,
	opts,
}: {
	client: EditorApiClient;
	projectId: string;
	opts: CLIRunOptions;
}): Promise<CLIResult> {
	const action = opts.command.split(":").slice(2).join(":");
	const path = mixPath(projectId);
	try {
		switch (action) {
			case "export":
				return {
					success: true,
					data: await client.get<ClaudeAudioMixSnapshot>(path),
				};
			case "bus-list":
				return {
					success: true,
					data: listBuses(await client.get<ClaudeAudioMixSnapshot>(path)),
				};
			case "bus-create": {
				const body = busBody(
					opts,
					await readJsonFlag(opts.effects, "--effects")
				);
				if (!body.name) return { success: false, error: "Missing --name" };
				const created = await client.post<{
					busId: string;
					bus: ClaudeAudioMixBus;
				}>(`${path}/buses`, {
					...body,
					...(opts.busId ? { id: opts.busId.trim() } : {}),
				});
				return {
					success: true,
					data: { projectId, busId: created.busId, bus: created.bus },
				};
			}
			case "bus-set":
			case "master-set": {
				const busId = action === "master-set" ? "master" : opts.busId?.trim();
				if (!busId) return { success: false, error: "Missing --bus-id" };
				const body = busBody(
					opts,
					await readJsonFlag(opts.effects, "--effects")
				);
				if (Object.keys(body).length === 0) {
					return {
						success: false,
						error:
							action === "master-set"
								? "Pass --gain-db, --pan, --mute/--no-mute or --effects"
								: "Pass --name, --gain-db, --pan, --mute/--no-mute, --solo/--no-solo or --effects",
					};
				}
				const { bus } = await client.patch<{ bus: ClaudeAudioMixBus }>(
					`${path}/buses/${encodeURIComponent(busId)}`,
					body
				);
				return { success: true, data: { projectId, bus } };
			}
			case "bus-remove": {
				const busId = opts.busId?.trim();
				if (!busId) return { success: false, error: "Missing --bus-id" };
				const removed = await client.delete<{
					removed: string;
					reroutedTrackIds: string[];
				}>(`${path}/buses/${encodeURIComponent(busId)}`);
				return {
					success: true,
					data: {
						projectId,
						removed: removed.removed,
						reroutedTrackIds: removed.reroutedTrackIds,
					},
				};
			}
			default:
				return {
					success: false,
					error: `Unknown mix action: ${action}. Available: export, bus-list, bus-create, bus-set, bus-remove, master-set`,
				};
		}
	} catch (error) {
		if (error instanceof FlagError) {
			return { success: false, error: error.message };
		}
		throw error;
	}
}
