import { gaussianSmooth } from "./lens-gaussian";
import {
	DEFAULT_MINIMUM_SCALE,
	constrainMotion,
} from "./lens-motion-constraint";
import type { MotionAnalysis } from "./stabilization-protocol";

/**
 * Turns a motion analysis into per-frame corrective transforms.
 *
 * The per-frame similarity motions are accumulated into a camera trajectory
 * (centre translation, rotation, log-scale), the trajectory is smoothed with
 * the lens Gaussian, and the difference between the smooth and the measured
 * path becomes the content correction for each frame. The recovered lens
 * motion constraint then clips every correction so the sampling window —
 * the output rectangle shrunk by `cropScale`, rotated and translated back
 * into the source — never leaves the source frame, which is what keeps the
 * output free of black borders without any inpainting.
 */

export interface StabilizationProfile {
	/** Full width of the smoothing window in seconds of source time. */
	smoothingSeconds: number;
	/** Fraction of the source kept; the output zooms by `1 / cropScale`. */
	cropScale: number;
}

/**
 * Content transform for one source frame, in source pixels about the frame
 * centre and before the crop zoom: `q = c + scale·R(rotation)·(p − c) + t`.
 */
export interface StabilizedFrame {
	ptsUs: number;
	translationX: number;
	translationY: number;
	/** Radians, clockwise in image coordinates. */
	rotation: number;
	scale: number;
}

export interface StabilizationPlan {
	cropScale: number;
	sourceWidth: number;
	sourceHeight: number;
	frameIntervalUs: number;
	frames: StabilizedFrame[];
}

export const IDENTITY_STABILIZED_FRAME: Omit<StabilizedFrame, "ptsUs"> = {
	translationX: 0,
	translationY: 0,
	rotation: 0,
	scale: 1,
};

const DEGREES_PER_RADIAN = 180 / Math.PI;

function medianFrameIntervalUs({ ptsUs }: { ptsUs: number[] }): number {
	const deltas: number[] = [];
	for (let index = 1; index < ptsUs.length; index += 1) {
		const delta = ptsUs[index] - ptsUs[index - 1];
		if (delta > 0) deltas.push(delta);
	}
	if (deltas.length === 0) return 1_000_000 / 30;
	deltas.sort((a, b) => a - b);
	return deltas[Math.floor(deltas.length / 2)];
}

function smoothTrajectory({
	values,
	length,
}: {
	values: Float64Array;
	length: number;
}): ArrayLike<number> {
	if (length <= 1) return values;
	return (
		gaussianSmooth({ input: values, request: { length, sigma: 1 } }) ?? values
	);
}

export function buildStabilizationPlan({
	analysis,
	profile,
}: {
	analysis: MotionAnalysis;
	profile: StabilizationProfile;
}): StabilizationPlan {
	const cropScale = Math.min(
		1,
		Math.max(DEFAULT_MINIMUM_SCALE, profile.cropScale)
	);
	const frames = analysis.frames;
	const count = frames.length;
	const frameIntervalUs = medianFrameIntervalUs({
		ptsUs: frames.map((frame) => frame.ptsUs),
	});
	const pixelScale = analysis.sourceWidth / Math.max(1, analysis.analysisWidth);
	const x = new Float64Array(count);
	const y = new Float64Array(count);
	const angle = new Float64Array(count);
	const logScale = new Float64Array(count);
	for (let index = 1; index < count; index += 1) {
		const motion = frames[index];
		x[index] = x[index - 1] + motion.dx * pixelScale;
		y[index] = y[index - 1] + motion.dy * pixelScale;
		angle[index] = angle[index - 1] + motion.rotation;
		logScale[index] =
			logScale[index - 1] + (motion.scale > 0 ? Math.log(motion.scale) : 0);
	}
	const radius = Math.max(
		0,
		Math.round((profile.smoothingSeconds * 1_000_000) / frameIntervalUs / 2)
	);
	const length = Math.min(4095, 2 * radius + 1);
	const smoothX = smoothTrajectory({ values: x, length });
	const smoothY = smoothTrajectory({ values: y, length });
	const smoothAngle = smoothTrajectory({ values: angle, length });
	const smoothLogScale = smoothTrajectory({ values: logScale, length });
	const center = { x: analysis.sourceWidth / 2, y: analysis.sourceHeight / 2 };
	const constraint = {
		width: analysis.sourceWidth,
		height: analysis.sourceHeight,
		center,
		minimumScale: DEFAULT_MINIMUM_SCALE,
	};
	const planned: StabilizedFrame[] = [];
	for (let index = 0; index < count; index += 1) {
		const translationX = smoothX[index] - x[index];
		const translationY = smoothY[index] - y[index];
		const rotation = smoothAngle[index] - angle[index];
		const scale = Math.exp(smoothLogScale[index] - logScale[index]);
		// Sampling window of this output frame, expressed the way Move::Run
		// composes it: scale about the centre, rotate, translate.
		const inverseScale = 1 / scale;
		const cosine = Math.cos(-rotation);
		const sine = Math.sin(-rotation);
		const constrained = constrainMotion({
			constraint,
			input: {
				translationX:
					-inverseScale * (cosine * translationX - sine * translationY),
				translationY:
					-inverseScale * (sine * translationX + cosine * translationY),
				degrees: -rotation * DEGREES_PER_RADIAN,
				scale: cropScale * inverseScale,
			},
		});
		if (!constrained) {
			planned.push({
				ptsUs: frames[index].ptsUs,
				...IDENTITY_STABILIZED_FRAME,
			});
			continue;
		}
		const fittedRotation = -constrained.degrees / DEGREES_PER_RADIAN;
		const fittedScale = cropScale / constrained.scale;
		const fittedCosine = Math.cos(fittedRotation) * fittedScale;
		const fittedSine = Math.sin(fittedRotation) * fittedScale;
		planned.push({
			ptsUs: frames[index].ptsUs,
			translationX: -(
				fittedCosine * constrained.translationX -
				fittedSine * constrained.translationY
			),
			translationY: -(
				fittedSine * constrained.translationX +
				fittedCosine * constrained.translationY
			),
			rotation: fittedRotation,
			scale: fittedScale,
		});
	}
	return {
		cropScale,
		sourceWidth: analysis.sourceWidth,
		sourceHeight: analysis.sourceHeight,
		frameIntervalUs,
		frames: planned,
	};
}

/** Nearest planned frame to a source time, or null outside the analysed range. */
export function lookupStabilizedFrame({
	plan,
	sourceTimeSeconds,
}: {
	plan: StabilizationPlan;
	sourceTimeSeconds: number;
}): StabilizedFrame | null {
	const frames = plan.frames;
	if (frames.length === 0 || !Number.isFinite(sourceTimeSeconds)) return null;
	const ptsUs = sourceTimeSeconds * 1_000_000;
	let low = 0;
	let high = frames.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (frames[middle].ptsUs <= ptsUs) low = middle;
		else high = middle - 1;
	}
	let best = frames[low];
	if (low + 1 < frames.length) {
		const next = frames[low + 1];
		if (Math.abs(next.ptsUs - ptsUs) < Math.abs(best.ptsUs - ptsUs))
			best = next;
	}
	if (Math.abs(best.ptsUs - ptsUs) > plan.frameIntervalUs * 1.5) return null;
	return best;
}

/**
 * Canvas/affine matrix `[a, b, c, d, e, f]` mapping source pixels to output
 * pixels for one frame: the content correction about the centre followed by
 * the crop zoom about the centre.
 */
export function stabilizedFrameMatrix({
	frame,
	cropScale,
	width,
	height,
}: {
	frame: Omit<StabilizedFrame, "ptsUs">;
	cropScale: number;
	width: number;
	height: number;
}): [number, number, number, number, number, number] {
	const zoom = 1 / cropScale;
	const scale = frame.scale * zoom;
	const a = Math.cos(frame.rotation) * scale;
	const b = Math.sin(frame.rotation) * scale;
	const centerX = width / 2;
	const centerY = height / 2;
	return [
		a,
		b,
		-b,
		a,
		centerX - (a * centerX - b * centerY) + frame.translationX * zoom,
		centerY - (b * centerX + a * centerY) + frame.translationY * zoom,
	];
}

/** Draws `source` stabilized into a same-size context (cleared first). */
export function drawStabilizedFrame({
	context,
	source,
	frame,
	cropScale,
	width,
	height,
}: {
	context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	source: CanvasImageSource;
	frame: Omit<StabilizedFrame, "ptsUs">;
	cropScale: number;
	width: number;
	height: number;
}): void {
	const [a, b, c, d, e, f] = stabilizedFrameMatrix({
		frame,
		cropScale,
		width,
		height,
	});
	context.save();
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, width, height);
	context.setTransform(a, b, c, d, e, f);
	context.drawImage(source, 0, 0, width, height);
	context.restore();
}
