export type {
	Beat,
	BeatDetectionConfig,
	BeatDetectionResult,
	FirstOnsetResult,
	ResolvedBeatDetectionConfig,
} from "./beat-types.js";

export {
	analyzeFromSamples,
	detectFirstOnset,
	resolveConfig,
} from "./beat-detection-engine.js";
