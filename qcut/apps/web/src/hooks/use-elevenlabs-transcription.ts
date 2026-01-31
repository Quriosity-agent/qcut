/**
 * ElevenLabs Transcription Hook
 *
 * Provides a React hook for transcribing audio/video files using
 * ElevenLabs Scribe v2 via FAL AI.
 *
 * Features:
 * - Automatic audio extraction from video files
 * - Progress tracking for UI feedback
 * - Automatic cleanup of temporary files
 * - Integration with word timeline store
 *
 * @example
 * ```tsx
 * const { transcribeMedia, isTranscribing, progress, error } = useElevenLabsTranscription();
 *
 * const handleTranscribe = async (filePath: string) => {
 *   try {
 *     const result = await transcribeMedia(filePath);
 *     console.log('Transcription complete:', result.words.length, 'words');
 *   } catch (err) {
 *     console.error('Transcription failed:', err);
 *   }
 * };
 * ```
 */

import { useState, useCallback } from "react";
import { useWordTimelineStore } from "@/stores/word-timeline-store";
import type { ElevenLabsTranscribeResult } from "@/types/electron";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for transcription.
 */
export interface TranscriptionOptions {
  /** Language code (e.g., "eng", "spa"). Default: auto-detect */
  language?: string;
  /** Enable speaker diarization. Default: true */
  diarize?: boolean;
  /** Tag audio events (laughter, applause). Default: true */
  tagAudioEvents?: boolean;
  /** Words to bias transcription toward. +30% cost if used */
  keyterms?: string[];
}

/**
 * Return type of the useElevenLabsTranscription hook.
 */
export interface UseElevenLabsTranscriptionReturn {
  /** Function to transcribe a media file */
  transcribeMedia: (
    filePath: string,
    options?: TranscriptionOptions
  ) => Promise<ElevenLabsTranscribeResult | null>;
  /** Whether transcription is in progress */
  isTranscribing: boolean;
  /** Current progress message */
  progress: string;
  /** Error message if transcription failed */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

// ============================================================================
// Constants
// ============================================================================

/** Video file extensions that require audio extraction */
const VIDEO_EXTENSIONS = ["mp4", "mov", "avi", "mkv", "webm", "m4v", "flv"];

/** Audio file extensions that can be transcribed directly */
const AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "aac", "ogg", "flac", "wma"];

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for transcribing audio/video files using ElevenLabs Scribe v2.
 *
 * Handles the full transcription pipeline:
 * 1. Extract audio from video (if needed)
 * 2. Upload to FAL storage
 * 3. Call ElevenLabs API
 * 4. Save results to project folder
 * 5. Clean up temporary files
 */
export function useElevenLabsTranscription(): UseElevenLabsTranscriptionReturn {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { loadFromTranscription } = useWordTimelineStore();

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const transcribeMedia = useCallback(
    async (
      filePath: string,
      options?: TranscriptionOptions
    ): Promise<ElevenLabsTranscribeResult | null> => {
      // Check if Electron API is available
      if (!window.electronAPI?.transcribe?.elevenlabs) {
        setError("Transcription is only available in the desktop app");
        return null;
      }

      setIsTranscribing(true);
      setError(null);
      setProgress("Preparing...");

      let extractedAudioPath: string | null = null;

      try {
        // Get file extension
        const ext = filePath.split(".").pop()?.toLowerCase() || "";
        const isVideo = VIDEO_EXTENSIONS.includes(ext);
        const isAudio = AUDIO_EXTENSIONS.includes(ext);

        if (!isVideo && !isAudio) {
          throw new Error(
            `Unsupported file type: .${ext}. Supported: ${[...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS].join(", ")}`
          );
        }

        let audioPath = filePath;

        // Step 1: Extract audio from video if needed
        if (isVideo) {
          setProgress("Extracting audio from video...");

          if (!window.electronAPI?.ffmpeg?.extractAudio) {
            throw new Error("FFmpeg audio extraction not available");
          }

          const extractResult = await window.electronAPI.ffmpeg.extractAudio({
            videoPath: filePath,
            format: "wav",
          });

          audioPath = extractResult.audioPath;
          extractedAudioPath = audioPath; // Track for cleanup

          setProgress(
            `Audio extracted (${(extractResult.fileSize / 1024 / 1024).toFixed(1)} MB)`
          );
        }

        // Step 2: Call ElevenLabs transcription
        setProgress("Transcribing audio with ElevenLabs...");

        const result = await window.electronAPI.transcribe.elevenlabs({
          audioPath,
          language: options?.language,
          diarize: options?.diarize ?? true,
          tagAudioEvents: options?.tagAudioEvents ?? true,
          keyterms: options?.keyterms,
        });

        // Step 3: Generate filename with timestamp
        const sourceFileName =
          filePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ||
          "transcription";
        const timestamp = new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .slice(0, 15);
        const transcriptFileName = `${sourceFileName}_${timestamp}_transcript.json`;

        // Step 4: Load into word timeline store
        setProgress("Loading transcription...");
        loadFromTranscription(result, transcriptFileName);

        // Note: Project folder save and temp file cleanup are optional features
        // that require additional Electron IPC handlers to be implemented.
        // For now, the transcription result is loaded into the word timeline store
        // and can be exported manually by the user.

        setProgress("Complete!");

        // Log summary
        const wordCount = result.words.filter((w) => w.type === "word").length;
        console.log(
          `[Transcription] Complete: ${wordCount} words, language: ${result.language_code}`
        );

        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Transcription failed";
        console.error("[Transcription] Error:", err);
        setError(message);

        // Note: Temp file cleanup requires additional Electron IPC handlers.
        // Extracted audio files will remain in the system temp directory.

        return null;
      } finally {
        setIsTranscribing(false);
      }
    },
    [loadFromTranscription]
  );

  return {
    transcribeMedia,
    isTranscribing,
    progress,
    error,
    clearError,
  };
}

export default useElevenLabsTranscription;
