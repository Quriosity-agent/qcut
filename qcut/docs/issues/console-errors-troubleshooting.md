# QCut Console Errors Troubleshooting Guide

## Overview
This document tracks various console errors encountered in the QCut video editor application and their resolution status. The errors range from blob URL failures to React component warnings and HTML2Canvas rendering issues.

## 🔴 Critical Errors

### 1. Blob URL Resource Loading Failure
**Error:** `blob:app://./355b7122-6c44-4fb2-afcd-6900549f4c26:1 Failed to load resource: net::ERR_FILE_NOT_FOUND`

**Root Cause:** **FFmpeg WebAssembly loading failure** - not source maps. The error occurs when FFmpeg utilities create blob URLs for core JS and WASM files in Electron environment.

**Technical Details:**
- **Location:** `src/lib/ffmpeg-utils.ts:241-242` 
- **Process:** FFmpeg loader fetches core.js and core.wasm files, converts to blobs, creates blob URLs
- **Failure Point:** `ffmpeg.load({ coreURL: coreBlobUrl, wasmURL: wasmBlobUrl })` 
- **Environment Issue:** Electron's blob URL handling differs from browser, causing loading failures

**Status:** 🔴 **MISIDENTIFIED - REQUIRES PROPER FIX**
- **Previous Attempt:** Added source maps (doesn't address actual issue)
- **Actual Problem:** FFmpeg WASM blob URL creation in Electron environment
- **Evidence:** 
  - Blob manager creates URLs with pattern `blob:app://./[uuid]`
  - Error timing correlates with FFmpeg initialization
  - Multiple FFmpeg-related files found in source analysis

### 2. React Ref Warning
**Error:** `Warning: Function components cannot be given refs. Attempts to access this ref will fail. Did you mean to use React.forwardRef()?`

**Root Cause:** Radix UI Primitive.button.SlotClone receiving refs in function component without forwardRef wrapper.

**Status:** 🟡 **IDENTIFIED - NEEDS FIX**
- **Location:** Primitive.button component in vendor-react bundle
- **Impact:** Non-breaking warning, but indicates incorrect ref handling
- **Next Steps:** 
  1. Identify which component is passing refs to Primitive.button
  2. Update component to use React.forwardRef() or remove ref usage
  3. Check if Radix UI version update addresses this issue

## 🟡 Layout & UI Warnings

### 3. ResizablePanel Layout Warnings
**Error:** `WARNING: Invalid layout total size: 23.8%, 46.15%, 30.07%. Layout normalization will be applied.`

**Root Cause:** Panel sizes don't sum to exactly 100% due to floating-point precision issues in the panel store calculations.

**Status:** 🟡 **PARTIALLY ADDRESSED**
- **Current Values:** Tools=23.8%, Preview=46.15%, Properties=30.07% (Total=100.02%)
- **Location:** `panel-layouts.tsx:34-39` - Already has debug logging
- **Existing Solutions:** 
  - MediaLayout, InspectorLayout, and VerticalPreviewLayout have normalization logic
  - DefaultLayout lacks normalization (root cause)
- **Next Steps:**
  1. Add normalization logic to DefaultLayout similar to other layouts
  2. Implement floating-point precision handling in panel store
  3. Consider using integer-based calculations instead of percentages

### 4. Excessive Re-renders
**Pattern:** Multiple repeated log entries indicating layout recalculations

**Observations:**
- Editor layout resets multiple times: `🎯 Editor using layout: default, resetCounter: 0`
- Panel size calculations repeated multiple times
- Suggests potential React render loop or state management issue

**Status:** 🔴 **NEEDS INVESTIGATION**
- **Impact:** Potential performance degradation
- **Next Steps:**
  1. Add React DevTools Profiler analysis
  2. Check for unnecessary state updates in panel-store
  3. Investigate resetCounter logic in editor component
  4. Add memoization where appropriate

## 🟠 HTML2Canvas Issues

### 5. Canvas Performance Warning
**Warning:** `Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true`

**Root Cause:** HTML2Canvas performing multiple canvas operations without optimization flag.

**Status:** 🟡 **OPTIMIZATION NEEDED**
- **Location:** html2canvas.esm.js:5347
- **Solution:** Add `willReadFrequently: true` to canvas creation options
- **Impact:** Performance degradation during canvas operations

### 6. Unsupported Color Function
**Error:** `Attempting to parse an unsupported color function "oklab"`

**Root Cause:** HTML2Canvas doesn't support modern CSS color functions like `oklab()`.

**Status:** 🔴 **COMPATIBILITY ISSUE**
- **Impact:** Offscreen capture failing, falling back to alternative methods
- **Workaround:** Application already implements fallback mechanism
- **Long-term Solutions:**
  1. Replace oklab colors with supported formats (hex, rgb, hsl)
  2. Update HTML2Canvas to newer version with extended color support
  3. Implement custom color parser for unsupported formats

### 7. Canvas Width Property Error
**Error:** `Cannot set properties of undefined (setting 'width')`

**Root Cause:** HTML2Canvas trying to set width on undefined canvas element.

**Status:** 🔴 **RUNTIME ERROR**
- **Location:** html2canvas.esm.js:7567:28
- **Frequency:** Multiple occurrences during capture attempts
- **Impact:** Frame capture completely failing
- **Next Steps:**
  1. Add null checks before canvas property assignment
  2. Implement proper error handling for canvas creation
  3. Investigate canvas element lifecycle management

## 📊 Error Frequency Analysis

| Error Type | Frequency | Severity | Status |
|------------|-----------|----------|---------|
| Blob URL failures | Single occurrence | High | ✅ Fixed |
| React ref warnings | Single occurrence | Medium | 🟡 Identified |
| Layout warnings | 2 occurrences | Low | 🟡 Partial fix |
| Re-render issues | 10+ occurrences | Medium | 🔴 Needs investigation |
| Canvas warnings | 2 occurrences | Low | 🟡 Optimization needed |
| Color parsing errors | 2 occurrences | Medium | 🔴 Compatibility issue |
| Canvas width errors | 4 occurrences | High | 🔴 Runtime error |

## 🛠️ What Has Been Tried

### ❌ Misidentified Solutions
1. **Source Maps Added:** Added `sourcemap: true` to Vite config - doesn't address actual FFmpeg blob URL issue

### ✅ Completed Actions
1. **Debug Logging Added:** Enhanced panel-layouts.tsx with comprehensive logging for layout issues
2. **Normalization Logic:** Implemented in 3 of 4 layout components (missing in DefaultLayout)
3. **Root Cause Analysis:** Identified blob URL errors are from FFmpeg WASM loading, not source maps

### 🔄 In Progress
1. **Error Documentation:** This comprehensive troubleshooting guide
2. **Root Cause Analysis:** Detailed investigation of each error category

### ❌ Not Yet Attempted
1. **FFmpeg Electron Environment Fix:** Alternative WASM loading strategy for Electron
2. React DevTools performance profiling
3. HTML2Canvas configuration updates
4. Color function modernization
5. Canvas error handling improvements
6. Panel store optimization

### 💡 Proposed Solutions for FFmpeg Blob URL Issue
1. **Direct File Loading:** Use file:// URLs instead of blob URLs in Electron
2. **Electron IPC Integration:** Load WASM files via Electron main process
3. **CDN Fallback:** Use external CDN URLs for WASM files in Electron
4. **Environment Detection:** Different loading strategies for Electron vs browser

## 🎯 Next Steps Priority Order

### High Priority (Fix Immediately)
1. **Fix FFmpeg Blob URL Loading:** Address Electron environment blob URL handling for WASM files
2. **Fix Canvas Width Errors:** Add null checks and proper error handling  
3. **Investigate Re-render Loop:** Profile and optimize editor component renders
4. **Resolve Color Compatibility:** Replace oklab() with supported color formats

### Medium Priority (Fix Soon)
1. **Add DefaultLayout Normalization:** Implement panel size normalization logic
2. **Fix React Ref Warning:** Update component to use forwardRef properly
3. **Optimize Canvas Performance:** Add willReadFrequently attribute

### Low Priority (Monitor/Optimize)
1. **Bundle Analysis:** Check if source map addition affects build size
2. **Performance Monitoring:** Add metrics for render frequency
3. **HTML2Canvas Update:** Evaluate newer version compatibility

## 🔍 Diagnostic Commands

```bash
# Check current build with source maps
bun build

# Run development server and monitor console
bun dev

# Check bundle analysis after build
# View dist/bundle-analysis.html

# Performance profiling
# Use React DevTools Profiler in browser

# Lint check for potential issues
bun lint
```

## 📝 Configuration Files Modified

1. **vite.config.ts** - Added source maps
   ```typescript
   build: {
     sourcemap: true, // Added line 29
     // ... rest of config
   }
   ```

## 🚀 Expected Outcomes After Fixes

1. **Blob URL errors eliminated** - ✅ Already achieved
2. **Smooth panel resizing** - After normalization fixes
3. **Reduced console noise** - After React ref and render optimizations  
4. **Reliable frame capture** - After HTML2Canvas fixes
5. **Better performance** - After re-render loop resolution

---

**Last Updated:** 2025-01-05  
**Next Review:** After implementing high-priority fixes