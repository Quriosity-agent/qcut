/**
 * Upscale Tab State Hook
 *
 * Manages all state related to the Upscale tab including:
 * - Source video (file + URL + metadata)
 * - ByteDance upscaler settings
 * - FlashVSR upscaler settings
 * - Topaz upscaler settings
 *
 * @see ai-tsx-refactoring.md - Subtask 2.5
 */

import { useState, useCallback, useMemo } from "react";
import {
  extractVideoMetadataFromFile,
  extractVideoMetadataFromUrl,
  type VideoMetadata,
} from "@/lib/video-metadata";
import {
  calculateByteDanceUpscaleCost,
  calculateFlashVSRUpscaleCost,
  calculateTopazUpscaleCost,
} from "../utils/ai-cost-calculators";

// ============================================
// Types
// ============================================

export type ByteDanceResolution = "1080p" | "2k" | "4k";
export type ByteDanceFPS = "30fps" | "60fps";

export type FlashVSRAcceleration = "regular" | "high" | "full";
export type FlashVSROutputFormat = "X264" | "VP9" | "PRORES4444" | "GIF";
export type FlashVSROutputQuality = "low" | "medium" | "high" | "maximum";
export type FlashVSRWriteMode = "fast" | "balanced" | "small";

export type TopazTargetFPS = "original" | "interpolated";

export interface ByteDanceSettings {
  targetResolution: ByteDanceResolution;
  targetFPS: ByteDanceFPS;
}

export interface FlashVSRSettings {
  upscaleFactor: number;
  acceleration: FlashVSRAcceleration;
  quality: number;
  colorFix: boolean;
  preserveAudio: boolean;
  outputFormat: FlashVSROutputFormat;
  outputQuality: FlashVSROutputQuality;
  outputWriteMode: FlashVSRWriteMode;
  seed: number | undefined;
}

export interface TopazSettings {
  upscaleFactor: number;
  targetFPS: TopazTargetFPS;
  h264Output: boolean;
}

export interface UpscaleTabState {
  // Source video
  sourceVideoFile: File | null;
  sourceVideoUrl: string;
  videoMetadata: VideoMetadata | null;

  // ByteDance settings
  bytedance: ByteDanceSettings;

  // FlashVSR settings
  flashvsr: FlashVSRSettings;

  // Topaz settings
  topaz: TopazSettings;
}

export interface UpscaleTabSetters {
  // Source video
  setSourceVideoFile: (file: File | null) => void;
  setSourceVideoUrl: (url: string) => void;

  // ByteDance settings
  setBytedanceTargetResolution: (value: ByteDanceResolution) => void;
  setBytedanceTargetFPS: (value: ByteDanceFPS) => void;

  // FlashVSR settings
  setFlashvsrUpscaleFactor: (value: number) => void;
  setFlashvsrAcceleration: (value: FlashVSRAcceleration) => void;
  setFlashvsrQuality: (value: number) => void;
  setFlashvsrColorFix: (value: boolean) => void;
  setFlashvsrPreserveAudio: (value: boolean) => void;
  setFlashvsrOutputFormat: (value: FlashVSROutputFormat) => void;
  setFlashvsrOutputQuality: (value: FlashVSROutputQuality) => void;
  setFlashvsrOutputWriteMode: (value: FlashVSRWriteMode) => void;
  setFlashvsrSeed: (value: number | undefined) => void;

  // Topaz settings
  setTopazUpscaleFactor: (value: number) => void;
  setTopazTargetFPS: (value: TopazTargetFPS) => void;
  setTopazH264Output: (value: boolean) => void;
}

export interface UpscaleTabHandlers {
  /** Handle video file change with metadata extraction */
  handleUpscaleVideoChange: (file: File | null) => Promise<void>;
  /** Handle video URL blur with metadata extraction */
  handleUpscaleVideoUrlBlur: () => Promise<void>;
  /** Reset all upscale state */
  resetAll: () => void;
}

export interface UpscaleTabCosts {
  /** ByteDance estimated cost */
  bytedanceEstimatedCost: string;
  /** FlashVSR estimated cost */
  flashvsrEstimatedCost: string;
  /** Topaz estimated cost */
  topazEstimatedCost: string;
  /** Video duration in seconds (from metadata) */
  videoDurationSeconds: number;
}

export interface UseUpscaleTabStateResult {
  state: UpscaleTabState;
  setters: UpscaleTabSetters;
  handlers: UpscaleTabHandlers;
  costs: UpscaleTabCosts;
}

// ============================================
// Defaults
// ============================================

export const UPSCALE_DEFAULTS = {
  bytedance: {
    targetResolution: "1080p" as ByteDanceResolution,
    targetFPS: "30fps" as ByteDanceFPS,
  },
  flashvsr: {
    upscaleFactor: 4,
    acceleration: "regular" as FlashVSRAcceleration,
    quality: 70,
    colorFix: true,
    preserveAudio: false,
    outputFormat: "X264" as FlashVSROutputFormat,
    outputQuality: "high" as FlashVSROutputQuality,
    outputWriteMode: "balanced" as FlashVSRWriteMode,
    seed: undefined,
  },
  topaz: {
    upscaleFactor: 2,
    targetFPS: "original" as TopazTargetFPS,
    h264Output: false,
  },
} as const;

// ============================================
// Hook
// ============================================

/**
 * Hook for managing Upscale tab state.
 *
 * @example
 * ```tsx
 * const { state, setters, handlers, costs } = useUpscaleTabState();
 *
 * // Use video source
 * <FileUpload
 *   value={state.sourceVideoFile}
 *   onChange={handlers.handleUpscaleVideoChange}
 * />
 * <Input
 *   value={state.sourceVideoUrl}
 *   onChange={(e) => setters.setSourceVideoUrl(e.target.value)}
 *   onBlur={handlers.handleUpscaleVideoUrlBlur}
 * />
 *
 * // Display metadata
 * {state.videoMetadata && (
 *   <span>{state.videoMetadata.width}x{state.videoMetadata.height}</span>
 * )}
 *
 * // Show estimated costs
 * <Badge>Est. {costs.bytedanceEstimatedCost}</Badge>
 * ```
 */
export function useUpscaleTabState(): UseUpscaleTabStateResult {
  // Source video
  const [sourceVideoFile, setSourceVideoFile] = useState<File | null>(null);
  const [sourceVideoUrl, setSourceVideoUrl] = useState("");
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(
    null
  );

  // ByteDance settings
  const [bytedanceTargetResolution, setBytedanceTargetResolution] =
    useState<ByteDanceResolution>(UPSCALE_DEFAULTS.bytedance.targetResolution);
  const [bytedanceTargetFPS, setBytedanceTargetFPS] = useState<ByteDanceFPS>(
    UPSCALE_DEFAULTS.bytedance.targetFPS
  );

  // FlashVSR settings
  const [flashvsrUpscaleFactor, setFlashvsrUpscaleFactor] = useState<number>(
    UPSCALE_DEFAULTS.flashvsr.upscaleFactor
  );
  const [flashvsrAcceleration, setFlashvsrAcceleration] =
    useState<FlashVSRAcceleration>(UPSCALE_DEFAULTS.flashvsr.acceleration);
  const [flashvsrQuality, setFlashvsrQuality] = useState<number>(
    UPSCALE_DEFAULTS.flashvsr.quality
  );
  const [flashvsrColorFix, setFlashvsrColorFix] = useState<boolean>(
    UPSCALE_DEFAULTS.flashvsr.colorFix
  );
  const [flashvsrPreserveAudio, setFlashvsrPreserveAudio] = useState<boolean>(
    UPSCALE_DEFAULTS.flashvsr.preserveAudio
  );
  const [flashvsrOutputFormat, setFlashvsrOutputFormat] =
    useState<FlashVSROutputFormat>(UPSCALE_DEFAULTS.flashvsr.outputFormat);
  const [flashvsrOutputQuality, setFlashvsrOutputQuality] =
    useState<FlashVSROutputQuality>(UPSCALE_DEFAULTS.flashvsr.outputQuality);
  const [flashvsrOutputWriteMode, setFlashvsrOutputWriteMode] =
    useState<FlashVSRWriteMode>(UPSCALE_DEFAULTS.flashvsr.outputWriteMode);
  const [flashvsrSeed, setFlashvsrSeed] = useState<number | undefined>(
    UPSCALE_DEFAULTS.flashvsr.seed
  );

  // Topaz settings
  const [topazUpscaleFactor, setTopazUpscaleFactor] = useState<number>(
    UPSCALE_DEFAULTS.topaz.upscaleFactor
  );
  const [topazTargetFPS, setTopazTargetFPS] = useState<TopazTargetFPS>(
    UPSCALE_DEFAULTS.topaz.targetFPS
  );
  const [topazH264Output, setTopazH264Output] = useState<boolean>(
    UPSCALE_DEFAULTS.topaz.h264Output
  );

  // Handle video file change with metadata extraction
  const handleUpscaleVideoChange = useCallback(async (file: File | null) => {
    setSourceVideoFile(file);

    if (!file) {
      setVideoMetadata(null);
      return;
    }

    setSourceVideoUrl("");
    try {
      const metadata = await extractVideoMetadataFromFile(file);
      setVideoMetadata(metadata);
    } catch (error) {
      console.error("Failed to read video metadata", error);
      setVideoMetadata(null);
    }
  }, []);

  // Handle video URL blur with metadata extraction
  const handleUpscaleVideoUrlBlur = useCallback(async () => {
    if (!sourceVideoUrl) {
      setVideoMetadata(null);
      return;
    }

    try {
      const metadata = await extractVideoMetadataFromUrl(sourceVideoUrl);
      setVideoMetadata(metadata);
    } catch (error) {
      console.error("Failed to read video metadata", error);
      setVideoMetadata(null);
    }
  }, [sourceVideoUrl]);

  // Reset all state
  const resetAll = useCallback(() => {
    setSourceVideoFile(null);
    setSourceVideoUrl("");
    setVideoMetadata(null);

    // Reset ByteDance
    setBytedanceTargetResolution(UPSCALE_DEFAULTS.bytedance.targetResolution);
    setBytedanceTargetFPS(UPSCALE_DEFAULTS.bytedance.targetFPS);

    // Reset FlashVSR
    setFlashvsrUpscaleFactor(UPSCALE_DEFAULTS.flashvsr.upscaleFactor);
    setFlashvsrAcceleration(UPSCALE_DEFAULTS.flashvsr.acceleration);
    setFlashvsrQuality(UPSCALE_DEFAULTS.flashvsr.quality);
    setFlashvsrColorFix(UPSCALE_DEFAULTS.flashvsr.colorFix);
    setFlashvsrPreserveAudio(UPSCALE_DEFAULTS.flashvsr.preserveAudio);
    setFlashvsrOutputFormat(UPSCALE_DEFAULTS.flashvsr.outputFormat);
    setFlashvsrOutputQuality(UPSCALE_DEFAULTS.flashvsr.outputQuality);
    setFlashvsrOutputWriteMode(UPSCALE_DEFAULTS.flashvsr.outputWriteMode);
    setFlashvsrSeed(UPSCALE_DEFAULTS.flashvsr.seed);

    // Reset Topaz
    setTopazUpscaleFactor(UPSCALE_DEFAULTS.topaz.upscaleFactor);
    setTopazTargetFPS(UPSCALE_DEFAULTS.topaz.targetFPS);
    setTopazH264Output(UPSCALE_DEFAULTS.topaz.h264Output);
  }, []);

  // Video duration from metadata
  const videoDurationSeconds = videoMetadata?.duration ?? 10;

  // Calculate estimated costs
  const bytedanceEstimatedCost = useMemo(
    () =>
      calculateByteDanceUpscaleCost(
        bytedanceTargetResolution,
        bytedanceTargetFPS,
        videoDurationSeconds
      ),
    [bytedanceTargetResolution, bytedanceTargetFPS, videoDurationSeconds]
  );

  const flashvsrEstimatedCost = useMemo(() => {
    if (!videoMetadata) return "$0.000";
    const { width, height, frames, duration, fps } = videoMetadata;
    const frameCount =
      frames ?? Math.max(1, Math.round((duration ?? 0) * (fps ?? 30)));

    return calculateFlashVSRUpscaleCost(
      width,
      height,
      frameCount,
      flashvsrUpscaleFactor
    );
  }, [videoMetadata, flashvsrUpscaleFactor]);

  const topazEstimatedCost = useMemo(
    () => calculateTopazUpscaleCost(topazUpscaleFactor),
    [topazUpscaleFactor]
  );

  return {
    state: {
      sourceVideoFile,
      sourceVideoUrl,
      videoMetadata,
      bytedance: {
        targetResolution: bytedanceTargetResolution,
        targetFPS: bytedanceTargetFPS,
      },
      flashvsr: {
        upscaleFactor: flashvsrUpscaleFactor,
        acceleration: flashvsrAcceleration,
        quality: flashvsrQuality,
        colorFix: flashvsrColorFix,
        preserveAudio: flashvsrPreserveAudio,
        outputFormat: flashvsrOutputFormat,
        outputQuality: flashvsrOutputQuality,
        outputWriteMode: flashvsrOutputWriteMode,
        seed: flashvsrSeed,
      },
      topaz: {
        upscaleFactor: topazUpscaleFactor,
        targetFPS: topazTargetFPS,
        h264Output: topazH264Output,
      },
    },
    setters: {
      setSourceVideoFile,
      setSourceVideoUrl,
      setBytedanceTargetResolution,
      setBytedanceTargetFPS,
      setFlashvsrUpscaleFactor,
      setFlashvsrAcceleration,
      setFlashvsrQuality,
      setFlashvsrColorFix,
      setFlashvsrPreserveAudio,
      setFlashvsrOutputFormat,
      setFlashvsrOutputQuality,
      setFlashvsrOutputWriteMode,
      setFlashvsrSeed,
      setTopazUpscaleFactor,
      setTopazTargetFPS,
      setTopazH264Output,
    },
    handlers: {
      handleUpscaleVideoChange,
      handleUpscaleVideoUrlBlur,
      resetAll,
    },
    costs: {
      bytedanceEstimatedCost,
      flashvsrEstimatedCost,
      topazEstimatedCost,
      videoDurationSeconds,
    },
  };
}
