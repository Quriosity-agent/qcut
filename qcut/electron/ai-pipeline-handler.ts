/**
 * AI Pipeline Handler — barrel re-export.
 * Split into ai-pipeline-handler/ directory for maintainability.
 *
 * @module electron/ai-pipeline-handler
 */

export {
	AIPipelineManager,
	type GenerateOptions,
	type PipelineProgress,
	type PipelineResult,
	type PipelineStatus,
	type PipelineConfig,
} from "./ai-pipeline-handler/index.js";
