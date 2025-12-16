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
  useVideoFileWithDuration,
} from "./use-ai-tab-state-base";
import type {
  SyncLipsyncEmotion,
  SyncLipsyncModelMode,
  SyncLipsyncSyncMode,
} from "../types/ai-types";

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

  // Sync Lipsync React-1
  syncLipsyncSourceVideo: File | null;
  syncLipsyncSourceVideoPreview: string | null;
  syncLipsyncVideoDuration: number | null;
  syncLipsyncEmotion: SyncLipsyncEmotion;
  syncLipsyncModelMode: SyncLipsyncModelMode;
  syncLipsyncLipsyncMode: SyncLipsyncSyncMode;
  syncLipsyncTemperature: number;

  // Veo 3.1 Extend-Video
  extendVideoAspectRatio: "auto" | "16:9" | "9:16";
  extendVideoGenerateAudio: boolean;
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

  // Sync Lipsync React-1
  setSyncLipsyncSourceVideo: (file: File | null) => void;
  setSyncLipsyncEmotion: (emotion: SyncLipsyncEmotion) => void;
  setSyncLipsyncModelMode: (mode: SyncLipsyncModelMode) => void;
  setSyncLipsyncLipsyncMode: (mode: SyncLipsyncSyncMode) => void;
  setSyncLipsyncTemperature: (temp: number) => void;

  // Veo 3.1 Extend-Video
  setExtendVideoAspectRatio: (value: "auto" | "16:9" | "9:16") => void;
  setExtendVideoGenerateAudio: (value: boolean) => void;
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
  /** Reset Sync Lipsync source video */
  resetSyncLipsyncSourceVideo: () => void;
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

  // Sync Lipsync React-1 state
  const syncLipsyncVideoState = useVideoFileWithDuration();
  const [syncLipsyncEmotion, setSyncLipsyncEmotion] =
    useState<SyncLipsyncEmotion>("neutral");
  const [syncLipsyncModelMode, setSyncLipsyncModelMode] =
    useState<SyncLipsyncModelMode>("face");
  const [syncLipsyncLipsyncMode, setSyncLipsyncLipsyncMode] =
    useState<SyncLipsyncSyncMode>("bounce");
  const [syncLipsyncTemperature, setSyncLipsyncTemperature] =
    useState<number>(0.5);

  // Veo 3.1 Extend-Video state
  const [extendVideoAspectRatio, setExtendVideoAspectRatio] = useState<
    "auto" | "16:9" | "9:16"
  >("auto");
  const [extendVideoGenerateAudio, setExtendVideoGenerateAudio] =
    useState<boolean>(true);

  // Reset all state
  const resetAll = useCallback(() => {
    avatarImageState.reset();
    avatarLastFrameState.reset();
    referenceImagesState.reset();
    audioState.reset();
    sourceVideoState.reset();
    setKlingAvatarV2Prompt("");
    // Reset Sync Lipsync React-1 state
    syncLipsyncVideoState.reset();
    setSyncLipsyncEmotion("neutral");
    setSyncLipsyncModelMode("face");
    setSyncLipsyncLipsyncMode("bounce");
    setSyncLipsyncTemperature(0.5);
  }, [
    avatarImageState,
    avatarLastFrameState,
    referenceImagesState,
    audioState,
    sourceVideoState,
    syncLipsyncVideoState,
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
      // Sync Lipsync React-1 state
      syncLipsyncSourceVideo: syncLipsyncVideoState.file,
      syncLipsyncSourceVideoPreview: syncLipsyncVideoState.preview,
      syncLipsyncVideoDuration: syncLipsyncVideoState.duration,
      syncLipsyncEmotion,
      syncLipsyncModelMode,
      syncLipsyncLipsyncMode,
      syncLipsyncTemperature,
      // Veo 3.1 Extend-Video state
      extendVideoAspectRatio,
      extendVideoGenerateAudio,
    },
    setters: {
      setAvatarImage: avatarImageState.setFile,
      setAvatarLastFrame: avatarLastFrameState.setFile,
      setReferenceImage: referenceImagesState.setFile,
      setAudioFile: audioState.setFile,
      setSourceVideo: sourceVideoState.setFile,
      setKlingAvatarV2Prompt,
      // Sync Lipsync React-1 setters
      setSyncLipsyncSourceVideo: syncLipsyncVideoState.setFile,
      setSyncLipsyncEmotion,
      setSyncLipsyncModelMode,
      setSyncLipsyncLipsyncMode,
      setSyncLipsyncTemperature,
      // Veo 3.1 Extend-Video setters
      setExtendVideoAspectRatio,
      setExtendVideoGenerateAudio,
    },
    helpers: {
      resetAvatarImage: avatarImageState.reset,
      resetAvatarLastFrame: avatarLastFrameState.reset,
      resetReferenceImageAt: referenceImagesState.resetAt,
      resetAllReferenceImages: referenceImagesState.reset,
      resetAudio: audioState.reset,
      resetSourceVideo: sourceVideoState.reset,
      resetSyncLipsyncSourceVideo: syncLipsyncVideoState.reset,
      resetAll,
    },
  };
}
