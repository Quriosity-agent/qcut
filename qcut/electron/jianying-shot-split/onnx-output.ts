export const SHOT_ONNX_MODEL_SHA256 =
	"6cb814bb30d7dcaf12af5de4a8d09506bca52731e2523862e22c26a364400a96";
export const SHOT_ONNX_PREPROCESSING = "numpy-fp32-half-pixel-round-even-v1";
export const SHOT_ONNX_MAX_FRAMES = 86_400;

export interface OnnxShotOutput {
	cutFrames: number[];
	frameCount: number;
	scores: Array<[number, number]>;
	onnxVersion: string;
}

export function parseOnnxShotOutput({
	stdout,
	expectedSampling,
}: {
	stdout: string;
	expectedSampling?: { fps: number; width: number; height: number };
}): OnnxShotOutput {
	const value: unknown = JSON.parse(stdout);
	if (!value || typeof value !== "object")
		throw new Error("Invalid ONNX shot result");
	const result = value as Record<string, unknown>;
	if (
		expectedSampling &&
		(result.fps !== expectedSampling.fps ||
			result.width !== expectedSampling.width ||
			result.height !== expectedSampling.height ||
			result.threshold !== 0.35)
	)
		throw new Error("ONNX sampling or threshold does not match request");
	const count = result.frame_count;
	if (
		result.engine !== "onnx" ||
		result.artifact_sha256 !== SHOT_ONNX_MODEL_SHA256 ||
		result.preprocessing !== SHOT_ONNX_PREPROCESSING ||
		typeof count !== "number" ||
		!Number.isSafeInteger(count) ||
		count < 1 ||
		count > SHOT_ONNX_MAX_FRAMES ||
		typeof result.onnx_version !== "string" ||
		!result.onnx_version ||
		!Array.isArray(result.cut_frames) ||
		!Array.isArray(result.scores)
	)
		throw new Error("Invalid ONNX shot identity or frame count");
	let previous = -1;
	const cutFrames: number[] = [];
	for (const frame of result.cut_frames) {
		if (
			typeof frame !== "number" ||
			!Number.isSafeInteger(frame) ||
			frame <= previous ||
			frame >= count - 1
		) {
			throw new Error("Invalid ONNX cut frames");
		}
		previous = frame;
		cutFrames.push(frame);
	}
	if (result.scores.length !== Math.max(0, count - 7))
		throw new Error("Incomplete ONNX scores");
	const scores: Array<[number, number]> = [];
	for (const [index, item] of result.scores.entries()) {
		if (
			!Array.isArray(item) ||
			item.length !== 2 ||
			item[0] !== index + 4 ||
			typeof item[1] !== "number" ||
			!Number.isFinite(item[1]) ||
			item[1] < 0 ||
			item[1] > 1
		) {
			throw new Error("Invalid ONNX probability");
		}
		scores.push([item[0], item[1]]);
	}
	return {
		cutFrames,
		frameCount: count,
		scores,
		onnxVersion: result.onnx_version,
	};
}
