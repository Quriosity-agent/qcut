import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAIGeneration } from "../use-ai-generation";
import { useAsyncMediaStoreActions } from "@/hooks/media/use-async-media-store";

vi.mock("@/hooks/media/use-async-media-store", () => ({
	useAsyncMediaStoreActions: vi.fn(),
}));

describe("useAIGeneration public return contract", () => {
	beforeEach(() => {
		vi.mocked(useAsyncMediaStoreActions).mockReturnValue({
			loading: false,
			error: null,
			addMediaItem: undefined,
			addGeneratedImages: undefined,
			removeMediaItem: undefined,
			clearProjectMedia: undefined,
			loadProjectMedia: undefined,
			clearAllMedia: undefined,
		});
	});

	it("keeps required return keys", () => {
		const { result } = renderHook(() =>
			useAIGeneration({
				prompt: "",
				selectedModels: [],
				selectedImage: null,
				activeTab: "text",
				activeProject: null,
				onProgress: vi.fn(),
				onError: vi.fn(),
				onComplete: vi.fn(),
			})
		);

		const requiredKeys = [
			"handleGenerate",
			"canGenerate",
			"veo31Settings",
			"setVeo31Resolution",
			"setVeo31Duration",
			"setVeo31AspectRatio",
			"setVeo31GenerateAudio",
			"setVeo31EnhancePrompt",
			"setVeo31AutoFix",
			"firstFrame",
			"setFirstFrame",
			"lastFrame",
			"setLastFrame",
			"uploadedImageForEdit",
			"uploadedImagePreview",
			"uploadedImageUrl",
			"handleImageUploadForEdit",
			"clearUploadedImageForEdit",
			"startStatusPolling",
			"handleMockGenerate",
			"downloadVideoToMemory",
			"generationState",
			"mediaStoreLoading",
			"mediaStoreError",
		] as const;

		for (const key of requiredKeys) {
			expect(key in result.current).toBe(true);
		}
	});
});
