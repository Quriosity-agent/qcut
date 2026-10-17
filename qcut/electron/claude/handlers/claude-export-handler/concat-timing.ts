/**
 * Timing of the native export's concat step.
 *
 * Each encoded segment carries its AAC encoder priming as an edit list: the
 * first audio packet sits at −1024 samples and the list skips it, so the
 * segment's sound and picture both start at zero. The concat demuxer does
 * not keep that: it shifts every stream of the first file up by that lead,
 * so the whole program came out 21–23 ms late, and every later video
 * re-encode (text, stickers, adjustment layers) added another third of a
 * frame on top. Shifting the concat input back by the lead, and letting the
 * muxer keep the negative audio start as an edit list again, puts picture
 * and sound where the timeline has them.
 *
 * @module electron/claude/handlers/claude-export-handler/concat-timing
 */

import { spawn } from "node:child_process";
import { getFFprobePath } from "../../../ffmpeg/utils.js";

/**
 * Where `file`'s sound starts, in seconds: negative for AAC priming kept as
 * an edit list, 0 when the file has no sound or the probe cannot run (no
 * ffprobe, unreadable file) — a plain copy then, never a failed export.
 */
export async function probeLeadingAudioTime({
	file,
}: {
	file: string;
}): Promise<number> {
	let ffprobePath: string;
	try {
		ffprobePath = await getFFprobePath();
	} catch {
		return 0;
	}
	const output = await new Promise<string>((resolve) => {
		const probe = spawn(
			ffprobePath,
			[
				"-v",
				"error",
				"-select_streams",
				"a:0",
				"-read_intervals",
				"%+#1",
				"-show_entries",
				"packet=pts_time",
				"-of",
				"csv=p=0",
				file,
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
		);
		let stdout = "";
		probe.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		probe.on("error", () => resolve(""));
		probe.on("close", () => resolve(stdout));
	});
	const first = Number(output.trim().split("\n")[0]?.replace(/,.*$/, ""));
	return Number.isFinite(first) ? first : 0;
}

/**
 * The stream-copy concat of `listPath` into `outputPath`. With a negative
 * `leadSeconds` (the first input's audio lead), the input is shifted back by
 * it and negative timestamps are kept, so the output starts at zero like the
 * segments did instead of `lead` late.
 */
export function buildConcatCopyArgs({
	listPath,
	outputPath,
	leadSeconds,
}: {
	listPath: string;
	outputPath: string;
	leadSeconds: number;
}): string[] {
	const shifted = leadSeconds < 0;
	return [
		"-y",
		...(shifted ? ["-itsoffset", leadSeconds.toFixed(6)] : []),
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		listPath,
		"-c",
		"copy",
		...(shifted ? ["-avoid_negative_ts", "disabled"] : []),
		"-movflags",
		"+faststart",
		outputPath,
	];
}
