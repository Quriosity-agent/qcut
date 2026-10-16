/**
 * Applies the timeline mix (track, bus and master settings) to an FFmpeg
 * export, so the exported audio matches what the editor plays.
 *
 * The preview (apps/web/src/lib/audio/audio-mix-engine.ts) runs every track,
 * bus and the master through the same strip: low cut, EQ bands, high cut,
 * compressor, gain, ducking, pan, limiter. Tracks feed their bus (or the
 * master when the bus does not exist), buses feed the master. This builds the
 * same chain as filters. A mix where nothing differs from the defaults leaves
 * the graph exactly as it was before mixing existed.
 *
 * Ducking in the preview watches the source tracks' level and pulls the
 * target down by a fixed amount while it is above the threshold. Here a gate
 * keyed by the sources opens on the target's own signal while they are loud,
 * and that gated copy is subtracted from the target at the ducking depth: the
 * target drops by exactly the set amount, gliding with the attack and
 * release times.
 *
 * @module electron/ffmpeg/audio-mix-graph
 */

import {
	automatedLevelFilters,
	automatedPanFilters,
} from "./audio-mix-automation";
import type {
	AudioBusEffects,
	AudioMixBus,
	AudioMixConfig,
	AudioTrackMix,
} from "./types";

const MASTER_BUS_ID = "master";

/** A label carrying one track's mixed clips, before its own strip. */
export interface TrackAudioInput {
	trackId: string | undefined;
	label: string;
}

function dbToLinear(db: number): number {
	return 10 ** (db / 20);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
	return Number(value.toFixed(6));
}

function effectsAreNeutral(effects: AudioBusEffects): boolean {
	const equalizer = effects.parametricEqualizer;
	const eqActive =
		equalizer.enabled &&
		(equalizer.lowCutHz > 20 ||
			equalizer.highCutHz < 20_000 ||
			equalizer.bands.some(
				(band) => band.enabled && (band.type === "notch" || band.gainDb !== 0)
			));
	return !eqActive && !effects.compressor.enabled && !effects.limiter.enabled;
}

function stripIsNeutral(strip: AudioMixBus | AudioTrackMix): boolean {
	return (
		!strip.automation?.gainDb?.length &&
		!strip.automation?.pan?.length &&
		strip.gainDb === 0 &&
		strip.pan === 0 &&
		!strip.muted &&
		!strip.solo &&
		effectsAreNeutral(strip.effects)
	);
}

/** Whether applying `config` would leave every signal untouched. */
export function isNeutralAudioMix(config: AudioMixConfig | undefined): boolean {
	if (!config) return true;
	return (
		stripIsNeutral(config.master) &&
		config.buses.every(stripIsNeutral) &&
		config.tracks.every(
			(track) =>
				stripIsNeutral(track) &&
				track.busId === MASTER_BUS_ID &&
				!track.ducking.enabled
		)
	);
}

/** EQ and compressor: the strip stages before gain. */
function buildToneFilters(effects: AudioBusEffects): string[] {
	const filters: string[] = [];
	const equalizer = effects.parametricEqualizer;
	if (equalizer.enabled) {
		if (equalizer.lowCutHz > 20) {
			filters.push(`highpass=f=${round(equalizer.lowCutHz)}`);
		}
		for (const band of equalizer.bands) {
			if (!band.enabled) continue;
			const frequency = round(band.frequencyHz);
			const q = round(clamp(band.q, 0.01, 100));
			if (band.type === "notch") {
				filters.push(`bandreject=f=${frequency}:t=q:w=${q}`);
			} else if (band.gainDb !== 0) {
				const gain = round(band.gainDb);
				filters.push(
					band.type === "low-shelf"
						? `lowshelf=f=${frequency}:g=${gain}`
						: band.type === "high-shelf"
							? `highshelf=f=${frequency}:g=${gain}`
							: `equalizer=f=${frequency}:t=q:w=${q}:g=${gain}`
				);
			}
		}
		if (equalizer.highCutHz < 20_000) {
			filters.push(`lowpass=f=${round(equalizer.highCutHz)}`);
		}
	}
	const compressor = effects.compressor;
	if (compressor.enabled) {
		filters.push(
			`acompressor=threshold=${round(clamp(dbToLinear(compressor.thresholdDb), 0.000976563, 1))}` +
				`:ratio=${round(clamp(compressor.ratio, 1, 20))}` +
				`:attack=${round(clamp(compressor.attackMs, 0.01, 2000))}` +
				`:release=${round(clamp(compressor.releaseMs, 0.01, 9000))}` +
				`:makeup=${round(clamp(dbToLinear(compressor.makeupGainDb), 1, 64))}` +
				":knee=8"
		);
	}
	return filters;
}

/**
 * StereoPannerNode's law for a stereo input, which every strip receives:
 * the far channel fades by cos, the near one gains the other at sin.
 */
function buildPanFilter(pan: number): string | null {
	const amount = clamp(pan, -1, 1);
	if (amount === 0) return null;
	const angle = (Math.abs(amount) * Math.PI) / 2;
	const keep = round(Math.cos(angle));
	const cross = round(Math.sin(angle));
	return amount > 0
		? `pan=stereo|c0=${keep}*c0|c1=c1+${cross}*c0`
		: `pan=stereo|c0=c0+${cross}*c1|c1=${keep}*c1`;
}

/** Pan and limiter: the strip stages after gain and ducking. */
function buildOutputFilters(strip: AudioMixBus | AudioTrackMix): string[] {
	const filters: string[] = [];
	const panCurve = strip.automation?.pan;
	const pan = buildPanFilter(strip.pan);
	if (panCurve?.length) filters.push(...automatedPanFilters(panCurve));
	else if (pan) filters.push("aformat=channel_layouts=stereo", pan);
	const limiter = strip.effects.limiter;
	if (limiter.enabled) {
		filters.push(
			`alimiter=limit=${round(clamp(dbToLinear(limiter.ceilingDb), 0.0625, 1))}` +
				`:attack=3:release=${round(clamp(limiter.releaseMs, 1, 8000))}:level=0`
		);
	}
	return filters;
}

function gainFilter(gainDb: number): string | null {
	return gainDb === 0 ? null : `volume=${round(gainDb)}dB`;
}

/** The strip's level: its curve when it has one, else its fixed gain. */
function levelFilters(strip: AudioMixBus | AudioTrackMix): string[] {
	const curve = strip.automation?.gainDb;
	if (curve?.length) return automatedLevelFilters(curve);
	const gain = gainFilter(strip.gainDb);
	return gain ? [gain] : [];
}

/** Joins labels into one, summing when there are several. */
function sumLabels({
	labels,
	output,
	filterSteps,
}: {
	labels: string[];
	output: string;
	filterSteps: string[];
}): string {
	if (labels.length === 1) return labels[0];
	filterSteps.push(
		`${labels.map((label) => `[${label}]`).join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0[${output}]`
	);
	return output;
}

function applyFilters({
	input,
	filters,
	output,
	filterSteps,
}: {
	input: string;
	filters: string[];
	output: string;
	filterSteps: string[];
}): string {
	if (filters.length === 0) return input;
	filterSteps.push(`[${input}]${filters.join(",")}[${output}]`);
	return output;
}

/** A track's settings, or the defaults for a track the config does not list. */
function defaultTrackMix(trackId: string): AudioTrackMix {
	return {
		trackId,
		muted: false,
		gainDb: 0,
		pan: 0,
		solo: false,
		busId: MASTER_BUS_ID,
		effects: {
			parametricEqualizer: {
				enabled: false,
				lowCutHz: 20,
				highCutHz: 20_000,
				bands: [],
			},
			compressor: {
				enabled: false,
				thresholdDb: 0,
				ratio: 1,
				attackMs: 10,
				releaseMs: 100,
				makeupGainDb: 0,
			},
			limiter: { enabled: false, ceilingDb: 0, releaseMs: 100 },
		},
		ducking: {
			enabled: false,
			sourceTrackIds: [],
			thresholdDb: -30,
			reductionDb: -12,
			attackMs: 80,
			releaseMs: 350,
		},
	};
}

/**
 * Mixes per-track labels through their tracks, buses and the master, and
 * returns the label of the finished mix: silence when the mix silences
 * everything, null only when there are no inputs.
 */
export function appendAudioMixGraph({
	inputs,
	config,
	filterSteps,
}: {
	inputs: TrackAudioInput[];
	config: AudioMixConfig;
	filterSteps: string[];
}): string | null {
	const buses = new Map(config.buses.map((bus) => [bus.id, bus]));
	const anyBusSolo = config.buses.some((bus) => bus.solo);
	const settingsById = new Map(
		config.tracks.map((track) => [track.trackId, track])
	);
	const allTracks = [
		...new Set(inputs.map((input) => input.trackId ?? "__unassigned")),
	].map((trackId) => settingsById.get(trackId) ?? defaultTrackMix(trackId));
	const anyTrackSolo = allTracks.some((track) => track.solo);

	// The preview's rules for who is heard: muted tracks, tracks outside a
	// track solo, and tracks whose bus is outside a bus solo are silent.
	const audible = allTracks.filter((track) => {
		const routedBus = buses.get(track.busId);
		const soloBusMuted = anyBusSolo && routedBus?.solo !== true;
		return !(track.muted || (anyTrackSolo && !track.solo) || soloBusMuted);
	});
	// FFmpeg rejects a graph with an unconnected output, so a silenced
	// signal is ended explicitly rather than left dangling.
	const discard = (label: string) => filterSteps.push(`[${label}]anullsink`);
	// A mix that silences everything still ends in a stream: one input at
	// zero. Were it to end in nothing, exports would fall back to the raw
	// input and play it unmixed.
	const silentMix = (labels: string[]): string | null => {
		const [kept, ...rest] = labels;
		if (kept === undefined) return null;
		for (const label of rest) discard(label);
		filterSteps.push(`[${kept}]volume=0[a_mix]`);
		return "a_mix";
	};
	const audibleTrackIds = new Set(audible.map((track) => track.trackId));
	const silencedInputs = inputs
		.filter((input) => !audibleTrackIds.has(input.trackId ?? "__unassigned"))
		.map((input) => input.label.replace(/^\[|\]$/g, ""));
	if (audible.length === 0) return silentMix(silencedInputs);
	for (const label of silencedInputs) discard(label);

	// Stage 1: each track's clips, through EQ, compressor and gain.
	const preDuck = new Map<string, string>();
	for (const [index, track] of audible.entries()) {
		const labels = inputs
			.filter((input) => (input.trackId ?? "__unassigned") === track.trackId)
			.map((input) => input.label.replace(/^\[|\]$/g, ""));
		const summed = sumLabels({
			labels,
			output: `mix_t${index}_in`,
			filterSteps,
		});
		preDuck.set(
			track.trackId,
			applyFilters({
				input: summed,
				filters: [...buildToneFilters(track.effects), ...levelFilters(track)],
				output: `mix_t${index}_pre`,
				filterSteps,
			})
		);
	}

	// Stage 2: ducking. A track keyed by others needs copies of their signal,
	// so each pre-duck label is split once for every consumer.
	const audibleIds = new Set(audible.map((track) => track.trackId));
	const duckSources = new Map<string, string[]>();
	for (const track of audible) {
		if (!track.ducking.enabled) continue;
		const sources = track.ducking.sourceTrackIds.filter(
			(id) => id !== track.trackId && audibleIds.has(id)
		);
		if (sources.length > 0) duckSources.set(track.trackId, sources);
	}
	const consumers = new Map<string, string[]>();
	for (const track of audible) {
		consumers.set(track.trackId, [preDuck.get(track.trackId) as string]);
	}
	for (const [index, track] of audible.entries()) {
		const sideUses = [...duckSources.values()].filter((sources) =>
			sources.includes(track.trackId)
		).length;
		if (sideUses === 0) continue;
		const source = preDuck.get(track.trackId) as string;
		const copies = Array.from(
			{ length: sideUses + 1 },
			(_, copy) => `mix_t${index}_split${copy}`
		);
		filterSteps.push(
			`[${source}]asplit=${copies.length}${copies.map((copy) => `[${copy}]`).join("")}`
		);
		consumers.set(track.trackId, copies);
	}
	const takeCopy = (trackId: string): string =>
		(consumers.get(trackId) as string[]).shift() as string;

	const trackOutputs: Array<{ busId: string; label: string }> = [];
	for (const [index, track] of audible.entries()) {
		let current = takeCopy(track.trackId);
		const sources = duckSources.get(track.trackId);
		if (sources) {
			// The key is padded with silence, since the sidechain filters stop
			// at the shorter input and would cut the ducked signal off when a
			// short source clip ends. A -120 dB offset keeps the key off exact
			// zero: FFmpeg's gate stays open on digital silence.
			const sidechain = applyFilters({
				input: sumLabels({
					labels: sources.map(takeCopy),
					output: `mix_t${index}_key`,
					filterSteps,
				}),
				filters: ["apad", "dcshift=shift=0.000001"],
				output: `mix_t${index}_keypad`,
				filterSteps,
			});
			const kept = dbToLinear(Math.min(0, track.ducking.reductionDb));
			filterSteps.push(
				`[${current}]asplit=2[mix_t${index}_dry][mix_t${index}_wet]`,
				`[mix_t${index}_wet][${sidechain}]sidechaingate=` +
					`threshold=${round(clamp(dbToLinear(track.ducking.thresholdDb), 0.000001, 1))}` +
					":ratio=9000:range=0.0001:knee=1:detection=rms" +
					`:attack=${round(clamp(track.ducking.attackMs, 0.01, 9000))}` +
					`:release=${round(clamp(track.ducking.releaseMs, 0.01, 9000))}` +
					`,volume=${round(kept - 1)}[mix_t${index}_gated]`,
				`[mix_t${index}_dry][mix_t${index}_gated]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix_t${index}_duck]`
			);
			current = `mix_t${index}_duck`;
		}
		current = applyFilters({
			input: current,
			filters: buildOutputFilters(track),
			output: `mix_t${index}_out`,
			filterSteps,
		});
		trackOutputs.push({
			busId: buses.has(track.busId) ? track.busId : MASTER_BUS_ID,
			label: current,
		});
	}

	// Stage 3: buses, then the master.
	const droppedByBus: string[] = [];
	const masterInputs = trackOutputs
		.filter((output) => output.busId === MASTER_BUS_ID)
		.map((output) => output.label);
	for (const [index, bus] of config.buses.entries()) {
		const labels = trackOutputs
			.filter((output) => output.busId === bus.id)
			.map((output) => output.label);
		if (labels.length === 0) continue;
		if (bus.muted || (anyBusSolo && !bus.solo)) {
			droppedByBus.push(...labels);
			continue;
		}
		const summed = sumLabels({
			labels,
			output: `mix_b${index}_in`,
			filterSteps,
		});
		masterInputs.push(
			applyFilters({
				input: summed,
				filters: [
					...buildToneFilters(bus.effects),
					...levelFilters(bus),
					...buildOutputFilters(bus),
				],
				output: `mix_b${index}_out`,
				filterSteps,
			})
		);
	}
	// Tracks routed to a bus that does not exist went to the master above, so
	// every audible track output is consumed here or dropped with its bus.
	if (masterInputs.length === 0) return silentMix(droppedByBus);
	for (const label of droppedByBus) discard(label);

	const master = config.master;
	const masterSum = sumLabels({
		labels: masterInputs,
		output: "mix_master_in",
		filterSteps,
	});
	return applyFilters({
		input: masterSum,
		filters: [
			...buildToneFilters(master.effects),
			...(master.muted ? ["volume=0"] : levelFilters(master)),
			...buildOutputFilters(master),
		],
		output: "a_mix",
		filterSteps,
	});
}
