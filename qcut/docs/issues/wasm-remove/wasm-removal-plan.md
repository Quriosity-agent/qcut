# Export Engine WASM Removal Plan: Simplifying Export Architecture

## Overview
This document outlines the plan to remove FFmpeg WebAssembly (WASM) from QCut's **export engines only** while preserving WASM for core media processing features (thumbnails, video info, audio extraction). The goal is to simplify the export architecture to use only CLI FFmpeg (Electron) and Standard Canvas-based engines (Browser).

## Current Export Methods Analysis

Based on code analysis of `export-engine-factory.ts`, the current export architecture uses the following priority:

### Electron Environment (Primary Path)
1. **CLI FFmpeg Engine** (lines 95-106) - **Currently Used**
   - Primary choice for Electron environment
   - Uses native FFmpeg CLI via IPC
   - Marked as "most stable and performant"

### Browser Environment Fallback Chain
1. **WebCodecs Engine** (lines 115-127) - High-end systems
   - Requires: WebCodecs API + 16GB RAM + high performance score
   - **Currently NOT implemented** (falls back to OptimizedExportEngine)

2. **FFmpeg WASM Engine** (lines 129-142) - Mid-range systems
   - Requires: SharedArrayBuffer + Workers + 8GB RAM + good performance
   - **Currently PROBLEMATIC** - Referenced in lines 210-233, 258-296
   - Dependencies: `@ffmpeg/ffmpeg@0.12.15`, `@ffmpeg/core@0.12.10`, `@ffmpeg/util@0.12.2`

3. **Optimized Engine** (lines 144-152) - Modern browsers
   - Requires: OffscreenCanvas + Workers
   - Canvas-based with worker optimization

4. **Standard Engine** (lines 154-161) - Final fallback
   - Basic Canvas2D implementation
   - Maximum compatibility

## Current Issues with Export Engine WASM

### 1. Reliability Problems
- FFmpeg WASM export engine frequently times out during initialization
- Inconsistent export performance across different browsers
- Memory allocation issues with large video exports
- Complex debugging when WASM export fails

### 2. Export Architecture Complexity
- Multiple export engines (Standard, Optimized, FFmpeg WASM, CLI)
- Complex fallback logic in `export-engine-factory.ts`
- Browser capability detection overhead for export engine selection
- Maintenance burden of multiple export code paths

### 3. Export User Experience Issues
- Unpredictable export failures due to WASM timeouts
- Long export initialization times
- Inconsistent export quality between engines
- Confusing error messages when WASM export fails

### 4. Core Media Processing vs Export Separation
- **WASM is RELIABLE for core features**: Media thumbnails, video info, audio extraction work well
- **WASM is PROBLEMATIC for exports**: Large video encoding causes timeouts and failures
- **Different use cases**: Quick media processing vs. long-running video exports

## Proposed Solution: Export Engine Simplification

### Target Architecture
```
EXPORT ENGINES:
Electron Environment:
└── CLI FFmpeg Engine (Primary)
    └── Standard Canvas Engine (Fallback)

Browser Environment:
└── Standard Canvas Engine (Primary)
    └── Optimized Canvas Engine (Enhanced)

CORE MEDIA PROCESSING (UNCHANGED):
All Environments:
└── FFmpeg WASM (KEEP)
    ├── Video thumbnails (media-store.ts)
    ├── Video metadata extraction (media-store.ts)
    └── Audio extraction for captions (captions.tsx)
```

### Benefits
1. **Export Reliability**: Remove problematic WASM export timeouts
2. **Preserved Core Features**: Keep working WASM media processing
3. **Simplified Export Logic**: Fewer export engine code paths
4. **Maintained Performance**: Core media processing stays fast
5. **Clear Separation**: Export engines vs. media processing utilities

## Implementation Plan

### Phase 1: Remove Dedicated Export Engine Only
- [ ] Delete `export-engine-ffmpeg.ts` (✅ SAFE - only used in factory)
- [ ] **CANNOT DELETE** `ffmpeg-video-recorder.ts` (❌ Used by Standard Engine)
- [ ] **CANNOT DELETE** `ffmpeg-utils-encode.ts` (❌ Used by ffmpeg-video-recorder)
- [ ] **KEEP** all WASM packages (needed for core features AND Standard engine)

### Phase 2: Disable WASM Export in Standard Engine
- [ ] Modify `export-engine.ts` to disable WASM export option
- [ ] Change `isFFmpegExportEnabled()` to return `false`
- [ ] Keep MediaRecorder fallback path in Standard engine
- [ ] Remove `FFMPEG` engine type from export factory
- [ ] Remove FFMPEG engine recommendation logic (lines 129-142)
- [ ] Remove FFMPEG case handling (lines 210-233, 258-296)
- [ ] Remove isFFmpegAvailable() method (line 494)

### Phase 3: Update Export Configuration Only
- [ ] Update vite.config.ts - remove export-related WASM chunking
- [ ] **KEEP** WASM assets inclusion for core media processing
- [ ] **KEEP** all FFmpeg dependencies in package.json

### Phase 4: Testing & Verification
- [ ] Test export functionality: CLI (Electron) and Standard (Browser)
- [ ] **VERIFY** media thumbnails still work (media-store.ts)
- [ ] **VERIFY** video info extraction still works (media-store.ts)
- [ ] **VERIFY** caption audio extraction still works (captions.tsx)
- [ ] Update export engine documentation only

## Detailed File Analysis & Modification Plan

### ⚠️ CRITICAL FINDING: Standard Engine Uses WASM Export!

**MAJOR DISCOVERY**: The main `export-engine.ts` (Standard Canvas Engine) imports and uses:
- `FFmpegVideoRecorder` from `ffmpeg-video-recorder.ts`
- `isFFmpegExportEnabled()` which returns `true` by default
- This means the "Standard" engine actually uses WASM export when available!

### Files to Modify (NOT Remove) ⚠️
```
apps/web/src/lib/export-engine-ffmpeg.ts ✅ EXISTS
├── Dedicated WASM export engine implementation
└── ✅ SAFE TO REMOVE - only used in factory fallback chain

apps/web/src/lib/ffmpeg-video-recorder.ts ✅ EXISTS
├── WASM video recorder class
└── ❌ CANNOT REMOVE - Used by main export-engine.ts (Standard Engine)

apps/web/src/lib/ffmpeg-utils-encode.ts ✅ EXISTS
├── WASM encoding utilities
└── ❌ CANNOT REMOVE - Used by ffmpeg-video-recorder.ts

apps/web/src/lib/export-engine.ts ⚠️ CRITICAL
├── Standard Canvas Engine imports FFmpegVideoRecorder
├── Uses isFFmpegExportEnabled() to decide export method
└── ❌ MODIFY CAREFULLY - Remove WASM export option, keep MediaRecorder fallback

apps/web/src/lib/ffmpeg-utils.ts
├── Core WASM utility functions
└── ⚠️  CRITICAL: Used by media-store.ts, captions.tsx - **DO NOT REMOVE**

apps/web/src/lib/ffmpeg-service.ts
├── WASM service wrapper
└── ⚠️  USED BY: media-processing.ts - **ANALYZE DEPENDENCIES**

apps/web/src/lib/ffmpeg-loader.ts
├── Dynamic WASM module loader
└── Used by: ffmpeg-utils.ts, use-async-ffmpeg.ts

apps/web/src/lib/ffmpeg-utils-loader.ts
├── Dynamic utils loader
└── Used by: media-processing.ts

apps/web/src/hooks/use-async-ffmpeg.ts
├── React hook for WASM operations
└── Check if used by any components
```

### Files to Modify Carefully ⚠️
```
apps/web/src/lib/export-engine-factory.ts ✅ MODIFY
├── Lines 213, 288: Remove FFmpegExportEngine imports
├── Lines 129-142: Remove FFMPEG engine recommendation logic
├── Lines 210-233, 258-296: Remove FFMPEG case handling
├── Line 494: Remove isFFmpegAvailable() method
└── ✅ SAFE: Only affects export engine selection

apps/web/package.json ✅ NO CHANGES NEEDED
├── **KEEP**: "@ffmpeg/ffmpeg": "^0.12.15" (needed for media processing)
├── **KEEP**: "@ffmpeg/core": "^0.12.10" (needed for media processing)
├── **KEEP**: "@ffmpeg/util": "^0.12.2" (needed for media processing)
└── ✅ SAFE: All dependencies needed for core features

apps/web/vite.config.ts ✅ MINIMAL CHANGES
├── **KEEP**: Line 34 "**/*.wasm" in assetsInclude (needed for media processing)
├── Lines 63-65: Remove commented FFmpeg chunking (cleanup only)
└── ✅ SAFE: Only removes unused comments
```

### Files Using FFmpeg - Keep Intact ⚠️
```
apps/web/src/lib/ffmpeg-utils.ts
├── Used by: media-store.ts (video info, thumbnails)
├── Used by: captions.tsx (audio extraction)
└── ❌ DO NOT REMOVE - Core media processing

apps/web/src/stores/media-store.ts
├── Uses: getVideoInfo, generateThumbnail from ffmpeg-utils
└── ❌ CRITICAL - Media file processing

apps/web/src/components/editor/media-panel/views/captions.tsx
├── Uses: extractAudio from ffmpeg-utils
└── ❌ CRITICAL - Caption generation feature

apps/web/src/lib/media-processing.ts
├── Uses: getFFmpegUtilFunctions from ffmpeg-utils-loader
└── ❌ ANALYZE - May need alternative implementation

apps/web/src/test/mocks/ffmpeg.ts
├── Test mocks for FFmpeg functionality
└── ✅ UPDATE - Simplify mock to match remaining functionality
```

### Risk Assessment by File Impact

#### 🟢 LOW RISK - Safe to Remove
- `export-engine-ffmpeg.ts` - Only used in factory fallback chain

#### 🟡 MEDIUM RISK - Modify Carefully
- `export-engine-factory.ts` - Remove WASM engine logic, keep other fallbacks
- `export-engine.ts` - Disable WASM export, keep MediaRecorder fallback
- `ffmpeg-video-recorder.ts` - Keep file, but disable via isFFmpegExportEnabled()

#### 🔴 HIGH RISK - DO NOT REMOVE
- `ffmpeg-utils-encode.ts` - Used by Standard engine's WASM fallback
- `ffmpeg-utils.ts` - Core media processing (thumbnails, video info)
- `ffmpeg-loader.ts` - Used by core utilities and Standard engine
- `ffmpeg-utils-loader.ts` - Used by media-processing
- `media-store.ts` - Critical media file handling
- `captions.tsx` - Audio extraction for transcription

### Modified Implementation Strategy

**Phase 1: Export Engine File Removals**
- Remove export engine WASM files only (3 files)
- **KEEP** all WASM dependencies in package.json
- **KEEP** WASM assets in vite.config.ts

**Phase 2: Export Factory Simplification**
- Modify export-engine-factory.ts to remove WASM export engine logic
- **PRESERVE** all other FFmpeg utilities for media processing
- Maintain clear separation between export and media processing

**Phase 3: Comprehensive Testing**
- ✅ Test export functionality: CLI (Electron) and Standard (Browser)
- ✅ **CRITICAL**: Verify media thumbnails still work (media-store.ts)
- ✅ **CRITICAL**: Verify video info extraction still works (media-store.ts)
- ✅ **CRITICAL**: Verify caption audio extraction still works (captions.tsx)
- Update documentation to reflect export engine changes only

## Risk Assessment

### Low Risk
- CLI engine is already working and stable
- Standard engine provides browser fallback
- No breaking changes to core export API

### Mitigation Strategies
- Keep Standard engine as reliable fallback
- Provide clear error messages for unsupported environments
- Document the simplified architecture for developers

## Timeline
- **Phase 1-2**: 1-2 days (dependency removal and factory simplification)
- **Phase 3**: 1 day (configuration cleanup)
- **Phase 4**: 1 day (documentation and testing)

**Total Estimated Time**: 3-4 days

## Success Criteria
1. Export works reliably in Electron with CLI engine
2. Export works in browser with Standard engine
3. No WASM-related dependencies remain
4. Simplified codebase with clear architecture
5. Updated documentation reflects new architecture

## Backward Compatibility
- Export API remains unchanged
- User-facing functionality preserved
- Only internal implementation changes

---

## 🚨 REVISED CONCLUSION: Minimal Configuration-Based Approach

### Key Discovery
The Standard Canvas Engine (`export-engine.ts`) **already uses WASM export** via `FFmpegVideoRecorder` when `isFFmpegExportEnabled()` returns `true`. This means we cannot remove WASM export files without breaking the Standard engine.

### Minimal Safe Approach
**Only remove**: `export-engine-ffmpeg.ts` (dedicated WASM engine)
**Disable via config**: Change `isFFmpegExportEnabled()` to return `false`
**Keep everything else**: All WASM files, dependencies, and infrastructure

### Final Architecture
```
EXPORT ENGINES:
Electron Environment:
└── CLI FFmpeg Engine (Primary via factory)
    └── Standard Canvas Engine w/ MediaRecorder (Fallback)

Browser Environment:
└── Standard Canvas Engine w/ MediaRecorder (Primary via factory)
    └── Optimized Canvas Engine (Fallback)

CORE MEDIA PROCESSING (UNCHANGED):
└── FFmpeg WASM (All preserved for thumbnails, video info, audio extraction)
```

This approach:
- ✅ Eliminates problematic WASM export timeouts
- ✅ Preserves all core media processing features
- ✅ Allows easy re-enablement in future
- ✅ Minimal risk of breaking existing functionality

## 🔍 Console Logging Added for Testing

Added comprehensive console logging to track export engine usage:

### Factory Selection Logging
- `🚀 EXPORT ENGINE SELECTION: [engine] chosen for [environment]`
- `🏗️ EXPORT ENGINE CREATION: Creating [engine] engine instance`

### Standard Engine Logging
- `🎬 STANDARD EXPORT ENGINE: Constructor called`
- `🎬 STANDARD EXPORT ENGINE: Will use [FFmpeg WASM/MediaRecorder] for export`
- `🎬 STANDARD EXPORT ENGINE: Export method called`

### CLI Engine Logging
- `⚡ CLI EXPORT ENGINE: Export method called`
- `⚡ CLI EXPORT ENGINE: Using native FFmpeg CLI for video export`

### Testing Instructions
1. Run export in browser environment - look for console messages
2. Run export in Electron environment - look for console messages
3. Check which engine is actually selected vs. expected
4. Verify if Standard engine uses WASM or MediaRecorder in practice

## 🔬 ACTUAL TEST RESULTS - Electron Export

### Console Output Analysis:
```
export-engine-factory.ts:99 🚀 EXPORT ENGINE SELECTION: CLI FFmpeg chosen for Electron environment
export-engine-factory.ts:187 🏗️ EXPORT ENGINE CREATION: Creating cli engine instance
export-engine.ts:94 🎬 STANDARD EXPORT ENGINE: Constructor called
export-engine.ts:95 🎬 STANDARD EXPORT ENGINE: Will use FFmpeg WASM for export
export-engine-cli.ts:486 ⚡ CLI EXPORT ENGINE: Export method called
export-engine-cli.ts:487 ⚡ CLI EXPORT ENGINE: Using native FFmpeg CLI for video export
```

### 🚨 KEY FINDINGS:

1. **Factory correctly selects CLI engine** for Electron (line 1)
2. **Factory attempts to create CLI engine** (line 2)
3. **BUT Standard Engine constructor is ALSO called!** (lines 3-4)
4. **Standard Engine shows it would use FFmpeg WASM** if it ran (line 4)
5. **CLI Engine export method IS called** (lines 5-6)
6. **Final result: CLI Engine is actually used** for export

### 🎯 CONCLUSION:

**CLI Export Engine IS being used in Electron**, and the pattern makes sense:
- Standard Engine constructor is called because **CLIExportEngine extends ExportEngine**
- This is normal JavaScript class inheritance - parent constructor runs first
- CLI Engine overrides the `export()` method, so parent's export never runs
- Standard Engine's WASM configuration in constructor is harmless but unused

This confirms:
- ✅ **CLI Engine is the actual export engine used in Electron**
- ✅ **Standard Engine constructor runs as parent class** (normal inheritance)
- ✅ **CLI Engine's export() method overrides parent** - WASM never used
- ❌ **Standard Engine's WASM configuration is irrelevant in Electron**

### Implications for WASM Removal:
- **Safe to disable WASM in Standard Engine** - it's not used in Electron anyway
- **CLI Engine is working correctly** as the primary Electron export path
- **Need to test browser environment** to see if Standard Engine is actually used there

**Status**: Analysis Complete - CLI Engine confirmed as Electron export path
**Created**: 2025-09-19
**Updated**: 2025-09-19 (Console logging added to track actual usage)
**Branch**: wasm-remove