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

import { useCallback, useRef, useEffect } from "react";
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
import { useElevenLabsTranscription } from "@/hooks/use-elevenlabs-transcription";
import { useDragDrop } from "@/hooks/use-drag-drop";
import { Upload, X, Loader2, AlertCircle, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WordItem } from "@/types/word-timeline";
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

// ============================================================================
// Word Chip Component
// ============================================================================

interface WordChipProps {
  word: WordItem;
  isSelected: boolean;
  onSelect: (word: WordItem) => void;
  onToggleDelete: (wordId: string) => void;
}

function WordChip({
  word,
  isSelected,
  onSelect,
  onToggleDelete,
}: WordChipProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(() => {
    onSelect(word);
  }, [word, onSelect]);

  const handleRightClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onToggleDelete(word.id);
    },
    [word.id, onToggleDelete]
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
            className={cn(
              "inline-flex items-center px-2 py-1 text-sm rounded transition-all",
              "hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring",
              word.deleted
                ? "bg-destructive/20 text-destructive line-through decoration-2"
                : "bg-muted hover:bg-accent hover:text-accent-foreground",
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
          <p className="text-muted-foreground mt-1">
            Right-click to {word.deleted ? "restore" : "delete"}
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
      try {
        const file = files[0];
        if (!file) {
          return;
        }

        if (isJsonFile(file.name)) {
          onJsonSelect(file);
        } else if (isMediaFile(file.name)) {
          // For media files, we need the file path (Electron only)
          const filePath = (file as File & { path?: string }).path;
          if (filePath) {
            onMediaSelect(filePath);
          } else {
            toast.error("Media transcription requires the desktop app");
          }
        } else {
          toast.error(
            "Unsupported file type. Drop JSON or media files (MP4, WAV, MP3, etc.)"
          );
        }
      } catch {
        toast.error("Unable to process the dropped file");
      }
    },
    [onJsonSelect, onMediaSelect]
  );

  const { isDragOver, dragProps } = useDragDrop({ onDrop: handleDrop });

  const handleClick = useCallback(async () => {
    try {
      // Use Electron's native file dialog to get the file path
      if (window.electronAPI?.openFileDialog) {
        const filePath = await window.electronAPI.openFileDialog();

        if (!filePath) {
          return;
        }

        const fileName = filePath.split(/[/\\]/).pop() || "";

        if (isJsonFile(fileName)) {
          // For JSON, we need to read the file content
          if (!window.electronAPI.readFile) {
            toast.error("File reading not available");
            return;
          }
          const buffer = await window.electronAPI.readFile(filePath);
          if (buffer) {
            const uint8Array = new Uint8Array(buffer);
            const blob = new Blob([uint8Array], { type: "application/json" });
            const file = new File([blob], fileName, { type: "application/json" });
            onJsonSelect(file);
          }
        } else if (isMediaFile(fileName)) {
          onMediaSelect(filePath);
        } else {
          toast.error("Unsupported file type. Select JSON or media files.");
        }
      } else {
        fileInputRef.current?.click();
      }
    } catch {
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
    <div className="h-full flex items-center justify-center p-4" {...dragProps}>
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

export function WordTimelineView() {
  const {
    data,
    fileName,
    selectedWordId,
    isLoading,
    error,
    loadFromJson,
    clearData,
    toggleWordDeleted,
    selectWord,
    getVisibleWords,
  } = useWordTimelineStore();

  const { seek, currentTime, isPlaying } = usePlaybackStore();

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

  const handleJsonSelect = useCallback(
    (file: File) => {
      loadFromJson(file);
    },
    [loadFromJson]
  );

  const handleMediaSelect = useCallback(
    async (filePath: string) => {
      // Try to find the media item in the store and add it to the timeline
      const mediaItems = useMediaStore.getState().mediaItems;

      // Normalize path for comparison (handle both forward and back slashes)
      const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();

      const mediaItem = mediaItems.find((item) => {
        // Check localPath
        if (item.localPath) {
          const itemPath = item.localPath.replace(/\\/g, "/").toLowerCase();
          if (itemPath === normalizedPath || normalizedPath.endsWith(itemPath.split("/").pop() || "")) {
            return true;
          }
        }
        // Check importMetadata.originalPath
        if (item.importMetadata?.originalPath) {
          const originalPath = item.importMetadata.originalPath.replace(/\\/g, "/").toLowerCase();
          if (originalPath === normalizedPath || normalizedPath.endsWith(originalPath.split("/").pop() || "")) {
            return true;
          }
        }
        // Check by filename as fallback
        const fileName = filePath.split(/[/\\]/).pop()?.toLowerCase();
        if (fileName && item.name.toLowerCase() === fileName) {
          return true;
        }
        return false;
      });

      if (mediaItem) {
        // Add to timeline
        const added = useTimelineStore.getState().addMediaToNewTrack(mediaItem);
        if (added) {
          toast.success(`Added "${mediaItem.name}" to timeline`);
        }
      }

      // Start transcription
      try {
        const result = await transcribeMedia(filePath);
        if (result) {
          const wordCount = result.words.filter((w) => w.type === "word").length;
          toast.success(`Transcription complete: ${wordCount} words`);
        }
      } catch {
        // Error is already handled in the hook
        toast.error("Transcription failed");
      }
    },
    [transcribeMedia]
  );

  const handleWordSelect = useCallback(
    (word: WordItem) => {
      selectWord(word.id);
      seek(word.start);
      toast.info(`Seeked to ${formatTime(word.start)}`);
    },
    [selectWord, seek]
  );

  const handleToggleDelete = useCallback(
    (wordId: string) => {
      toggleWordDeleted(wordId);
    },
    [toggleWordDeleted]
  );

  const handleClear = useCallback(() => {
    clearData();
    clearTranscriptionError();
    toast.info("Word timeline cleared");
  }, [clearData, clearTranscriptionError]);

  // Calculate stats
  const deletedCount = words.filter((w) => w.deleted).length;
  const lastWord = words[words.length - 1];
  const totalDuration = lastWord?.end || 0;

  // Combined error state
  const displayError = error || transcriptionError;

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

  // Empty state - show drop zone
  if (!data) {
    return (
      <DropZone
        onJsonSelect={handleJsonSelect}
        onMediaSelect={handleMediaSelect}
        isLoading={isLoading}
        isTranscribing={isTranscribing}
        transcriptionProgress={transcriptionProgress}
      />
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
        </div>
        <Button
          type="button"
          variant="text"
          size="icon"
          onClick={handleClear}
          className="shrink-0 h-7 w-7"
          title="Clear"
        >
          <X className="w-4 h-4">
            <title>Clear</title>
          </X>
        </Button>
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
                onSelect={handleWordSelect}
                onToggleDelete={handleToggleDelete}
              />
            ))}
          </div>
        </div>
      </ScrollArea>

      {/* Footer - Stats */}
      <div className="p-2 border-t bg-muted/30 text-xs text-muted-foreground">
        <div className="flex justify-between items-center">
          <span>
            {deletedCount > 0 && (
              <span className="text-destructive font-medium">
                {deletedCount} deleted
              </span>
            )}
            {deletedCount === 0 && "No deletions"}
          </span>
          <span>Duration: {formatDuration(totalDuration)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Click word to seek, right-click to delete
        </p>
      </div>
    </div>
  );
}
