import { runAudioMeasurementProcess } from "./audio-measurement-process.js";
import { getFFmpegPath, getFFprobePath } from "./utils.js";

export function parseTruePeakSummary({ stderr }: { stderr: string }): number {
	const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
	const peak = summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
	if (!peak || (peak[1] !== "-inf" && !Number.isFinite(Number(peak[1])))) {
		throw new Error("FFmpeg's ebur128 meter gave no summary true peak");
	}
	return peak[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(peak[1]);
}

/** null means no audio stream; -Infinity means an audio stream containing silence. */
export async function measureFileTruePeak({
	file,
	signal,
}: {
	file: string;
	signal?: AbortSignal;
}): Promise<number | null> {
	signal?.throwIfAborted();
	const { stdout } = await runAudioMeasurementProcess({
		command: await getFFprobePath(),
		args: [
			"-v",
			"error",
			"-select_streams",
			"a:0",
			"-show_entries",
			"stream=index",
			"-of",
			"csv=p=0",
			file,
		],
		signal,
		timeout: 60_000,
	});
	signal?.throwIfAborted();
	if (!stdout.trim()) return null;
	const { stderr } = await runAudioMeasurementProcess({
		command: getFFmpegPath(),
		args: [
			"-hide_banner",
			"-nostdin",
			"-nostats",
			"-v",
			"info",
			"-i",
			file,
			"-map",
			"0:a:0",
			"-vn",
			"-sn",
			"-dn",
			// Keep the summary without buffering ten measurement lines per second.
			"-af",
			"ebur128=peak=true:framelog=verbose",
			"-f",
			"null",
			"-",
		],
		signal,
		timeout: 30 * 60_000,
	});
	signal?.throwIfAborted();
	return parseTruePeakSummary({ stderr });
}
