/**
 * The numbers FFmpeg's EBU R 128 meter writes to its log, for the export's
 * loudness measurement and the CLI's own measurements alike.
 *
 * @module electron/ffmpeg/ebur128-report
 */

import type { ClaudeMixLoudness } from "../types/claude-audio-mix-api.js";
import { parseTruePeakSummary } from "./audio-true-peak.js";

/**
 * The numbers in FFmpeg's `ebur128=peak=true` log followed by `astats`:
 * integrated loudness and true peak from the summary, the loudest momentary
 * (400 ms) and short-term (3 s) windows from the running lines, the sample
 * peak from astats.
 */
export function parseEbur128Report({
	stderr,
}: {
	stderr: string;
}): Omit<ClaudeMixLoudness, "durationSeconds"> {
	const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
	const integrated = summary.match(/\bI:\s+(-?[\d.]+|-inf) LUFS/);
	if (!integrated) {
		throw new Error(
			`FFmpeg's ebur128 meter gave no summary: ${stderr.slice(-400)}`
		);
	}
	let maxMomentary = Number.NEGATIVE_INFINITY;
	let maxShortTerm = Number.NEGATIVE_INFINITY;
	for (const line of stderr.split("\n")) {
		const momentary = line.match(/\bM:\s*(-?[\d.]+)/);
		const shortTerm = line.match(/\bS:\s*(-?[\d.]+)/);
		if (!momentary || !shortTerm || !/\bt:\s*[\d.]+/.test(line)) continue;
		maxMomentary = Math.max(maxMomentary, Number(momentary[1]));
		maxShortTerm = Math.max(maxShortTerm, Number(shortTerm[1]));
	}
	const samplePeak = stderr.match(/Peak level dB:\s*(-?[\d.]+|-inf)/);
	const toNumber = (text: string) =>
		text === "-inf" ? Number.NEGATIVE_INFINITY : Number(text);
	return {
		integratedLufs: toNumber(integrated[1]),
		truePeakDbtp: parseTruePeakSummary({ stderr }),
		maxMomentaryLufs: maxMomentary,
		maxShortTermLufs: maxShortTerm,
		samplePeakDb: samplePeak
			? toNumber(samplePeak[1])
			: Number.NEGATIVE_INFINITY,
	};
}
