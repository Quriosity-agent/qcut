/**
 * Claude Code Integration API
 * Main entry point for all Claude API handlers
 */

import { setupClaudeMediaIPC } from './claude-media-handler.js';
import { setupClaudeTimelineIPC } from './claude-timeline-handler.js';
import { setupClaudeProjectIPC } from './claude-project-handler.js';
import { setupClaudeExportIPC } from './claude-export-handler.js';
import { setupClaudeDiagnosticsIPC } from './claude-diagnostics-handler.js';

/**
 * Setup all Claude Code Integration IPC handlers
 * Call this once during app initialization
 */
export function setupAllClaudeIPC(): void {
  console.log('[Claude API] Initializing Claude Code Integration...');
  
  setupClaudeMediaIPC();
  setupClaudeTimelineIPC();
  setupClaudeProjectIPC();
  setupClaudeExportIPC();
  setupClaudeDiagnosticsIPC();
  
  console.log('[Claude API] All handlers registered successfully');
}

// Re-export individual setup functions for selective use
export {
  setupClaudeMediaIPC,
  setupClaudeTimelineIPC,
  setupClaudeProjectIPC,
  setupClaudeExportIPC,
  setupClaudeDiagnosticsIPC,
};

// CommonJS export for main.ts compatibility (uses require)
module.exports = {
  setupAllClaudeIPC,
  setupClaudeMediaIPC,
  setupClaudeTimelineIPC,
  setupClaudeProjectIPC,
  setupClaudeExportIPC,
  setupClaudeDiagnosticsIPC,
};
