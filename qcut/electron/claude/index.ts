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
export { setupClaudeAnalyzeIPC } from "./claude-analyze-handler.js";
export {
	startClaudeHTTPServer,
	stopClaudeHTTPServer,
} from "./claude-http-server.js";

// Import for internal use
import { setupClaudeMediaIPC } from "./claude-media-handler.js";
import { setupClaudeTimelineIPC } from "./claude-timeline-handler.js";
import { setupClaudeProjectIPC } from "./claude-project-handler.js";
import { setupClaudeExportIPC } from "./claude-export-handler.js";
import { setupClaudeDiagnosticsIPC } from "./claude-diagnostics-handler.js";
import { setupClaudeAnalyzeIPC } from "./claude-analyze-handler.js";
import { startClaudeHTTPServer } from "./claude-http-server.js";

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
	setupClaudeAnalyzeIPC();

	// Start HTTP server for external control (non-blocking — failure is non-fatal)
	try {
		startClaudeHTTPServer();
	} catch (error) {
		claudeLog.warn(
			"Claude",
			`HTTP server failed to start: ${error}. External control disabled.`
		);
	}

	claudeLog.info("Claude", "All handlers registered successfully");
}
