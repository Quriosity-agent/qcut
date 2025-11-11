import { useCallback, useState } from "react";
import {
  uploadImageToFAL,
  type ImageEditProgressCallback,
} from "@/lib/image-edit-client";
import { useText2ImageStore } from "@/stores/text2image-store";

export function useUpscaleGeneration() {
  const upscaleImage = useText2ImageStore((state) => state.upscaleImage);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

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
