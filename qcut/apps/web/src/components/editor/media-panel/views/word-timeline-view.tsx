"use client";

/**
 * Word Timeline View Component
 *
 * Displays word-level transcription data from JSON files or transcribed media.
 * Features:
 * - Drag & drop JSON file import
 * - Drag & drop video/audio for transcription (ElevenLabs Scribe v2)
 * - Click word to seek timeline to that timestamp
 * - Toggle word deletion (red color + strikethrough)
 * - Tooltip showing word timing on hover
 *
 * @module components/editor/media-panel/views/word-timeline-view
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWordTimelineStore } from "@/stores/word-timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useMediaStore } from "@/stores/media-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { useElevenLabsTranscription } from "@/hooks/use-elevenlabs-transcription";
import { useDragDrop } from "@/hooks/use-drag-drop";
import { Upload, X, Loader2, AlertCircle, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WORD_FILTER_STATE,
  type WordFilterState,
  type WordItem,
} from "@/types/word-timeline";
import { toast } from "sonner";

// ============================================================================
// Constants
// ============================================================================

/** Supported media extensions for transcription */
const MEDIA_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".wav",
  ".mp3",
  ".m4a",
  ".aac",
];

/** Check if a file is a supported media file */
function isMediaFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  return MEDIA_EXTENSIONS.includes(ext);
}

/** Check if a file is a JSON file */
function isJsonFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".json");
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format seconds to MM:SS.ms format
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(2).padStart(5, "0")}`;
}

/**
 * Format duration in human readable form
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Return Tailwind classes for a word chip based on its filter state. */
function getChipColor({
  filterState,
}: {
  filterState: WordFilterState;
}): string {
  if (filterState === WORD_FILTER_STATE.AI) {
    return "bg-orange-500/20 text-orange-700 border border-dashed border-orange-400";
  }
  if (filterState === WORD_FILTER_STATE.USER_REMOVE) {
    return "bg-destructive/20 text-destructive line-through decoration-2";
  }
  if (filterState === WORD_FILTER_STATE.USER_KEEP) {
    return "bg-emerald-500/20 text-emerald-700 border border-emerald-400";
  }
  return "bg-muted hover:bg-accent hover:text-accent-foreground";
}

/** Return contextual tooltip text based on a word's current filter state. */
function getChipHelpText({ word }: { word: WordItem }): string {
  if (word.filterState === WORD_FILTER_STATE.AI) {
    return "Left-click keep, right-click remove";
  }
  if (word.filterState === WORD_FILTER_STATE.USER_REMOVE) {
    return "Left-click keep, right-click keep removed";
  }
  if (word.filterState === WORD_FILTER_STATE.USER_KEEP) {
    return "Left-click remove, right-click remove";
  }
  return "Left-click seek, right-click remove";
}

/** Sum the duration of all words marked for removal (AI or user-removed). */
function calculateRemovedDuration({ words }: { words: WordItem[] }): number {
  try {
    const ranges = words
      .filter(
        (word) =>
          word.filterState === WORD_FILTER_STATE.AI ||
          word.filterState === WORD_FILTER_STATE.USER_REMOVE
      )
      .map((word) => ({
        start: Math.max(0, word.start),
        end: Math.max(word.start, word.end),
      }))
      .sort((left, right) => left.start - right.start);

    if (ranges.length === 0) {
      return 0;
    }

    const merged: Array<{ start: number; end: number }> = [];
    for (const range of ranges) {
      const previous = merged[merged.length - 1];
      if (!previous || range.start > previous.end) {
        merged.push({ ...range });
        continue;
      }
      previous.end = Math.max(previous.end, range.end);
    }

    let total = 0;
    for (const range of merged) {
      total += Math.max(0, range.end - range.start);
    }
    return total;
  } catch {
    return 0;
  }
}

// ============================================================================
// Word Chip Component
// ============================================================================

interface WordChipProps {
  word: WordItem;
  isSelected: boolean;
  onPrimaryAction: (word: WordItem) => void;
  onQuickRemove: (word: WordItem) => void;
}

/** Individual word chip with click/right-click actions and keyboard support. */
function WordChip({
  word,
  isSelected,
  onPrimaryAction,
  onQuickRemove,
}: WordChipProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(() => {
    onPrimaryAction(word);
  }, [word, onPrimaryAction]);

  const handleRightClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onQuickRemove(word);
    },
    [word, onQuickRemove]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      try {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPrimaryAction(word);
        }
      } catch {
        return;
      }
    },
    [onPrimaryAction, word]
  );

  // Auto-scroll into view when selected during playback
  useEffect(() => {
    if (isSelected && buttonRef.current) {
      buttonRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [isSelected]);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            onClick={handleClick}
            onContextMenu={handleRightClick}
            onKeyDown={handleKeyDown}
            className={cn(
              "inline-flex items-center px-2 py-1 text-sm rounded transition-all",
              "hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring",
              getChipColor({ filterState: word.filterState }),
              isSelected && "ring-2 ring-primary ring-offset-1"
            )}
          >
            {word.text}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <p className="font-mono">
            {formatTime(word.start)} - {formatTime(word.end)}
          </p>
          {word.filterReason && (
            <p className="text-muted-foreground mt-1">{word.filterReason}</p>
          )}
          <p className="text-muted-foreground mt-1">
            {getChipHelpText({ word })}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================================================
// Drop Zone Component
// ============================================================================

interface DropZoneProps {
  onJsonSelect: (file: File) => void;
  onMediaSelect: (filePath: string) => void;
  isLoading: boolean;
  isTranscribing: boolean;
  transcriptionProgress: string;
}

/** Drag-and-drop zone for importing JSON transcription or media files. */
function DropZone({
  onJsonSelect,
  onMediaSelect,
  isLoading,
  isTranscribing,
  transcriptionProgress,
}: DropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (files: FileList) => {
      console.log("[WordTimeline] handleDrop called");
      console.log("[WordTimeline] Files count:", files.length);
      try {
        const file = files[0];
        if (!file) {
          console.log("[WordTimeline] No file found in drop");
          return;
        }

        // Use webUtils.getPathForFile via preload (Electron 37+ removed File.path)
        const filePath =
          window.electronAPI?.getPathForFile?.(file) ?? undefined;

        console.log("[WordTimeline] File dropped:", {
          name: file.name,
          type: file.type,
          size: file.size,
          path: filePath,
        });

        if (isJsonFile(file.name)) {
          console.log(
            "[WordTimeline] Detected JSON file, calling onJsonSelect"
          );
          onJsonSelect(file);
        } else if (isMediaFile(file.name)) {
          console.log("[WordTimeline] Detected media file");
          console.log("[WordTimeline] File path from Electron:", filePath);
          if (filePath) {
            console.log(
              "[WordTimeline] Calling onMediaSelect with path:",
              filePath
            );
            onMediaSelect(filePath);
          } else {
            console.error(
              "[WordTimeline] No file path available - not running in Electron?"
            );
            toast.error("Media transcription requires the desktop app");
          }
        } else {
          console.warn(
            "[WordTimeline] Unsupported file type:",
            file.name,
            file.type
          );
          toast.error(
            "Unsupported file type. Drop JSON or media files (MP4, WAV, MP3, etc.)"
          );
        }
      } catch (err) {
        console.error("[WordTimeline] Error processing dropped file:", err);
        toast.error("Unable to process the dropped file");
      }
    },
    [onJsonSelect, onMediaSelect]
  );

  const { isDragOver, dragProps } = useDragDrop({ onDrop: handleDrop });

  const handleClick = useCallback(async () => {
    console.log("[WordTimeline] handleClick called (file picker button)");
    try {
      // Use Electron's native file dialog to get the file path
      console.log("[WordTimeline] Checking for Electron file dialog API...");
      console.log(
        "[WordTimeline] window.electronAPI exists:",
        !!window.electronAPI
      );
      console.log(
        "[WordTimeline] openFileDialog exists:",
        !!window.electronAPI?.openFileDialog
      );

      if (window.electronAPI?.openFileDialog) {
        console.log("[WordTimeline] Opening native file dialog...");
        const dialogResult = await window.electronAPI.openFileDialog();

        console.log("[WordTimeline] File dialog result:", dialogResult);
        console.log("[WordTimeline] Result type:", typeof dialogResult);

        // Handle both string (expected) and object (raw dialog result) formats
        let filePath: string | null = null;
        if (typeof dialogResult === "string") {
          filePath = dialogResult;
        } else if (dialogResult && typeof dialogResult === "object") {
          // Raw dialog result object - extract filePath
          const rawResult = dialogResult as {
            canceled?: boolean;
            filePaths?: string[];
          };
          console.log("[WordTimeline] Raw dialog object:", rawResult);
          if (
            !rawResult.canceled &&
            rawResult.filePaths &&
            rawResult.filePaths.length > 0
          ) {
            filePath = rawResult.filePaths[0];
          }
        }

        console.log("[WordTimeline] Extracted file path:", filePath);

        if (!filePath) {
          console.log(
            "[WordTimeline] No file selected (dialog cancelled or empty)"
          );
          return;
        }

        const fileName = filePath.split(/[/\\]/).pop() || "";
        console.log("[WordTimeline] Selected file name:", fileName);

        if (isJsonFile(fileName)) {
          console.log("[WordTimeline] JSON file detected, reading content...");
          // For JSON, we need to read the file content
          if (!window.electronAPI.readFile) {
            console.error("[WordTimeline] readFile API not available");
            toast.error("File reading not available");
            return;
          }
          const buffer = await window.electronAPI.readFile(filePath);
          console.log(
            "[WordTimeline] File buffer received, size:",
            buffer?.length
          );
          if (buffer) {
            const uint8Array = new Uint8Array(buffer);
            const blob = new Blob([uint8Array], { type: "application/json" });
            const file = new File([blob], fileName, {
              type: "application/json",
            });
            console.log("[WordTimeline] Calling onJsonSelect with File object");
            onJsonSelect(file);
          }
        } else if (isMediaFile(fileName)) {
          console.log(
            "[WordTimeline] Media file detected, calling onMediaSelect"
          );
          console.log("[WordTimeline] File path:", filePath);
          onMediaSelect(filePath);
        } else {
          console.warn("[WordTimeline] Unsupported file type:", fileName);
          toast.error("Unsupported file type. Select JSON or media files.");
        }
      } else {
        console.log(
          "[WordTimeline] Electron API not available, using HTML file input"
        );
        fileInputRef.current?.click();
      }
    } catch (err) {
      console.error("[WordTimeline] Error in handleClick:", err);
      toast.error("Unable to open the file picker");
    }
  }, [onJsonSelect, onMediaSelect]);

  const handleFileChange = useCallback(
    ({ target }: React.ChangeEvent<HTMLInputElement>) => {
      try {
        const file = target.files?.[0];
        if (!file) {
          return;
        }

        if (isJsonFile(file.name)) {
          onJsonSelect(file);
        } else if (isMediaFile(file.name)) {
          // HTML file input doesn't provide file.path, need Electron dialog
          toast.error("Please use the file picker button for media files");
        }
      } catch {
        toast.error("Unable to read the selected file");
      }
    },
    [onJsonSelect]
  );

  const handleDropZoneKeyDown = useCallback(
    ({ key, nativeEvent }: React.KeyboardEvent<HTMLButtonElement>) => {
      try {
        const isActivationKey =
          key === "Enter" || key === " " || key === "Spacebar";
        if (!isActivationKey) {
          return;
        }

        nativeEvent.preventDefault();
        handleClick();
      } catch (error) {
        toast.error("Unable to open the file picker");
      }
    },
    [handleClick]
  );

  const isBusy = isLoading || isTranscribing;

  return (
    <div className="flex-1 flex items-center justify-center p-4" {...dragProps}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.mp4,.mov,.avi,.mkv,.webm,.wav,.mp3,.m4a,.aac"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleDropZoneKeyDown}
        disabled={isBusy}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all w-full max-w-sm",
          "hover:border-primary hover:bg-primary/5",
          isDragOver
            ? "border-primary bg-primary/10 scale-105"
            : "border-muted-foreground/25",
          isBusy && "pointer-events-none opacity-50"
        )}
      >
        {isTranscribing ? (
          <>
            <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin">
              <title>Transcribing</title>
            </Loader2>
            <p className="text-sm text-primary font-medium">
              {transcriptionProgress || "Transcribing..."}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              This may take a moment depending on audio length
            </p>
          </>
        ) : isLoading ? (
          <>
            <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin">
              <title>Loading</title>
            </Loader2>
            <p className="text-sm text-muted-foreground">Loading...</p>
          </>
        ) : (
          <>
            <div className="flex justify-center gap-2 mb-4">
              <Upload className="w-10 h-10 text-muted-foreground">
                <title>Upload</title>
              </Upload>
              <Mic className="w-10 h-10 text-muted-foreground">
                <title>Transcribe</title>
              </Mic>
            </div>
            <p className="text-sm text-muted-foreground">
              Drop media or JSON file here, or click to select
            </p>
            <p className="text-xs text-muted-foreground/70 mt-2">
              Supports: MP4, MOV, WAV, MP3, JSON
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Media files will be transcribed with ElevenLabs
            </p>
          </>
        )}
      </button>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/** Main word timeline view for transcription editing and filler word filtering. */
export function WordTimelineView() {
  const {
    data,
    fileName,
    selectedWordId,
    isLoading,
    isAnalyzing,
    error,
    analysisError,
    loadFromJson,
    clearData,
    setFilterState,
    setMultipleFilterStates,
    acceptAllAiSuggestions,
    resetAllFilters,
    undoLastFilterChange,
    selectWord,
    getVisibleWords,
  } = useWordTimelineStore();

  const { seek, currentTime, isPlaying } = usePlaybackStore();
  const [previewSkipFiltered, setPreviewSkipFiltered] = useState(true);

  // Transcription hook
  const {
    transcribeMedia,
    isTranscribing,
    progress: transcriptionProgress,
    error: transcriptionError,
    clearError: clearTranscriptionError,
  } = useElevenLabsTranscription();

  // Get only words (not spacing)
  const words = getVisibleWords();
  const allWords = data?.words || [];

  // Auto-select word based on current playback time (karaoke-style sync)
  useEffect(() => {
    if (!isPlaying || words.length === 0) return;

    // Find the word that contains the current time
    const currentWord = words.find(
      (word) => currentTime >= word.start && currentTime < word.end
    );

    if (currentWord && currentWord.id !== selectedWordId) {
      selectWord(currentWord.id);
    }
  }, [currentTime, isPlaying, words, selectedWordId, selectWord]);

  useEffect(() => {
    try {
      if (!previewSkipFiltered || !isPlaying || allWords.length === 0) {
        return;
      }

      const currentFilteredWord = allWords.find(
        (word) =>
          (word.filterState === WORD_FILTER_STATE.AI ||
            word.filterState === WORD_FILTER_STATE.USER_REMOVE) &&
          currentTime >= word.start &&
          currentTime < word.end
      );
      if (!currentFilteredWord) {
        return;
      }

      let skipEnd = currentFilteredWord.end;
      const filteredWords = allWords
        .filter(
          (word) =>
            word.filterState === WORD_FILTER_STATE.AI ||
            word.filterState === WORD_FILTER_STATE.USER_REMOVE
        )
        .sort((left, right) => left.start - right.start);

      for (const word of filteredWords) {
        if (word.start <= skipEnd + 0.1 && word.end >= skipEnd) {
          skipEnd = Math.max(skipEnd, word.end);
        }
      }

      if (skipEnd > currentTime + 0.02) {
        seek(skipEnd);
      }
    } catch {
      return;
    }
  }, [allWords, currentTime, isPlaying, previewSkipFiltered, seek]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      try {
        const target = event.target as HTMLElement | null;
        const isTyping =
          !!target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        if (isTyping) {
          return;
        }

        const isMac = navigator.platform.toLowerCase().includes("mac");
        const commandOrCtrl = isMac ? event.metaKey : event.ctrlKey;

        if (commandOrCtrl && event.key.toLowerCase() === "a") {
          event.preventDefault();
          acceptAllAiSuggestions();
          return;
        }

        if (commandOrCtrl && event.key.toLowerCase() === "z") {
          event.preventDefault();
          undoLastFilterChange();
          return;
        }

        if (!selectedWordId) {
          return;
        }

        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          setFilterState(selectedWordId, WORD_FILTER_STATE.USER_REMOVE);
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          const selectedWord = allWords.find(
            (word) => word.id === selectedWordId
          );
          if (
            selectedWord &&
            selectedWord.filterState !== WORD_FILTER_STATE.NONE
          ) {
            event.preventDefault();
            setFilterState(selectedWordId, WORD_FILTER_STATE.USER_KEEP);
          }
        }
      } catch {
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    acceptAllAiSuggestions,
    allWords,
    selectedWordId,
    setFilterState,
    undoLastFilterChange,
  ]);

  const handleJsonSelect = useCallback(
    (file: File) => {
      console.log("[WordTimeline] handleJsonSelect called");
      console.log("[WordTimeline] JSON file:", file.name, "size:", file.size);
      loadFromJson(file);
    },
    [loadFromJson]
  );

  const handleMediaSelect = useCallback(
    async (filePath: string) => {
      console.log("[WordTimeline] handleMediaSelect called, path:", filePath);

      const mediaItems = useMediaStore.getState().mediaItems;
      const addMediaItem = useMediaStore.getState().addMediaItem;
      const projectId = useProjectStore.getState().activeProject?.id;
      const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();

      // Try to find existing media item by path or filename
      let mediaItem = mediaItems.find((item) => {
        if (item.localPath) {
          const itemPath = item.localPath.replace(/\\/g, "/").toLowerCase();
          if (
            itemPath === normalizedPath ||
            normalizedPath.endsWith(itemPath.split("/").pop() || "")
          ) {
            return true;
          }
        }
        if (item.importMetadata?.originalPath) {
          const originalPath = item.importMetadata.originalPath
            .replace(/\\/g, "/")
            .toLowerCase();
          if (
            originalPath === normalizedPath ||
            normalizedPath.endsWith(originalPath.split("/").pop() || "")
          ) {
            return true;
          }
        }
        const fName = filePath.split(/[/\\]/).pop()?.toLowerCase();
        return !!(fName && item.name.toLowerCase() === fName);
      });

      // If not in media store, import it first
      if (!mediaItem && projectId) {
        console.log("[WordTimeline] Media not in store, importing...");
        try {
          const { processMediaFiles } = await import("@/lib/media-processing");

          // Read file from disk via Electron to create a File object
          const fileName = filePath.split(/[/\\]/).pop() || "media";
          const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
          const isVideo = [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(
            ext
          );
          const mimeType = isVideo
            ? `video/${ext.slice(1)}`
            : `audio/${ext.slice(1)}`;

          let file: File;
          if (window.electronAPI?.readFile) {
            const buffer = await window.electronAPI.readFile(filePath);
            if (buffer) {
              const blob = new Blob([new Uint8Array(buffer)], {
                type: mimeType,
              });
              file = new File([blob], fileName, { type: mimeType });
            } else {
              throw new Error("Failed to read file");
            }
          } else {
            throw new Error("Electron API not available");
          }

          const processedItems = await processMediaFiles([file]);
          if (processedItems.length > 0) {
            const newId = await addMediaItem(projectId, {
              ...processedItems[0],
              localPath: filePath,
              importMetadata: {
                importMethod: "copy",
                originalPath: filePath,
                importedAt: Date.now(),
                fileSize: file.size,
              },
            });
            mediaItem =
              useMediaStore.getState().mediaItems.find((m) => m.id === newId) ??
              undefined;
            if (mediaItem) {
              console.log(
                "[WordTimeline] Imported to media store:",
                mediaItem.name
              );
              toast.success(`Imported "${mediaItem.name}" to media library`);
            }
          }
        } catch (err) {
          console.error("[WordTimeline] Media import failed:", err);
          // Continue with transcription even if import fails
        }
      }

      // Add to timeline (skip if already present)
      if (mediaItem) {
        const timelineState = useTimelineStore.getState();
        const alreadyOnTimeline = timelineState.tracks.some((track) =>
          track.elements.some(
            (el) => el.type === "media" && el.mediaId === mediaItem!.id
          )
        );
        if (!alreadyOnTimeline) {
          timelineState.addMediaToNewTrack(mediaItem);
          toast.success(`Added "${mediaItem.name}" to timeline`);
        }
      }

      // Start transcription
      try {
        const result = await transcribeMedia(filePath);
        if (result) {
          const wordCount = result.words.filter(
            (w) => w.type === "word"
          ).length;
          toast.success(`Transcription complete: ${wordCount} words`);
        }
      } catch (err) {
        console.error("[WordTimeline] Transcription error:", err);
        toast.error("Transcription failed");
      }
    },
    [transcribeMedia]
  );

  const handleWordPrimaryAction = useCallback(
    (word: WordItem) => {
      try {
        selectWord(word.id);
        if (word.filterState === WORD_FILTER_STATE.NONE) {
          seek(word.start);
          toast.info(`Seeked to ${formatTime(word.start)}`);
          return;
        }

        if (
          word.filterState === WORD_FILTER_STATE.AI ||
          word.filterState === WORD_FILTER_STATE.USER_REMOVE
        ) {
          setFilterState(word.id, WORD_FILTER_STATE.USER_KEEP);
          return;
        }

        if (word.filterState === WORD_FILTER_STATE.USER_KEEP) {
          setFilterState(word.id, WORD_FILTER_STATE.USER_REMOVE);
        }
      } catch {
        return;
      }
    },
    [seek, selectWord, setFilterState]
  );

  const handleWordQuickRemove = useCallback(
    (word: WordItem) => {
      try {
        setFilterState(word.id, WORD_FILTER_STATE.USER_REMOVE);
      } catch {
        return;
      }
    },
    [setFilterState]
  );

  const handleAcceptAllAi = useCallback(() => {
    try {
      acceptAllAiSuggestions();
      toast.success("Accepted all AI suggestions");
    } catch {
      return;
    }
  }, [acceptAllAiSuggestions]);

  const handleResetAll = useCallback(async () => {
    try {
      await resetAllFilters();
      toast.info("Filters reset to AI defaults");
    } catch {
      return;
    }
  }, [resetAllFilters]);

  const handleSelectAllAi = useCallback(() => {
    try {
      const aiWordIds = allWords
        .filter((word) => word.filterState === WORD_FILTER_STATE.AI)
        .map((word) => word.id);
      setMultipleFilterStates(aiWordIds, WORD_FILTER_STATE.USER_REMOVE);
      toast.success(`Marked ${aiWordIds.length} AI words for removal`);
    } catch {
      return;
    }
  }, [allWords, setMultipleFilterStates]);

  const handlePreviewToggle = useCallback(() => {
    setPreviewSkipFiltered((previous) => !previous);
  }, []);

  const handlePreviewToggleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      try {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handlePreviewToggle();
        }
      } catch {
        return;
      }
    },
    [handlePreviewToggle]
  );

  const handleClear = useCallback(() => {
    clearData();
    clearTranscriptionError();
    toast.info("Word timeline cleared");
  }, [clearData, clearTranscriptionError]);

  // Calculate stats
  const aiFilteredCount = words.filter(
    (word) => word.filterState === WORD_FILTER_STATE.AI
  ).length;
  const userRemovedCount = words.filter(
    (word) => word.filterState === WORD_FILTER_STATE.USER_REMOVE
  ).length;
  const userKeptCount = words.filter(
    (word) => word.filterState === WORD_FILTER_STATE.USER_KEEP
  ).length;

  const removedDuration = useMemo(() => {
    return calculateRemovedDuration({ words: allWords });
  }, [allWords]);

  const lastWord = words[words.length - 1];
  const totalDuration = lastWord?.end || 0;
  const removedPercent =
    totalDuration > 0 ? (removedDuration / totalDuration) * 100 : 0;

  // Combined error state
  const displayError = error || transcriptionError || analysisError;

  // Error state
  if (displayError && !data) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="w-12 h-12 text-destructive mb-4">
          <title>Error</title>
        </AlertCircle>
        <p className="text-sm text-destructive font-medium">
          {transcriptionError ? "Transcription failed" : "Failed to load file"}
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
          {displayError}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
          className="mt-4"
        >
          Try Again
        </Button>
      </div>
    );
  }

  // Empty state - show intro + drop zone
  if (!data) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 pt-4 pb-2 text-center">
          <h2 className="text-base font-semibold">SmartEdit</h2>
          <p className="text-xs text-muted-foreground mt-1">
            AI-powered speech editing for talking videos.
          </p>
          <div className="flex flex-wrap justify-center gap-1.5 mt-3">
            {[
              "Remove filler",
              "Remove repetition",
              "Generate captions",
              "Jump by word",
            ].map((feature) => (
              <span
                key={feature}
                className="inline-flex items-center px-2.5 py-1 rounded-full bg-muted text-[11px] text-muted-foreground"
              >
                {feature}
              </span>
            ))}
          </div>
        </div>
        <DropZone
          onJsonSelect={handleJsonSelect}
          onMediaSelect={handleMediaSelect}
          isLoading={isLoading}
          isTranscribing={isTranscribing}
          transcriptionProgress={transcriptionProgress}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-sm font-medium truncate max-w-[180px]"
            title={fileName || ""}
          >
            {fileName}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            ({words.length} words)
          </span>
          {isAnalyzing && (
            <span className="inline-flex items-center gap-1 text-[10px] text-orange-700 shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />
              Analyzing for fillers...
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={previewSkipFiltered ? "outline" : "text"}
            size="sm"
            onClick={handlePreviewToggle}
            onKeyDown={handlePreviewToggleKeyDown}
            className="h-7 px-2 text-[11px]"
          >
            Preview: {previewSkipFiltered ? "Skip filtered" : "Normal"}
          </Button>
          <Button
            type="button"
            variant="text"
            size="icon"
            onClick={handleClear}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClear();
              }
            }}
            className="shrink-0 h-7 w-7"
            title="Clear"
          >
            <X className="w-4 h-4">
              <title>Clear</title>
            </X>
          </Button>
        </div>
      </div>

      {/* Word List */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          <div className="flex flex-wrap gap-1.5">
            {words.map((word) => (
              <WordChip
                key={word.id}
                word={word}
                isSelected={selectedWordId === word.id}
                onPrimaryAction={handleWordPrimaryAction}
                onQuickRemove={handleWordQuickRemove}
              />
            ))}
          </div>
        </div>
      </ScrollArea>

      {/* Footer - Stats */}
      <div className="p-2 border-t bg-muted/30 text-xs text-muted-foreground">
        {analysisError && (
          <p className="text-[10px] text-destructive mb-1">{analysisError}</p>
        )}
        <div className="flex justify-between items-center gap-2">
          <span className="truncate">
            {aiFilteredCount} AI, {userRemovedCount} removed, {userKeptCount}{" "}
            kept
          </span>
          <span>Duration: {formatDuration(totalDuration)}</span>
        </div>
        <div className="flex justify-between items-center mt-1 gap-2">
          <span className="truncate">
            Removes {formatDuration(removedDuration)} (
            {removedPercent.toFixed(1)}
            %)
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={handleSelectAllAi}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelectAllAi();
                }
              }}
            >
              Remove AI
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={handleAcceptAllAi}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleAcceptAllAi();
                }
              }}
            >
              Accept All
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={handleResetAll}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleResetAll();
                }
              }}
            >
              Reset All
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Click toggles state-aware action, right-click quick-removes,
          Ctrl/Cmd+Z undo
        </p>
      </div>
    </div>
  );
}
