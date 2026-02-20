import { describe, it, expect, vi, afterEach } from "vitest";
import { getGenerationStatus } from "@/lib/ai-video-client";
import { UI_CONSTANTS, STATUS_MESSAGES } from "../../constants/ai-constants";
import {
	createStatusPoller,
	type PollingCallbacks,
	type PollingContext,
} from "../use-ai-polling";

vi.mock("@/lib/ai-video-client", () => ({
	getGenerationStatus: vi.fn(),
}));

function createCallbacks({
	initialInterval = null,
}: {
	initialInterval?: NodeJS.Timeout | null;
} = {}): {
	callbacks: PollingCallbacks;
	getInterval: () => NodeJS.Timeout | null;
} {
	let pollingInterval = initialInterval;
	let progressValue = 0;

	const callbacks: PollingCallbacks = {
		setGenerationProgress: vi.fn((value) => {
			progressValue =
				typeof value === "function" ? value(progressValue) : value;
		}),
		setStatusMessage: vi.fn(),
		setGeneratedVideo: vi.fn(),
		setIsGenerating: vi.fn(),
		setPollingInterval: vi.fn((value) => {
			pollingInterval =
				typeof value === "function" ? value(pollingInterval) : value;
		}),
		onError: vi.fn(),
	};

	return {
		callbacks,
		getInterval: () => pollingInterval,
	};
}

function createContext(): PollingContext {
	return {
		prompt: "A neon-lit cyberpunk city",
		selectedModels: ["kling_v3_pro_t2v"],
		activeProject: null,
		addMediaItem: undefined,
	};
}

describe("createStatusPoller", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns a function", () => {
		const { callbacks } = createCallbacks();
		const poller = createStatusPoller({ callbacks, context: createContext() });

		expect(typeof poller).toBe("function");
	});

	it("startStatusPolling calls setStatusMessage", async () => {
		vi.useFakeTimers();
		vi.mocked(getGenerationStatus).mockResolvedValue({
			status: "failed",
			error: "Mock polling failure",
		});

		const { callbacks } = createCallbacks();
		const poller = createStatusPoller({ callbacks, context: createContext() });

		await poller("job-123");

		expect(callbacks.setStatusMessage).toHaveBeenCalledWith(
			STATUS_MESSAGES.STARTING
		);
	});

	it("clears previous interval and resolves once", async () => {
		vi.useFakeTimers();
		vi.mocked(getGenerationStatus).mockResolvedValue({
			status: "completed",
			video_url: "https://example.com/video.mp4",
			progress: 100,
		});

		const previousInterval = setInterval(() => {
			// no-op
		}, 5000);
		const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
		const { callbacks, getInterval } = createCallbacks({
			initialInterval: previousInterval,
		});
		const poller = createStatusPoller({ callbacks, context: createContext() });

		await poller("job-456");
		await vi.advanceTimersByTimeAsync(UI_CONSTANTS.POLLING_INTERVAL_MS * 2);

		expect(clearIntervalSpy).toHaveBeenCalledWith(previousInterval);
		expect(vi.mocked(getGenerationStatus)).toHaveBeenCalledTimes(1);
		expect(getInterval()).toBeNull();
	});

	it("polls immediately before interval", async () => {
		vi.useFakeTimers();
		vi.mocked(getGenerationStatus).mockResolvedValue({
			status: "failed",
			error: "done",
		});

		const { callbacks } = createCallbacks();
		const poller = createStatusPoller({ callbacks, context: createContext() });

		const pollingPromise = poller("job-789");
		await Promise.resolve();

		expect(vi.mocked(getGenerationStatus)).toHaveBeenCalledTimes(1);

		await pollingPromise;
	});
});
