/**
 * Claude Code Integration API
 * Main entry point for all Claude API handlers
 */

import { claudeLog } from "./utils/logger.js";

// Re-export individual setup functions for selective use
export { setupClaudeMediaIPC } from "./handlers/claude-media-handler.js";
export { setupClaudeTimelineIPC } from "./handlers/claude-timeline-handler.js";
export { setupClaudeProjectIPC } from "./handlers/claude-project-handler.js";
export { setupClaudeExportIPC } from "./handlers/claude-export-handler.js";
export { setupClaudeDiagnosticsIPC } from "./handlers/claude-diagnostics-handler.js";
export { setupClaudeAnalyzeIPC } from "./handlers/claude-analyze-handler.js";
export { setupClaudeNavigatorIPC } from "./handlers/claude-navigator-handler.js";
export { setupClaudeStateIPC } from "./handlers/claude-state-handler.js";
export { setupClaudeEventsIPC } from "./handlers/claude-events-handler.js";
export { setupClaudeNotificationIPC } from "./notification-bridge.js";
export {
	startClaudeHTTPServer,
	stopClaudeHTTPServer,
} from "./http/claude-http-server.js";

// Import for internal use
import { setupClaudeMediaIPC } from "./handlers/claude-media-handler.js";
import { setupClaudeTimelineIPC } from "./handlers/claude-timeline-handler.js";
import { setupClaudeProjectIPC } from "./handlers/claude-project-handler.js";
import { setupClaudeExportIPC } from "./handlers/claude-export-handler.js";
import { setupClaudeDiagnosticsIPC } from "./handlers/claude-diagnostics-handler.js";
import { setupClaudeAnalyzeIPC } from "./handlers/claude-analyze-handler.js";
import { setupClaudeNavigatorIPC } from "./handlers/claude-navigator-handler.js";
import { setupClaudeStateIPC } from "./handlers/claude-state-handler.js";
import { setupClaudeEventsIPC } from "./handlers/claude-events-handler.js";
import { setupClaudeNotificationIPC } from "./notification-bridge.js";
import { startClaudeHTTPServer } from "./http/claude-http-server.js";

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
	setupClaudeNavigatorIPC();
	setupClaudeStateIPC();
	setupClaudeEventsIPC();
	setupClaudeNotificationIPC();

	// HTTP server now runs in utility process (started via utility-bridge.ts)
	// See electron/utility/utility-http-server.ts

	claudeLog.info("Claude", "All handlers registered successfully");
}
