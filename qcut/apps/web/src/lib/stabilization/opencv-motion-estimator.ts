import type { Mat } from "@techstark/opencv-js";
import type { OpenCvPlanarRuntime } from "@/lib/tracking/opencv-planar-tracker-kernel";
import {
	fitSimilarity,
	applySimilarity,
	type PlanePoint,
} from "./similarity-fit";
import {
	type FrameMotion,
	type MotionAnalysisFrame,
	type MotionEstimatorConfiguration,
	identityFrameMotion,
} from "./stabilization-protocol";

/**
 * Global camera-motion estimator on top of the bundled OpenCV runtime.
 *
 * Per frame pair: GFTT corners on the previous frame, pyramidal Lucas-Kanade
 * forward and backward (points that do not return within
 * `forwardBackwardMaxErrorPx` are dropped), RANSAC `estimateAffine2D` for the
 * inlier set, then a closed-form similarity on the inliers. A pair that
 * cannot be matched reports the identity with `inliers: 0` so the caller can
 * see the gap instead of an invented motion.
 */

export type OpenCvMotionRuntime = OpenCvPlanarRuntime;

export class OpenCvMotionEstimatorError extends Error {
	readonly code: string;
	constructor({ code, message }: { code: string; message: string }) {
		super(message);
		this.name = "OpenCvMotionEstimatorError";
		this.code = code;
	}
}

interface PreviousFrame {
	gray: Mat;
	width: number;
	height: number;
}

function validateFrame({ frame }: { frame: MotionAnalysisFrame }): void {
	if (
		!Number.isSafeInteger(frame.ptsUs) ||
		frame.width < 1 ||
		frame.height < 1 ||
		frame.gray.length !== frame.width * frame.height
	) {
		throw new OpenCvMotionEstimatorError({
			code: "decode-failed",
			message: "Invalid motion analysis frame.",
		});
	}
}

function pointsToMat({
	cv,
	points,
}: {
	cv: OpenCvMotionRuntime;
	points: readonly PlanePoint[];
}): Mat {
	return cv.matFromArray(
		points.length,
		1,
		cv.CV_32FC2,
		points.flatMap((point) => [point.x, point.y])
	);
}

function pointsFromMat({ mat }: { mat: Mat }): PlanePoint[] {
	const points: PlanePoint[] = [];
	for (let index = 0; index < mat.rows; index += 1) {
		points.push({ x: mat.data32F[index * 2], y: mat.data32F[index * 2 + 1] });
	}
	return points;
}

export class OpenCvMotionEstimator {
	private readonly cv: OpenCvMotionRuntime;
	private previous?: PreviousFrame;

	constructor({ cv }: { cv: OpenCvMotionRuntime }) {
		this.cv = cv;
	}

	private frameMat({ frame }: { frame: MotionAnalysisFrame }): Mat {
		validateFrame({ frame });
		return this.cv.matFromArray(
			frame.height,
			frame.width,
			this.cv.CV_8UC1,
			frame.gray
		);
	}

	private detectFeatures({
		configuration,
		gray,
	}: {
		configuration: MotionEstimatorConfiguration;
		gray: Mat;
	}): PlanePoint[] {
		const detector = new this.cv.GFTTDetector();
		const keypoints = new this.cv.KeyPointVector();
		const noMask = new this.cv.Mat();
		try {
			detector.setMaxFeatures(configuration.maxFeatures);
			detector.setQualityLevel(configuration.qualityLevel);
			detector.setMinDistance(configuration.minFeatureDistancePx);
			detector.setBlockSize(configuration.blockSize);
			detector.setHarrisDetector(false);
			detector.setK(0.04);
			detector.detect(gray, keypoints, noMask);
			const points: PlanePoint[] = [];
			for (let index = 0; index < keypoints.size(); index += 1) {
				const keypoint = keypoints.get(index) as unknown as { pt: PlanePoint };
				if (Number.isFinite(keypoint.pt.x) && Number.isFinite(keypoint.pt.y)) {
					points.push({ x: keypoint.pt.x, y: keypoint.pt.y });
				}
			}
			return points;
		} finally {
			noMask.delete();
			keypoints.delete();
			detector.delete();
		}
	}

	/** Tracks `points` from `prevGray` into `nextGray`; returns surviving pairs. */
	private trackFeatures({
		configuration,
		prevGray,
		nextGray,
		points,
	}: {
		configuration: MotionEstimatorConfiguration;
		prevGray: Mat;
		nextGray: Mat;
		points: readonly PlanePoint[];
	}): { from: PlanePoint[]; to: PlanePoint[] } {
		const cv = this.cv;
		const prevPointsMat = pointsToMat({ cv, points });
		const nextPointsMat = new cv.Mat();
		const forwardStatus = new cv.Mat();
		const forwardError = new cv.Mat();
		const backwardPointsMat = new cv.Mat();
		const backwardStatus = new cv.Mat();
		const backwardError = new cv.Mat();
		try {
			const windowSize = new cv.Size(
				configuration.lkWindowSize,
				configuration.lkWindowSize
			);
			const criteria = new cv.TermCriteria(
				cv.TermCriteria_COUNT + cv.TermCriteria_EPS,
				30,
				0.01
			);
			cv.calcOpticalFlowPyrLK(
				prevGray,
				nextGray,
				prevPointsMat,
				nextPointsMat,
				forwardStatus,
				forwardError,
				windowSize,
				configuration.pyramidLevels,
				criteria
			);
			cv.calcOpticalFlowPyrLK(
				nextGray,
				prevGray,
				nextPointsMat,
				backwardPointsMat,
				backwardStatus,
				backwardError,
				windowSize,
				configuration.pyramidLevels,
				criteria
			);
			const nextPoints = pointsFromMat({ mat: nextPointsMat });
			const backwardPoints = pointsFromMat({ mat: backwardPointsMat });
			const from: PlanePoint[] = [];
			const to: PlanePoint[] = [];
			for (let index = 0; index < points.length; index += 1) {
				if (
					forwardStatus.data[index] !== 1 ||
					backwardStatus.data[index] !== 1
				) {
					continue;
				}
				const previous = points[index];
				const current = nextPoints[index];
				const backward = backwardPoints[index];
				if (
					!Number.isFinite(current.x) ||
					!Number.isFinite(current.y) ||
					Math.hypot(backward.x - previous.x, backward.y - previous.y) >
						configuration.forwardBackwardMaxErrorPx
				) {
					continue;
				}
				from.push(previous);
				to.push(current);
			}
			return { from, to };
		} finally {
			prevPointsMat.delete();
			nextPointsMat.delete();
			forwardStatus.delete();
			forwardError.delete();
			backwardPointsMat.delete();
			backwardStatus.delete();
			backwardError.delete();
		}
	}

	/** RANSAC inlier subset of the tracked pairs (empty when estimation fails). */
	private robustInliers({
		configuration,
		from,
		to,
	}: {
		configuration: MotionEstimatorConfiguration;
		from: readonly PlanePoint[];
		to: readonly PlanePoint[];
	}): { from: PlanePoint[]; to: PlanePoint[] } {
		const cv = this.cv;
		const fromMat = pointsToMat({ cv, points: from });
		const toMat = pointsToMat({ cv, points: to });
		const inliers = new cv.Mat();
		let affine: Mat | undefined;
		try {
			affine = cv.estimateAffine2D(
				fromMat,
				toMat,
				inliers,
				cv.RANSAC,
				configuration.ransacReprojectionThresholdPx,
				2000,
				0.99,
				10
			) as Mat;
			if (!affine || affine.rows === 0) return { from: [], to: [] };
			const keptFrom: PlanePoint[] = [];
			const keptTo: PlanePoint[] = [];
			for (let index = 0; index < from.length; index += 1) {
				if (inliers.data[index] !== 1) continue;
				keptFrom.push(from[index]);
				keptTo.push(to[index]);
			}
			return { from: keptFrom, to: keptTo };
		} finally {
			affine?.delete();
			inliers.delete();
			toMat.delete();
			fromMat.delete();
		}
	}

	/** Estimates the motion from the previous pushed frame into `frame`. */
	push({
		frame,
		configuration,
	}: {
		frame: MotionAnalysisFrame;
		configuration: MotionEstimatorConfiguration;
	}): FrameMotion {
		const nextGray = this.frameMat({ frame });
		const previous = this.previous;
		this.previous = {
			gray: nextGray,
			width: frame.width,
			height: frame.height,
		};
		if (!previous) return identityFrameMotion({ ptsUs: frame.ptsUs });
		try {
			if (previous.width !== frame.width || previous.height !== frame.height) {
				throw new OpenCvMotionEstimatorError({
					code: "frame-size-changed",
					message: "Motion analysis frames must share one size.",
				});
			}
			const corners = this.detectFeatures({
				configuration,
				gray: previous.gray,
			});
			if (corners.length < configuration.minInliers) {
				return identityFrameMotion({ ptsUs: frame.ptsUs, tracked: 0 });
			}
			const tracked = this.trackFeatures({
				configuration,
				prevGray: previous.gray,
				nextGray,
				points: corners,
			});
			if (tracked.from.length < configuration.minInliers) {
				return identityFrameMotion({
					ptsUs: frame.ptsUs,
					tracked: tracked.from.length,
				});
			}
			const inliers = this.robustInliers({ configuration, ...tracked });
			if (inliers.from.length < configuration.minInliers) {
				return identityFrameMotion({
					ptsUs: frame.ptsUs,
					tracked: tracked.from.length,
				});
			}
			const similarity = fitSimilarity(inliers);
			if (!similarity) {
				return identityFrameMotion({
					ptsUs: frame.ptsUs,
					tracked: tracked.from.length,
				});
			}
			const center = { x: frame.width / 2, y: frame.height / 2 };
			const moved = applySimilarity({ transform: similarity, point: center });
			return {
				ptsUs: frame.ptsUs,
				dx: moved.x - center.x,
				dy: moved.y - center.y,
				rotation: similarity.rotation,
				scale: similarity.scale,
				tracked: tracked.from.length,
				inliers: inliers.from.length,
			};
		} finally {
			previous.gray.delete();
		}
	}

	reset(): void {
		this.previous?.gray.delete();
		this.previous = undefined;
	}

	dispose(): void {
		this.reset();
	}
}
