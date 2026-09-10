import MotionEstimatorWorker from "./opencv-motion-estimator-worker?worker&inline";
import {
	DEFAULT_MOTION_ESTIMATOR_CONFIGURATION,
	type FrameMotion,
	type MotionAnalysisFrame,
	type MotionEstimatorConfiguration,
	type MotionEstimatorWorkerRequest,
	type MotionEstimatorWorkerResponse,
} from "./stabilization-protocol";

interface PendingRequest {
	reject: (error: Error) => void;
	resolve: (response: MotionEstimatorWorkerResponse) => void;
}

function openCvRuntimeUrl(): string {
	return new URL(
		`${import.meta.env.BASE_URL}opencv/opencv.js`,
		document.baseURI
	).href;
}

function requestError({ cause }: { cause: unknown }): Error {
	return cause instanceof Error
		? cause
		: new Error("OpenCV motion worker request failed.", { cause });
}

/** Main-thread handle on the OpenCV motion estimator worker. */
export class MotionAnalysisClient {
	private readonly worker: Worker;
	private requestId = 0;
	private disposed = false;
	private initializePromise?: Promise<{ providerVersion: string }>;
	private readonly pending = new Map<number, PendingRequest>();

	constructor({
		createWorker = () =>
			new MotionEstimatorWorker({ name: "qcut-opencv-motion-estimator" }),
	}: {
		createWorker?: () => Worker;
	} = {}) {
		this.worker = createWorker();
		this.worker.addEventListener("message", this.handleMessage);
		this.worker.addEventListener("error", this.handleWorkerError);
	}

	private handleMessage = (
		event: MessageEvent<MotionEstimatorWorkerResponse>
	): void => {
		const pending = this.pending.get(event.data.id);
		if (!pending) return;
		this.pending.delete(event.data.id);
		if (event.data.type === "error") {
			pending.reject(new Error(event.data.message));
			return;
		}
		pending.resolve(event.data);
	};

	private handleWorkerError = (event: Event): void => {
		const detail =
			"message" in event && typeof event.message === "string"
				? event.message
				: "OpenCV motion worker crashed.";
		this.shutdown({ error: new Error(detail) });
	};

	private rejectPending({ error }: { error: Error }): void {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}

	private request({
		message,
		transfer = [],
	}: {
		message: MotionEstimatorWorkerRequest;
		transfer?: Transferable[];
	}): Promise<MotionEstimatorWorkerResponse> {
		if (this.disposed) {
			return Promise.reject(new Error("OpenCV motion worker is terminated."));
		}
		return new Promise((resolve, reject) => {
			this.pending.set(message.id, { resolve, reject });
			try {
				this.worker.postMessage(message, transfer);
			} catch (cause) {
				this.pending.delete(message.id);
				reject(requestError({ cause }));
			}
		});
	}

	private shutdown({ error }: { error: Error }): void {
		this.disposed = true;
		this.worker.removeEventListener("message", this.handleMessage);
		this.worker.removeEventListener("error", this.handleWorkerError);
		this.worker.terminate();
		this.rejectPending({ error });
	}

	initialize(): Promise<{ providerVersion: string }> {
		if (this.initializePromise) return this.initializePromise;
		const pending = (async () => {
			const response = await this.request({
				message: {
					id: ++this.requestId,
					runtimeUrl: openCvRuntimeUrl(),
					type: "initialize",
				},
			});
			if (response.type !== "initialized") {
				throw new Error("OpenCV motion worker returned an invalid response.");
			}
			return { providerVersion: response.providerVersion };
		})();
		this.initializePromise = pending;
		void pending.catch(() => {
			if (this.initializePromise === pending)
				this.initializePromise = undefined;
		});
		return pending;
	}

	/** Estimates the motion from the previously pushed frame; the frame buffer is transferred. */
	async push({
		frame,
		configuration = DEFAULT_MOTION_ESTIMATOR_CONFIGURATION,
	}: {
		frame: MotionAnalysisFrame;
		configuration?: MotionEstimatorConfiguration;
	}): Promise<FrameMotion> {
		await this.initialize();
		const response = await this.request({
			message: { id: ++this.requestId, type: "push", frame, configuration },
			transfer: [frame.gray.buffer],
		});
		if (response.type !== "motion") {
			throw new Error("OpenCV motion worker returned an invalid response.");
		}
		return response.motion;
	}

	async reset(): Promise<void> {
		await this.initialize();
		await this.request({ message: { id: ++this.requestId, type: "reset" } });
	}

	terminate(): void {
		if (this.disposed) return;
		this.shutdown({ error: new Error("OpenCV motion worker is terminated.") });
	}
}
