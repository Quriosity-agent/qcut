/**
 * Closed-loop check of the in-house stabilizer on the real OpenCV runtime.
 *
 *   bun scripts/validate-stabilizer.ts
 *
 * Synthesises a textured clip with a known random-walk camera jitter
 * (translation, rotation, scale), runs the motion estimator on it, compares
 * the recovered inter-frame motions with the ground truth, then applies the
 * stabilization plan and measures how much frame-to-frame motion survives in
 * the output. The output must also stay free of black borders — the lens
 * motion constraint is what guarantees that, so a border pixel is a failure.
 */
import { join } from "node:path";
import type { Mat } from "@techstark/opencv-js";
import {
	OpenCvMotionEstimator,
	type OpenCvMotionRuntime,
} from "../apps/web/src/lib/stabilization/opencv-motion-estimator";
import {
	buildStabilizationPlan,
	stabilizedFrameMatrix,
} from "../apps/web/src/lib/stabilization/stabilization-plan";
import {
	DEFAULT_MOTION_ESTIMATOR_CONFIGURATION,
	type FrameMotion,
	type MotionAnalysis,
	STABILIZATION_ANALYSIS_VERSION,
} from "../apps/web/src/lib/stabilization/stabilization-protocol";

const WIDTH = 640;
const HEIGHT = 360;
const MARGIN = 120;
const FRAMES = 60;
const FPS = 30;
const CROP_SCALE = 0.9;
const SMOOTHING_SECONDS = 0.5;

type Affine = [number, number, number, number, number, number];

interface Jitter {
	dx: number;
	dy: number;
	rotation: number;
	scale: number;
}

class Random {
	private state: number;
	constructor(seed: number) {
		this.state = seed >>> 0;
	}
	unit(): number {
		this.state = (this.state * 1664525 + 1013904223) >>> 0;
		return (this.state >>> 8) / 16777216;
	}
	range(low: number, high: number): number {
		return low + (high - low) * this.unit();
	}
}

/** Canvas-style affine `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
function compose(second: Affine, first: Affine): Affine {
	const [a1, b1, c1, d1, e1, f1] = first;
	const [a2, b2, c2, d2, e2, f2] = second;
	return [
		a2 * a1 + c2 * b1,
		b2 * a1 + d2 * b1,
		a2 * c1 + c2 * d1,
		b2 * c1 + d2 * d1,
		a2 * e1 + c2 * f1 + e2,
		b2 * e1 + d2 * f1 + f2,
	];
}

function similarityAboutCenter({ dx, dy, rotation, scale }: Jitter): Affine {
	const a = Math.cos(rotation) * scale;
	const b = Math.sin(rotation) * scale;
	const cx = WIDTH / 2;
	const cy = HEIGHT / 2;
	return [
		a,
		b,
		-b,
		a,
		cx - (a * cx - b * cy) + dx,
		cy - (b * cx + a * cy) + dy,
	];
}

function affineMat({
	cv,
	affine,
}: {
	cv: OpenCvMotionRuntime;
	affine: Affine;
}): Mat {
	const [a, b, c, d, e, f] = affine;
	return cv.matFromArray(2, 3, cv.CV_64F, [a, c, e, b, d, f]);
}

function createTexture({ random }: { random: Random }): Uint8Array {
	const width = WIDTH + 2 * MARGIN;
	const height = HEIGHT + 2 * MARGIN;
	const noise = new Float32Array(width * height);
	for (let index = 0; index < noise.length; index += 1)
		noise[index] = random.unit();
	// Two box blurs give mid-frequency texture that corners and LK both like.
	let source = noise;
	for (let pass = 0; pass < 2; pass += 1) {
		const blurred = new Float32Array(width * height);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				let sum = 0;
				let count = 0;
				for (let oy = -2; oy <= 2; oy += 1) {
					for (let ox = -2; ox <= 2; ox += 1) {
						const sx = x + ox;
						const sy = y + oy;
						if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
						sum += source[sy * width + sx];
						count += 1;
					}
				}
				blurred[y * width + x] = sum / count;
			}
		}
		source = blurred;
	}
	const pixels = new Uint8Array(width * height);
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = Math.round(40 + (source[index] - 0.5) * 900 + 90);
	}
	// A few flat rectangles add strong corners of a different scale.
	for (let block = 0; block < 40; block += 1) {
		const bw = Math.round(random.range(12, 40));
		const bh = Math.round(random.range(12, 40));
		const bx = Math.round(random.range(0, width - bw));
		const by = Math.round(random.range(0, height - bh));
		const value = Math.round(random.range(0, 255));
		for (let y = by; y < by + bh; y += 1) {
			for (let x = bx; x < bx + bw; x += 1) pixels[y * width + x] = value;
		}
	}
	return pixels;
}

function warp({
	cv,
	source,
	affine,
	borderMode,
}: {
	cv: OpenCvMotionRuntime;
	source: Mat;
	affine: Affine;
	borderMode: number;
}): Uint8Array {
	const destination = new cv.Mat();
	const matrix = affineMat({ cv, affine });
	try {
		cv.warpAffine(
			source,
			destination,
			matrix,
			new cv.Size(WIDTH, HEIGHT),
			cv.INTER_LINEAR,
			borderMode,
			new cv.Scalar(0, 0, 0, 0)
		);
		return new Uint8Array(destination.data);
	} finally {
		matrix.delete();
		destination.delete();
	}
}

function estimate({
	cv,
	frames,
}: {
	cv: OpenCvMotionRuntime;
	frames: Uint8Array[];
}): FrameMotion[] {
	const estimator = new OpenCvMotionEstimator({ cv });
	try {
		return frames.map((gray, index) =>
			estimator.push({
				frame: {
					gray,
					width: WIDTH,
					height: HEIGHT,
					ptsUs: Math.round((index * 1_000_000) / FPS),
				},
				configuration: DEFAULT_MOTION_ESTIMATOR_CONFIGURATION,
			})
		);
	} finally {
		estimator.dispose();
	}
}

function rms(values: number[]): number {
	if (values.length === 0) return 0;
	return Math.sqrt(
		values.reduce((sum, value) => sum + value * value, 0) / values.length
	);
}

function blackBorderFraction({ gray }: { gray: Uint8Array }): number {
	let black = 0;
	let total = 0;
	const band = 3;
	for (let y = 0; y < HEIGHT; y += 1) {
		for (let x = 0; x < WIDTH; x += 1) {
			if (x >= band && x < WIDTH - band && y >= band && y < HEIGHT - band)
				continue;
			total += 1;
			if (gray[y * WIDTH + x] === 0) black += 1;
		}
	}
	return black / total;
}

const runtimePath = Bun.resolveSync(
	"@techstark/opencv-js",
	join(process.cwd(), "apps", "web", "package.json")
);
const runtimeModule = (await import(runtimePath)) as {
	default: Promise<OpenCvMotionRuntime>;
};
const cv = await runtimeModule.default;

const random = new Random(20260910);
const texture = createTexture({ random });
const textureMat = cv.matFromArray(
	HEIGHT + 2 * MARGIN,
	WIDTH + 2 * MARGIN,
	cv.CV_8UC1,
	texture
);

// Ground truth: a random-walk jitter; frame i = J_i ∘ frame i-1 content.
const truth: Jitter[] = [{ dx: 0, dy: 0, rotation: 0, scale: 1 }];
for (let index = 1; index < FRAMES; index += 1) {
	truth.push({
		dx: random.range(-3, 3),
		dy: random.range(-3, 3),
		rotation: random.range(-0.4, 0.4) * (Math.PI / 180),
		scale: 1 + random.range(-0.006, 0.006),
	});
}
const shift: Affine = [1, 0, 0, 1, -MARGIN, -MARGIN];
let cumulative: Affine = [1, 0, 0, 1, 0, 0];
const inputs: Uint8Array[] = [];
for (const jitter of truth) {
	cumulative = compose(similarityAboutCenter(jitter), cumulative);
	inputs.push(
		warp({
			cv,
			source: textureMat,
			affine: compose(cumulative, shift),
			borderMode: cv.BORDER_REFLECT,
		})
	);
}

const recovered = estimate({ cv, frames: inputs });
const translationErrors: number[] = [];
const rotationErrors: number[] = [];
const scaleErrors: number[] = [];
let lostFrames = 0;
for (let index = 1; index < FRAMES; index += 1) {
	const motion = recovered[index];
	if (motion.inliers === 0) lostFrames += 1;
	translationErrors.push(
		Math.hypot(motion.dx - truth[index].dx, motion.dy - truth[index].dy)
	);
	rotationErrors.push(
		Math.abs(motion.rotation - truth[index].rotation) * (180 / Math.PI)
	);
	scaleErrors.push(Math.abs(motion.scale - truth[index].scale));
}

const analysis: MotionAnalysis = {
	version: STABILIZATION_ANALYSIS_VERSION,
	contentSha256: "synthetic",
	sourceWidth: WIDTH,
	sourceHeight: HEIGHT,
	analysisWidth: WIDTH,
	analysisHeight: HEIGHT,
	frames: recovered,
};
const plan = buildStabilizationPlan({
	analysis,
	profile: { smoothingSeconds: SMOOTHING_SECONDS, cropScale: CROP_SCALE },
});
const outputs: Uint8Array[] = [];
let worstBorder = 0;
for (let index = 0; index < FRAMES; index += 1) {
	const frameMat = cv.matFromArray(HEIGHT, WIDTH, cv.CV_8UC1, inputs[index]);
	try {
		const output = warp({
			cv,
			source: frameMat,
			affine: stabilizedFrameMatrix({
				frame: plan.frames[index],
				cropScale: plan.cropScale,
				width: WIDTH,
				height: HEIGHT,
			}),
			borderMode: cv.BORDER_CONSTANT,
		});
		worstBorder = Math.max(worstBorder, blackBorderFraction({ gray: output }));
		outputs.push(output);
	} finally {
		frameMat.delete();
	}
}
textureMat.delete();

const residual = estimate({ cv, frames: outputs });
const inputJitter = rms(truth.slice(1).map((j) => Math.hypot(j.dx, j.dy)));
const outputJitter = rms(residual.slice(1).map((m) => Math.hypot(m.dx, m.dy)));
const inputRotation = rms(
	truth.slice(1).map((j) => j.rotation * (180 / Math.PI))
);
const outputRotation = rms(
	residual.slice(1).map((m) => m.rotation * (180 / Math.PI))
);

const report = {
	frames: FRAMES,
	lostFrames,
	translationErrorMeanPx: rms(translationErrors),
	translationErrorMaxPx: Math.max(...translationErrors),
	rotationErrorMaxDeg: Math.max(...rotationErrors),
	scaleErrorMax: Math.max(...scaleErrors),
	inputJitterRmsPx: inputJitter,
	outputJitterRmsPx: outputJitter,
	jitterRatio: outputJitter / inputJitter,
	inputRotationRmsDeg: inputRotation,
	outputRotationRmsDeg: outputRotation,
	worstBlackBorderFraction: worstBorder,
	minInliers: Math.min(...recovered.slice(1).map((m) => m.inliers)),
};
console.log(JSON.stringify(report, null, 2));

const failures: string[] = [];
if (lostFrames > 0) failures.push(`${lostFrames} frame pairs lost`);
if (report.translationErrorMaxPx > 0.35)
	failures.push(
		`translation error ${report.translationErrorMaxPx.toFixed(3)} px`
	);
if (report.rotationErrorMaxDeg > 0.05)
	failures.push(`rotation error ${report.rotationErrorMaxDeg.toFixed(4)} deg`);
if (report.scaleErrorMax > 0.003)
	failures.push(`scale error ${report.scaleErrorMax.toFixed(5)}`);
if (report.jitterRatio > 0.35)
	failures.push(
		`output keeps ${(report.jitterRatio * 100).toFixed(1)}% of the jitter`
	);
if (report.worstBlackBorderFraction > 0.005)
	failures.push(
		`black border fraction ${report.worstBlackBorderFraction.toFixed(4)}`
	);
if (failures.length > 0) {
	console.error(`✗ stabilizer validation failed: ${failures.join("; ")}`);
	process.exitCode = 1;
} else {
	console.log(
		`✓ estimator within tolerance and the plan removes ${((1 - report.jitterRatio) * 100).toFixed(1)}% of the jitter without borders.`
	);
}
