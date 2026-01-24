/**
 * Remotion Integration Module
 *
 * This module provides the integration layer between QCut and Remotion,
 * enabling the use of Remotion components within the QCut video editor.
 *
 * @module lib/remotion
 */

// Types
export * from "./types";

// Components
export {
  RemotionPlayerWrapper,
  RemotionPlayerLoading,
  RemotionPlayerError,
  type RemotionPlayerWrapperProps,
  type RemotionPlayerHandle,
} from "./player-wrapper";

// Sync Manager
export {
  SyncManager,
  useSyncManager,
  globalToLocalFrame,
  localToGlobalFrame,
  timeToFrame,
  frameToTime,
  getActiveElements,
  isElementActive,
  DEFAULT_SYNC_CONFIG,
} from "./sync-manager";

// Re-export from @remotion/player for convenience
export { Player, type PlayerRef } from "@remotion/player";
