import type {
	AudioAutomationPoint,
	AudioBusEffectsSettings,
	AudioMixAutomation,
	AudioCompressorSettings,
	AudioDuckingSettings,
	AudioLimiterSettings,
	AudioMixBusSettings,
	AudioParametricEqBand,
	AudioParametricEqualizerSettings,
	ProjectAudioMixSettings,
	TimelineTrackAudioSettings,
} from "@/types/timeline";
import {
	MASTER_AUDIO_BUS_ID,
	createDefaultAudioMixBus,
} from "./audio-mix-settings";
import {
	type AutomationParam,
	normalizeAutomation,
} from "./audio-mix-automation";

/**
 * Partial changes to mixer settings, merged onto what a track or bus already
 * has: only the fields given change, at any depth. The mixer panel and the
 * editor API both apply changes through these, and the bus operations below
 * keep the project's bus list consistent.
 */

export interface AudioEffectsPatch {
	parametricEqualizer?: Partial<
		Omit<AudioParametricEqualizerSettings, "bands">
	> & {
		/** Bands change by id, or by position when they carry no id. */
		bands?: Array<Partial<AudioParametricEqBand>>;
	};
	compressor?: Partial<AudioCompressorSettings>;
	limiter?: Partial<AudioLimiterSettings>;
}

/** Curves to set; each one given replaces the old one, null removes it. */
export type AutomationPatch = Partial<
	Record<AutomationParam, AudioAutomationPoint[] | null>
>;

export interface TrackAudioPatch {
	gainDb?: number;
	pan?: number;
	busId?: string;
	solo?: boolean;
	ducking?: Partial<AudioDuckingSettings>;
	effects?: AudioEffectsPatch;
	automation?: AutomationPatch;
}

export interface AudioBusPatch {
	name?: string;
	gainDb?: number;
	pan?: number;
	muted?: boolean;
	solo?: boolean;
	effects?: AudioEffectsPatch;
	automation?: AutomationPatch;
}

function mergeAutomationPatch({
	automation,
	patch,
}: {
	automation?: AudioMixAutomation;
	patch?: AutomationPatch;
}): AudioMixAutomation | undefined {
	if (!patch) return automation;
	const merged: Partial<Record<AutomationParam, unknown>> = { ...automation };
	for (const [param, points] of Object.entries(patch) as Array<
		[AutomationParam, AudioAutomationPoint[] | null | undefined]
	>) {
		if (points === undefined) continue;
		merged[param] = points ?? undefined;
	}
	return normalizeAutomation(merged);
}

/**
 * Puts `automation` on `settings`. When there is none the key is set to
 * undefined rather than left out: the stores spread a change over the old
 * settings, and an absent key would keep the old curves.
 */
function withAutomation<T extends { automation?: AudioMixAutomation }>(
	settings: T,
	automation: AudioMixAutomation | undefined
): T {
	return { ...settings, automation };
}

function mergeBands({
	bands,
	patch,
}: {
	bands: AudioParametricEqBand[];
	patch: Array<Partial<AudioParametricEqBand>>;
}): AudioParametricEqBand[] {
	const merged = bands.map((band) => ({ ...band }));
	for (const [index, change] of patch.entries()) {
		const position = change.id
			? merged.findIndex((band) => band.id === change.id)
			: index;
		const existing = merged[position];
		if (existing) {
			merged[position] = { ...existing, ...change } as AudioParametricEqBand;
			continue;
		}
		merged.push({
			id: change.id ?? `band-${merged.length + 1}`,
			enabled: change.enabled ?? true,
			type: change.type ?? "bell",
			frequencyHz: change.frequencyHz ?? 1_000,
			gainDb: change.gainDb ?? 0,
			q: change.q ?? 1,
		});
	}
	return merged;
}

export function mergeAudioEffectsPatch({
	effects,
	patch,
}: {
	effects: AudioBusEffectsSettings;
	patch?: AudioEffectsPatch;
}): AudioBusEffectsSettings {
	if (!patch) return effects;
	const { bands, ...equalizer } = patch.parametricEqualizer ?? {};
	return {
		parametricEqualizer: {
			...effects.parametricEqualizer,
			...equalizer,
			bands: bands
				? mergeBands({ bands: effects.parametricEqualizer.bands, patch: bands })
				: effects.parametricEqualizer.bands,
		},
		compressor: { ...effects.compressor, ...patch.compressor },
		limiter: { ...effects.limiter, ...patch.limiter },
	};
}

export function mergeTrackAudioPatch({
	settings,
	patch,
}: {
	settings: TimelineTrackAudioSettings;
	patch: TrackAudioPatch;
}): TimelineTrackAudioSettings {
	const { ducking, effects, automation, ...levels } = patch;
	return withAutomation(
		{
			...settings,
			...levels,
			ducking: { ...settings.ducking, ...ducking },
			effects: mergeAudioEffectsPatch({
				effects: settings.effects,
				patch: effects,
			}),
		},
		mergeAutomationPatch({ automation: settings.automation, patch: automation })
	);
}

export function mergeAudioBusPatch({
	bus,
	patch,
}: {
	bus: AudioMixBusSettings;
	patch: AudioBusPatch;
}): AudioMixBusSettings {
	const { effects, automation, ...fields } = patch;
	return withAutomation(
		{
			...bus,
			...fields,
			effects: mergeAudioEffectsPatch({ effects: bus.effects, patch: effects }),
		},
		mergeAutomationPatch({ automation: bus.automation, patch: automation })
	);
}

/** Why a bus operation was refused. */
export class AudioMixBusError extends Error {
	constructor(
		readonly reason: "not-found" | "invalid",
		message: string
	) {
		super(message);
		this.name = "AudioMixBusError";
	}
}

function busList(audioMix: ProjectAudioMixSettings): string {
	return [MASTER_AUDIO_BUS_ID, ...audioMix.buses.map((bus) => bus.id)].join(
		", "
	);
}

/** An unused id from the name's letters and digits, or `bus-N`. */
function newBusId({
	audioMix,
	name,
}: {
	audioMix: ProjectAudioMixSettings;
	name: string;
}): string {
	const taken = new Set([
		MASTER_AUDIO_BUS_ID,
		...audioMix.buses.map((bus) => bus.id),
	]);
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	const base = slug && slug !== MASTER_AUDIO_BUS_ID ? slug : "bus";
	if (base !== "bus" && !taken.has(base)) return base;
	for (let suffix = 1; ; suffix += 1) {
		const candidate = `${base}-${suffix}`;
		if (!taken.has(candidate)) return candidate;
	}
}

export function createAudioBus({
	audioMix,
	id,
	patch,
}: {
	audioMix: ProjectAudioMixSettings;
	id?: string;
	patch: AudioBusPatch & { name: string };
}): { audioMix: ProjectAudioMixSettings; bus: AudioMixBusSettings } {
	const name = patch.name.trim();
	const sameName = audioMix.buses.find(
		(bus) => bus.name.toLowerCase() === name.toLowerCase()
	);
	if (sameName) {
		throw new AudioMixBusError(
			"invalid",
			`A bus named "${sameName.name}" already exists (id ${sameName.id})`
		);
	}
	if (
		id &&
		(id === MASTER_AUDIO_BUS_ID || audioMix.buses.some((bus) => bus.id === id))
	) {
		throw new AudioMixBusError("invalid", `Bus id "${id}" is taken`);
	}
	const busId = id ?? newBusId({ audioMix, name });
	const bus = mergeAudioBusPatch({
		bus: createDefaultAudioMixBus({ id: busId, name }),
		patch: { ...patch, name },
	});
	return { audioMix: { ...audioMix, buses: [...audioMix.buses, bus] }, bus };
}

/** Changes a bus, or the master when `busId` is "master". */
export function updateAudioBus({
	audioMix,
	busId,
	patch,
}: {
	audioMix: ProjectAudioMixSettings;
	busId: string;
	patch: AudioBusPatch;
}): ProjectAudioMixSettings {
	if (busId === MASTER_AUDIO_BUS_ID) {
		if (patch.name !== undefined) {
			throw new AudioMixBusError("invalid", "The master keeps its name");
		}
		if (patch.solo !== undefined) {
			throw new AudioMixBusError("invalid", "The master cannot be soloed");
		}
		return {
			...audioMix,
			master: mergeAudioBusPatch({ bus: audioMix.master, patch }),
		};
	}
	const existing = audioMix.buses.find((bus) => bus.id === busId);
	if (!existing) {
		throw new AudioMixBusError(
			"not-found",
			`No bus "${busId}"; buses: ${busList(audioMix)}`
		);
	}
	const name = patch.name?.trim();
	if (
		name &&
		audioMix.buses.some(
			(bus) => bus.id !== busId && bus.name.toLowerCase() === name.toLowerCase()
		)
	) {
		throw new AudioMixBusError(
			"invalid",
			`Another bus is already named "${name}"`
		);
	}
	return {
		...audioMix,
		buses: audioMix.buses.map((bus) =>
			bus.id === busId ? mergeAudioBusPatch({ bus, patch }) : bus
		),
	};
}

export function removeAudioBus({
	audioMix,
	busId,
}: {
	audioMix: ProjectAudioMixSettings;
	busId: string;
}): ProjectAudioMixSettings {
	if (busId === MASTER_AUDIO_BUS_ID) {
		throw new AudioMixBusError("invalid", "The master cannot be removed");
	}
	if (!audioMix.buses.some((bus) => bus.id === busId)) {
		throw new AudioMixBusError(
			"not-found",
			`No bus "${busId}"; buses: ${busList(audioMix)}`
		);
	}
	return {
		...audioMix,
		buses: audioMix.buses.filter((bus) => bus.id !== busId),
	};
}
