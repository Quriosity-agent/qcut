/**
 * Mixer commands:
 *
 * - `editor:track:audio-get|audio-set|mute|solo` read or change one audio
 *   track's mixer settings;
 * - `editor:mix:export|bus-list|bus-create|bus-set|bus-remove|master-set`
 *   read the whole mix or change its buses and master;
 * - `editor:mix:loudness` renders the mix and measures its loudness;
 * - `editor:mix:stems` writes one WAV per bus;
 * - `editor:mix:job-status` follows one of those renders by job id.
 *
 * The renders run as jobs in the editor: the command polls until the job
 * finishes or `--timeout` runs out, or returns the job id with `--no-wait`.
 *
 * The editor checks every value and answers with what it now holds, which is
 * what these commands print.
 *
 * @module electron/native-pipeline/editor/editor-handlers-audio-mix
 */

import * as path from "node:path";
import type {
	ClaudeAudioMixBus,
	ClaudeAudioMixSnapshot,
	ClaudeMixStem,
	ClaudeTrackAudioMix,
} from "../../types/claude-audio-mix-api.js";
import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";
import { resolveJsonInput } from "./editor-api-types.js";

/** Stem rendering runs the whole mix once per bus. */
const DEFAULT_RENDER_WAIT_SECONDS = 1800;

interface MixJob {
	jobId: string;
	status: "running" | "completed" | "failed";
	message?: string;
	error?: string;
	result?: {
		loudness?: Record<string, number>;
		stems?: ClaudeMixStem[];
		outputDir?: string;
	};
}

/**
 * Waits for a mix render job. A poll that runs out of time names the job
 * and the command that keeps following it; the render goes on in the app.
 */
async function waitForMixJob({
	client,
	projectId,
	jobId,
	opts,
	timeoutMs,
}: {
	client: EditorApiClient;
	projectId: string;
	jobId: string;
	opts: Pick<CLIRunOptions, "timeout" | "pollInterval">;
	timeoutMs?: number;
}): Promise<MixJob> {
	const budgetMs =
		timeoutMs ?? (opts.timeout ?? DEFAULT_RENDER_WAIT_SECONDS) * 1000;
	try {
		return await client.pollJob<MixJob>(
			`${mixPath(projectId)}/jobs/${encodeURIComponent(jobId)}`,
			{ interval: (opts.pollInterval ?? 3) * 1000, timeout: budgetMs }
		);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith("Polling timed out")
		) {
			throw new FlagError(
				`Waited ${Math.round(budgetMs / 1000)} s; the render is still running in QCut (jobId=${jobId}). ` +
					`Follow it with: qcut editor mix job-status --project-id ${projectId} --job-id ${jobId}`
			);
		}
		throw error;
	}
}

/**
 * Writes one WAV per bus (and one for tracks feeding the master) into
 * `outputDir`, waiting for the render.
 */
export async function writeMixStems({
	client,
	projectId,
	outputDir,
	fileNamePrefix,
	opts = {},
	timeoutMs,
}: {
	client: EditorApiClient;
	projectId: string;
	outputDir: string;
	fileNamePrefix?: string;
	opts?: Pick<CLIRunOptions, "timeout" | "pollInterval">;
	timeoutMs?: number;
}): Promise<{ jobId: string; outputDir: string; stems: ClaudeMixStem[] }> {
	const started = await client.post<{ jobId: string }>(
		`${mixPath(projectId)}/stems`,
		{
			outputDir: path.resolve(outputDir),
			...(fileNamePrefix ? { fileNamePrefix } : {}),
		}
	);
	const job = await waitForMixJob({
		client,
		projectId,
		jobId: started.jobId,
		opts,
		timeoutMs,
	});
	return {
		jobId: job.jobId,
		outputDir: job.result?.outputDir ?? path.resolve(outputDir),
		stems: job.result?.stems ?? [],
	};
}

/** `editor:export:start --stems` puts them beside the export: `<name>-<bus>.wav`. */
export function stemsBesideExport(outputPath: string): {
	outputDir: string;
	fileNamePrefix: string;
} {
	const parsed = path.parse(outputPath);
	return { outputDir: parsed.dir, fileNamePrefix: `${parsed.name}-` };
}

export const TRACK_AUDIO_ACTIONS = new Set([
	"audio-get",
	"audio-automation",
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

const AUTOMATION_PARAMS = new Set(["gainDb", "pan"]);

/** `--param` with `--points` or `--clear`, as a mixer automation patch. */
async function readAutomationFlags(
	opts: CLIRunOptions
): Promise<{ automation: Record<string, unknown[] | null> }> {
	const param = opts.param?.trim();
	if (!param || !AUTOMATION_PARAMS.has(param)) {
		throw new FlagError("--param must be gainDb or pan");
	}
	if (opts.clear && opts.points !== undefined) {
		throw new FlagError("Give --points or --clear, not both");
	}
	if (!opts.clear && opts.points === undefined) {
		throw new FlagError("Give --points <json|@file> or --clear");
	}
	const points = opts.clear
		? null
		: await readJsonFlag(opts.points, "--points");
	if (points !== null && !Array.isArray(points)) {
		throw new FlagError("--points must be a JSON array of {time, value}");
	}
	return { automation: { [param]: points } };
}

/** Handle `editor:track:audio-get|audio-set|audio-automation|mute|solo`. */
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
			case "audio-automation":
				return await setTrack({
					client,
					projectId,
					trackId,
					body: await readAutomationFlags(opts),
				});
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
	const base = mixPath(projectId);
	try {
		switch (action) {
			case "export":
				return {
					success: true,
					data: await client.get<ClaudeAudioMixSnapshot>(base),
				};
			case "bus-list":
				return {
					success: true,
					data: listBuses(await client.get<ClaudeAudioMixSnapshot>(base)),
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
				}>(`${base}/buses`, {
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
					`${base}/buses/${encodeURIComponent(busId)}`,
					body
				);
				return { success: true, data: { projectId, bus } };
			}
			case "bus-automation": {
				const busId = opts.busId?.trim();
				if (!busId) return { success: false, error: "Missing --bus-id" };
				const { bus } = await client.patch<{ bus: ClaudeAudioMixBus }>(
					`${base}/buses/${encodeURIComponent(busId)}`,
					await readAutomationFlags(opts)
				);
				return { success: true, data: { projectId, bus } };
			}
			case "stems": {
				if (!opts.outputDir || opts.outputDir === "./output") {
					return {
						success: false,
						error: "Pass --output-dir <folder> for the stems",
					};
				}
				if (opts.noWait) {
					const started = await client.post<{ jobId: string }>(
						`${base}/stems`,
						{ outputDir: path.resolve(opts.outputDir) }
					);
					return { success: true, data: { projectId, ...started } };
				}
				return {
					success: true,
					data: {
						projectId,
						...(await writeMixStems({
							client,
							projectId,
							outputDir: opts.outputDir,
							opts,
						})),
					},
				};
			}
			case "loudness": {
				const started = await client.post<{ jobId: string }>(
					`${base}/loudness`,
					{}
				);
				if (opts.noWait) {
					return { success: true, data: { projectId, ...started } };
				}
				const job = await waitForMixJob({
					client,
					projectId,
					jobId: started.jobId,
					opts,
				});
				return {
					success: true,
					data: { projectId, jobId: job.jobId, ...job.result?.loudness },
				};
			}
			case "job-status": {
				const jobId = opts.jobId?.trim();
				if (!jobId) return { success: false, error: "Missing --job-id" };
				const job = await client.get<MixJob>(
					`${base}/jobs/${encodeURIComponent(jobId)}`
				);
				return { success: true, data: { projectId, ...job } };
			}
			case "bus-remove": {
				const busId = opts.busId?.trim();
				if (!busId) return { success: false, error: "Missing --bus-id" };
				const removed = await client.delete<{
					removed: string;
					reroutedTrackIds: string[];
				}>(`${base}/buses/${encodeURIComponent(busId)}`);
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
					error: `Unknown mix action: ${action}. Available: export, bus-list, bus-create, bus-set, bus-remove, master-set, bus-automation, loudness, stems, job-status`,
				};
		}
	} catch (error) {
		if (error instanceof FlagError) {
			return { success: false, error: error.message };
		}
		throw error;
	}
}
