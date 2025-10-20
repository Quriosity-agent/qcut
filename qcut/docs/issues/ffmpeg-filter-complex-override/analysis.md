# FFmpeg Filter Complex Override Issue

## Issue Summary

**Critical Bug**: Multiple `-filter_complex` arguments in FFmpeg command override each other, causing stickers and text overlays to be dropped when audio mixing/delay filters are used.

**Severity**: High - Results in silent data loss where visual elements disappear from exported videos

**Affects**: Lines 1395-1426, 1646-1652 in `export-engine-cli.ts` and FFmpeg argument builder in `electron/ffmpeg-handler.ts`

---

## Technical Analysis

### The Problem

FFmpeg only processes the **last** `-filter_complex` argument when multiple are provided. When our export system generates separate filter_complex arguments for:
1. Video filters (effects, stickers, text overlays)
2. Audio filters (delay, volume, mixing)

The last one **completely overrides** the previous one, causing:
- **Stickers disappear** from final video
- **Text overlays disappear** from final video
- **Visual effects disappear** from final video
- Only audio mixing remains functional

### Current Broken Behavior

```bash
# What we currently generate (BROKEN):
ffmpeg \
  -i video.mp4 \
  -i sticker1.png \
  -i sticker2.png \
  -filter_complex "[1:v]scale=100:100[s1];[0:v][s1]overlay[v1];[v1]drawtext=..." \
  -filter_complex "[0:a]adelay=1000|1000[a1];[a1]volume=0.8[aout]" \
  -map 0:v -map [aout] output.mp4

# Result: Second -filter_complex OVERRIDES the first one
# Stickers and text are LOST!
```

### Root Cause

**FFmpeg Specification**: FFmpeg processes command-line arguments sequentially and the last `-filter_complex` argument **replaces** any previous ones. This is documented FFmpeg behavior, not a bug in FFmpeg itself.

**Our Architecture Flaw**: We build filter chains independently:
1. Video processing builds sticker/text filter chain
2. Audio processing builds delay/mix filter chain
3. Both append `-filter_complex` to args array
4. FFmpeg sees two `-filter_complex` → uses only the last one

### Impact Assessment

**When does it break?**
- ✅ Single video + stickers → Works (no audio filters needed)
- ✅ Single video + text → Works (no audio filters needed)
- ❌ Video + stickers + audio with delay → **BREAKS** (stickers lost)
- ❌ Video + text + multiple audio tracks → **BREAKS** (text lost)
- ❌ Video + effects + stickers + audio → **BREAKS** (all video filters lost)

**User Experience**:
- Silent failure: No error messages
- Data loss: Visual elements silently disappear
- Inconsistent: Works sometimes, fails others
- Debugging nightmare: Issue only appears with specific combinations

---

## Solution Architecture

### Unified Filter Graph Approach

Build **ONE** filter_complex argument with labeled outputs for both video and audio streams.

#### Conceptual Flow

```
Input Streams → Filter Graph → Labeled Outputs → Map Outputs
```

#### Filter Graph Structure

```
[Video Path]
  [0:v] → effects → stickers → text → [vout]

[Audio Path]
  [0:a] → delay → volume → [a1]
  [1:a] → delay → volume → [a2]
  [a1][a2] → amix → [aout]

[Final Mapping]
  -map [vout] → output video stream
  -map [aout] → output audio stream
```

### Implementation Strategy

#### 1. Video Filter Chain Builder

**Responsibility**: Accept base video label, append all video filters, return output label

```
Input:  baseLabel = "[0:v]"
        effects = [...]
        stickers = [...]
        text = [...]

Output: {
          filterString: "...full video filter chain...",
          outputLabel: "[vout]"
        }
```

**Chain Progression**:
```
[0:v] → [effects_out] → [stickers_out] → [text_out] → [vout]
```

**Key Considerations**:
- Each stage must produce a labeled output
- Labels must be unique within the graph
- Empty stages should pass through without creating filters
- Rotation/opacity/scaling must be chained correctly

#### 2. Audio Filter Chain Builder

**Responsibility**: Build audio mixing/delay chain from multiple inputs

```
Input:  audioFiles = [{path, startTime, volume}, ...]
        totalDuration = 10.5

Output: {
          filterString: "...full audio filter chain...",
          outputLabel: "[aout]"
        }
```

**Chain Progression**:
```
[0:a] → adelay → volume → [a1]
[1:a] → adelay → volume → [a2]
[2:a] → adelay → volume → [a3]
[a1][a2][a3] → amix[aout]
```

**Key Considerations**:
- Handle variable number of audio inputs
- Pad audio to match video duration
- Apply delay based on startTime
- Apply volume normalization
- Mix all delayed/volumed streams

#### 3. Unified Graph Builder

**Responsibility**: Combine video + audio graphs into single -filter_complex

```
function buildUnifiedFilterGraph(params: {
  videoFilters: { filterString: string; outputLabel: string };
  audioFilters: { filterString: string; outputLabel: string };
}): string {
  // Combine with semicolon separator
  return `${videoFilters.filterString};${audioFilters.filterString}`;
}
```

**FFmpeg Command Structure**:
```bash
ffmpeg \
  -i video.mp4 \
  -i sticker1.png \
  -i sticker2.png \
  -i audio1.mp3 \
  -i audio2.mp3 \
  -filter_complex "
    [1:v]scale=100:100[s1];
    [2:v]scale=120:120[s2];
    [0:v][s1]overlay=x=10:y=10[v1];
    [v1][s2]overlay=x=50:y=50[v2];
    [v2]drawtext=text='Hello'[vout];
    [3:a]adelay=1000|1000,volume=0.8[a1];
    [4:a]adelay=2000|2000,volume=0.6[a2];
    [a1][a2]amix=inputs=2:duration=longest[aout]
  " \
  -map [vout] \
  -map [aout] \
  output.mp4
```

---

## Implementation Phases

### Phase 1: Refactor Video Filter Builder

**Goal**: Make video filter chain return labeled output instead of appending to args

**Current Code Location**: `export-engine-cli.ts:1135-1213` (buildStickerOverlayFilters)

**Refactor Needed**:
- Accept base video label as parameter
- Return `{ filterString, outputLabel }` instead of string
- Ensure all intermediate stages use unique labels
- Handle empty filter cases (no stickers, no text)

**Benefits**:
- Composable filter chains
- Testable in isolation
- Clear input/output contract

### Phase 2: Refactor Audio Filter Builder

**Goal**: Build audio filter chain with labeled output

**Current Code Location**: `electron/ffmpeg-handler.ts` (audio mixing logic)

**Refactor Needed**:
- Build adelay + volume + amix chain
- Return `{ filterString, outputLabel: "[aout]" }`
- Handle edge cases (no audio, single audio, multiple audio)
- Proper padding/duration handling

**Benefits**:
- Explicit audio graph structure
- Easier to debug audio sync issues
- Supports complex audio scenarios

### Phase 3: Unified Graph Assembly

**Goal**: Combine video + audio graphs into single -filter_complex

**Current Code Location**: `electron/ffmpeg-handler.ts` (buildFFmpegArgs)

**Refactor Needed**:
- Remove duplicate `-filter_complex` appends
- Build unified graph string
- Update `-map` arguments to use labels
- Handle fallback when no audio (`-map 0:a?`)

**Benefits**:
- Fixes the override bug
- Single source of truth for filter graph
- Proper stream mapping

### Phase 4: Testing & Validation

**Test Cases**:
1. ✅ Video + stickers only (no audio)
2. ✅ Video + text only (no audio)
3. ✅ Video + stickers + single audio
4. ✅ Video + text + multiple audio with delays
5. ✅ Video + stickers + text + effects + multi-audio
6. ✅ Direct copy mode (no filters)
7. ✅ Mode 2 with filters (verify no regression)

**Validation Criteria**:
- All visual elements appear in final video
- Audio sync is correct
- No filter override occurs
- FFmpeg command is valid
- Performance is not degraded

---

## Edge Cases & Considerations

### 1. No Audio Files
**Scenario**: Video with stickers/text but no audio track

**Solution**:
```bash
# Video filters only
-filter_complex "[video graph to [vout]]" \
-map [vout] \
-map 0:a?  # Optional audio mapping (won't fail if missing)
```

### 2. No Video Filters
**Scenario**: Pure audio mixing with no visual overlays

**Solution**:
```bash
# Audio filters only
-filter_complex "[audio graph to [aout]]" \
-map 0:v \      # Direct video mapping
-map [aout]
```

### 3. No Filters At All
**Scenario**: Direct copy or simple concatenation

**Solution**:
```bash
# No -filter_complex needed
-map 0:v \
-map 0:a
```

### 4. Sticker Input Indexing
**Current Issue**: Audio input indices are calculated as `index + 1 + stickerCount`

**Critical**: After unification, ALL input indices must account for:
- Base video: index 0
- Sticker images: indices 1..N
- Audio files: indices (N+1)..(N+M)

**Example**:
```
Input 0: video.mp4 (base)
Input 1: sticker1.png
Input 2: sticker2.png
Input 3: audio1.mp3  ← Index = 1 + 2 stickers = 3 ✓
Input 4: audio2.mp3  ← Index = 2 + 2 stickers = 4 ✓
```

### 5. Filter Label Uniqueness
**Requirement**: All intermediate labels must be unique

**Strategy**:
- Video chain: `[v0]`, `[v1]`, `[v2]`, ..., `[vout]`
- Sticker scaling: `[scaled0]`, `[scaled1]`, ...
- Sticker rotation: `[rotated0]`, `[rotated1]`, ...
- Sticker opacity: `[alpha0]`, `[alpha1]`, ...
- Audio delay: `[a1]`, `[a2]`, `[a3]`, ..., `[aout]`

**Collision Risk**: Must avoid reusing labels across video/audio paths

---

## Performance Implications

### Before (Multiple filter_complex)
- Each filter graph parsed separately
- Potential for FFmpeg to optimize independently
- **BUT**: Broken - later graphs override earlier ones

### After (Unified filter_complex)
- Single filter graph parsing
- FFmpeg can optimize entire graph holistically
- **Better**: No performance regression, potentially faster due to unified optimization

### Expected Impact
- ✅ No performance degradation
- ✅ Possible minor improvement (unified graph optimization)
- ✅ Reduced FFmpeg process overhead (one graph vs multiple)

---

## Migration Path

### Backward Compatibility
**Goal**: Ensure existing exports don't break during refactor

**Strategy**:
1. Keep old code paths functional during development
2. Add feature flag for unified graph (`qcut_unified_filter_graph=true`)
3. Test both paths in parallel
4. Switch to unified as default after validation
5. Remove old code path after confidence period

### Testing Strategy
**Unit Tests**:
- Video filter builder returns correct labeled output
- Audio filter builder handles variable inputs
- Unified graph builder combines correctly

**Integration Tests**:
- Export with stickers + audio → verify stickers appear
- Export with text + multi-audio → verify text appears
- Export with effects + stickers + text + audio → verify all appear

**Regression Tests**:
- Existing test suite must pass
- No performance degradation
- No new bugs introduced

---

## Dependencies & Prerequisites

### Code Locations
1. **Video Filter Building**: `apps/web/src/lib/export-engine-cli.ts:1135-1213`
2. **Audio Mixing Logic**: `electron/ffmpeg-handler.ts` (buildFFmpegArgs)
3. **Sticker Extraction**: `apps/web/src/lib/export-engine-cli.ts:1018-1122`
4. **Text Filter Building**: `apps/web/src/lib/export-engine-cli.ts:724-778`

### Type Definitions Needed
```typescript
interface FilterChainResult {
  filterString: string;
  outputLabel: string;
}

interface VideoFilterParams {
  baseLabel: string;        // Input label (e.g., "[0:v]")
  effects?: EffectFilter[];
  stickers?: StickerSourceForFilter[];
  textElements?: TextElement[];
}

interface AudioFilterParams {
  audioFiles: AudioFileInput[];
  totalDuration: number;
  stickerInputCount: number; // For correct input indexing
}
```

### Refactoring Order
1. ✅ Create type definitions (interfaces above)
2. ⚠️ Refactor `buildStickerOverlayFilters()` → return FilterChainResult
3. ⚠️ Refactor text filter builder → return FilterChainResult
4. ⚠️ Create audio filter builder → return FilterChainResult
5. ⚠️ Create unified graph builder in ffmpeg-handler.ts
6. ⚠️ Update buildFFmpegArgs to use unified graph
7. ⚠️ Remove duplicate -filter_complex code paths
8. ✅ Add comprehensive tests
9. ✅ Validate with real-world exports

---

## Success Criteria

### Functional Requirements
- ✅ Stickers appear in videos with audio mixing
- ✅ Text overlays appear in videos with audio mixing
- ✅ Effects work correctly with audio mixing
- ✅ Audio sync remains correct
- ✅ Multi-audio mixing works as before
- ✅ Direct copy mode unaffected
- ✅ Mode 2 (direct video + filters) unaffected

### Quality Requirements
- ✅ No performance regression
- ✅ Code is more maintainable (separated concerns)
- ✅ Clear filter graph structure
- ✅ Comprehensive test coverage
- ✅ No silent failures
- ✅ Proper error messages if filter graph invalid

### Documentation Requirements
- ✅ Update JSDoc comments
- ✅ Document filter graph structure
- ✅ Explain label naming conventions
- ✅ Provide examples of unified graphs
- ✅ Update architecture docs

---

## Next Steps

1. **Confirm Current Behavior**: Write failing test demonstrating sticker loss with audio
2. **Create Feature Branch**: `fix/unified-filter-complex-graph`
3. **Implement Phase 1**: Refactor video filter builder
4. **Implement Phase 2**: Create audio filter builder
5. **Implement Phase 3**: Unified graph assembly
6. **Test Extensively**: All combinations of video/audio/filters
7. **Code Review**: Ensure no regressions
8. **Merge to Main**: After validation passes

---

## References

### FFmpeg Documentation
- [FFmpeg Filtering Guide](https://ffmpeg.org/ffmpeg-filters.html)
- [Complex Filtergraphs](https://trac.ffmpeg.org/wiki/FilteringGuide#Complexfiltergraphs)
- [Stream Mapping](https://trac.ffmpeg.org/wiki/Map)

### Related Code
- Sticker overlay implementation: `export-engine-cli.ts:1135-1213`
- Text overlay implementation: `export-engine-cli.ts:724-778`
- Audio mixing: `ffmpeg-handler.ts` (buildFFmpegArgs)

### Similar Issues
- None found in current codebase (new issue)
- Common FFmpeg pitfall in multi-filter scenarios
- Well-documented solution pattern in FFmpeg community

---

## Author Notes

This issue represents a **critical architectural flaw** in how we build FFmpeg filter chains. The solution is well-understood in the FFmpeg community: **always use a single unified filter graph with labeled outputs**.

The refactor will:
- ✅ Fix silent data loss bug
- ✅ Improve code maintainability
- ✅ Enable future filter chain extensions
- ✅ Make debugging easier
- ✅ Align with FFmpeg best practices

**Estimated Effort**: 1-2 days for implementation + testing
**Risk Level**: Medium (requires careful testing but solution is proven)
**Priority**: **High** (silent data loss affecting user exports)
