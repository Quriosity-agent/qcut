/**
 * The editor API for the mixer: each track's level, pan, bus, solo, mute,
 * ducking and effects, the project's buses and its master.
 *
 * Every request is answered with the whole mix read back from the editor, so
 * a caller sees what actually took effect.
 *
 * @module electron/types/claude-audio-mix-api
 */

export const CLAUDE_MASTER_BUS_ID = "master";

export interface ClaudeAudioEqBand {
	id: string;
	enabled: boolean;
	type: "bell" | "low-shelf" | "high-shelf" | "notch";
	frequencyHz: number;
	gainDb: number;
	q: number;
}

export interface ClaudeAudioEffects {
	parametricEqualizer: {
		enabled: boolean;
		lowCutHz: number;
		highCutHz: number;
		bands: ClaudeAudioEqBand[];
	};
	compressor: {
		enabled: boolean;
		thresholdDb: number;
		ratio: number;
		attackMs: number;
		releaseMs: number;
		makeupGainDb: number;
	};
	limiter: { enabled: boolean; ceilingDb: number; releaseMs: number };
}

export interface ClaudeAudioDucking {
	enabled: boolean;
	sourceTrackIds: string[];
	thresholdDb: number;
	reductionDb: number;
	attackMs: number;
	releaseMs: number;
}

export interface ClaudeTrackAudioSettings {
	gainDb: number;
	pan: number;
	solo: boolean;
	busId: string;
	effects: ClaudeAudioEffects;
	ducking: ClaudeAudioDucking;
	autoCrossfade: {
		enabled: boolean;
		defaultDuration: number;
		curve: string;
	};
}

export interface ClaudeAudioMixBus {
	id: string;
	name: string;
	gainDb: number;
	pan: number;
	muted: boolean;
	solo: boolean;
	effects: ClaudeAudioEffects;
}

export interface ClaudeTrackAudioMix {
	trackId: string;
	name: string;
	type: string;
	muted: boolean;
	audio: ClaudeTrackAudioSettings;
	/** What the mix makes of the settings: heard or not, and where it goes. */
	effective: { silenced: boolean; busId: string };
}

export interface ClaudeAudioMixSnapshot {
	projectId: string;
	master: ClaudeAudioMixBus;
	buses: ClaudeAudioMixBus[];
	tracks: ClaudeTrackAudioMix[];
}

/** Partial effects: only the stages and fields given change. */
export interface ClaudeAudioEffectsPatch {
	parametricEqualizer?: Partial<
		Omit<ClaudeAudioEffects["parametricEqualizer"], "bands">
	> & { bands?: Array<Partial<ClaudeAudioEqBand>> };
	compressor?: Partial<ClaudeAudioEffects["compressor"]>;
	limiter?: Partial<ClaudeAudioEffects["limiter"]>;
}

export interface ClaudeTrackAudioPatch {
	gainDb?: number;
	pan?: number;
	busId?: string;
	solo?: boolean;
	muted?: boolean;
	ducking?: Partial<ClaudeAudioDucking>;
	effects?: ClaudeAudioEffectsPatch;
}

export interface ClaudeAudioBusPatch {
	name?: string;
	gainDb?: number;
	pan?: number;
	muted?: boolean;
	solo?: boolean;
	effects?: ClaudeAudioEffectsPatch;
}

export type ClaudeAudioMixRequest = { projectId: string } & (
	| { action: "get" }
	| { action: "set-track"; trackId: string; patch: ClaudeTrackAudioPatch }
	| {
			action: "create-bus";
			busId?: string;
			bus: ClaudeAudioBusPatch & { name: string };
	  }
	/** `busId` "master" changes the master. */
	| { action: "update-bus"; busId: string; patch: ClaudeAudioBusPatch }
	| { action: "remove-bus"; busId: string }
);

export interface ClaudeAudioMixResponse {
	success: boolean;
	error?: string;
	/** Why it failed: the project is not open, a track or bus is missing, or a value is refused. */
	reason?: "not-open" | "not-found" | "invalid";
	mix?: ClaudeAudioMixSnapshot;
	/** The bus a create made. */
	busId?: string;
	/** Tracks a removed bus sent back to the master. */
	reroutedTrackIds?: string[];
}
