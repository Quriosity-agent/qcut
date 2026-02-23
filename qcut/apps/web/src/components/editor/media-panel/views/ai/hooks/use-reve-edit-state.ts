import { useCallback, useState } from "react";
import { falAIClient } from "@/lib/ai-clients/fal-ai-client";
import { validateReveEditImage } from "@/lib/ai-models/image-validation";

export function useReveEditState() {
	const [uploadedImageForEdit, setUploadedImageForEdit] = useState<File | null>(
		null
	);
	const [uploadedImagePreview, setUploadedImagePreview] = useState<
		string | null
	>(null);
	const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

	const clearUploadedImageForEdit = useCallback(() => {
		if (uploadedImagePreview) {
			URL.revokeObjectURL(uploadedImagePreview);
		}

		setUploadedImageForEdit(null);
		setUploadedImagePreview(null);
		setUploadedImageUrl(null);
	}, [uploadedImagePreview]);

	const handleImageUploadForEdit = useCallback(
		async (file: File) => {
			try {
				const validation = await validateReveEditImage(file);

				if (!validation.valid) {
					const errorMessage = validation.error || "Invalid image file";
					console.error("[Reve Edit] Validation failed:", errorMessage);
					throw new Error(errorMessage);
				}

				const preview = URL.createObjectURL(file);
				setUploadedImagePreview(preview);
				setUploadedImageForEdit(file);

				const imageUrl = await falAIClient.uploadImageToFal(file);
				setUploadedImageUrl(imageUrl);

				console.log("[Reve Edit] Image uploaded successfully:", {
					fileName: file.name,
					fileSize: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
					dimensions: validation.dimensions,
					url: imageUrl,
				});
			} catch (error) {
				console.error("[Reve Edit] Image upload failed:", error);
				clearUploadedImageForEdit();
				throw error;
			}
		},
		[clearUploadedImageForEdit]
	);

	return {
		uploadedImageForEdit,
		uploadedImagePreview,
		uploadedImageUrl,
		clearUploadedImageForEdit,
		handleImageUploadForEdit,
	};
}
