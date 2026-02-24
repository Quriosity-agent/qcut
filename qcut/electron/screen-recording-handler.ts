/**
 * Screen Recording Handler — barrel re-export.
 * Split into electron/screen-recording-handler/ directory.
 */

export {
	setupScreenRecordingIPC,
	listCaptureSources,
	buildStatus,
} from "./screen-recording-handler/index.js";
