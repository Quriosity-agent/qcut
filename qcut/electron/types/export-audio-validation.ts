/**
 * How a native export with the master limiter handles encoding pushing the
 * true peak over the ceiling: "local" lowers the moments around it (the
 * default), "whole" lowers the whole mix, "check" lowers nothing and only
 * reports.
 */
export type ExportPeakCorrection = "local" | "whole" | "check";

export const EXPORT_PEAK_CORRECTIONS: readonly ExportPeakCorrection[] = [
	"local",
	"whole",
	"check",
];

/** A stretch of the export that was lowered, in seconds from its start. */
export interface ExportAudioCorrection {
	start: number;
	end: number;
	/** How far it came down at its deepest, dB. */
	depthDb: number;
}

export interface ExportAudioValidation {
	status: "passed" | "exceeded" | "unavailable" | "no-audio";
	/** null means an invalid ceiling prevented validation. */
	ceilingDbtp: number | null;
	/** null is digital silence; absent means the output could not be measured. */
	truePeakDbtp?: number | null;
	/** Encoded candidates are verified before the limited export is published. */
	limiting?: {
		oversampleFactor: number;
		encodeAttempts: number;
		peakCorrection: ExportPeakCorrection;
		/**
		 * Seconds of the mix lowered: the moments around the overshoot
		 * ("local"), all of it ("whole"), none ("check", or a first encode
		 * that passed).
		 */
		correctedSeconds: number;
		/** The deepest reduction anywhere, dB. */
		maxCorrectionDb: number;
		/** Each lowered stretch, in time order. */
		corrections: ExportAudioCorrection[];
	};
}
