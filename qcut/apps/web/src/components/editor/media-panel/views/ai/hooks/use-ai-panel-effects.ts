import { useEffect } from "react";
import type { T2VModelCapabilities } from "../constants/text2video-models-config";
import type {
	ReveAspectRatioOption,
	ReveOutputFormatOption,
} from "../constants/ai-model-options";

interface PanelEffectsInput {
	// Capability clamping
	combinedCapabilities: T2VModelCapabilities;
	t2vAspectRatio: string;
	t2vResolution: string;
	t2vDuration: number;
	setT2vAspectRatio: (v: string) => void;
	setT2vResolution: (v: string) => void;
	setT2vDuration: (v: number) => void;
	// Reve state reset
	selectedModels: string[];
	setReveAspectRatio: (v: ReveAspectRatioOption) => void;
	setReveNumImages: (v: number) => void;
	setReveOutputFormat: (v: ReveOutputFormatOption) => void;
	// Frame sync
	firstFrame: File | null;
	lastFrame: File | null;
	firstFramePreview: string | null;
	setSelectedImage: (v: File | null) => void;
	setImagePreview: (v: string | null) => void;
}

/**
 * Side-effect hook for AI panel:
 * - Clamps unified text-to-video settings when selected models change
 * - Resets Reve state when model is deselected
 * - Syncs firstFrame with selectedImage for backward compatibility
 */
export function useAIPanelEffects(input: PanelEffectsInput): void {
	// Clamp unified settings when selected models change
	useEffect(() => {
		if (
			input.combinedCapabilities.supportedAspectRatios &&
			input.combinedCapabilities.supportedAspectRatios.length > 0 &&
			!input.combinedCapabilities.supportedAspectRatios.includes(
				input.t2vAspectRatio
			)
		) {
			input.setT2vAspectRatio(
				input.combinedCapabilities.supportedAspectRatios[0]
			);
		}

		if (
			input.combinedCapabilities.supportedResolutions &&
			input.combinedCapabilities.supportedResolutions.length > 0 &&
			!input.combinedCapabilities.supportedResolutions.includes(
				input.t2vResolution
			)
		) {
			input.setT2vResolution(
				input.combinedCapabilities.supportedResolutions[0]
			);
		}

		if (
			input.combinedCapabilities.supportedDurations &&
			input.combinedCapabilities.supportedDurations.length > 0 &&
			!input.combinedCapabilities.supportedDurations.includes(input.t2vDuration)
		) {
			input.setT2vDuration(input.combinedCapabilities.supportedDurations[0]);
		}
	}, [
		input.combinedCapabilities,
		input.t2vAspectRatio,
		input.t2vResolution,
		input.t2vDuration,
		input.setT2vAspectRatio,
		input.setT2vResolution,
		input.setT2vDuration,
	]);

	// Reset Reve state when model is deselected
	useEffect(() => {
		if (!input.selectedModels.some((id) => id === "reve-text-to-image")) {
			input.setReveAspectRatio("3:2");
			input.setReveNumImages(1);
			input.setReveOutputFormat("png");
		}
	}, [
		input.selectedModels,
		input.setReveAspectRatio,
		input.setReveNumImages,
		input.setReveOutputFormat,
	]);

	// Sync firstFrame with selectedImage for backward compatibility
	useEffect(() => {
		if (input.firstFrame && !input.lastFrame) {
			input.setSelectedImage(input.firstFrame);
			input.setImagePreview(input.firstFramePreview);
		} else {
			input.setSelectedImage(null);
			input.setImagePreview(null);
		}
	}, [
		input.firstFrame,
		input.lastFrame,
		input.firstFramePreview,
		input.setSelectedImage,
		input.setImagePreview,
	]);
}
