export interface ExportAudioValidation {
	status: "passed" | "exceeded" | "unavailable" | "no-audio";
	/** null means an invalid ceiling prevented validation. */
	ceilingDbtp: number | null;
	/** null is digital silence; absent means the output could not be measured. */
	truePeakDbtp?: number | null;
}
