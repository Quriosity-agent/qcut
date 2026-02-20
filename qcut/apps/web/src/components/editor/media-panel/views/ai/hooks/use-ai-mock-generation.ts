import { debugLogger } from "@/lib/debug-logger";
import { AI_MODELS } from "../constants/ai-constants";
import {
	buildUnifiedParams,
	getModelCapabilities,
	validateGenerationInputs,
} from "./use-ai-generation-helpers";
import type { GeneratedVideo, GeneratedVideoResult } from "../types/ai-types";

export interface MockGenerationParams {
	activeTab: "text" | "image" | "avatar" | "upscale" | "angles";
	prompt: string;
	selectedModels: string[];
	selectedImage: File | null;
	firstFrame: File | null;
	lastFrame: File | null;
	avatarImage: File | null;
	audioFile: File | null;
	sourceVideo: File | null;
	sourceVideoFile: File | null;
	sourceVideoUrl: string;
	referenceImages: (File | null)[];
	t2vAspectRatio: string;
	t2vResolution: string;
	t2vDuration: number;
	t2vNegativePrompt: string;
	t2vPromptExpansion: boolean;
	t2vSeed: number;
	t2vSafetyChecker: boolean;
}

export interface MockGenerationCallbacks {
	setIsGenerating: (isGenerating: boolean) => void;
	setJobId: (jobId: string | null) => void;
	setGeneratedVideos: (videos: GeneratedVideoResult[]) => void;
	setGenerationStartTime: (timestamp: number | null) => void;
	setElapsedTime: (seconds: number) => void;
	setStatusMessage: (message: string) => void;
	onComplete?: (videos: GeneratedVideoResult[]) => void;
	onError?: (error: string) => void;
}

function validateMockGenerationInput({
	params,
}: {
	params: MockGenerationParams;
}): string | null {
	if (params.activeTab === "upscale") {
		if (params.selectedModels.length === 0) {
			return "Validation failed - missing models for upscale tab";
		}

		if (!params.sourceVideoFile && !params.sourceVideoUrl) {
			return "Validation failed - video source required for upscaling";
		}

		return null;
	}

	return validateGenerationInputs(params.activeTab, {
		prompt: params.prompt,
		selectedModels: params.selectedModels,
		selectedImage: params.selectedImage,
		firstFrame: params.firstFrame,
		lastFrame: params.lastFrame,
		sourceVideo: params.sourceVideo,
		audioFile: params.audioFile,
		avatarImage: params.avatarImage,
		referenceImages: params.referenceImages,
	});
}

export async function handleMockGenerate(
	params: MockGenerationParams,
	callbacks: MockGenerationCallbacks
): Promise<void> {
	const validationError = validateMockGenerationInput({ params });
	if (validationError) {
		console.log(`? ${validationError}`);
		return;
	}

	callbacks.setIsGenerating(true);
	callbacks.setJobId(null);
	callbacks.setGeneratedVideos([]);

	const startTime = Date.now();
	callbacks.setGenerationStartTime(startTime);
	callbacks.setElapsedTime(0);

	try {
		const mockGenerations: GeneratedVideoResult[] = [];

		for (const [index, modelId] of params.selectedModels.entries()) {
			console.log(
				"------------------------------------------------------------"
			);
			console.log(
				`Model ${index + 1}/${params.selectedModels.length} - processing:`,
				modelId
			);
			console.log(
				"------------------------------------------------------------"
			);

			const modelName = AI_MODELS.find((model) => model.id === modelId)?.name;
			const modelCapabilities = getModelCapabilities(modelId);

			// Mock does not follow Sora2 text-model skip behavior from real generation.
			const unifiedParams = buildUnifiedParams({
				modelId,
				modelCapabilities,
				isSora2TextModel: false,
				t2vAspectRatio: params.t2vAspectRatio,
				t2vResolution: params.t2vResolution,
				t2vDuration: params.t2vDuration,
				t2vNegativePrompt: params.t2vNegativePrompt,
				t2vPromptExpansion: params.t2vPromptExpansion,
				t2vSeed: params.t2vSeed,
				t2vSafetyChecker: params.t2vSafetyChecker,
			});

			callbacks.setStatusMessage(
				`🧪 Mock generating with ${modelName} (${index + 1}/${params.selectedModels.length})`
			);

			await new Promise<void>((resolve) => {
				setTimeout(resolve, 1500);
			});

			const mockVideo: GeneratedVideo = {
				jobId: `mock-job-${Date.now()}-${index}`,
				videoUrl:
					"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
				videoPath:
					"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
				fileSize: 2_097_152,
				duration: 15,
				prompt: params.prompt.trim(),
				model: modelId,
			};

			mockGenerations.push({ modelId, video: mockVideo });

			debugLogger.log("AIGeneration", "MOCK_VIDEO_GENERATED", {
				modelName,
				mockJobId: mockVideo.jobId,
				modelId,
				unifiedParams,
			});
		}

		callbacks.setGeneratedVideos(mockGenerations);
		callbacks.setStatusMessage(
			`🧪 Mock generated ${mockGenerations.length} videos successfully!`
		);
		callbacks.onComplete?.(mockGenerations);
	} catch (error) {
		const errorMessage = `Mock generation error: ${
			error instanceof Error ? error.message : "Unknown error"
		}`;
		callbacks.onError?.(errorMessage);
		debugLogger.log("AIGeneration", "MOCK_GENERATION_FAILED", {
			error: error instanceof Error ? error.message : "Unknown error",
		});
	} finally {
		callbacks.setIsGenerating(false);
	}
}
