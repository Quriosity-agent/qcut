import { measureFileTruePeak } from "../../../ffmpeg/audio-true-peak.js";
import type { ExportAudioValidation } from "../../../types/export-audio-validation.js";
import { throwIfCancelled } from "./export-cancel.js";

// ebur128's summary rounds to 0.1 dB; one full displayed step must still warn.
const METER_ROUNDING_DB = 0.050001;

export async function validateExportAudioPeak({
	outputPath,
	limiter,
	signal,
}: {
	outputPath: string;
	limiter?: { enabled: boolean; ceilingDb: number };
	signal?: AbortSignal;
}): Promise<{ audioValidation?: ExportAudioValidation; warnings?: string[] }> {
	throwIfCancelled(signal);
	if (!limiter?.enabled) return {};
	const ceilingDbtp = Number.isFinite(limiter.ceilingDb)
		? limiter.ceilingDb
		: null;
	try {
		if (ceilingDbtp === null) {
			throw new Error("The master limiter ceiling is not finite");
		}
		const truePeakDbtp = await measureFileTruePeak({
			file: outputPath,
			signal,
		});
		throwIfCancelled(signal);
		if (truePeakDbtp === null) {
			return { audioValidation: { status: "no-audio", ceilingDbtp } };
		}
		if (
			!Number.isFinite(truePeakDbtp) &&
			truePeakDbtp !== Number.NEGATIVE_INFINITY
		) {
			throw new Error("The measured true peak is not a valid level");
		}
		const exceeded = truePeakDbtp - ceilingDbtp > METER_ROUNDING_DB;
		return {
			audioValidation: {
				status: exceeded ? "exceeded" : "passed",
				ceilingDbtp,
				truePeakDbtp: Number.isFinite(truePeakDbtp) ? truePeakDbtp : null,
			},
			...(exceeded
				? {
						warnings: [
							`The exported audio true peak is ${truePeakDbtp.toFixed(1)} dBTP, above the master limiter ceiling of ${ceilingDbtp.toFixed(1)} dB. Sample limiting does not guarantee the encoded true peak. Lower the master gain or limiter ceiling and re-export; measure the new file before delivery.`,
						],
					}
				: {}),
		};
	} catch (error) {
		throwIfCancelled(signal);
		return {
			audioValidation: { status: "unavailable", ceilingDbtp },
			warnings: [
				`The export was saved, but its audio true peak could not be verified: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
}
