# WASM Removal Plan: Simplifying Export Architecture

## Overview
This document outlines the plan to remove FFmpeg WebAssembly (WASM) support from QCut and simplify the export architecture to use only the default FFmpeg CLI engine.

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

## Current Issues with WASM

### 1. Reliability Problems
- FFmpeg WASM frequently times out during initialization
- Inconsistent performance across different browsers
- Memory allocation issues with large video files
- Complex debugging when WASM fails

### 2. Architecture Complexity
- Multiple export engines (Standard, Optimized, FFmpeg WASM, CLI)
- Complex fallback logic in `export-engine-factory.ts`
- Browser capability detection overhead
- Maintenance burden of multiple code paths

### 3. User Experience Issues
- Unpredictable export failures
- Long initialization times
- Inconsistent export quality between engines
- Confusing error messages when WASM fails

## Proposed Solution: CLI-Only Architecture

### Target Architecture
```
Electron Environment:
└── CLI FFmpeg Engine (Primary)
    └── Standard Engine (Fallback)

Browser Environment:
└── Standard Engine (Canvas-based)
```

### Benefits
1. **Reliability**: CLI FFmpeg is proven and stable
2. **Performance**: Native FFmpeg is faster than WASM
3. **Simplicity**: Single code path reduces bugs
4. **Maintainability**: Less complex fallback logic
5. **Predictability**: Consistent behavior across environments

## Implementation Plan

### Phase 1: Remove WASM Dependencies
- [ ] Remove `@ffmpeg/ffmpeg` and `@ffmpeg/core` packages
- [ ] Delete `export-engine-ffmpeg.ts`
- [ ] Delete `ffmpeg-video-recorder.ts`
- [ ] Remove FFmpeg WASM setup scripts

### Phase 2: Simplify Export Factory
- [ ] Remove `FFMPEG` engine type from factory
- [ ] Remove browser capability detection for WASM
- [ ] Simplify `getEngineRecommendation()` logic
- [ ] Update engine selection to: CLI (Electron) or Standard (Browser)

### Phase 3: Update Configuration
- [ ] Remove WASM-related environment variables
- [ ] Update build scripts to skip FFmpeg WASM setup
- [ ] Clean up package.json dependencies

### Phase 4: Documentation & Testing
- [ ] Update user documentation
- [ ] Update developer documentation
- [ ] Test export functionality in both environments
- [ ] Update error handling and user messaging

## Files to Modify

### Remove Completely
- `apps/web/src/lib/export-engine-ffmpeg.ts` ✅ **EXISTS** - WASM export engine implementation
- `apps/web/src/lib/ffmpeg-video-recorder.ts` ✅ **EXISTS** - WASM video recorder
- `apps/web/src/lib/ffmpeg-utils-encode.ts` (check if exists)
- Package dependencies: `@ffmpeg/ffmpeg@0.12.15`, `@ffmpeg/core@0.12.10`, `@ffmpeg/util@0.12.2`

### Modify
- `apps/web/src/lib/export-engine-factory.ts` - Simplify engine selection
- `apps/web/package.json` - Remove WASM dependencies
- `apps/web/vite.config.ts` - Remove WASM-related configuration
- Export-related components - Remove WASM options

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

**Status**: Planning Phase
**Created**: 2025-09-19
**Branch**: wasm-remove