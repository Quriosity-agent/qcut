# Transcribe Redesign: Smart Filtering & Export Integration

**Created**: 2026-02-16
**Branch**: `transribe-improve`
**Estimated effort**: ~3-4 hours (4 subtasks)

## Overview

Redesign the word timeline transcription feature with three core improvements:

1. **AI-powered auto-filtering** - After transcription, AI analyzes word-level timestamps to detect filler words and excessive silence gaps, auto-marking them for removal
2. **Export integration** - Actually cut filtered segments from video during export (currently deletions are visual-only)
3. **Enhanced user control** - Replace the binary red/not-red toggle with a tri-state UI: keep, remove, or reset to AI suggestion

## Current State

| Aspect | Status |
|--------|--------|
| Word-level timestamps | Working (ElevenLabs Scribe v2) |
| Deletion marking | Visual only (red strikethrough + timeline markers) |
| Export | Ignores deleted words entirely |
| User interaction | Right-click to toggle deleted (binary) |

### Key Files (Current)

| File | Role |
|------|------|
| `apps/web/src/stores/word-timeline-store.ts` | Word data + deletion state |
| `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx` | Word chips UI |
| `apps/web/src/types/word-timeline.ts` | WordItem types |
| `apps/web/src/components/editor/timeline/index.tsx` | Red markers on timeline (L76-79, L628-641) |
| `apps/web/src/lib/export-engine-cli.ts` | Export pipeline (no word deletion awareness) |
| `apps/web/src/lib/export-cli/sources/video-sources.ts` | Video source extraction |
| `electron/ffmpeg-args-builder.ts` | FFmpeg command construction |
| `electron/ffmpeg-export-handler.ts` | Export IPC handler |
| `electron/ffmpeg/utils.ts` | Video normalization utilities |

---

## Subtask 1: AI Auto-Filter Detection

**Goal**: After transcription completes, automatically analyze words and mark filler words / excessive gaps for removal.

### What to Build

Add a post-transcription analysis step that marks words as `filtered: "ai"` based on two criteria:

1. **Filler word detection** - Common filler words: "um", "uh", "ah", "er", "like" (when used as filler), "you know", "I mean", "basically", "actually", "so" (sentence-start filler), "right", "okay" (filler usage)
2. **Excessive gap detection** - When the gap between two words exceeds a threshold (e.g., >1.5s), mark the gap region as a silence segment to filter

### Implementation

#### 1.1 Update `WordItem` type

**File**: `apps/web/src/types/word-timeline.ts`

```typescript
// Current
interface WordItem {
  id: string;
  text: string;
  start: number;
  end: number;
  type: "word" | "spacing";
  speaker_id?: string;
  deleted: boolean;        // boolean toggle
}

// New
type WordFilterState = "none" | "ai" | "user-remove" | "user-keep";

interface WordItem {
  id: string;
  text: string;
  start: number;
  end: number;
  type: "word" | "spacing";
  speaker_id?: string;
  filterState: WordFilterState;  // replaces `deleted: boolean`
}
```

- `"none"` - Not filtered (default for normal words)
- `"ai"` - AI suggested for removal (user hasn't decided)
- `"user-remove"` - User confirmed removal
- `"user-keep"` - User explicitly chose to keep (overrides AI)

#### 1.2 Add filler detection logic

**New file**: `apps/web/src/lib/transcription/filler-detector.ts`

```typescript
interface FilterResult {
  wordId: string;
  reason: "filler-word" | "excessive-gap";
}

/** Analyze transcription words and return IDs of words to auto-filter */
function detectFillers(words: WordItem[], options?: {
  gapThresholdSeconds?: number;   // default 1.5
  fillerWords?: string[];         // override default list
}): FilterResult[]
```

Logic:
- Match words against filler word list (case-insensitive, trimmed)
- Detect gaps: iterate word pairs, if `words[i+1].start - words[i].end > threshold`, mark the gap
- Return array of word IDs + reasons

#### 1.3 Integrate into store

**File**: `apps/web/src/stores/word-timeline-store.ts`

- Add `applyAiFilters()` action that runs `detectFillers()` on loaded words and sets `filterState: "ai"` on detected words
- Call `applyAiFilters()` automatically after `loadFromTranscription()` completes
- Update `toggleWordDeleted()` → `cycleFilterState(wordId)` to cycle through states
- Update `getNonDeletedWords()` → `getWordsForExport()` which excludes `filterState === "ai" | "user-remove"` but includes `"user-keep"`
- Add backward compat: map old `deleted: true` → `filterState: "user-remove"`, `deleted: false` → `filterState: "none"` when loading JSON

### Files to Modify

- `apps/web/src/types/word-timeline.ts` - Add `WordFilterState` type, update `WordItem`
- `apps/web/src/stores/word-timeline-store.ts` - New actions, migrate from boolean to enum
- **New**: `apps/web/src/lib/transcription/filler-detector.ts` - Detection logic

### Tests

- `apps/web/src/lib/transcription/__tests__/filler-detector.test.ts`
  - Detects common filler words ("um", "uh", "like", etc.)
  - Detects excessive gaps (>1.5s between words)
  - Respects custom threshold
  - Does not flag normal words
  - Case-insensitive matching

---

## Subtask 2: Enhanced Word Chip UI (Tri-State Control)

**Goal**: Replace right-click binary toggle with a clear, clickable tri-state UI so users can decide: keep, remove, or accept AI suggestion.

### What to Build

Each word chip shows its filter state visually and allows the user to cycle through states with a single click:

| State | Visual | Click Action |
|-------|--------|-------------|
| `none` | Default chip (gray bg) | No change (normal word) |
| `ai` | Orange bg + dashed underline | Cycles to `user-keep` |
| `user-remove` | Red bg + strikethrough | Cycles to `user-keep` |
| `user-keep` | Green bg + checkmark | Cycles to `user-remove` |

For `ai`-flagged words, right-click confirms removal (`user-remove`). Left-click keeps it (`user-keep`).

For non-flagged words (`none`), right-click marks as `user-remove`. Left-click still seeks to timestamp.

### Implementation

#### 2.1 Update `WordChip` component

**File**: `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx`

- Update styling based on `filterState` instead of `deleted`
- Left-click on `ai` word → set `user-keep`
- Left-click on `user-remove` → set `user-keep`
- Left-click on `user-keep` → set `user-remove`
- Left-click on `none` → seek to timestamp (existing behavior)
- Right-click on any word → cycle to `user-remove` (quick remove)
- Show tooltip with state explanation + timing

#### 2.2 Update footer stats

- Show breakdown: "3 AI-filtered, 2 user-removed, 1 kept"
- Add "Accept All AI Suggestions" button → converts all `ai` to `user-remove`
- Add "Reset All" button → sets everything back to AI defaults

#### 2.3 Update timeline red markers

**File**: `apps/web/src/components/editor/timeline/index.tsx` (L628-641)

- Orange markers for `ai`-filtered words
- Red markers for `user-remove` words
- No markers for `user-keep` and `none`

### Files to Modify

- `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx` - WordChip styling + interaction
- `apps/web/src/components/editor/timeline/index.tsx` - Timeline marker colors
- `apps/web/src/stores/word-timeline-store.ts` - `setFilterState(wordId, state)` action

---

## Subtask 3: Export with Filtered Segments Removed

**Goal**: When exporting, actually cut out the filtered segments from the video so the exported file excludes removed words.

### Strategy: Multi-Segment Export via Mode 1.5

Convert the filtered word timestamps into multiple video segments (keeping only the non-filtered parts), then use the existing Mode 1.5 normalization + concat pipeline.

### Implementation

#### 3.1 Build segment calculator

**New file**: `apps/web/src/lib/transcription/segment-calculator.ts`

```typescript
interface KeepSegment {
  start: number;  // seconds from video start
  end: number;    // seconds from video start
}

/**
 * Given words with filter states, compute the segments of video to KEEP.
 * Merges adjacent keep-segments that are close together (<0.05s gap)
 * to avoid micro-cuts.
 */
function calculateKeepSegments(
  words: WordItem[],
  videoDuration: number
): KeepSegment[]
```

Logic:
1. Collect all words where `filterState === "ai" | "user-remove"`
2. Build time ranges to remove (from word.start to word.end for each)
3. Merge overlapping/adjacent remove ranges
4. Invert to get keep ranges
5. Clamp to [0, videoDuration]

#### 3.2 Integrate with export pipeline

**File**: `apps/web/src/lib/export-engine-cli.ts`

In the export flow, after collecting video sources:
1. Check if word timeline has any filtered words
2. If yes, call `calculateKeepSegments()` to get keep ranges
3. Convert each keep range into a `VideoSourceInput` with appropriate `trimStart`/`trimEnd`
4. Replace the original single video source with the array of keep segments
5. Force Mode 1.5 (normalization + concat) since we now have multiple segments from one source

This naturally integrates with the existing Mode 1.5 pipeline:
- Each segment gets normalized individually (with trim)
- All segments get concatenated via concat demuxer
- Audio is handled automatically (video+audio in each segment)

#### 3.3 Handle audio sync

The existing Mode 1.5 pipeline handles audio within each segment (since FFmpeg processes both streams). No separate audio handling needed.

### Files to Modify

- **New**: `apps/web/src/lib/transcription/segment-calculator.ts` - Segment math
- `apps/web/src/lib/export-engine-cli.ts` - Integrate segments into export flow
- `apps/web/src/lib/export-cli/sources/video-sources.ts` - Accept word-filtered segments

### Tests

- `apps/web/src/lib/transcription/__tests__/segment-calculator.test.ts`
  - No filters → single segment [0, duration]
  - One word removed → two segments around it
  - Adjacent removes merge into one gap
  - Edge case: first/last word removed
  - Micro-gap merge (<0.05s)
  - Empty words array → single segment

---

## Subtask 4: UX Polish & Edge Cases

**Goal**: Handle edge cases, add quality-of-life features, and ensure robust behavior.

### 4.1 Gap visualization on timeline

**File**: `apps/web/src/components/editor/timeline/index.tsx`

- Show gap regions (excessive silence) as semi-transparent orange bars on timeline
- Distinguish from word markers (dots vs bars)

### 4.2 Keyboard shortcuts

**File**: `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx`

- `Delete` key on selected word → `user-remove`
- `Backspace` → `user-remove`
- `Enter` or `Space` → `user-keep` (if filtered)
- `Ctrl+A` → Select all AI-filtered words
- `Ctrl+Z` → Undo last filter change (store history)

### 4.3 Batch operations

**File**: `apps/web/src/stores/word-timeline-store.ts`

- `acceptAllAiSuggestions()` - Set all `ai` → `user-remove`
- `resetAllFilters()` - Set all → `none`, then re-run `applyAiFilters()`
- `setMultipleFilterStates(wordIds[], state)` - Batch update

### 4.4 Export preview

- Before export, show a summary: "Export will remove X segments (Y seconds total)"
- Estimate output duration vs original duration

### Files to Modify

- `apps/web/src/components/editor/timeline/index.tsx` - Gap visualization
- `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx` - Keyboard shortcuts
- `apps/web/src/stores/word-timeline-store.ts` - Batch operations
- `apps/web/src/lib/export-engine-cli.ts` - Export preview stats

---

## Implementation Order

```
Subtask 1 (AI Auto-Filter)
    ↓
Subtask 2 (UI Tri-State)  ← depends on new filterState type from Subtask 1
    ↓
Subtask 3 (Export Integration)  ← depends on filterState for segment calculation
    ↓
Subtask 4 (Polish)  ← depends on all above
```

## Migration Notes

- `deleted: boolean` → `filterState: WordFilterState` is a breaking change for saved JSON files
- Add migration in `loadFromJson()` and `loadFromData()`:
  - If word has `deleted: true` → set `filterState: "user-remove"`
  - If word has `deleted: false` → set `filterState: "none"`
  - If word already has `filterState` → use as-is

## Architecture Decisions

1. **Filler detection runs client-side** - No API call needed, just pattern matching on word text + gap analysis. Fast and free.
2. **Reuse Mode 1.5 for export** - Don't build a new export mode. Convert filtered words → multiple `VideoSourceInput` segments → existing normalization + concat pipeline handles the rest.
3. **Tri-state over binary** - `WordFilterState` enum instead of boolean gives users clear control and preserves the distinction between AI suggestions and user decisions.
4. **No separate audio pipeline** - FFmpeg handles both video and audio streams together in each segment, so audio sync is automatic.
