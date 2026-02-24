/**
 * CLI Pipeline Runner — barrel re-export.
 * Split into cli-runner/ directory for maintainability.
 *
 * @module electron/native-pipeline/cli-runner
 */

export {
	CLIPipelineRunner,
	type CLIRunOptions,
	type CLIResult,
	type ProgressFn,
	createProgressReporter,
	guessExtFromCommand,
	renderProgressBar,
} from "./cli-runner/index.js";
