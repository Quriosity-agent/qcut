import { runAudioMeasurementProcess } from "./audio-measurement-process.js";
import { getFFmpegPath, getFFprobePath } from "./utils.js";

/** The R 128 meter reports a block every 100 ms of audio. */
const BLOCK_SECONDS = 0.1;

export function parseTruePeakSummary({ stderr }: { stderr: string }): number {
	const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
	const peak = summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
	if (!peak || (peak[1] !== "-inf" && !Number.isFinite(Number(peak[1])))) {
		throw new Error("FFmpeg's ebur128 meter gave no summary true peak");
	}
	return peak[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(peak[1]);
}

/** A stretch of a file and the true peak of its loudest channel, dBTP. */
export interface TruePeakBlock {
	start: number;
	/** Infinity for a stretch that runs to the end of the file. */
	end: number;
	peakDb: number;
}

/**
 * One block line of `ebur128=peak=true` with frame logging: the block's
 * index, from the time at its end, and the true peak of its loudest channel
 * (`FTPK`). Null for any other line.
 */
export function parseTruePeakBlockLine({
	line,
}: {
	line: string;
}): { index: number; peakDb: number } | null {
	const time = line.match(/\bt:\s*(\d+(?:\.\d+)?)/);
	const peaks = line.match(/\bFTPK:((?:\s+(?:-?\d+(?:\.\d+)?|-inf))+)\s+dBFS/);
	if (!time || !peaks) return null;
	const levels = peaks[1]
		.trim()
		.split(/\s+/)
		.map((level) =>
			level === "-inf" ? Number.NEGATIVE_INFINITY : Number(level)
		);
	return {
		index: Math.round(Number(time[1]) / BLOCK_SECONDS) - 1,
		peakDb: Math.max(...levels),
	};
}

async function hasAudioStream({
	file,
	signal,
}: {
	file: string;
	signal?: AbortSignal;
}): Promise<boolean> {
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
	return stdout.trim() !== "";
}

function meterArgs({
	file,
	framelog,
}: {
	file: string;
	framelog: "info" | "verbose";
}): string[] {
	return [
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
		"-af",
		`ebur128=peak=true:framelog=${framelog}`,
		"-f",
		"null",
		"-",
	];
}

/** null means no audio stream; -Infinity means an audio stream containing silence. */
export async function measureFileTruePeak({
	file,
	signal,
}: {
	file: string;
	signal?: AbortSignal;
}): Promise<number | null> {
	if (!(await hasAudioStream({ file, signal }))) return null;
	const { stderr } = await runAudioMeasurementProcess({
		command: getFFmpegPath(),
		// Keep the summary without buffering ten measurement lines per second.
		args: meterArgs({ file, framelog: "verbose" }),
		signal,
		timeout: 30 * 60_000,
	});
	signal?.throwIfAborted();
	return parseTruePeakSummary({ stderr });
}

/**
 * The file's true peak, as measureFileTruePeak gives it, and every 100 ms
 * block whose true peak is above `aboveDb`. The meter logs no block for the
 * last partial 100 ms, so a peak there is reported as a block from the end of
 * the last logged one to the end of the file.
 */
export async function measureFileTruePeakBlocks({
	file,
	aboveDb,
	signal,
}: {
	file: string;
	aboveDb: number;
	signal?: AbortSignal;
}): Promise<{ truePeak: number | null; blocks: TruePeakBlock[] }> {
	if (!(await hasAudioStream({ file, signal }))) {
		return { truePeak: null, blocks: [] };
	}
	const blocks: TruePeakBlock[] = [];
	let loggedBlocks = 0;
	let loudestLogged = Number.NEGATIVE_INFINITY;
	let summary = "";
	await runAudioMeasurementProcess({
		command: getFFmpegPath(),
		args: meterArgs({ file, framelog: "info" }),
		signal,
		timeout: 30 * 60_000,
		onStderrLine: (line) => {
			if (summary || line.includes("Summary:")) {
				summary += `${line}\n`;
				return;
			}
			const block = parseTruePeakBlockLine({ line });
			if (!block) return;
			loggedBlocks = Math.max(loggedBlocks, block.index + 1);
			loudestLogged = Math.max(loudestLogged, block.peakDb);
			if (block.peakDb <= aboveDb) return;
			blocks.push({
				start: block.index * BLOCK_SECONDS,
				end: (block.index + 1) * BLOCK_SECONDS,
				peakDb: block.peakDb,
			});
		},
	});
	signal?.throwIfAborted();
	const truePeak = parseTruePeakSummary({ stderr: summary });
	// Both are shown to 0.1 dB: a summary a whole step above every block lies after them.
	if (truePeak > aboveDb && truePeak > loudestLogged + 0.05) {
		blocks.push({
			start: loggedBlocks * BLOCK_SECONDS,
			end: Number.POSITIVE_INFINITY,
			peakDb: truePeak,
		});
	}
	return { truePeak, blocks };
}
