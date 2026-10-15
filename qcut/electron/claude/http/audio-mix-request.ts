/**
 * Reads mixer changes from editor API request bodies. Every value is checked
 * against the range the editor keeps, so a change is either refused here with
 * the reason or stored exactly as asked; nothing is quietly clamped.
 *
 * @module electron/claude/http/audio-mix-request
 */

import type {
	ClaudeAudioBusPatch,
	ClaudeAudioDucking,
	ClaudeAudioEffectsPatch,
	ClaudeAudioEqBand,
	ClaudeTrackAudioPatch,
} from "../../types/claude-audio-mix-api.js";
import { HttpError } from "../utils/http-router.js";

type Fields = Record<string, unknown>;

function invalid(message: string): never {
	throw new HttpError(400, message);
}

function readObject(value: unknown, field: string): Fields {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalid(`${field} must be an object`);
	}
	return value as Fields;
}

function refuseUnknown(fields: Fields, allowed: string[], field: string) {
	for (const key of Object.keys(fields)) {
		if (!allowed.includes(key)) {
			invalid(
				`Unknown field ${field ? `${field}.` : ""}${key}; allowed: ${allowed.join(", ")}`
			);
		}
	}
}

function readNumber(
	fields: Fields,
	key: string,
	[min, max]: [number, number],
	field: string
): number | undefined {
	const value = fields[key];
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		invalid(`${field}${key} must be a number`);
	}
	if (value < min || value > max) {
		invalid(`${field}${key} must be between ${min} and ${max} (got ${value})`);
	}
	return value;
}

function readBoolean(
	fields: Fields,
	key: string,
	field: string
): boolean | undefined {
	const value = fields[key];
	if (value === undefined) return undefined;
	if (typeof value !== "boolean")
		invalid(`${field}${key} must be true or false`);
	return value;
}

function readText(
	fields: Fields,
	key: string,
	field: string
): string | undefined {
	const value = fields[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) {
		invalid(`${field}${key} must be a non-empty string`);
	}
	return value.trim();
}

/** Drops keys whose value is undefined, so patches carry only what was given. */
function defined<T extends Fields>(fields: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value !== undefined)
	) as Partial<T>;
}

const BAND_TYPES: ClaudeAudioEqBand["type"][] = [
	"bell",
	"low-shelf",
	"high-shelf",
	"notch",
];

function readBand(value: unknown, index: number): Partial<ClaudeAudioEqBand> {
	const field = `effects.parametricEqualizer.bands[${index}]`;
	const band = readObject(value, field);
	refuseUnknown(
		band,
		["id", "enabled", "type", "frequencyHz", "gainDb", "q"],
		field
	);
	if (
		band.type !== undefined &&
		!BAND_TYPES.includes(band.type as ClaudeAudioEqBand["type"])
	) {
		invalid(`${field}.type must be one of: ${BAND_TYPES.join(", ")}`);
	}
	const prefix = `${field}.`;
	return defined({
		id: readText(band, "id", prefix),
		enabled: readBoolean(band, "enabled", prefix),
		type: band.type as ClaudeAudioEqBand["type"] | undefined,
		frequencyHz: readNumber(band, "frequencyHz", [20, 20_000], prefix),
		gainDb: readNumber(band, "gainDb", [-24, 24], prefix),
		q: readNumber(band, "q", [0.1, 18], prefix),
	});
}

/** `effects`: any of the EQ, compressor and limiter, each partly. */
export function readEffectsPatch(value: unknown): ClaudeAudioEffectsPatch {
	const effects = readObject(value, "effects");
	refuseUnknown(
		effects,
		["parametricEqualizer", "compressor", "limiter"],
		"effects"
	);
	const patch: ClaudeAudioEffectsPatch = {};
	if (effects.parametricEqualizer !== undefined) {
		const field = "effects.parametricEqualizer";
		const equalizer = readObject(effects.parametricEqualizer, field);
		refuseUnknown(
			equalizer,
			["enabled", "lowCutHz", "highCutHz", "bands"],
			field
		);
		if (equalizer.bands !== undefined && !Array.isArray(equalizer.bands)) {
			invalid(`${field}.bands must be a list`);
		}
		const prefix = `${field}.`;
		patch.parametricEqualizer = defined({
			enabled: readBoolean(equalizer, "enabled", prefix),
			lowCutHz: readNumber(equalizer, "lowCutHz", [20, 2_000], prefix),
			highCutHz: readNumber(equalizer, "highCutHz", [2_000, 20_000], prefix),
			bands: (equalizer.bands as unknown[] | undefined)?.map(readBand),
		});
	}
	if (effects.compressor !== undefined) {
		const field = "effects.compressor";
		const compressor = readObject(effects.compressor, field);
		refuseUnknown(
			compressor,
			[
				"enabled",
				"thresholdDb",
				"ratio",
				"attackMs",
				"releaseMs",
				"makeupGainDb",
			],
			field
		);
		const prefix = `${field}.`;
		patch.compressor = defined({
			enabled: readBoolean(compressor, "enabled", prefix),
			thresholdDb: readNumber(compressor, "thresholdDb", [-60, 0], prefix),
			ratio: readNumber(compressor, "ratio", [1, 20], prefix),
			attackMs: readNumber(compressor, "attackMs", [0, 1_000], prefix),
			releaseMs: readNumber(compressor, "releaseMs", [0, 1_000], prefix),
			makeupGainDb: readNumber(compressor, "makeupGainDb", [0, 24], prefix),
		});
	}
	if (effects.limiter !== undefined) {
		const field = "effects.limiter";
		const limiter = readObject(effects.limiter, field);
		refuseUnknown(limiter, ["enabled", "ceilingDb", "releaseMs"], field);
		const prefix = `${field}.`;
		patch.limiter = defined({
			enabled: readBoolean(limiter, "enabled", prefix),
			ceilingDb: readNumber(limiter, "ceilingDb", [-60, 0], prefix),
			releaseMs: readNumber(limiter, "releaseMs", [0, 1_000], prefix),
		});
	}
	return patch;
}

function readDucking(value: unknown): Partial<ClaudeAudioDucking> {
	const ducking = readObject(value, "ducking");
	refuseUnknown(
		ducking,
		[
			"enabled",
			"sourceTrackIds",
			"thresholdDb",
			"reductionDb",
			"attackMs",
			"releaseMs",
		],
		"ducking"
	);
	const sources = ducking.sourceTrackIds;
	if (
		sources !== undefined &&
		(!Array.isArray(sources) ||
			sources.some((id) => typeof id !== "string" || id.length === 0))
	) {
		invalid("ducking.sourceTrackIds must list track ids");
	}
	return defined({
		enabled: readBoolean(ducking, "enabled", "ducking."),
		sourceTrackIds: sources as string[] | undefined,
		thresholdDb: readNumber(ducking, "thresholdDb", [-90, 0], "ducking."),
		reductionDb: readNumber(ducking, "reductionDb", [-60, 0], "ducking."),
		attackMs: readNumber(ducking, "attackMs", [1, 5_000], "ducking."),
		releaseMs: readNumber(ducking, "releaseMs", [1, 10_000], "ducking."),
	});
}

const LEVEL_RANGE: [number, number] = [-60, 12];
const PAN_RANGE: [number, number] = [-1, 1];

/** A track's mixer change: level, pan, bus, solo, mute, ducking, effects. */
export function readTrackAudioPatch(body: unknown): ClaudeTrackAudioPatch {
	const fields = readObject(body ?? {}, "body");
	refuseUnknown(
		fields,
		["gainDb", "pan", "busId", "solo", "muted", "ducking", "effects"],
		""
	);
	const patch: ClaudeTrackAudioPatch = defined({
		gainDb: readNumber(fields, "gainDb", LEVEL_RANGE, ""),
		pan: readNumber(fields, "pan", PAN_RANGE, ""),
		busId: readText(fields, "busId", ""),
		solo: readBoolean(fields, "solo", ""),
		muted: readBoolean(fields, "muted", ""),
		ducking:
			fields.ducking === undefined ? undefined : readDucking(fields.ducking),
		effects:
			fields.effects === undefined
				? undefined
				: readEffectsPatch(fields.effects),
	});
	if (Object.keys(patch).length === 0) {
		invalid(
			"Nothing to change: give gainDb, pan, busId, solo, muted, ducking or effects"
		);
	}
	return patch;
}

/** A bus or master change; `name` is required when creating. */
export function readBusPatch(
	body: unknown,
	{ creating = false }: { creating?: boolean } = {}
): ClaudeAudioBusPatch {
	const fields = readObject(body ?? {}, "body");
	refuseUnknown(
		fields,
		[
			...(creating ? ["id"] : []),
			"name",
			"gainDb",
			"pan",
			"muted",
			"solo",
			"effects",
		],
		""
	);
	const patch: ClaudeAudioBusPatch = defined({
		name: readText(fields, "name", ""),
		gainDb: readNumber(fields, "gainDb", LEVEL_RANGE, ""),
		pan: readNumber(fields, "pan", PAN_RANGE, ""),
		muted: readBoolean(fields, "muted", ""),
		solo: readBoolean(fields, "solo", ""),
		effects:
			fields.effects === undefined
				? undefined
				: readEffectsPatch(fields.effects),
	});
	if (creating && !patch.name) invalid("A new bus needs a name");
	if (!creating && Object.keys(patch).length === 0) {
		invalid(
			"Nothing to change: give name, gainDb, pan, muted, solo or effects"
		);
	}
	return patch;
}

/** A new bus's id: letters, digits, - and _, not "master". */
export function readNewBusId(body: unknown): string | undefined {
	const id = readText(readObject(body ?? {}, "body"), "id", "");
	if (id === undefined) return undefined;
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
		invalid("id may use letters, digits, - and _ (at most 64)");
	}
	if (id === "master") invalid('"master" is the master bus; pick another id');
	return id;
}
