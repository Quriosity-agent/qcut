/**
 * CLI Pipeline Runner — barrel re-exports.
 * @module electron/native-pipeline/cli/cli-runner
 */

export { CLIPipelineRunner } from "./runner.js";
export type { CLIRunOptions, CLIResult, ProgressFn } from "./types.js";
export {
	createProgressReporter,
	guessExtFromCommand,
	renderProgressBar,
} from "./progress.js";
export {
	runSession,
	parseSessionLine,
	getSessionClient,
	resetSessionState,
} from "./session.js";
