/**
 * Claude Export API Handler — barrel re-export.
 * Split into electron/claude/handlers/claude-export-handler/ directory.
 */

export {
	setupClaudeExportIPC,
	PRESETS,
	getExportPresets,
	getExportRecommendation,
	startExportJob,
	getExportJobStatus,
	listExportJobs,
	applyProgressEvent,
	clearExportJobsForTests,
} from "./claude-export-handler/index.js";
