/**
 * `--start-time`/`--end-time` as part of the timeline, for `export start`
 * and `mix loudness`.
 *
 * @module electron/native-pipeline/editor/editor-time-range-flags
 */

import type { ClaudeTimeRange } from "../../types/claude-api.js";
import type { CLIRunOptions } from "../cli/cli-runner/types.js";

/**
 * The range the flags name: no `--start-time` is 0, no `--end-time` the
 * timeline's end. Neither flag gives no range; a value that cannot be one
 * gives the error to show.
 */
export function readTimeRangeFlags(
	opts: Pick<CLIRunOptions, "startTime" | "endTime">
): { range?: ClaudeTimeRange; error?: string } {
	const { startTime, endTime } = opts;
	if (startTime === undefined && endTime === undefined) return {};
	if (
		startTime !== undefined &&
		!(Number.isFinite(startTime) && startTime >= 0)
	) {
		return { error: "--start-time must be a number of seconds, 0 or more" };
	}
	if (endTime !== undefined && !(Number.isFinite(endTime) && endTime > 0)) {
		return { error: "--end-time must be a number of seconds above 0" };
	}
	if (
		startTime !== undefined &&
		endTime !== undefined &&
		endTime <= startTime
	) {
		return { error: "--end-time must come after --start-time" };
	}
	return {
		range: {
			...(startTime !== undefined ? { startTime } : {}),
			...(endTime !== undefined ? { endTime } : {}),
		},
	};
}
