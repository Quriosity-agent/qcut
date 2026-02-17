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
export { ModelRegistry } from "./registry.js";
export type {
  ModelDefinition,
  ModelCategory,
  ModelPricing,
  ModelDefinitionInput,
} from "./registry.js";

export { NativePipelineManager } from "./manager.js";
export type {
  GenerateOptions,
  PipelineProgress,
  PipelineResult,
  PipelineStatus,
} from "./manager.js";

export { PipelineExecutor } from "./executor.js";
export type { PipelineStep, PipelineChain, StepResult } from "./executor.js";

export { ParallelPipelineExecutor, MergeStrategy } from "./parallel-executor.js";
export type { ParallelConfig, ParallelStats, ParallelGroup } from "./parallel-executor.js";

export { callModelApi, downloadOutput, pollQueueStatus } from "./api-caller.js";
export type { ApiCallOptions, ApiCallResult } from "./api-caller.js";

export {
  parseChainConfig,
  validateChain,
  getDataTypeForCategory,
  hasParallelGroups,
} from "./chain-parser.js";

export {
  estimateCost,
  estimatePipelineCost,
  listModels,
} from "./cost-calculator.js";
export type { CostEstimate } from "./cost-calculator.js";
