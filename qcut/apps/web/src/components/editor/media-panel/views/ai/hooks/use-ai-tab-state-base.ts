/**
 * Base State Hook Patterns for AI Tabs
 *
 * Provides reusable state management utilities used across all AI tab state hooks.
 * This module reduces code duplication for common patterns like file uploads with previews.
 *
 * @see ai-tsx-refactoring.md - Subtask 2.1
 */

import { useState, useCallback, useEffect, useRef } from "react";

// ============================================
// Types
// ============================================

export interface TabStateConfig<T> {
  initialState: T;
  resetDependencies?: unknown[];
}

export interface FileWithPreviewState {
  file: File | null;
  preview: string | null;
  setFile: (file: File | null) => void;
  reset: () => void;
}

export interface MultipleFilesWithPreviewState {
  files: (File | null)[];
  previews: (string | null)[];
  setFile: (index: number, file: File | null) => void;
  reset: () => void;
  resetAt: (index: number) => void;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Creates a reset function for tab state.
 * @param setState - React state setter
 * @param initialState - Initial state value to reset to
 * @returns A function that resets the state
 */
export function createTabStateReset<T>(
  setState: React.Dispatch<React.SetStateAction<T>>,
  initialState: T
): () => void {
  return () => setState(initialState);
}

// ============================================
// Hooks
// ============================================

/**
 * Hook for managing a single file with its object URL preview.
 * Handles proper cleanup of object URLs to prevent memory leaks.
 *
 * @param initialFile - Optional initial file
 * @returns File state with preview URL and handlers
 *
 * @example
 * ```tsx
 * const firstFrame = useFileWithPreview();
 * // Use firstFrame.file, firstFrame.preview
 * // Call firstFrame.setFile(file) to update
 * // Call firstFrame.reset() to clear
 * ```
 */
export function useFileWithPreview(
  initialFile: File | null = null
): FileWithPreviewState {
  const [file, setFileInternal] = useState<File | null>(initialFile);
  const [preview, setPreview] = useState<string | null>(null);

  // Ref to track the latest preview for unmount cleanup
  const previewRef = useRef<string | null>(null);
  previewRef.current = preview;

  // Initialize preview if initial file is provided (run once on mount)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initialFile && !preview && !initializedRef.current) {
      initializedRef.current = true;
      setPreview(URL.createObjectURL(initialFile));
    }
  }, [initialFile, preview]);

  const setFile = useCallback((newFile: File | null) => {
    setFileInternal(newFile);

    // Revoke previous preview URL inside functional update to avoid stale closure
    setPreview((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return newFile ? URL.createObjectURL(newFile) : null;
    });
  }, []);

  const reset = useCallback(() => {
    setFileInternal(null);
    // Revoke preview URL inside functional update to avoid stale closure
    setPreview((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
  }, []);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current);
      }
    };
  }, []);

  return { file, preview, setFile, reset };
}

/**
 * Hook for managing multiple files with their object URL previews.
 * Useful for arrays like reference images (6 slots).
 *
 * @param count - Number of file slots
 * @returns Files state with previews and handlers
 *
 * @example
 * ```tsx
 * const refImages = useMultipleFilesWithPreview(6);
 * // Use refImages.files[0], refImages.previews[0]
 * // Call refImages.setFile(0, file) to update slot 0
 * // Call refImages.resetAt(0) to clear slot 0
 * // Call refImages.reset() to clear all
 * ```
 */
export function useMultipleFilesWithPreview(
  count: number
): MultipleFilesWithPreviewState {
  const [files, setFiles] = useState<(File | null)[]>(() =>
    new Array(count).fill(null)
  );
  const [previews, setPreviews] = useState<(string | null)[]>(() =>
    new Array(count).fill(null)
  );

  // Ref to track the latest previews for unmount cleanup
  const previewsRef = useRef<(string | null)[]>([]);
  previewsRef.current = previews;

  const setFile = useCallback(
    (index: number, newFile: File | null) => {
      if (index < 0 || index >= count) return;

      // Update files array
      setFiles((prev) => {
        const updated = [...prev];
        updated[index] = newFile;
        return updated;
      });

      // Update previews array (revoke old URL inside functional update to avoid stale closure)
      setPreviews((prev) => {
        const updated = [...prev];
        // Revoke previous preview URL at this index
        const oldPreview = prev[index];
        if (oldPreview) {
          URL.revokeObjectURL(oldPreview);
        }
        updated[index] = newFile ? URL.createObjectURL(newFile) : null;
        return updated;
      });
    },
    [count]
  );

  const resetAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= count) return;

      setFiles((prev) => {
        const updated = [...prev];
        updated[index] = null;
        return updated;
      });

      // Revoke old URL inside functional update to avoid stale closure
      setPreviews((prev) => {
        const updated = [...prev];
        const oldPreview = prev[index];
        if (oldPreview) {
          URL.revokeObjectURL(oldPreview);
        }
        updated[index] = null;
        return updated;
      });
    },
    [count]
  );

  const reset = useCallback(() => {
    setFiles(new Array(count).fill(null));
    // Revoke all preview URLs inside functional update to avoid stale closure
    setPreviews((prev) => {
      for (const p of prev) {
        if (p) URL.revokeObjectURL(p);
      }
      return new Array(count).fill(null);
    });
  }, [count]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      for (const p of previewsRef.current) {
        if (p) URL.revokeObjectURL(p);
      }
    };
  }, []);

  return { files, previews, setFile, reset, resetAt };
}

/**
 * Hook for managing audio file with duration extraction.
 * Automatically extracts duration when audio file is set.
 *
 * @returns Audio file state with duration
 *
 * @example
 * ```tsx
 * const audio = useAudioFileWithDuration();
 * // Use audio.file, audio.preview, audio.duration
 * ```
 */
export function useAudioFileWithDuration() {
  const fileState = useFileWithPreview();
  const [duration, setDuration] = useState<number | null>(null);
  const { reset: fileReset } = fileState;

  useEffect(() => {
    if (fileState.file) {
      const audio = new Audio();
      const objectUrl = URL.createObjectURL(fileState.file);
      audio.src = objectUrl;

      audio.onloadedmetadata = () => {
        setDuration(audio.duration);
        URL.revokeObjectURL(objectUrl);
      };

      audio.onerror = () => {
        setDuration(null);
        URL.revokeObjectURL(objectUrl);
      };

      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    }
    setDuration(null);
  }, [fileState.file]);

  const reset = useCallback(() => {
    fileReset();
    setDuration(null);
  }, [fileReset]);

  return {
    file: fileState.file,
    preview: fileState.preview,
    setFile: fileState.setFile,
    reset,
    duration,
  };
}

/**
 * Hook for managing video file with duration extraction.
 * Automatically extracts duration when video file is set.
 *
 * @returns Video file state with duration
 *
 * @example
 * ```tsx
 * const video = useVideoFileWithDuration();
 * // Use video.file, video.preview, video.duration
 * ```
 */
export function useVideoFileWithDuration() {
  const fileState = useFileWithPreview();
  const [duration, setDuration] = useState<number | null>(null);
  const { reset: fileReset } = fileState;

  useEffect(() => {
    if (fileState.file) {
      const video = document.createElement("video");
      const objectUrl = URL.createObjectURL(fileState.file);
      video.src = objectUrl;
      video.preload = "metadata";

      video.onloadedmetadata = () => {
        setDuration(video.duration);
        URL.revokeObjectURL(objectUrl);
      };

      video.onerror = () => {
        setDuration(null);
        URL.revokeObjectURL(objectUrl);
      };

      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    }
    setDuration(null);
  }, [fileState.file]);

  const reset = useCallback(() => {
    fileReset();
    setDuration(null);
  }, [fileReset]);

  return {
    file: fileState.file,
    preview: fileState.preview,
    setFile: fileState.setFile,
    reset,
    duration,
  };
}

/**
 * Hook for managing video file with metadata extraction.
 * Can handle both file uploads and URL inputs.
 *
 * @param extractMetadataFromFile - Function to extract metadata from file
 * @param extractMetadataFromUrl - Function to extract metadata from URL
 * @returns Video state with metadata
 */
export function useVideoWithMetadata<TMetadata>(
  extractMetadataFromFile: (file: File) => Promise<TMetadata | null>,
  extractMetadataFromUrl: (url: string) => Promise<TMetadata | null>
) {
  const [file, setFileInternal] = useState<File | null>(null);
  const [url, setUrl] = useState<string>("");
  const [metadata, setMetadata] = useState<TMetadata | null>(null);

  // Refs to track current file/url for race condition prevention
  const currentFileRef = useRef<File | null>(null);
  const currentUrlRef = useRef<string>("");

  const setFile = useCallback(
    async (newFile: File | null) => {
      currentFileRef.current = newFile;
      setFileInternal(newFile);

      if (!newFile) {
        setMetadata(null);
        return;
      }

      // Clear URL when file is set
      setUrl("");
      currentUrlRef.current = "";

      try {
        const meta = await extractMetadataFromFile(newFile);
        // Only update if this is still the current file
        if (currentFileRef.current === newFile) {
          setMetadata(meta);
        }
      } catch (error) {
        console.error("Failed to read video metadata", error);
        if (currentFileRef.current === newFile) {
          setMetadata(null);
        }
      }
    },
    [extractMetadataFromFile]
  );

  const handleUrlBlur = useCallback(async () => {
    const currentUrl = url;
    currentUrlRef.current = currentUrl;

    if (!currentUrl) {
      setMetadata(null);
      return;
    }

    try {
      const meta = await extractMetadataFromUrl(currentUrl);
      // Only update if this is still the current URL
      if (currentUrlRef.current === currentUrl) {
        setMetadata(meta);
      }
    } catch (error) {
      console.error("Failed to read video metadata", error);
      if (currentUrlRef.current === currentUrl) {
        setMetadata(null);
      }
    }
  }, [url, extractMetadataFromUrl]);

  const reset = useCallback(() => {
    currentFileRef.current = null;
    currentUrlRef.current = "";
    setFileInternal(null);
    setUrl("");
    setMetadata(null);
  }, []);

  return {
    file,
    url,
    metadata,
    setFile,
    setUrl,
    handleUrlBlur,
    reset,
  };
}
