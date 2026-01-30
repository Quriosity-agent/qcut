"use client";

/**
 * Word Timeline View Component
 *
 * Displays word-level transcription data from JSON files.
 * Features:
 * - Drag & drop JSON file import
 * - Click word to seek timeline to that timestamp
 * - Toggle word deletion (red color + strikethrough)
 * - Tooltip showing word timing on hover
 *
 * @module components/editor/media-panel/views/word-timeline-view
 */

import { useCallback, useRef } from "react";
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
import { useDragDrop } from "@/hooks/use-drag-drop";
import { Upload, X, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WordItem } from "@/types/word-timeline";
import { toast } from "sonner";

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

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
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
  onFileSelect: (file: File) => void;
  isLoading: boolean;
}

function DropZone({ onFileSelect, isLoading }: DropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (files: FileList) => {
      try {
        const file = files[0];
        if (!file) {
          return;
        }

        const isJsonFile = file.name.endsWith(".json");
        if (!isJsonFile) {
          toast.error("Please drop a JSON file");
          return;
        }

        onFileSelect(file);
      } catch (error) {
        toast.error("Unable to process the dropped file");
      }
    },
    [onFileSelect]
  );

  const { isDragOver, dragProps } = useDragDrop({ onDrop: handleDrop });

  const handleClick = useCallback(() => {
    try {
      fileInputRef.current?.click();
    } catch (error) {
      toast.error("Unable to open the file picker");
    }
  }, []);

  const handleFileChange = useCallback(
    ({ target }: React.ChangeEvent<HTMLInputElement>) => {
      try {
        const file = target.files?.[0];
        if (!file) {
          return;
        }

        onFileSelect(file);
      } catch (error) {
        toast.error("Unable to read the selected file");
      }
    },
    [onFileSelect]
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

  return (
    <div className="h-full flex items-center justify-center p-4" {...dragProps}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleDropZoneKeyDown}
        disabled={isLoading}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all",
          "hover:border-primary hover:bg-primary/5",
          isDragOver
            ? "border-primary bg-primary/10 scale-105"
            : "border-muted-foreground/25",
          isLoading && "pointer-events-none opacity-50"
        )}
      >
        {isLoading ? (
          <Loader2 className="w-12 h-12 mx-auto mb-4 text-primary animate-spin">
            <title>Loading</title>
          </Loader2>
        ) : (
          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground">
            <title>Upload</title>
          </Upload>
        )}
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? "Loading..."
            : "Drop a word timeline JSON file here, or click to select"}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-2">
          Supports transcription JSON with word-level timing
        </p>
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

  const { seek } = usePlaybackStore();

  // Get only words (not spacing)
  const words = getVisibleWords();

  const handleFileSelect = useCallback(
    (file: File) => {
      loadFromJson(file);
    },
    [loadFromJson]
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
    toast.info("Word timeline cleared");
  }, [clearData]);

  // Calculate stats
  const deletedCount = words.filter((w) => w.deleted).length;
  const lastWord = words[words.length - 1];
  const totalDuration = lastWord?.end || 0;

  // Error state
  if (error && !data) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="w-12 h-12 text-destructive mb-4">
          <title>Error</title>
        </AlertCircle>
        <p className="text-sm text-destructive font-medium">
          Failed to load file
        </p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
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
    return <DropZone onFileSelect={handleFileSelect} isLoading={isLoading} />;
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
