/**
 * The mixer part of `editor timeline apply`: the project's buses and master
 * (`mix`, as `timeline export` writes them) and each track's mixer settings
 * (`tracks[].audio`), applied through the same routes as `editor mix` and
 * `editor track audio-set`, then read back and compared.
 *
 * @module electron/native-pipeline/editor/editor-timeline-apply-mix
 */
import type { EditorApiClient } from "./editor-api-client.js";
import {
	aliasFor,
	isRecord,
	mapReference,
	valuesMatch,
	type JsonRecord,
	type ManifestTrack,
	type TimelineManifest,
} from "./editor-timeline-manifest.js";

export interface MixSnapshot {
	master: JsonRecord & { id: string };
	buses: Array<JsonRecord & { id: string }>;
	tracks: Array<{ trackId: string; muted?: boolean; audio?: JsonRecord }>;
}

export interface ManifestMix extends JsonRecord {
	master?: JsonRecord;
	buses?: JsonRecord[];
}

/** What a bus (or the master) patch may carry; `id` names the bus instead. */
const BUS_PATCH_KEYS = [
	"name",
	"gainDb",
	"pan",
	"muted",
	"solo",
	"effects",
	"automation",
] as const;
/**
 * The master keeps its name (a localized export must not rename it) and
 * cannot be soloed, so an exported `solo: false` is not sent back.
 */
const MASTER_PATCH_KEYS = BUS_PATCH_KEYS.filter(
	(key) => key !== "name" && key !== "solo"
);
/** A track's mixer patch; `autoCrossfade` is read-only through the API. */
const TRACK_AUDIO_PATCH_KEYS = [
	"gainDb",
	"pan",
	"busId",
	"solo",
	"ducking",
	"effects",
	"automation",
] as const;

function mixPath(projectId: string): string {
	return `/api/claude/mix/${encodeURIComponent(projectId)}`;
}

function pick(record: JsonRecord, keys: readonly string[]): JsonRecord {
	const picked: JsonRecord = {};
	for (const key of keys) {
		if (record[key] !== undefined) picked[key] = record[key];
	}
	return picked;
}

/** The manifest's mix section, under `mix` or the project's own `audioMix`. */
export function manifestMix(
	manifest: TimelineManifest
): ManifestMix | undefined {
	const candidate = manifest.mix ?? manifest.audioMix;
	if (!isRecord(candidate)) return undefined;
	if (candidate.buses !== undefined && !Array.isArray(candidate.buses)) {
		throw new Error("mix.buses must be a list of buses");
	}
	if (candidate.master !== undefined && !isRecord(candidate.master)) {
		throw new Error("mix.master must be an object");
	}
	return candidate as ManifestMix;
}

/** Whether any manifest track asks for mixer settings. */
export function manifestHasTrackAudio(manifest: TimelineManifest): boolean {
	return (manifest.tracks ?? []).some((track) => isRecord(track.audio));
}

/**
 * The mix as the editor holds it, read before the apply changes anything in
 * the mixer. A failed read is an error, not an empty snapshot: without the
 * state before there would be nothing to put back if a later step failed.
 */
export async function readMixSnapshot({
	client,
	projectId,
}: {
	client: EditorApiClient;
	projectId: string;
}): Promise<MixSnapshot> {
	try {
		return await client.get<MixSnapshot>(mixPath(projectId));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Could not read the mix before changing it, so the mixer was left untouched: ${message}`
		);
	}
}

/**
 * A track's mixer patch from its manifest entry, with ducking sources mapped
 * from aliases or old ids to the ids the tracks now have.
 */
export function trackAudioPatch({
	track,
	trackIds,
}: {
	track: ManifestTrack;
	trackIds: Map<string, string>;
}): JsonRecord | undefined {
	if (!isRecord(track.audio)) return undefined;
	const patch = pick(track.audio, TRACK_AUDIO_PATCH_KEYS);
	if (isRecord(patch.ducking) && Array.isArray(patch.ducking.sourceTrackIds)) {
		patch.ducking = {
			...patch.ducking,
			sourceTrackIds: patch.ducking.sourceTrackIds.map(
				(source) => mapReference(trackIds, source) ?? source
			),
		};
	}
	return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * Creates or updates the manifest's buses and the master. With `replace`,
 * buses the manifest does not list are removed (their tracks go to the master).
 */
export async function applyManifestMix({
	client,
	projectId,
	mix,
	replace,
}: {
	client: EditorApiClient;
	projectId: string;
	mix: ManifestMix;
	replace: boolean;
}): Promise<void> {
	const base = mixPath(projectId);
	const current = await client.get<MixSnapshot>(base);
	const existing = new Set(current.buses.map((bus) => bus.id));
	const listed = new Set<string>();
	for (const [index, bus] of (mix.buses ?? []).entries()) {
		if (!isRecord(bus))
			throw new Error(`mix.buses[${index}] must be an object`);
		const id = typeof bus.id === "string" && bus.id ? bus.id : undefined;
		const patch = pick(bus, BUS_PATCH_KEYS);
		if (id && existing.has(id)) {
			listed.add(id);
			if (Object.keys(patch).length > 0) {
				await client.patch(`${base}/buses/${encodeURIComponent(id)}`, patch);
			}
			continue;
		}
		if (typeof patch.name !== "string") {
			throw new Error(`mix.buses[${index}] needs a name`);
		}
		const created = await client.post<{ busId: string }>(`${base}/buses`, {
			...(id ? { id } : {}),
			...patch,
		});
		listed.add(created.busId);
	}
	if (replace && mix.buses) {
		for (const bus of current.buses) {
			if (listed.has(bus.id)) continue;
			await client.delete(`${base}/buses/${encodeURIComponent(bus.id)}`);
		}
	}
	if (isRecord(mix.master)) {
		const patch = pick(mix.master, MASTER_PATCH_KEYS);
		if (Object.keys(patch).length > 0) {
			await client.patch(`${base}/buses/master`, patch);
		}
	}
}

/** Sets each manifest track's mixer settings (`tracks[].audio`). */
export async function applyManifestTrackAudio({
	client,
	projectId,
	manifest,
	trackIds,
}: {
	client: EditorApiClient;
	projectId: string;
	manifest: TimelineManifest;
	trackIds: Map<string, string>;
}): Promise<void> {
	for (const [index, track] of (manifest.tracks ?? []).entries()) {
		const patch = trackAudioPatch({ track, trackIds });
		if (!patch) continue;
		const alias = aliasFor(track, `track-${index}`);
		const trackId = trackIds.get(alias);
		if (!trackId) throw new Error(`Track '${alias}' has no id for its audio`);
		await client.patch(
			`${mixPath(projectId)}/tracks/${encodeURIComponent(trackId)}`,
			patch
		);
	}
}

/**
 * Differences between the mix the editor now holds and what the manifest
 * asked for: buses by id, the master, and each track's mixer settings.
 */
export function verifyManifestMix({
	actual,
	manifest,
	mix,
	trackIds,
}: {
	actual: MixSnapshot;
	manifest: TimelineManifest;
	mix: ManifestMix | undefined;
	trackIds: Map<string, string>;
}): string[] {
	const issues: string[] = [];
	for (const [index, bus] of (mix?.buses ?? []).entries()) {
		if (!isRecord(bus)) continue;
		const id = typeof bus.id === "string" ? bus.id : undefined;
		const expected = pick(bus, BUS_PATCH_KEYS);
		const found = id
			? actual.buses.find((candidate) => candidate.id === id)
			: actual.buses.find((candidate) => candidate.name === bus.name);
		if (!found) {
			issues.push(`bus '${id ?? bus.name ?? index}' is missing`);
			continue;
		}
		for (const [key, value] of Object.entries(expected)) {
			if (!valuesMatch(value, found[key])) {
				issues.push(`bus '${id ?? bus.name}' field '${key}' did not match`);
			}
		}
	}
	if (mix && isRecord(mix.master)) {
		for (const [key, value] of Object.entries(
			pick(mix.master, MASTER_PATCH_KEYS)
		)) {
			if (!valuesMatch(value, actual.master[key])) {
				issues.push(`master field '${key}' did not match`);
			}
		}
	}
	for (const [index, track] of (manifest.tracks ?? []).entries()) {
		const patch = trackAudioPatch({ track, trackIds });
		if (!patch) continue;
		const alias = aliasFor(track, `track-${index}`);
		const trackId = trackIds.get(alias);
		const found = actual.tracks.find((entry) => entry.trackId === trackId);
		if (!found) {
			issues.push(`track '${alias}' has no mixer settings`);
			continue;
		}
		for (const [key, value] of Object.entries(patch)) {
			if (!valuesMatch(value, found.audio?.[key])) {
				issues.push(`track '${alias}' audio.${key} did not match`);
			}
		}
	}
	return issues;
}

/**
 * Puts the mix back the way it was before an apply that failed: buses the
 * apply made are removed, changed ones and the master get their old values,
 * and tracks that still exist get their old mixer settings. Best effort.
 */
export async function restoreMix({
	client,
	projectId,
	previous,
}: {
	client: EditorApiClient;
	projectId: string;
	previous: MixSnapshot;
}): Promise<void> {
	await applyManifestMix({
		client,
		projectId,
		mix: { master: previous.master, buses: previous.buses },
		replace: true,
	});
	const current = await client.get<MixSnapshot>(mixPath(projectId));
	const present = new Set(current.tracks.map((track) => track.trackId));
	for (const track of previous.tracks) {
		if (!present.has(track.trackId) || !isRecord(track.audio)) continue;
		const patch = pick(track.audio, TRACK_AUDIO_PATCH_KEYS);
		if (Object.keys(patch).length === 0) continue;
		await client.patch(
			`${mixPath(projectId)}/tracks/${encodeURIComponent(track.trackId)}`,
			patch
		);
	}
}
