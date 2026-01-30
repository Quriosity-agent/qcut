# Word Timeline Panel Implementation Plan

## Overview

Add a new "Word Timeline" panel to the QCut editor that displays word-level transcription data from JSON files. When users click on a word, the timeline playhead moves to that word's timestamp. Words can be deleted (marked in red) to be excluded from output.

## Input Data Format

The input JSON file (e.g., `suburbs_ai_words.json`) contains:

```json
{
  "text": "Full transcription text...",
  "language_code": "eng",
  "language_probability": 0.98,
  "words": [
    {
      "text": "artificial",
      "start": 0.47,
      "end": 1.06,
      "type": "word",
      "speaker_id": "speaker_0"
    },
    {
      "text": " ",
      "start": 1.06,
      "end": 1.2,
      "type": "spacing",
      "speaker_id": "speaker_0"
    }
    // ... more words
  ]
}
```

- **374 words** in sample file
- **132.68 seconds** total duration
- Each word has `start` and `end` timestamps
- `type` can be "word" or "spacing"

## Requirements

1. **New Panel Tab**: Add "Word Timeline" tab to Media Panel
2. **Word Display**: Show all words from JSON in a scrollable list/grid
3. **Click to Seek**: Clicking a word moves the timeline playhead to that word's start time
4. **Delete Words**: Words can be marked for deletion (shown in red)
5. **JSON Import**: Load word data from JSON files

---

## Implementation Subtasks

### Task 1: Create Word Timeline Types and Store (15 min)

**Files to create/modify:**
- `apps/web/src/types/word-timeline.ts` - New type definitions
- `apps/web/src/stores/word-timeline-store.ts` - New Zustand store

**Type Definitions:**
```typescript
// apps/web/src/types/word-timeline.ts

export interface WordItem {
  id: string;
  text: string;
  start: number;  // seconds
  end: number;    // seconds
  type: "word" | "spacing";
  speaker_id?: string;
  deleted: boolean;  // For delete marking
}

export interface WordTimelineData {
  text: string;
  language_code: string;
  language_probability: number;
  words: WordItem[];
}

export interface WordTimelineState {
  data: WordTimelineData | null;
  fileName: string | null;
  selectedWordId: string | null;
}
```

**Store Implementation:**
```typescript
// apps/web/src/stores/word-timeline-store.ts

import { create } from "zustand";
import type { WordTimelineData, WordItem } from "@/types/word-timeline";

interface WordTimelineStore {
  // State
  data: WordTimelineData | null;
  fileName: string | null;
  selectedWordId: string | null;

  // Actions
  loadFromJson: (file: File) => Promise<void>;
  toggleWordDeleted: (wordId: string) => void;
  selectWord: (wordId: string | null) => void;
  clearData: () => void;
  getVisibleWords: () => WordItem[];
}

export const useWordTimelineStore = create<WordTimelineStore>((set, get) => ({
  data: null,
  fileName: null,
  selectedWordId: null,

  loadFromJson: async (file: File) => {
    const text = await file.text();
    const json = JSON.parse(text);

    // Transform words array to include id and deleted flag
    const words = json.words.map((w: any, idx: number) => ({
      ...w,
      id: `word-${idx}`,
      deleted: false,
    }));

    set({
      data: { ...json, words },
      fileName: file.name,
      selectedWordId: null,
    });
  },

  toggleWordDeleted: (wordId: string) => {
    const { data } = get();
    if (!data) return;

    const words = data.words.map(w =>
      w.id === wordId ? { ...w, deleted: !w.deleted } : w
    );

    set({ data: { ...data, words } });
  },

  selectWord: (wordId: string | null) => {
    set({ selectedWordId: wordId });
  },

  clearData: () => {
    set({ data: null, fileName: null, selectedWordId: null });
  },

  getVisibleWords: () => {
    const { data } = get();
    if (!data) return [];
    return data.words.filter(w => w.type === "word");
  },
}));
```

**Unit Test File:**
- `apps/web/src/stores/__tests__/word-timeline-store.test.ts`

---

### Task 2: Create Word Timeline View Component (20 min)

**Files to create:**
- `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx`

**Implementation:**
```typescript
// apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx

import { useCallback, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useWordTimelineStore } from "@/stores/word-timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { Upload, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function WordTimelineView() {
  const { data, fileName, selectedWordId, loadFromJson, clearData, toggleWordDeleted, selectWord } = useWordTimelineStore();
  const { seek } = usePlaybackStore();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file?.name.endsWith(".json")) {
      loadFromJson(file);
    }
  }, [loadFromJson]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/json": [".json"] },
    maxFiles: 1,
  });

  const handleWordClick = (word: WordItem) => {
    selectWord(word.id);
    seek(word.start);  // Seek timeline to word start
  };

  const handleWordDelete = (e: React.MouseEvent, wordId: string) => {
    e.stopPropagation();
    toggleWordDeleted(wordId);
  };

  // Get only words (not spacing)
  const words = data?.words.filter(w => w.type === "word") || [];

  if (!data) {
    // Show drop zone
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
            isDragActive ? "border-primary bg-primary/10" : "border-muted-foreground/25"
          )}
        >
          <input {...getInputProps()} />
          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop a word timeline JSON file here, or click to select
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate max-w-[200px]" title={fileName || ""}>
            {fileName}
          </span>
          <span className="text-xs text-muted-foreground">
            ({words.length} words)
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={clearData}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Word List */}
      <ScrollArea className="flex-1 p-2">
        <div className="flex flex-wrap gap-1">
          {words.map((word) => (
            <button
              key={word.id}
              onClick={() => handleWordClick(word)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 text-sm rounded transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                word.deleted
                  ? "bg-destructive/20 text-destructive line-through"
                  : "bg-muted",
                selectedWordId === word.id && "ring-2 ring-primary"
              )}
            >
              <span>{word.text}</span>
              <button
                onClick={(e) => handleWordDelete(e, word.id)}
                className={cn(
                  "w-4 h-4 rounded-full flex items-center justify-center",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  "hover:bg-destructive hover:text-destructive-foreground"
                )}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* Footer - Stats */}
      <div className="p-2 border-t text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Deleted: {words.filter(w => w.deleted).length}</span>
          <span>Duration: {formatTime(words[words.length - 1]?.end || 0)}</span>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
```

---

### Task 3: Register Word Timeline Tab in Media Panel (10 min)

**Files to modify:**
- `apps/web/src/components/editor/media-panel/store.ts` - Add tab type
- `apps/web/src/components/editor/media-panel/index.tsx` - Register view

**Modifications to store.ts:**
```typescript
// Add to Tab union type
export type Tab =
  | "media"
  | "audio"
  // ... existing tabs
  | "word-timeline";  // NEW

// Add to tabs record
export const tabs: Record<Tab, { icon: LucideIcon; label: string }> = {
  // ... existing tabs
  "word-timeline": {
    icon: TextSelect,  // from lucide-react
    label: "Words",
  },
};
```

**Modifications to index.tsx:**
```typescript
import { WordTimelineView } from "./views/word-timeline-view";

// Add to viewMap
const viewMap: Record<Tab, React.ReactNode> = {
  // ... existing views
  "word-timeline": <WordTimelineView />,
};
```

---

### Task 4: Add Word Timeline Panel Tests (15 min)

**Files to create:**
- `apps/web/src/stores/__tests__/word-timeline-store.test.ts`
- `apps/web/src/components/editor/media-panel/views/__tests__/word-timeline-view.test.tsx`

**Store Test:**
```typescript
// apps/web/src/stores/__tests__/word-timeline-store.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { useWordTimelineStore } from "../word-timeline-store";

describe("WordTimelineStore", () => {
  beforeEach(() => {
    useWordTimelineStore.getState().clearData();
  });

  it("should load JSON data", async () => {
    const mockJson = {
      text: "Hello world",
      language_code: "eng",
      language_probability: 0.99,
      words: [
        { text: "Hello", start: 0, end: 0.5, type: "word" },
        { text: " ", start: 0.5, end: 0.6, type: "spacing" },
        { text: "world", start: 0.6, end: 1.0, type: "word" },
      ],
    };

    const file = new File([JSON.stringify(mockJson)], "test.json", {
      type: "application/json",
    });

    await useWordTimelineStore.getState().loadFromJson(file);

    const state = useWordTimelineStore.getState();
    expect(state.data).not.toBeNull();
    expect(state.data?.words).toHaveLength(3);
    expect(state.fileName).toBe("test.json");
  });

  it("should toggle word deleted state", async () => {
    // Load data first
    const mockJson = {
      text: "Hello",
      language_code: "eng",
      language_probability: 0.99,
      words: [{ text: "Hello", start: 0, end: 0.5, type: "word" }],
    };

    const file = new File([JSON.stringify(mockJson)], "test.json", {
      type: "application/json",
    });

    await useWordTimelineStore.getState().loadFromJson(file);

    const wordId = useWordTimelineStore.getState().data!.words[0].id;

    // Toggle deleted
    useWordTimelineStore.getState().toggleWordDeleted(wordId);
    expect(useWordTimelineStore.getState().data!.words[0].deleted).toBe(true);

    // Toggle again
    useWordTimelineStore.getState().toggleWordDeleted(wordId);
    expect(useWordTimelineStore.getState().data!.words[0].deleted).toBe(false);
  });

  it("should select word", () => {
    useWordTimelineStore.getState().selectWord("word-1");
    expect(useWordTimelineStore.getState().selectedWordId).toBe("word-1");

    useWordTimelineStore.getState().selectWord(null);
    expect(useWordTimelineStore.getState().selectedWordId).toBeNull();
  });

  it("should get visible words (excluding spacing)", async () => {
    const mockJson = {
      text: "Hello world",
      language_code: "eng",
      language_probability: 0.99,
      words: [
        { text: "Hello", start: 0, end: 0.5, type: "word" },
        { text: " ", start: 0.5, end: 0.6, type: "spacing" },
        { text: "world", start: 0.6, end: 1.0, type: "word" },
      ],
    };

    const file = new File([JSON.stringify(mockJson)], "test.json", {
      type: "application/json",
    });

    await useWordTimelineStore.getState().loadFromJson(file);

    const visibleWords = useWordTimelineStore.getState().getVisibleWords();
    expect(visibleWords).toHaveLength(2);
    expect(visibleWords[0].text).toBe("Hello");
    expect(visibleWords[1].text).toBe("world");
  });
});
```

---

### Task 5: Enhance Word Display with Time Indicators (10 min)

**Files to modify:**
- `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx`

**Add time display on hover:**
```typescript
// Add to word button tooltip or hover state
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        key={word.id}
        onClick={() => handleWordClick(word)}
        // ... existing classes
      >
        {word.text}
      </button>
    </TooltipTrigger>
    <TooltipContent>
      <p>{formatTime(word.start)} - {formatTime(word.end)}</p>
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

---

## File Summary

### New Files to Create:
1. `apps/web/src/types/word-timeline.ts` - Type definitions
2. `apps/web/src/stores/word-timeline-store.ts` - Zustand store
3. `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx` - Main view component
4. `apps/web/src/stores/__tests__/word-timeline-store.test.ts` - Store tests

### Files to Modify:
1. `apps/web/src/components/editor/media-panel/store.ts` - Add tab type
2. `apps/web/src/components/editor/media-panel/index.tsx` - Register view

---

## Estimated Total Time: ~70 minutes

| Task | Time | Priority |
|------|------|----------|
| Task 1: Types and Store | 15 min | P0 |
| Task 2: View Component | 20 min | P0 |
| Task 3: Register Tab | 10 min | P0 |
| Task 4: Unit Tests | 15 min | P1 |
| Task 5: Time Indicators | 10 min | P2 |

---

## Future Enhancements (Not in Scope)

- Export filtered words as SRT/VTT
- Keyboard navigation between words
- Speaker identification coloring
- Bulk delete/restore operations
- Integration with existing captions track
- Undo/redo support for word deletions
