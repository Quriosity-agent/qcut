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

## Subtask 1: AI-Powered Auto-Filter Detection

**Goal**: After transcription completes, send the transcription to an LLM (Gemini or Claude API) to intelligently identify filler words, false starts, repetitions, and excessive silence gaps. AI understands context - it knows "like" in "I like cats" is meaningful but "like" in "it was like, um, weird" is filler.

### Why AI > Pattern Matching

| Approach | "I was like um going" | "I like this song" | "so so basically" |
|----------|----------------------|--------------------|--------------------|
| Pattern matching | Flags "like", "um" | Wrongly flags "like" | Flags "so", "basically" but misses "so so" repetition |
| AI analysis | Flags "like", "um" as fillers | Keeps "like" (meaningful verb) | Flags "so so basically" as filler + repetition |

AI can also detect: false starts ("I was- I went to"), hesitation patterns, and contextual fillers that pattern matching would miss.

### What to Build

1. **IPC handler** in Electron for AI filler analysis (reuses existing Gemini SDK + adds Anthropic SDK option)
2. **Prompt engineering** - Send word list with timestamps, get back word IDs to filter with reasons
3. **Fallback** - If no API key or API fails, fall back to basic pattern matching as a safety net

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
  filterReason?: string;         // AI's explanation (e.g., "filler word", "false start", "excessive pause")
}
```

- `"none"` - Not filtered (default for normal words)
- `"ai"` - AI suggested for removal (user hasn't decided yet)
- `"user-remove"` - User confirmed removal
- `"user-keep"` - User explicitly chose to keep (overrides AI suggestion)

#### 1.2 Add AI filler analysis IPC handler

**New file**: `electron/ai-filler-handler.ts`

This handler sends the transcription to an LLM and gets back structured filter decisions.

```typescript
// IPC channel: "ai:analyze-fillers"
// Input: { words: WordItem[], languageCode: string }
// Output: { filteredWordIds: Array<{ id: string, reason: string }> }

ipcMain.handle("ai:analyze-fillers", async (_, { words, languageCode }) => {
  const apiKeys = await getDecryptedApiKeys();

  // Priority: Gemini (already integrated) → Anthropic (if key exists)
  if (apiKeys.geminiApiKey) {
    return analyzeWithGemini(words, languageCode, apiKeys.geminiApiKey);
  }
  if (apiKeys.anthropicApiKey) {
    return analyzeWithClaude(words, languageCode, apiKeys.anthropicApiKey);
  }

  // Fallback: basic pattern matching (no API key available)
  return analyzeWithPatternMatch(words);
});
```

**Gemini implementation** (reuses existing `@google/generative-ai` SDK):
```typescript
async function analyzeWithGemini(words, languageCode, apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",  // Fast + cheap ($0.10/1M tokens)
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = buildFilterPrompt(words, languageCode);
  const result = await model.generateContent(prompt);
  return parseFilterResponse(result.response.text());
}
```

**Anthropic implementation** (new, uses `@anthropic-ai/sdk`):
```typescript
async function analyzeWithClaude(words, languageCode, apiKey) {
  const anthropic = new Anthropic({ apiKey });
  const prompt = buildFilterPrompt(words, languageCode);

  const result = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",  // Fast + capable
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  return parseFilterResponse(result.content[0].text);
}
```

#### 1.3 AI Prompt Design

**File**: `electron/ai-filler-handler.ts` (same file, internal function)

```typescript
function buildFilterPrompt(words: WordItem[], languageCode: string): string {
  // Compact format: "id|text|start|end" per line to minimize tokens
  const wordList = words
    .filter(w => w.type === "word")
    .map(w => `${w.id}|${w.text}|${w.start.toFixed(2)}|${w.end.toFixed(2)}`)
    .join("\n");

  return `Analyze this transcription and identify words/phrases to remove for a clean edit.
Language: ${languageCode}

Words (format: id|text|startTime|endTime):
${wordList}

Identify these categories:
1. **Filler words** - "um", "uh", "ah", "er", and language-specific fillers used as hesitation
2. **Contextual fillers** - Words like "like", "so", "basically", "actually", "right", "okay" ONLY when used as verbal fillers (not when they carry meaning)
3. **False starts** - Incomplete words or abandoned sentence beginnings before restating
4. **Repetitions** - Unintentional word repetitions ("I I went", "the the thing")
5. **Excessive pauses** - Gaps between consecutive words longer than 1.5 seconds (check timestamps)

Return JSON array of objects: { "id": "word-X", "reason": "brief explanation" }
Only include words that should be removed. When in doubt, keep the word.
Return ONLY the JSON array, no other text.`;
}
```

**Token cost estimate**: ~500 words transcription → ~2K input tokens + ~500 output tokens → ~$0.001 per analysis with Gemini Flash.

#### 1.4 Pattern matching fallback

**File**: `electron/ai-filler-handler.ts` (same file, fallback function)

```typescript
/** Fallback when no API key is available */
function analyzeWithPatternMatch(words: WordItem[]): FilterResult {
  const FILLER_WORDS = new Set(["um", "uh", "ah", "er", "hmm", "huh"]);
  const GAP_THRESHOLD = 1.5; // seconds

  const filtered = [];
  for (const word of words) {
    if (word.type !== "word") continue;
    if (FILLER_WORDS.has(word.text.toLowerCase().trim())) {
      filtered.push({ id: word.id, reason: "common filler word" });
    }
  }

  // Gap detection between consecutive words
  const sortedWords = words.filter(w => w.type === "word").sort((a, b) => a.start - b.start);
  for (let i = 0; i < sortedWords.length - 1; i++) {
    const gap = sortedWords[i + 1].start - sortedWords[i].end;
    if (gap > GAP_THRESHOLD) {
      // Mark as gap (creates a virtual "gap segment" between the two words)
      filtered.push({ id: `gap-${sortedWords[i].id}`, reason: `${gap.toFixed(1)}s silence gap` });
    }
  }

  return { filteredWordIds: filtered };
}
```

#### 1.5 Integrate into store + UI flow

**File**: `apps/web/src/stores/word-timeline-store.ts`

- Add `analyzeFillers()` async action that calls `window.electronAPI.analyzeFillers(words, languageCode)` IPC
- On success, set `filterState: "ai"` and `filterReason` for each returned word ID
- Add `isAnalyzing: boolean` state for loading UI
- Call `analyzeFillers()` automatically after `loadFromTranscription()` completes
- Update `toggleWordDeleted()` → `cycleFilterState(wordId)` to cycle through states
- Update `getNonDeletedWords()` → `getWordsForExport()` which excludes `filterState === "ai" | "user-remove"` but includes `"user-keep"`
- Add backward compat: map old `deleted: true` → `filterState: "user-remove"`, `deleted: false` → `filterState: "none"` when loading JSON

**File**: `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx`

- Show "Analyzing for fillers..." spinner after transcription completes
- Display AI analysis results with reason tooltips

**File**: `electron/preload.ts` + `src/types/electron.d.ts`

- Expose `window.electronAPI.analyzeFillers()` IPC bridge
- Add TypeScript types

### Files to Modify

- `apps/web/src/types/word-timeline.ts` - Add `WordFilterState` type, `filterReason`, update `WordItem`
- `apps/web/src/stores/word-timeline-store.ts` - New async actions, migrate from boolean to enum
- **New**: `electron/ai-filler-handler.ts` - AI analysis IPC handler (Gemini + Claude + fallback)
- `electron/main.ts` - Register new IPC handler
- `electron/preload.ts` - Expose `analyzeFillers` bridge
- `apps/web/src/types/electron.d.ts` - Add type for new IPC method
- `package.json` - Add `@anthropic-ai/sdk` dependency (optional, for Claude API support)

### Tests

- `electron/__tests__/ai-filler-handler.test.ts`
  - Pattern matching fallback detects "um", "uh" etc.
  - Pattern matching fallback detects gaps > 1.5s
  - Does not flag meaningful words in fallback mode
  - Prompt builder formats words correctly
  - Response parser handles valid JSON
  - Response parser handles malformed AI output gracefully
  - Priority: Gemini → Claude → fallback

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

1. **AI-powered filler detection via LLM API** - Uses Gemini (already integrated) or Claude API to understand context. "Like" as a verb is kept, "like" as filler is removed. Falls back to basic pattern matching if no API key is available. Cost: ~$0.001 per analysis with Gemini Flash.
2. **Gemini first, Claude second, pattern matching fallback** - Follows existing API key priority in the codebase. Gemini SDK is already a dependency. Anthropic SDK added as optional. If neither key exists, basic filler word list + gap detection still works.
3. **Reuse Mode 1.5 for export** - Don't build a new export mode. Convert filtered words → multiple `VideoSourceInput` segments → existing normalization + concat pipeline handles the rest.
4. **Tri-state over binary** - `WordFilterState` enum instead of boolean gives users clear control and preserves the distinction between AI suggestions and user decisions.
5. **No separate audio pipeline** - FFmpeg handles both video and audio streams together in each segment, so audio sync is automatic.
6. **IPC handler for AI calls** - AI analysis runs in Electron main process (like existing Gemini chat/transcribe handlers), not in renderer. Keeps API keys secure and follows established patterns.
