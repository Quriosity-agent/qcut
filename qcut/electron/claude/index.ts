/**
 * Claude Code Integration API
 * Main entry point for all Claude API handlers
 */

import { claudeLog } from "./utils/logger.js";

// Re-export individual setup functions for selective use
export { setupClaudeMediaIPC } from "./claude-media-handler.js";
export { setupClaudeTimelineIPC } from "./claude-timeline-handler.js";
export { setupClaudeProjectIPC } from "./claude-project-handler.js";
export { setupClaudeExportIPC } from "./claude-export-handler.js";
export { setupClaudeDiagnosticsIPC } from "./claude-diagnostics-handler.js";

// Import for internal use
import { setupClaudeMediaIPC } from "./claude-media-handler.js";
import { setupClaudeTimelineIPC } from "./claude-timeline-handler.js";
import { setupClaudeProjectIPC } from "./claude-project-handler.js";
import { setupClaudeExportIPC } from "./claude-export-handler.js";
import { setupClaudeDiagnosticsIPC } from "./claude-diagnostics-handler.js";

/**
 * Setup all Claude Code Integration IPC handlers
 * Call this once during app initialization
 */
export function setupAllClaudeIPC(): void {
  claudeLog.info("Claude", "Initializing Claude Code Integration...");

  setupClaudeMediaIPC();
  setupClaudeTimelineIPC();
  setupClaudeProjectIPC();
  setupClaudeExportIPC();
  setupClaudeDiagnosticsIPC();

  claudeLog.info("Claude", "All handlers registered successfully");
}

// CommonJS export for main.ts compatibility (uses require)
module.exports = {
  setupAllClaudeIPC,
  setupClaudeMediaIPC,
  setupClaudeTimelineIPC,
  setupClaudeProjectIPC,
  setupClaudeExportIPC,
  setupClaudeDiagnosticsIPC,
};
