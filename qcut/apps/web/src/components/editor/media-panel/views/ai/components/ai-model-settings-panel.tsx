import { useState } from "react";
import { AISora2Settings } from "../settings/ai-sora-settings";
import { AIVeo31Settings } from "../settings/ai-veo-settings";
import {
	AIReveTextToImageSettings,
	AIReveEditSettings,
} from "../settings/ai-reve-settings";
import { REVE_TEXT_TO_IMAGE_MODEL } from "../constants/ai-constants";
import type {
	ReveAspectRatioOption,
	ReveOutputFormatOption,
} from "../constants/ai-model-options";
import type { AIActiveTab } from "../types/ai-types";

interface AIModelSettingsPanelProps {
	activeTab: AIActiveTab;
	selectedModels: string[];
	generation: {
		isSora2Selected: boolean;
		isVeo31Selected: boolean;
		duration: number;
		setDuration: (v: number) => void;
		aspectRatio: string;
		setAspectRatio: (v: string) => void;
		resolution: string;
		setResolution: (v: string) => void;
		hasSora2Pro: boolean;
		veo31Settings: {
			duration: number;
			resolution: string;
			aspectRatio: string;
			generateAudio: boolean;
			enhancePrompt: boolean;
			autoFix: boolean;
		};
		setVeo31Resolution: (v: string) => void;
		setVeo31Duration: (v: number) => void;
		setVeo31AspectRatio: (v: string) => void;
		setVeo31GenerateAudio: (v: boolean) => void;
		setVeo31EnhancePrompt: (v: boolean) => void;
		setVeo31AutoFix: (v: boolean) => void;
		uploadedImageForEdit: File | null;
		uploadedImagePreview: string | null;
		handleImageUploadForEdit: (file: File) => void;
		clearUploadedImageForEdit: () => void;
	};
	prompt: string;
	setPrompt: (prompt: string) => void;
	setError: (error: string | null) => void;
	reveAspectRatio: ReveAspectRatioOption;
	setReveAspectRatio: (v: ReveAspectRatioOption) => void;
	reveNumImages: number;
	setReveNumImages: (v: number) => void;
	reveOutputFormat: ReveOutputFormatOption;
	setReveOutputFormat: (v: ReveOutputFormatOption) => void;
}

export function AIModelSettingsPanel({
	activeTab,
	selectedModels,
	generation,
	prompt,
	setPrompt,
	setError,
	reveAspectRatio,
	setReveAspectRatio,
	reveNumImages,
	setReveNumImages,
	reveOutputFormat,
	setReveOutputFormat,
}: AIModelSettingsPanelProps) {
	return (
		<>
			{/* Sora 2 Settings */}
			{generation.isSora2Selected && (
				<AISora2Settings
					duration={generation.duration as 4 | 8 | 12}
					onDurationChange={(v) => generation.setDuration(v)}
					aspectRatio={generation.aspectRatio as "16:9" | "9:16"}
					onAspectRatioChange={(v) => generation.setAspectRatio(v)}
					resolution={generation.resolution as "auto" | "720p" | "1080p"}
					onResolutionChange={(v) => generation.setResolution(v)}
					hasSora2Pro={generation.hasSora2Pro}
				/>
			)}

			{/* Veo 3.1 Settings */}
			{generation.isVeo31Selected && (
				<AIVeo31Settings
					settings={generation.veo31Settings}
					onResolutionChange={(v) => generation.setVeo31Resolution(v)}
					onDurationChange={(v) => generation.setVeo31Duration(v)}
					onAspectRatioChange={(v) => generation.setVeo31AspectRatio(v)}
					onGenerateAudioChange={(v) => generation.setVeo31GenerateAudio(v)}
					onEnhancePromptChange={(v) => generation.setVeo31EnhancePrompt(v)}
					onAutoFixChange={(v) => generation.setVeo31AutoFix(v)}
				/>
			)}

			{/* Reve Text-to-Image Settings */}
			{selectedModels.some((id) => id === "reve-text-to-image") && (
				<AIReveTextToImageSettings
					aspectRatio={reveAspectRatio}
					onAspectRatioChange={setReveAspectRatio}
					numImages={reveNumImages}
					onNumImagesChange={setReveNumImages}
					outputFormat={reveOutputFormat}
					onOutputFormatChange={setReveOutputFormat}
				/>
			)}

			{/* Reve Edit (Image Tab only) */}
			{activeTab === "image" &&
				selectedModels.some((id) => id === "reve-text-to-image") && (
					<AIReveEditSettings
						uploadedImage={generation.uploadedImageForEdit}
						uploadedImagePreview={generation.uploadedImagePreview}
						onImageUpload={generation.handleImageUploadForEdit}
						onClearImage={generation.clearUploadedImageForEdit}
						editPrompt={prompt}
						onEditPromptChange={setPrompt}
						onError={setError}
					/>
				)}
		</>
	);
}
