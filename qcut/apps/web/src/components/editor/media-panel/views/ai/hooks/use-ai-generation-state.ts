/**
 * AI Generation State Hook
 *
 * Manages all state declarations, effects, and derived values
 * for the AI generation hook.
 */

import { useState, useEffect, useCallback } from "react";
import { AIVideoOutputManager } from "@/lib/ai-clients/ai-video-output";
import { useAsyncMediaStoreActions } from "@/hooks/media/use-async-media-store";
import {
	downloadVideoToMemory as downloadVideoToMemoryHelper,
	uploadImageToFal as uploadImageToFalHelper,
	uploadAudioToFal as uploadAudioToFalHelper,
} from "./use-ai-generation-helpers";
import { useAIPolling } from "./use-ai-polling";
import { useVeo31State } from "./use-veo31-state";
import { useReveEditState } from "./use-reve-edit-state";
import { VEO31_FRAME_MODELS as FRAME_MODELS } from "./generation";
import { PROGRESS_CONSTANTS } from "../constants/ai-constants";
import type {
	GeneratedVideo,
	GeneratedVideoResult,
	AIGenerationState,
	UseAIGenerationProps,
} from "../types/ai-types";

const VEO31_FRAME_MODELS = FRAME_MODELS;

export function useAIGenerationState(props: UseAIGenerationProps) {
	const {
		prompt,
		selectedModels,
		activeProject,
		onProgress,
		onError,
		onJobIdChange,
		onGeneratedVideoChange,
	} = props;

	// Core generation state
	const [isGenerating, setIsGenerating] = useState(false);
	const [generationProgress, setGenerationProgress] = useState(0);
	const [statusMessage, setStatusMessage] = useState("");
	const [elapsedTime, setElapsedTime] = useState(0);
	const [estimatedTime, setEstimatedTime] = useState<number | undefined>();
	const [currentModelIndex, setCurrentModelIndex] = useState(0);
	const [progressLogs, setProgressLogs] = useState<string[]>([]);
	const [generationStartTime, setGenerationStartTime] = useState<
		number | null
	>(null);

	// Critical state variables
	const [jobId, setJobId] = useState<string | null>(null);
	const [generatedVideo, setGeneratedVideo] = useState<GeneratedVideo | null>(
		null
	);
	const [generatedVideos, setGeneratedVideos] = useState<
		GeneratedVideoResult[]
	>([]);

	// Polling lifecycle
	const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(
		null
	);

	// Service instance
	const [outputManager] = useState(
		() => new AIVideoOutputManager("./ai-generated-videos")
	);

	// Sora 2 state
	const [duration, setDuration] = useState<4 | 8 | 12>(4);
	const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
	const [resolution, setResolution] = useState<"auto" | "720p" | "1080p">(
		"720p"
	);

	// Sub-hooks
	const veo31State = useVeo31State();
	const reveEditState = useReveEditState();

	// Detection flags
	const isSora2Selected = selectedModels.some((id) => id.startsWith("sora2_"));
	const hasSora2Pro =
		selectedModels.includes("sora2_text_to_video_pro") ||
		selectedModels.includes("sora2_image_to_video_pro");
	const isVeo31Selected = selectedModels.some((id) => id.startsWith("veo31_"));
	const hasVeo31FrameToVideo = selectedModels.some((id) =>
		VEO31_FRAME_MODELS.has(id)
	);

	// Store hooks
	const {
		addMediaItem,
		loading: mediaStoreLoading,
		error: mediaStoreError,
	} = useAsyncMediaStoreActions();

	// Client-side elapsed time timer
	useEffect(() => {
		let interval: NodeJS.Timeout | null = null;

		if (isGenerating && generationStartTime) {
			interval = setInterval(() => {
				const elapsed = Math.floor((Date.now() - generationStartTime) / 1000);
				setElapsedTime(elapsed);
			}, 1000);
		}

		return () => {
			if (interval) clearInterval(interval);
		};
	}, [isGenerating, generationStartTime]);

	// Cleanup polling on unmount
	useEffect(() => {
		return () => {
			if (pollingInterval) {
				clearInterval(pollingInterval);
			}
		};
	}, [pollingInterval]);

	// Notify parent of state changes
	useEffect(() => {
		if (onJobIdChange) {
			onJobIdChange(jobId);
		}
	}, [jobId, onJobIdChange]);

	useEffect(() => {
		if (onGeneratedVideoChange) {
			onGeneratedVideoChange(generatedVideo);
		}
	}, [generatedVideo, onGeneratedVideoChange]);

	useEffect(() => {
		if (onProgress) {
			let status: "queued" | "processing" | "completed" | "failed" =
				"processing";
			if (generationProgress === 100) {
				status = "completed";
			} else if (generationProgress === 0 && !isGenerating) {
				status =
					statusMessage.toLowerCase().includes("error") ||
					statusMessage.toLowerCase().includes("failed")
						? "failed"
						: "queued";
			}

			onProgress({
				status,
				progress: generationProgress,
				message: statusMessage,
				elapsedTime,
			});
		}
	}, [
		generationProgress,
		statusMessage,
		elapsedTime,
		isGenerating,
		onProgress,
	]);

	// Stable callback wrappers
	const downloadVideoToMemory = useCallback(
		(videoUrl: string) => downloadVideoToMemoryHelper(videoUrl),
		[]
	);
	const uploadImageToFal = useCallback(
		(file: File) => uploadImageToFalHelper(file),
		[]
	);
	const uploadAudioToFal = useCallback(
		(file: File) => uploadAudioToFalHelper(file),
		[]
	);

	// Polling setup
	const startStatusPolling = useAIPolling({
		callbacks: {
			setGenerationProgress,
			setStatusMessage,
			setGeneratedVideo,
			setIsGenerating,
			setPollingInterval,
			onError,
		},
		context: {
			prompt,
			selectedModels,
			activeProject,
			addMediaItem,
		},
	});

	// Reset generation state
	const resetGenerationState = useCallback(() => {
		setIsGenerating(false);
		setGenerationProgress(PROGRESS_CONSTANTS.INITIAL_PROGRESS);
		setStatusMessage("");
		setElapsedTime(0);
		setEstimatedTime(undefined);
		setCurrentModelIndex(0);
		setProgressLogs([]);
		setGenerationStartTime(null);
		setJobId(null);
		setGeneratedVideo(null);
		setGeneratedVideos([]);

		veo31State.resetVeo31State();

		if (pollingInterval) {
			clearInterval(pollingInterval);
			setPollingInterval(null);
		}
	}, [pollingInterval, veo31State.resetVeo31State]);

	// Generation state object
	const generationState: AIGenerationState = {
		isGenerating,
		generationProgress,
		statusMessage,
		elapsedTime,
		estimatedTime,
		currentModelIndex,
		progressLogs,
		generationStartTime,
		jobId,
		generatedVideo,
		generatedVideos,
		pollingInterval,
	};

	return {
		isGenerating,
		setIsGenerating,
		generationProgress,
		setGenerationProgress,
		statusMessage,
		setStatusMessage,
		elapsedTime,
		setElapsedTime,
		estimatedTime,
		currentModelIndex,
		setCurrentModelIndex,
		progressLogs,
		setProgressLogs,
		generationStartTime,
		setGenerationStartTime,
		jobId,
		setJobId,
		generatedVideo,
		setGeneratedVideo,
		generatedVideos,
		setGeneratedVideos,
		pollingInterval,
		setPollingInterval,
		outputManager,
		duration,
		setDuration,
		aspectRatio,
		setAspectRatio,
		resolution,
		setResolution,
		...veo31State,
		...reveEditState,
		isSora2Selected,
		hasSora2Pro,
		isVeo31Selected,
		hasVeo31FrameToVideo,
		addMediaItem,
		mediaStoreLoading,
		mediaStoreError,
		downloadVideoToMemory,
		uploadImageToFal,
		uploadAudioToFal,
		startStatusPolling,
		resetGenerationState,
		generationState,
	};
}

export type AIGenerationInternalState = ReturnType<typeof useAIGenerationState>;
