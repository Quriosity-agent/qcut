/**
 * Avatar Tab State Hook
 *
 * Manages all state related to the Avatar tab including:
 * - Avatar image upload
 * - Last frame upload (for end pose)
 * - Reference images (6 slots)
 * - Audio file with duration extraction
 * - Source video for video-to-avatar
 * - Kling Avatar v2 prompt
 *
 * @see ai-tsx-refactoring.md - Subtask 2.4
 */

import { useState, useCallback, useEffect } from "react";
import {
  useFileWithPreview,
  useMultipleFilesWithPreview,
  useAudioFileWithDuration,
} from "./use-ai-tab-state-base";

// ============================================
// Types
// ============================================

export interface AvatarTabState {
  // Avatar image
  avatarImage: File | null;
  avatarImagePreview: string | null;

  // Last frame (end pose)
  avatarLastFrame: File | null;
  avatarLastFramePreview: string | null;

  // Reference images (6 slots)
  referenceImages: (File | null)[];
  referenceImagePreviews: (string | null)[];

  // Audio
  audioFile: File | null;
  audioPreview: string | null;
  audioDuration: number | null;

  // Source video
  sourceVideo: File | null;
  sourceVideoPreview: string | null;

  // Kling Avatar v2
  klingAvatarV2Prompt: string;
}

export interface AvatarTabSetters {
  // Avatar image
  setAvatarImage: (file: File | null) => void;

  // Last frame
  setAvatarLastFrame: (file: File | null) => void;

  // Reference images
  setReferenceImage: (index: number, file: File | null) => void;

  // Audio
  setAudioFile: (file: File | null) => void;

  // Source video
  setSourceVideo: (file: File | null) => void;

  // Kling Avatar v2
  setKlingAvatarV2Prompt: (value: string) => void;
}

export interface AvatarTabHelpers {
  /** Reset avatar image */
  resetAvatarImage: () => void;
  /** Reset last frame */
  resetAvatarLastFrame: () => void;
  /** Reset a specific reference image slot */
  resetReferenceImageAt: (index: number) => void;
  /** Reset all reference images */
  resetAllReferenceImages: () => void;
  /** Reset audio */
  resetAudio: () => void;
  /** Reset source video */
  resetSourceVideo: () => void;
  /** Reset all avatar state */
  resetAll: () => void;
}

export interface UseAvatarTabStateResult {
  state: AvatarTabState;
  setters: AvatarTabSetters;
  helpers: AvatarTabHelpers;
}

// ============================================
// Constants
// ============================================

/** Number of reference image slots */
export const REFERENCE_IMAGE_COUNT = 6;

// ============================================
// Hook
// ============================================

/**
 * Hook for managing Avatar tab state.
 *
 * @example
 * ```tsx
 * const { state, setters, helpers } = useAvatarTabState();
 *
 * // Use avatar image
 * <FileUpload value={state.avatarImage} onChange={setters.setAvatarImage} />
 *
 * // Use reference images
 * {state.referenceImages.map((img, i) => (
 *   <FileUpload
 *     key={i}
 *     value={img}
 *     onChange={(file) => setters.setReferenceImage(i, file)}
 *   />
 * ))}
 *
 * // Check audio duration
 * <span>Duration: {state.audioDuration}s</span>
 * ```
 */
export function useAvatarTabState(): UseAvatarTabStateResult {
  // Avatar image using reusable hook
  const avatarImageState = useFileWithPreview();

  // Last frame using reusable hook
  const avatarLastFrameState = useFileWithPreview();

  // Reference images using reusable multi-file hook
  const referenceImagesState = useMultipleFilesWithPreview(
    REFERENCE_IMAGE_COUNT
  );

  // Audio with duration extraction
  const audioState = useAudioFileWithDuration();

  // Source video using reusable hook
  const sourceVideoState = useFileWithPreview();

  // Kling Avatar v2 prompt
  const [klingAvatarV2Prompt, setKlingAvatarV2Prompt] = useState("");

  // Reset all state
  const resetAll = useCallback(() => {
    avatarImageState.reset();
    avatarLastFrameState.reset();
    referenceImagesState.reset();
    audioState.reset();
    sourceVideoState.reset();
    setKlingAvatarV2Prompt("");
  }, [
    avatarImageState,
    avatarLastFrameState,
    referenceImagesState,
    audioState,
    sourceVideoState,
  ]);

  return {
    state: {
      avatarImage: avatarImageState.file,
      avatarImagePreview: avatarImageState.preview,
      avatarLastFrame: avatarLastFrameState.file,
      avatarLastFramePreview: avatarLastFrameState.preview,
      referenceImages: referenceImagesState.files,
      referenceImagePreviews: referenceImagesState.previews,
      audioFile: audioState.file,
      audioPreview: audioState.preview,
      audioDuration: audioState.duration,
      sourceVideo: sourceVideoState.file,
      sourceVideoPreview: sourceVideoState.preview,
      klingAvatarV2Prompt,
    },
    setters: {
      setAvatarImage: avatarImageState.setFile,
      setAvatarLastFrame: avatarLastFrameState.setFile,
      setReferenceImage: referenceImagesState.setFile,
      setAudioFile: audioState.setFile,
      setSourceVideo: sourceVideoState.setFile,
      setKlingAvatarV2Prompt,
    },
    helpers: {
      resetAvatarImage: avatarImageState.reset,
      resetAvatarLastFrame: avatarLastFrameState.reset,
      resetReferenceImageAt: referenceImagesState.resetAt,
      resetAllReferenceImages: referenceImagesState.reset,
      resetAudio: audioState.reset,
      resetSourceVideo: sourceVideoState.reset,
      resetAll,
    },
  };
}
