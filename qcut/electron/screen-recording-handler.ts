/**
 * Screen Recording Handler — barrel re-export.
 * Split into electron/screen-recording-handler/ directory.
 */

export {
	setupScreenRecordingIPC,
	forceStopActiveScreenRecordingSession,
	listCaptureSources,
	buildStatus,
} from "./screen-recording-handler/index.js";
