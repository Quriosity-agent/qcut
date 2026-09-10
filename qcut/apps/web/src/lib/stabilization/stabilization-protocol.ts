import type { PlanarAnalysisFrame } from "@/lib/tracking/planar-tracker-protocol";

/**
 * Wire types for the in-house stabilizer: the renderer decodes analysis
 * frames, the OpenCV worker estimates the inter-frame camera motion, and the
 * result is cached per source content hash.
 */

/** Bump when the estimator or the analysis layout changes; cached analyses are keyed by it. */
export const STABILIZATION_ANALYSIS_VERSION = "qcut-stabilization-opencv-v1";

/** Analysis frames are downscaled to at most this size before estimation. */
export const STABILIZATION_ANALYSIS_MAX_WIDTH = 640;
export const STABILIZATION_ANALYSIS_MAX_HEIGHT = 360;

export type MotionAnalysisFrame = PlanarAnalysisFrame;

export interface MotionEstimatorConfiguration {
	maxFeatures: number;
	qualityLevel: number;
	minFeatureDistancePx: number;
	blockSize: number;
	lkWindowSize: number;
	pyramidLevels: number;
	forwardBackwardMaxErrorPx: number;
	ransacReprojectionThresholdPx: number;
	minInliers: number;
}

export const DEFAULT_MOTION_ESTIMATOR_CONFIGURATION = {
	blockSize: 7,
	forwardBackwardMaxErrorPx: 1.5,
	lkWindowSize: 21,
	maxFeatures: 300,
	minFeatureDistancePx: 8,
	minInliers: 12,
	pyramidLevels: 3,
	qualityLevel: 0.01,
	ransacReprojectionThresholdPx: 2,
} satisfies MotionEstimatorConfiguration;

/**
 * Similarity motion from the previous analysis frame to this one, in analysis
 * pixels. `dx`/`dy` are the displacement of the frame centre; `rotation` is in
 * radians (clockwise in image coordinates); `scale` is the uniform factor.
 * The first frame, and any frame whose features could not be matched
 * (`inliers === 0`), carries the identity.
 */
export interface FrameMotion {
	ptsUs: number;
	dx: number;
	dy: number;
	rotation: number;
	scale: number;
	tracked: number;
	inliers: number;
}

export interface MotionAnalysis {
	version: string;
	contentSha256: string;
	sourceWidth: number;
	sourceHeight: number;
	analysisWidth: number;
	analysisHeight: number;
	frames: FrameMotion[];
}

export type MotionEstimatorWorkerRequest =
	| { id: number; type: "initialize"; runtimeUrl: string }
	| {
			id: number;
			type: "push";
			frame: MotionAnalysisFrame;
			configuration: MotionEstimatorConfiguration;
	  }
	| { id: number; type: "reset" };

export type MotionEstimatorWorkerResponse =
	| { id: number; type: "initialized"; providerVersion: string }
	| { id: number; type: "motion"; motion: FrameMotion }
	| { id: number; type: "reset-done" }
	| { id: number; type: "error"; message: string };

export function identityFrameMotion({
	ptsUs,
	tracked = 0,
}: {
	ptsUs: number;
	tracked?: number;
}): FrameMotion {
	return { ptsUs, dx: 0, dy: 0, rotation: 0, scale: 1, tracked, inliers: 0 };
}
