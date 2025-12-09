/**
 * Generation Utilities
 *
 * Barrel file for generation-related utilities extracted from use-ai-generation.ts.
 */

export {
  integrateVideoToMediaStore,
  updateVideoWithLocalPaths,
  canIntegrateMedia,
  type MediaIntegrationResult,
  type MediaIntegrationOptions,
} from "./media-integration";

// Note: model-handlers.ts contains extracted handler functions for future integration
// Currently not exported due to type strictness requiring additional work
// See USE-AI-GENERATION-REFACTORING-PLAN.md for Phase 2 status
