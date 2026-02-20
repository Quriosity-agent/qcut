"use client";

import { useCallback } from "react";
import { useAdjustmentStore } from "@/stores/adjustment-store";
import { getModelCapabilities } from "@/lib/image-edit-capabilities";
import { ImageUploader } from "./image-uploader";
import { MultiImageUpload } from "./multi-image-upload";
import { createObjectURL } from "@/lib/blob-manager";

/**
 * Conditional Image Uploader
 *
 * Automatically switches between single and multi-image upload
 * based on the selected model's capabilities.
 */
export function ConditionalImageUploader() {
	const {
		selectedModel,
		originalImageUrl,
		multipleImages,
		setOriginalImage,
		setMultipleImages,
		removeMultipleImage,
		clearMultipleImages,
	} = useAdjustmentStore();

	const capabilities = getModelCapabilities(selectedModel);

	// Handle single image selection
	const handleSingleImageSelect = useCallback(
		(file: File) => {
			const url = createObjectURL(file, "adjustment-single-image");
			setOriginalImage(file, url);
			// Clear multiple images when using single mode
			clearMultipleImages();
		},
		[setOriginalImage, clearMultipleImages]
	);

	// Handle multiple images change (receives both URLs and Files)
	const handleMultipleImagesChange = useCallback(
		(urls: string[], files: File[]) => {
			setMultipleImages(urls, files);
		},
		[setMultipleImages]
	);

	// Handle individual image removal
	const handleRemoveImage = useCallback(
		(index: number) => {
			removeMultipleImage(index);
		},
		[removeMultipleImage]
	);

	// Show single image uploader for single-image models
	if (!capabilities.supportsMultiple) {
		return (
			<ImageUploader
				onImageSelect={handleSingleImageSelect}
				uploading={false}
			/>
		);
	}

	// Show multi-image uploader for multi-image models
	return (
		<MultiImageUpload
			images={multipleImages}
			maxImages={capabilities.maxImages}
			onImagesChange={handleMultipleImagesChange}
			onRemoveImage={handleRemoveImage}
			label={`Input Images (up to ${capabilities.maxImages})`}
		/>
	);
}
