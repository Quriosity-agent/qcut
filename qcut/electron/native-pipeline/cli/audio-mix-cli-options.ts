/**
 * Mixer flags, shared by the one-shot CLI (cli.ts) and session mode
 * (cli-runner/session.ts) so both read them the same way.
 *
 * @module electron/native-pipeline/cli/audio-mix-cli-options
 */

import type { CLIRunOptions } from "./cli-runner/types.js";

export const AUDIO_MIX_PARSE_OPTIONS = {
	"gain-db": { type: "string" },
	pan: { type: "string" },
	bus: { type: "string" },
	"bus-id": { type: "string" },
	ducking: { type: "string" },
	effects: { type: "string" },
	off: { type: "boolean" },
	mute: { type: "boolean" },
	"no-mute": { type: "boolean" },
	solo: { type: "boolean" },
	"no-solo": { type: "boolean" },
	stems: { type: "boolean" },
	param: { type: "string" },
	points: { type: "string" },
} as const;

type AudioMixOptions = Pick<
	CLIRunOptions,
	| "gainDb"
	| "pan"
	| "bus"
	| "busId"
	| "ducking"
	| "effects"
	| "off"
	| "mute"
	| "solo"
	| "stems"
	| "param"
	| "points"
>;

/** A number, NaN when the text is not one (the handler names the flag). */
function readNumber(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	return value.trim() === "" ? Number.NaN : Number(value);
}

/** `--x` gives true, `--no-x` false, neither undefined. */
function readSwitch(on: unknown, off: unknown): boolean | undefined {
	if (off === true) return false;
	if (on === true) return true;
	return undefined;
}

export function readAudioMixOptions(
	values: Record<string, unknown>
): AudioMixOptions {
	const options: AudioMixOptions = {
		gainDb: readNumber(values["gain-db"]),
		pan: readNumber(values.pan),
		bus: values.bus as string | undefined,
		busId: values["bus-id"] as string | undefined,
		ducking: values.ducking as string | undefined,
		effects: values.effects as string | undefined,
		off: values.off === true ? true : undefined,
		mute: readSwitch(values.mute, values["no-mute"]),
		solo: readSwitch(values.solo, values["no-solo"]),
		stems: values.stems === true ? true : undefined,
		param: values.param as string | undefined,
		points: values.points as string | undefined,
	};
	return Object.fromEntries(
		Object.entries(options).filter(([, value]) => value !== undefined)
	) as AudioMixOptions;
}
