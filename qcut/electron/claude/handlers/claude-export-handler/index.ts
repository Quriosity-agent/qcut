/**
 * Claude Export API Handler — barrel re-exports.
 * @module electron/claude/handlers/claude-export-handler
 */

export { PRESETS } from "./presets.js";
export {
	getExportPresets,
	getExportRecommendation,
	startExportJob,
	applyProgressEvent,
} from "./public-api.js";
export {
	getExportJobStatus,
	listExportJobs,
	clearExportJobsForTests,
} from "./job-manager.js";
export { setupClaudeExportIPC } from "./ipc.js";

// CommonJS export for main.ts compatibility
module.exports = {
	setupClaudeExportIPC: require("./ipc.js").setupClaudeExportIPC,
	PRESETS: require("./presets.js").PRESETS,
	getExportPresets: require("./public-api.js").getExportPresets,
	getExportRecommendation: require("./public-api.js").getExportRecommendation,
	startExportJob: require("./public-api.js").startExportJob,
	getExportJobStatus: require("./job-manager.js").getExportJobStatus,
	listExportJobs: require("./job-manager.js").listExportJobs,
	applyProgressEvent: require("./public-api.js").applyProgressEvent,
	clearExportJobsForTests: require("./job-manager.js").clearExportJobsForTests,
};
