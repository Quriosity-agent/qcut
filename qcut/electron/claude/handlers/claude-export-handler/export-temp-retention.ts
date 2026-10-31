/**
 * The debug switch that keeps an export's intermediate files.
 *
 * N34: one project exported four times gave audio that was bit-identical on
 * two runs and differed on the others — once only across 40 ms near 20 s, and
 * once from 19.99 s to the end of the file with a true peak 0.6 dB higher.
 * The correction loop in `export-audio-limiter` is a pure function of its
 * input, and FFmpeg's AAC encode is byte-identical for identical PCM and
 * flags, so the divergence has to begin in the PCM handed to the encoder —
 * upstream of both. Which stage it begins in is still unknown, because every
 * intermediate is deleted when an export ends and there was nothing left to
 * compare.
 *
 * With `QCUT_EXPORT_KEEP_TEMP=1` the export's temp directory and the
 * limiter's audio work directory survive, and their paths are logged, so two
 * runs of one project can be hashed stage by stage in pipeline order:
 *
 * hash the audio of every `segment-`/`gap-` MOV and of `intermediate.mp4`
 * with `ffmpeg -i <file> -map 0:a:0 -f hash -`, then `shasum` the
 * `limited.f32` inside the `true-peak-pcm-` directory.
 *
 * The first hash that differs between two runs names the stage to look at.
 * Off by default: a kept directory holds a full-size intermediate video and a
 * float-PCM master, so it is large.
 *
 * @module electron/claude/handlers/claude-export-handler/export-temp-retention
 */
import { claudeLog } from "../../utils/logger.js";

/** True while the debug switch asks for intermediates to be kept. */
export function keepExportTempFiles(): boolean {
	const value = process.env.QCUT_EXPORT_KEEP_TEMP?.trim();
	return (
		value !== undefined && value !== "" && value !== "0" && value !== "false"
	);
}

/**
 * Report a directory the switch is keeping. Returns true when the caller
 * should skip its own removal.
 */
export function reportKeptExportDirectory({
	handler,
	label,
	directory,
}: {
	handler: string;
	label: string;
	directory: string;
}): boolean {
	if (!keepExportTempFiles()) return false;
	claudeLog.warn(
		handler,
		`QCUT_EXPORT_KEEP_TEMP is set: keeping ${label} at ${directory}`
	);
	return true;
}
