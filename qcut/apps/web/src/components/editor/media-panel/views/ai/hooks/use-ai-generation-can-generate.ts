/**
 * Can Generate Logic for AI Generation Hook
 *
 * Pure computation of whether generation can proceed based on current tab,
 * selected models, and available inputs.
 */

export interface CanGenerateParams {
	selectedModels: string[];
	activeTab: string;
	prompt: string;
	selectedImage: File | null;
	firstFrame: File | null;
	lastFrame: File | null;
	sourceVideoFile?: File | null;
	sourceVideoUrl?: string;
	avatarImage?: File | null;
	audioFile?: File | null;
	sourceVideo?: File | null;
	referenceImages?: (File | null)[];
}

export function computeCanGenerate(params: CanGenerateParams): boolean {
	const {
		selectedModels,
		activeTab,
		prompt,
		selectedImage,
		firstFrame,
		lastFrame,
		sourceVideoFile,
		sourceVideoUrl,
		avatarImage,
		audioFile,
		sourceVideo,
		referenceImages,
	} = params;

	if (selectedModels.length === 0) return false;

	if (activeTab === "text") {
		return prompt.trim().length > 0;
	}
	if (activeTab === "image") {
		const hasFrameToVideoModel = selectedModels.some(
			(id) =>
				id === "veo31_fast_frame_to_video" || id === "veo31_frame_to_video"
		);

		if (hasFrameToVideoModel) {
			if (!firstFrame || !lastFrame) return false;
		} else {
			if (!selectedImage) return false;
		}

		return true;
	}
	if (activeTab === "upscale") {
		return Boolean(sourceVideoFile || sourceVideoUrl);
	}
	if (activeTab === "avatar") {
		for (const modelId of selectedModels) {
			if (
				(modelId === "wan_animate_replace" ||
					modelId === "kling_o1_v2v_reference" ||
					modelId === "kling_o1_v2v_edit" ||
					modelId === "wan_26_ref2v") &&
				!sourceVideo
			)
				return false;

			if (
				(modelId === "kling_avatar_pro" ||
					modelId === "kling_avatar_standard" ||
					modelId === "bytedance_omnihuman_v1_5" ||
					modelId === "sync_lipsync_react1") &&
				!audioFile
			)
				return false;

			if (modelId === "sync_lipsync_react1" && !sourceVideo) return false;

			if (modelId === "kling_o1_ref2video") {
				const hasReferenceImage = referenceImages?.some(
					(img) => img !== null
				);
				if (!hasReferenceImage) return false;
				continue;
			}

			if (modelId === "wan_26_ref2v") {
				continue;
			}

			if (
				modelId !== "kling_o1_v2v_reference" &&
				modelId !== "kling_o1_v2v_edit" &&
				modelId !== "kling_o1_ref2video" &&
				modelId !== "sync_lipsync_react1" &&
				!avatarImage
			)
				return false;
		}
		return true;
	}
	if (activeTab === "angles") {
		return false;
	}

	return false;
}
