/**
 * AI Generation Management Hook
 *
 * Orchestrates AI video generation by composing sub-hooks for state,
 * core generation logic, and validation.
 *
 * @see use-ai-generation-state.ts - State declarations, effects, derived values
 * @see use-ai-generation-core.ts - Main generation callback
 * @see use-ai-generation-can-generate.ts - Validation logic
 */

import { useCallback } from "react";
import { handleMockGenerate as handleMockGenerateAction } from "./use-ai-mock-generation";
import { useAIGenerationState } from "./use-ai-generation-state";
import { useHandleGenerate } from "./use-ai-generation-core";
import { computeCanGenerate } from "./use-ai-generation-can-generate";
import type { UseAIGenerationProps } from "../types/ai-types";

/**
 * Custom hook for managing AI video generation
 * Handles generation logic, progress tracking, polling, and API integration
 */
export function useAIGeneration(props: UseAIGenerationProps) {
	const {
		activeTab,
		prompt,
		selectedModels,
		selectedImage,
		activeProject,
		onComplete,
		onError,
		avatarImage,
		audioFile,
		sourceVideo,
		referenceImages,
		sourceVideoFile = null,
		sourceVideoUrl = "",
		t2vAspectRatio = "16:9",
		t2vResolution = "1080p",
		t2vDuration = 4,
		t2vNegativePrompt = "low resolution, error, worst quality, low quality, defects",
		t2vPromptExpansion = false,
		t2vSeed = -1,
		t2vSafetyChecker = false,
	} = props;

	const state = useAIGenerationState(props);
	const handleGenerate = useHandleGenerate(props, state);

	// Mock generation function for testing
	const handleMockGenerate = useCallback(async () => {
		await handleMockGenerateAction(
			{
				activeTab,
				prompt,
				selectedModels,
				selectedImage,
				firstFrame: state.firstFrame,
				lastFrame: state.lastFrame,
				avatarImage: avatarImage ?? null,
				audioFile: audioFile ?? null,
				sourceVideo: sourceVideo ?? null,
				sourceVideoFile,
				sourceVideoUrl,
				referenceImages: referenceImages ?? [],
				t2vAspectRatio,
				t2vResolution,
				t2vDuration,
				t2vNegativePrompt,
				t2vPromptExpansion,
				t2vSeed,
				t2vSafetyChecker,
			},
			{
				setIsGenerating: state.setIsGenerating,
				setJobId: state.setJobId,
				setGeneratedVideos: state.setGeneratedVideos,
				setGenerationStartTime: state.setGenerationStartTime,
				setElapsedTime: state.setElapsedTime,
				setStatusMessage: state.setStatusMessage,
				onComplete,
				onError,
			}
		);
	}, [
		activeTab,
		prompt,
		selectedModels,
		selectedImage,
		state.firstFrame,
		state.lastFrame,
		avatarImage,
		audioFile,
		sourceVideo,
		sourceVideoFile,
		sourceVideoUrl,
		referenceImages,
		t2vAspectRatio,
		t2vResolution,
		t2vDuration,
		t2vNegativePrompt,
		t2vPromptExpansion,
		t2vSeed,
		t2vSafetyChecker,
		onComplete,
		onError,
		state.setIsGenerating,
		state.setJobId,
		state.setGeneratedVideos,
		state.setGenerationStartTime,
		state.setElapsedTime,
		state.setStatusMessage,
	]);

	const canGenerate = computeCanGenerate({
		selectedModels,
		activeTab,
		prompt,
		selectedImage,
		firstFrame: state.firstFrame,
		lastFrame: state.lastFrame,
		sourceVideoFile,
		sourceVideoUrl,
		avatarImage,
		audioFile,
		sourceVideo,
		referenceImages,
	});

	return {
		// State
		isGenerating: state.isGenerating,
		generationProgress: state.generationProgress,
		statusMessage: state.statusMessage,
		elapsedTime: state.elapsedTime,
		estimatedTime: state.estimatedTime,
		currentModelIndex: state.currentModelIndex,
		progressLogs: state.progressLogs,
		generationStartTime: state.generationStartTime,
		jobId: state.jobId,
		setJobId: state.setJobId,
		generatedVideo: state.generatedVideo,
		setGeneratedVideo: state.setGeneratedVideo,
		generatedVideos: state.generatedVideos,
		setGeneratedVideos: state.setGeneratedVideos,
		pollingInterval: state.pollingInterval,
		setPollingInterval: state.setPollingInterval,

		// Service instance
		outputManager: state.outputManager,

		// Actions
		handleGenerate,
		handleMockGenerate,
		resetGenerationState: state.resetGenerationState,
		startStatusPolling: state.startStatusPolling,
		downloadVideoToMemory: state.downloadVideoToMemory,

		// Complete state object
		generationState: state.generationState,

		// Computed values
		canGenerate,
		isPolling: state.pollingInterval !== null,
		hasResults: state.generatedVideos.length > 0,

		// Media store state
		mediaStoreLoading: state.mediaStoreLoading,
		mediaStoreError: state.mediaStoreError,

		// Sora 2 state
		duration: state.duration,
		setDuration: state.setDuration,
		aspectRatio: state.aspectRatio,
		setAspectRatio: state.setAspectRatio,
		resolution: state.resolution,
		setResolution: state.setResolution,
		isSora2Selected: state.isSora2Selected,
		hasSora2Pro: state.hasSora2Pro,

		// Veo 3.1 state
		veo31Settings: state.veo31Settings,
		setVeo31Settings: state.setVeo31Settings,
		setVeo31Resolution: state.setVeo31Resolution,
		setVeo31Duration: state.setVeo31Duration,
		setVeo31AspectRatio: state.setVeo31AspectRatio,
		setVeo31GenerateAudio: state.setVeo31GenerateAudio,
		setVeo31EnhancePrompt: state.setVeo31EnhancePrompt,
		setVeo31AutoFix: state.setVeo31AutoFix,
		isVeo31Selected: state.isVeo31Selected,
		hasVeo31FrameToVideo: state.hasVeo31FrameToVideo,
		firstFrame: state.firstFrame,
		setFirstFrame: state.setFirstFrame,
		lastFrame: state.lastFrame,
		setLastFrame: state.setLastFrame,

		// Reve Edit state
		uploadedImageForEdit: state.uploadedImageForEdit,
		uploadedImagePreview: state.uploadedImagePreview,
		uploadedImageUrl: state.uploadedImageUrl,
		handleImageUploadForEdit: state.handleImageUploadForEdit,
		clearUploadedImageForEdit: state.clearUploadedImageForEdit,
	};
}

export type UseAIGenerationReturn = ReturnType<typeof useAIGeneration>;
