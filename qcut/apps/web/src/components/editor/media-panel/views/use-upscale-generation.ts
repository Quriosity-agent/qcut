/**
 * Custom hook for managing AI image upscaling workflow
 *
 * Handles the complete upscaling process including:
 * - Image upload to FAL.ai
 * - Progress tracking during processing
 * - Result URL management
 * - Error handling and state management
 *
 * This hook orchestrates the upscale operation by coordinating between the
 * image upload client, the text2image store, and local component state.
 *
 * @module useUpscaleGeneration
 */

import { useCallback, useState } from "react";
import {
	uploadImageToFAL,
	type ImageEditProgressCallback,
} from "@/lib/image-edit-client";
import { useText2ImageStore } from "@/stores/text2image-store";

/**
 * Hook for handling AI image upscaling operations
 *
 * Provides a complete upscaling workflow with progress tracking, error handling,
 * and result management. The hook manages local state for the upscaling process
 * while delegating the actual API calls to the text2image store.
 *
 * @returns An object containing:
 * - `handleUpscale`: Function to initiate upscaling for a given file
 * - `isProcessing`: Boolean indicating if upscaling is in progress
 * - `progress`: Number (0-100) indicating current progress
 * - `error`: Error message string or null
 * - `resultUrl`: URL of the upscaled image result or null
 * - `reset`: Function to clear all state and start fresh
 *
 * @example
 * ```tsx
 * const { handleUpscale, isProcessing, progress, error, resultUrl } = useUpscaleGeneration();
 *
 * const onFileSelect = async (file: File) => {
 *   try {
 *     await handleUpscale(file);
 *     console.log('Upscale complete!');
 *   } catch (err) {
 *     console.error('Upscale failed:', err);
 *   }
 * };
 * ```
 */
export function useUpscaleGeneration() {
	const upscaleImage = useText2ImageStore((state) => state.upscaleImage);
	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [resultUrl, setResultUrl] = useState<string | null>(null);

	/**
	 * Initiates the image upscaling process
	 *
	 * This function:
	 * 1. Uploads the image file to FAL.ai storage
	 * 2. Calls the upscale API with current settings from the store
	 * 3. Tracks progress through callbacks
	 * 4. Sets the result URL on completion
	 *
	 * @param file - The image file to upscale
	 * @returns Promise that resolves with the upscale response
	 * @throws Error if upload or upscaling fails
	 */
	const handleUpscale = useCallback(
		async (file: File) => {
			setIsProcessing(true);
			setError(null);
			setProgress(5);
			setResultUrl(null);

			try {
				const uploadedUrl = await uploadImageToFAL(file);
				const progressHandler: ImageEditProgressCallback = (status) => {
					if (typeof status.progress === "number") {
						setProgress(status.progress);
					}
				};

				const response = await upscaleImage(uploadedUrl, {
					onProgress: progressHandler,
				});

				if (response.status === "completed" && response.result_url) {
					setResultUrl(response.result_url);
					setProgress(100);
				}

				return response;
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: "Upscale request failed unexpectedly"
				);
				throw err;
			} finally {
				setIsProcessing(false);
			}
		},
		[upscaleImage]
	);

	/**
	 * Resets all upscaling state to initial values
	 *
	 * Clears error messages, progress, and result URLs. Useful for starting
	 * a fresh upscaling operation or clearing the UI after viewing results.
	 */
	const reset = useCallback(() => {
		setError(null);
		setProgress(0);
		setResultUrl(null);
	}, []);

	return {
		handleUpscale,
		isProcessing,
		progress,
		error,
		resultUrl,
		reset,
	};
}
