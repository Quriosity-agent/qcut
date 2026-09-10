import {
	OpenCvMotionEstimator,
	OpenCvMotionEstimatorError,
	type OpenCvMotionRuntime,
} from "./opencv-motion-estimator";
import type {
	MotionEstimatorWorkerRequest,
	MotionEstimatorWorkerResponse,
} from "./stabilization-protocol";
import { STABILIZATION_ANALYSIS_VERSION } from "./stabilization-protocol";

interface MotionWorkerScope {
	cv?: unknown;
	onmessage:
		| ((event: MessageEvent<MotionEstimatorWorkerRequest>) => void)
		| null;
	postMessage: (message: MotionEstimatorWorkerResponse) => void;
}

const workerScope = self as unknown as MotionWorkerScope;
let estimatorPromise: Promise<OpenCvMotionEstimator> | undefined;

async function createEstimator({
	runtimeUrl,
}: {
	runtimeUrl: string;
}): Promise<OpenCvMotionEstimator> {
	// The UMD runtime installs a real initialization Promise on the worker global.
	await import(/* @vite-ignore */ runtimeUrl);
	const runtime = await workerScope.cv;
	if (
		runtime === null ||
		(typeof runtime !== "object" && typeof runtime !== "function")
	) {
		throw new OpenCvMotionEstimatorError({
			code: "provider-unavailable",
			message: "The bundled OpenCV runtime did not initialize.",
		});
	}
	const cv = runtime as OpenCvMotionRuntime;
	if (
		typeof cv.GFTTDetector !== "function" ||
		typeof cv.calcOpticalFlowPyrLK !== "function" ||
		typeof cv.estimateAffine2D !== "function"
	) {
		throw new OpenCvMotionEstimatorError({
			code: "provider-unavailable",
			message: "The bundled OpenCV runtime lacks motion estimation APIs.",
		});
	}
	return new OpenCvMotionEstimator({ cv });
}

function loadEstimator({
	runtimeUrl,
}: {
	runtimeUrl: string;
}): Promise<OpenCvMotionEstimator> {
	if (estimatorPromise) return estimatorPromise;
	const pending = createEstimator({ runtimeUrl });
	estimatorPromise = pending;
	pending.catch(() => {
		if (estimatorPromise === pending) estimatorPromise = undefined;
	});
	return pending;
}

function errorMessage({ cause }: { cause: unknown }): string {
	return cause instanceof Error ? cause.message : String(cause);
}

async function handleRequest({
	message,
}: {
	message: MotionEstimatorWorkerRequest;
}): Promise<MotionEstimatorWorkerResponse> {
	switch (message.type) {
		case "initialize": {
			await loadEstimator({ runtimeUrl: message.runtimeUrl });
			return {
				id: message.id,
				type: "initialized",
				providerVersion: STABILIZATION_ANALYSIS_VERSION,
			};
		}
		case "push": {
			if (!estimatorPromise) {
				throw new OpenCvMotionEstimatorError({
					code: "not-initialized",
					message: "Initialize the motion estimator before pushing frames.",
				});
			}
			const estimator = await estimatorPromise;
			return {
				id: message.id,
				type: "motion",
				motion: estimator.push({
					frame: message.frame,
					configuration: message.configuration,
				}),
			};
		}
		case "reset": {
			(await estimatorPromise)?.reset();
			return { id: message.id, type: "reset-done" };
		}
		default:
			throw new OpenCvMotionEstimatorError({
				code: "invalid-request",
				message: "Unknown motion estimator request.",
			});
	}
}

workerScope.onmessage = (event) => {
	const message = event.data;
	void handleRequest({ message })
		.then((response) => workerScope.postMessage(response))
		.catch((cause: unknown) =>
			workerScope.postMessage({
				id: message.id,
				type: "error",
				message: errorMessage({ cause }),
			})
		);
};
