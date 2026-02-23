/**
 * Native Pipeline - Barrel export
 *
 * Initializes the model registry and exports all public APIs.
 *
 * @module electron/native-pipeline
 */

// Initialize registry with all models (shared with CLI)
import { initRegistry } from "./init.js";
initRegistry();

// Public exports
export { ModelRegistry } from "./infra/registry.js";
export type {
	ModelDefinition,
	ModelCategory,
	ModelPricing,
	ModelDefinitionInput,
} from "./infra/registry.js";

export { NativePipelineManager } from "./manager.js";
export type {
	GenerateOptions,
	PipelineProgress,
	PipelineResult,
	PipelineStatus,
} from "./manager.js";

export { PipelineExecutor } from "./execution/executor.js";
export type {
	PipelineStep,
	PipelineChain,
	StepResult,
} from "./execution/executor.js";

export {
	ParallelPipelineExecutor,
	MergeStrategy,
} from "./execution/parallel-executor.js";
export type {
	ParallelConfig,
	ParallelStats,
	ParallelGroup,
} from "./execution/parallel-executor.js";

export {
	callModelApi,
	downloadOutput,
	pollQueueStatus,
} from "./infra/api-caller.js";
export type { ApiCallOptions, ApiCallResult } from "./infra/api-caller.js";

export {
	parseChainConfig,
	validateChain,
	getDataTypeForCategory,
	hasParallelGroups,
} from "./execution/chain-parser.js";

export {
	estimateCost,
	estimatePipelineCost,
	listModels,
} from "./infra/cost-calculator.js";
export type { CostEstimate } from "./infra/cost-calculator.js";

// ViMax pipeline re-exports
export * from "./vimax/index.js";
