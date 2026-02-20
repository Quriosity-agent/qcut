import { describe, it, expect, vi, afterEach } from "vitest";
import {
	handleMockGenerate,
	type MockGenerationParams,
	type MockGenerationCallbacks,
} from "../use-ai-mock-generation";

function createBaseParams(): MockGenerationParams {
	return {
		activeTab: "text",
		prompt: "A cinematic sunset over mountains",
		selectedModels: ["kling_v3_pro_t2v"],
		selectedImage: null,
		firstFrame: null,
		lastFrame: null,
		avatarImage: null,
		audioFile: null,
		sourceVideo: null,
		sourceVideoFile: null,
		sourceVideoUrl: "",
		referenceImages: [],
		t2vAspectRatio: "16:9",
		t2vResolution: "1080p",
		t2vDuration: 5,
		t2vNegativePrompt: "",
		t2vPromptExpansion: false,
		t2vSeed: -1,
		t2vSafetyChecker: false,
	};
}

function createCallbacks(): MockGenerationCallbacks {
	return {
		setIsGenerating: vi.fn(),
		setJobId: vi.fn(),
		setGeneratedVideos: vi.fn(),
		setGenerationStartTime: vi.fn(),
		setElapsedTime: vi.fn(),
		setStatusMessage: vi.fn(),
		onComplete: vi.fn(),
		onError: vi.fn(),
	};
}

describe("handleMockGenerate", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("validates inputs and exits early when invalid", async () => {
		const params = createBaseParams();
		params.prompt = "   ";
		const callbacks = createCallbacks();

		await handleMockGenerate(params, callbacks);

		expect(callbacks.setIsGenerating).not.toHaveBeenCalled();
		expect(callbacks.onComplete).not.toHaveBeenCalled();
	});

	it("calls onComplete for successful mock generation", async () => {
		vi.useFakeTimers();

		const params = createBaseParams();
		const callbacks = createCallbacks();

		const generationPromise = handleMockGenerate(params, callbacks);
		await vi.runAllTimersAsync();
		await generationPromise;

		expect(callbacks.setIsGenerating).toHaveBeenCalledWith(true);
		expect(callbacks.setIsGenerating).toHaveBeenLastCalledWith(false);
		expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
		expect(callbacks.setGeneratedVideos).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					modelId: "kling_v3_pro_t2v",
				}),
			])
		);
	});
});
