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
		/**
		 * Seconds of the mix lowered where encoding pushed the true peak up;
		 * everything else keeps its level. 0 when the first encode passed.
		 */
		correctedSeconds: number;
		/** The deepest of those local reductions, dB. */
		maxCorrectionDb: number;
	};
}
