# Word Filter Not Applied During Export

## Summary
When words are marked for removal (AI or user-remove) in the transcribe panel, the exported video still contains them — filtered segments are not cut.

## Root Cause
**Mode 1 (direct-copy) skips word filter processing entirely.**

The export pipeline has a mode detection flow:
1. `export-analysis.ts` decides the optimization strategy
2. Single video with no text/stickers → `"direct-copy"` (Mode 1)
3. `export-engine-cli.ts` only extracts `videoInput` when `canUseMode2` is true
4. Word filter logic at line ~840 requires `videoInput` to be non-null
5. With Mode 1: `videoInput = null` → `wordFilterSegments = undefined` → no cuts

```
Mode 1 (direct-copy)
  → canUseMode2 = false
  → videoInput = null
  → hasWordFilters && videoInput = false  ← SKIPPED
  → wordFilterSegments = undefined
  → FFmpeg does direct copy (no cuts)
```

## Evidence
Console log from export:
```
- Direct copy mode: ENABLED
- Word filter cuts: NO
```

## Fix Applied
Three changes in `export-engine-cli.ts`:

1. **Move word filter detection before mode decision** — check `hasWordFilters` early so it can influence `videoInput` extraction
2. **Extract videoInput when word filters exist** — `needsVideoInput = canUseMode2 || hasWordFilters`
3. **Disable direct copy when word filters active** — add `!wordFilterSegments` to the `useDirectCopy` condition

After fix, flow becomes:
```
Mode 1 + word filters active
  → needsVideoInput = true (due to hasWordFilters)
  → videoInput = { path, trimStart, trimEnd }
  → wordFilterSegments = [keep segments...]
  → useDirectCopy = false (wordFilterSegments present)
  → FFmpeg handler routes to handleWordFilterCut()
  → filter_complex with trim/concat/acrossfade
```

## Files Changed
- `apps/web/src/lib/export-engine-cli.ts` (lines 771-937)
  - Moved `wordTimelineData` + `hasWordFilters` check before `videoInput` extraction
  - Added `needsVideoInput` that includes `hasWordFilters`
  - Added `!wordFilterSegments` to `useDirectCopy` condition

## Verification
After fix, console should show:
```
[CLI Export] Filter state breakdown: { none: 140, ai: 5, user-remove: 3 }
[CLI Export] hasWordFilters: true, videoInput: true
[CLI Export] Word filters active: 8 words marked for removal
  [REMOVE] "um" (2.30s–2.50s) state=ai
  ...
[CLI Export] Keep segments (N): ["0.00s–2.25s", ...]
- Word filter cuts: N segments
- Direct copy mode: DISABLED
```
