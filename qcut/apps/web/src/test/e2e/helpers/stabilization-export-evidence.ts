/**
 * Evidence helpers for the stabilization export E2E: a synthetic shaky clip
 * with a known static scene, grayscale frame decoding, and the same OpenCV
 * motion estimator the product uses, run here in the test process to measure
 * how much frame-to-frame motion a clip carries.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { getFFmpegPath } from "../../../../../../electron/ffmpeg/paths";
import {
	OpenCvMotionEstimator,
	type OpenCvMotionRuntime,
} from "../../../lib/stabilization/opencv-motion-estimator";
import { DEFAULT_MOTION_ESTIMATOR_CONFIGURATION } from "../../../lib/stabilization/stabilization-protocol";

const execFileAsync = promisify(execFile);

export const EVIDENCE_WIDTH = 640;
export const EVIDENCE_HEIGHT = 360;

export interface GrayFrames {
	frames: Uint8Array[];
	width: number;
	height: number;
}

export interface JitterMeasurement {
	frames: number;
	lostFrames: number;
	meanInliers: number;
	rmsRotationDeg: number;
	rmsTranslationPx: number;
}

/**
 * Renders a still fractal and pans/rotates a crop window over it with a
 * deterministic multi-sine jitter. The scene itself never moves, so every
 * bit of inter-frame motion in the clip is camera shake.
 */
export async function generateShakyStillClip({
	outputPath,
	seconds = 6,
	fps = 30,
}: {
	outputPath: string;
	seconds?: number;
	fps?: number;
}): Promise<void> {
	const still = path.join(path.dirname(outputPath), "still.png");
	await execFileAsync(getFFmpegPath(), [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"mandelbrot=s=1920x1080:maxiter=300",
		"-frames:v",
		"1",
		still,
	]);
	await execFileAsync(getFFmpegPath(), [
		"-y",
		"-v",
		"error",
		"-loop",
		"1",
		"-i",
		still,
		"-t",
		String(seconds),
		"-r",
		String(fps),
		"-vf",
		[
			"crop=1280:720:x='(iw-1280)/2+40*sin(n/3.1)+25*sin(n/1.3)':y='(ih-720)/2+30*cos(n/2.7)+20*sin(n/1.7)'",
			"rotate=a='0.012*sin(n/2.3)':c=black",
			"crop=1200:675",
			"scale=1280:720",
			"format=yuv420p",
		].join(","),
		"-c:v",
		"libx264",
		"-crf",
		"18",
		"-colorspace",
		"bt709",
		"-color_primaries",
		"bt709",
		"-color_trc",
		"bt709",
		outputPath,
	]);
}

export async function decodeGrayFrames({
	filePath,
}: {
	filePath: string;
}): Promise<GrayFrames> {
	const { stdout } = await execFileAsync(
		getFFmpegPath(),
		[
			"-v",
			"error",
			"-i",
			filePath,
			"-vf",
			`scale=${EVIDENCE_WIDTH}:${EVIDENCE_HEIGHT}`,
			"-pix_fmt",
			"gray",
			"-f",
			"rawvideo",
			"-",
		],
		{ encoding: "buffer", maxBuffer: 512 * 1024 * 1024 }
	);
	const bytes = new Uint8Array(stdout);
	const frameSize = EVIDENCE_WIDTH * EVIDENCE_HEIGHT;
	const frames: Uint8Array[] = [];
	for (
		let offset = 0;
		offset + frameSize <= bytes.length;
		offset += frameSize
	) {
		frames.push(bytes.slice(offset, offset + frameSize));
	}
	return { frames, width: EVIDENCE_WIDTH, height: EVIDENCE_HEIGHT };
}

let runtimePromise: Promise<OpenCvMotionRuntime> | undefined;

async function loadOpenCv(): Promise<OpenCvMotionRuntime> {
	runtimePromise ??= (async () => {
		const module = (await import("@techstark/opencv-js")) as unknown as {
			default: Promise<OpenCvMotionRuntime> | OpenCvMotionRuntime;
		};
		return await module.default;
	})();
	return runtimePromise;
}

/** Frame-to-frame camera motion of a clip, measured with the product estimator. */
export async function measureJitter({
	gray,
}: {
	gray: GrayFrames;
}): Promise<JitterMeasurement> {
	const cv = await loadOpenCv();
	const estimator = new OpenCvMotionEstimator({ cv });
	try {
		let translation = 0;
		let rotation = 0;
		let lost = 0;
		let inliers = 0;
		for (const [index, frame] of gray.frames.entries()) {
			const motion = estimator.push({
				frame: {
					gray: frame,
					width: gray.width,
					height: gray.height,
					ptsUs: index * 33_333,
				},
				configuration: DEFAULT_MOTION_ESTIMATOR_CONFIGURATION,
			});
			if (index === 0) continue;
			if (motion.inliers === 0) lost += 1;
			inliers += motion.inliers;
			translation += motion.dx ** 2 + motion.dy ** 2;
			rotation += (motion.rotation * (180 / Math.PI)) ** 2;
		}
		const pairs = Math.max(1, gray.frames.length - 1);
		return {
			frames: gray.frames.length,
			lostFrames: lost,
			meanInliers: inliers / pairs,
			rmsRotationDeg: Math.sqrt(rotation / pairs),
			rmsTranslationPx: Math.sqrt(translation / pairs),
		};
	} finally {
		estimator.dispose();
	}
}

/**
 * Mean luminance of a border band versus the interior, sampled over all
 * frames. Black borders from an unconstrained warp drag the band mean down.
 */
export function borderLuminanceRatio({ gray }: { gray: GrayFrames }): number {
	const band = 4;
	let border = 0;
	let borderCount = 0;
	let interior = 0;
	let interiorCount = 0;
	for (const frame of gray.frames) {
		for (let y = 0; y < gray.height; y += 1) {
			for (let x = 0; x < gray.width; x += 1) {
				const value = frame[y * gray.width + x];
				if (
					x < band ||
					y < band ||
					x >= gray.width - band ||
					y >= gray.height - band
				) {
					border += value;
					borderCount += 1;
				} else {
					interior += value;
					interiorCount += 1;
				}
			}
		}
	}
	return border / borderCount / (interior / interiorCount);
}
