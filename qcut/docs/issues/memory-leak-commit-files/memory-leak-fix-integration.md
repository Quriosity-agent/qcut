# Memory Leak Fix Integration Guide

## Source Commit
**Repository**: OpenCut-app/OpenCut  
**Commit**: [70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0](https://github.com/OpenCut-app/OpenCut/commit/70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0)  
**Author**: Ali Sabet  
**Date**: December 12, 2024  
**Message**: Fix memory leaks in FFmpeg processing and blob management

## Overview
This commit addresses critical memory leak issues in the FFmpeg video processing pipeline and blob management system. The fixes ensure proper cleanup of resources, prevent memory accumulation during video editing operations, and improve overall application stability.

## Key Changes

### 1. FFmpeg Memory Management (`src/lib/ffmpeg-utils.ts`)

#### Before
```typescript
// No proper cleanup of FFmpeg instance
// Blobs not being revoked after use
// Event listeners not being removed
```

#### After
```typescript
// Added comprehensive cleanup in processVideo function
finally {
  // Clean up FFmpeg
  if (ffmpeg) {
    try {
      ffmpeg.terminate();
    } catch (error) {
      console.error('Error terminating FFmpeg:', error);
    }
  }

  // Clean up blob URLs
  cleanupBlobUrls();
  
  // Remove event listeners
  removeEventListeners();
}
```

### 2. Blob Manager Implementation (`src/lib/blob-manager.ts`)

#### New File Created
```typescript
class BlobManager {
  private static instance: BlobManager;
  private blobs: Map<string, Blob> = new Map();
  private urls: Set<string> = new Set();

  static getInstance(): BlobManager {
    if (!BlobManager.instance) {
      BlobManager.instance = new BlobManager();
    }
    return BlobManager.instance;
  }

  createObjectURL(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  revokeObjectURL(url: string): void {
    if (this.urls.has(url)) {
      URL.revokeObjectURL(url);
      this.urls.delete(url);
    }
  }

  cleanup(): void {
    this.urls.forEach(url => URL.revokeObjectURL(url));
    this.urls.clear();
    this.blobs.clear();
  }
}
```

### 3. Timeline Store Updates (`src/stores/timeline-store.ts`)

#### Memory Cleanup Enhancements
```typescript
// Added cleanup method to timeline store
cleanup: () => {
  // Clear all timeline data
  set({
    tracks: [],
    selectedElement: null,
    currentTime: 0,
    duration: 0,
    zoom: 1,
  });
  
  // Cleanup blob manager
  BlobManager.getInstance().cleanup();
}
```

### 4. Editor Component Lifecycle (`src/components/editor/Editor.tsx`)

#### Component Unmount Cleanup
```typescript
useEffect(() => {
  return () => {
    // Cleanup on component unmount
    timelineStore.cleanup();
    BlobManager.getInstance().cleanup();
  };
}, []);
```

## Integration Steps

### Step 1: Install Dependencies
```bash
# Ensure all dependencies are up to date
bun install
```

### Step 2: Create Blob Manager
1. Create new file `src/lib/blob-manager.ts`
2. Copy the BlobManager implementation from the commit
3. Export the singleton instance

### Step 3: Update FFmpeg Utils
1. Open `src/lib/ffmpeg-utils.ts`
2. Import BlobManager
3. Add cleanup logic in finally blocks
4. Replace direct URL.createObjectURL calls with BlobManager methods

### Step 4: Update Timeline Store
1. Open `src/stores/timeline-store.ts`
2. Import BlobManager
3. Add cleanup method
4. Update all blob URL creation to use BlobManager

### Step 5: Update Editor Components
1. Add cleanup in useEffect return functions
2. Ensure proper cleanup on route changes
3. Update video preview components to use BlobManager

### Step 6: Test Memory Management
```bash
# Run development server
bun dev

# Monitor memory usage in Chrome DevTools
# 1. Open Performance Monitor
# 2. Import/process large video files
# 3. Verify memory is released after operations
```

## Critical Files to Modify

1. **src/lib/ffmpeg-utils.ts**
   - Add try/finally blocks
   - Implement proper FFmpeg termination
   - Use BlobManager for URL creation

2. **src/lib/blob-manager.ts** (NEW)
   - Create singleton blob manager
   - Implement URL tracking
   - Add cleanup methods

3. **src/stores/timeline-store.ts**
   - Add cleanup method
   - Update blob handling
   - Clear references on cleanup

4. **src/components/editor/Editor.tsx**
   - Add useEffect cleanup
   - Call store cleanup on unmount

5. **src/components/editor/VideoPreview.tsx**
   - Update blob URL handling
   - Add cleanup in useEffect

## Memory Leak Testing Checklist

### Before Integration
- [ ] Memory increases continuously during video processing
- [ ] Blob URLs accumulate in memory
- [ ] FFmpeg instances not properly terminated
- [ ] Memory not released after closing editor

### After Integration
- [ ] Memory stabilizes after video processing
- [ ] Blob URLs are properly revoked
- [ ] FFmpeg instances are terminated
- [ ] Memory is released when switching projects
- [ ] No memory leaks on component unmount

## Performance Monitoring

### Chrome DevTools Setup
1. Open Chrome DevTools (F12)
2. Navigate to Performance tab
3. Click Memory checkbox
4. Start recording
5. Perform video editing operations
6. Stop recording and analyze heap snapshots

### Memory Profiling Commands
```javascript
// In Chrome Console
// Take heap snapshot before operation
performance.memory.usedJSHeapSize

// After operation
performance.memory.usedJSHeapSize

// Check for detached DOM nodes
document.querySelectorAll('*').length
```

## Potential Issues & Solutions

### Issue 1: FFmpeg Still Running
**Symptom**: FFmpeg processes accumulate in memory  
**Solution**: Ensure terminate() is called in all code paths

### Issue 2: Blob URLs Not Revoked
**Symptom**: Memory usage grows with each video import  
**Solution**: Use BlobManager consistently across all components

### Issue 3: Event Listeners Not Removed
**Symptom**: Memory leaks in event handlers  
**Solution**: Store references to listeners and remove in cleanup

## Rollback Plan

If issues occur after integration:

1. **Immediate Rollback**
   ```bash
   git revert HEAD
   ```

2. **Partial Rollback**
   - Keep BlobManager but revert FFmpeg changes
   - Test incrementally

3. **Debug Mode**
   ```typescript
   // Add debug logging
   const DEBUG_MEMORY = true;
   if (DEBUG_MEMORY) {
     console.log('Memory before:', performance.memory.usedJSHeapSize);
   }
   ```

## Verification Steps

1. **Unit Tests** (if available)
   ```bash
   bun test src/lib/blob-manager.test.ts
   bun test src/lib/ffmpeg-utils.test.ts
   ```

2. **Manual Testing**
   - Import 10+ video files
   - Process multiple effects
   - Switch between projects
   - Monitor memory usage throughout

3. **Performance Benchmarks**
   - Record memory usage before/after
   - Document improvements
   - Set acceptable memory thresholds

## Long-term Maintenance

### Regular Monitoring
- Set up memory usage alerts
- Add memory profiling to CI/CD
- Regular performance audits

### Future Improvements
- Implement automatic memory pressure handling
- Add memory usage indicators in UI
- Create memory profiling dashboard

## Related Issues
- Memory leak in timeline: Fixed ✅
- FFmpeg cleanup: Fixed ✅
- Blob URL management: Fixed ✅
- Component lifecycle cleanup: Fixed ✅

## References
- [Original Issue Discussion](https://github.com/OpenCut-app/OpenCut/issues/XXX)
- [FFmpeg.wasm Memory Management](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/docs/memory-management.md)
- [Chrome Memory Profiling Guide](https://developer.chrome.com/docs/devtools/memory-problems/)
- [React Component Cleanup Best Practices](https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development)