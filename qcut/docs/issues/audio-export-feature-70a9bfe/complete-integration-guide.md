# Complete Audio Export & Memory Management Integration Guide

## Source Commit
**Repository**: OpenCut-app/OpenCut  
**Commit**: [70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0](https://github.com/OpenCut-app/OpenCut/commit/70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0)  
**Author**: Ali Sabet  
**Date**: December 12, 2024  
**Message**: Fix memory leaks in FFmpeg processing and blob management + Audio export functionality

## Overview
This commit implements two critical improvements to the OpenCut video editor:
1. **Memory Leak Fixes**: Comprehensive cleanup of FFmpeg processing and blob management
2. **Audio Export Feature**: Complete audio export functionality with mixing and codec support

## Part 1: Memory Leak Fixes

### Critical Issues Addressed
- FFmpeg instances not being properly terminated
- Blob URLs accumulating in memory
- Event listeners not being removed
- Memory not released after operations

### Key Changes

#### 1. FFmpeg Memory Management (`src/lib/ffmpeg-utils.ts`)

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

#### 2. Blob Manager Implementation (`src/lib/blob-manager.ts`)

**New File - Create this singleton manager:**

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

export default BlobManager;
```

#### 3. Timeline Store Updates (`src/stores/timeline-store.ts`)

```typescript
// Add cleanup method to timeline store
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

#### 4. Editor Component Lifecycle (`src/components/editor/Editor.tsx`)

```typescript
useEffect(() => {
  return () => {
    // Cleanup on component unmount
    timelineStore.cleanup();
    BlobManager.getInstance().cleanup();
  };
}, []);
```

### Memory Testing Verification

#### Chrome DevTools Setup
1. Open Chrome DevTools (F12)
2. Navigate to Performance tab
3. Click Memory checkbox
4. Start recording
5. Perform video editing operations
6. Stop recording and analyze heap snapshots

#### Memory Profiling Commands
```javascript
// In Chrome Console
// Take heap snapshot before operation
performance.memory.usedJSHeapSize

// After operation
performance.memory.usedJSHeapSize

// Check for detached DOM nodes
document.querySelectorAll('*').length
```

## Part 2: Audio Export Feature

### Key Features
1. **Audio Export Toggle**: UI checkbox to include/exclude audio
2. **Audio Mixing Pipeline**: Handles multiple tracks with timing
3. **Format-Specific Codecs**: AAC for MP4, Opus for WebM

### Implementation Details

#### 1. Export Button UI (`apps/web/src/components/editor/export-button.tsx`)

```typescript
// Add audio toggle state
const [includeAudio, setIncludeAudio] = useState<boolean>(
  DEFAULT_EXPORT_OPTIONS.includeAudio || true
);

// Add to export dialog UI
<PropertyGroup title="Audio">
  <Checkbox
    id="include-audio"
    checked={includeAudio}
    onCheckedChange={(checked) => setIncludeAudio(!!checked)}
  />
  <Label htmlFor="include-audio">
    Include audio in export
  </Label>
</PropertyGroup>

// Pass to export function
await exportTimeline({
  ...otherOptions,
  includeAudio,
});
```

#### 2. Audio Processing (`apps/web/src/lib/export.ts`)

**Add Audio Element Interface:**
```typescript
interface AudioElement {
  buffer: AudioBuffer;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  muted: boolean;
}
```

**Add Timeline Audio Buffer Creation:**
```typescript
async function createTimelineAudioBuffer(
  tracks: any[],
  mediaFiles: any[],
  duration: number,
  sampleRate: number = 44100
): Promise<AudioBuffer | null> {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioElements: AudioElement[] = [];

  // Collect all audio elements
  for (const track of tracks) {
    if (track.type !== 'audio' || track.muted) continue;
    
    for (const element of track.elements) {
      if (element.muted) continue;
      
      const mediaFile = mediaFiles.find(f => f.id === element.mediaFileId);
      if (!mediaFile?.audioBuffer) continue;

      audioElements.push({
        buffer: mediaFile.audioBuffer,
        startTime: element.startTime,
        duration: element.duration,
        trimStart: element.trimStart || 0,
        trimEnd: element.trimEnd || element.duration,
        muted: element.muted || false,
      });
    }
  }

  if (audioElements.length === 0) return null;

  // Create output buffer
  const outputSampleRate = sampleRate;
  const outputLength = Math.ceil(duration * outputSampleRate);
  const outputBuffer = audioContext.createBuffer(2, outputLength, outputSampleRate);

  // Mix all audio elements
  for (const element of audioElements) {
    if (element.muted) continue;

    const startSample = Math.floor(element.startTime * outputSampleRate);
    const trimStartSample = Math.floor(element.trimStart * outputSampleRate);
    const trimEndSample = Math.floor(element.trimEnd * outputSampleRate);
    
    // Copy and mix audio data
    for (let channel = 0; channel < 2; channel++) {
      const inputData = element.buffer.getChannelData(Math.min(channel, element.buffer.numberOfChannels - 1));
      const outputData = outputBuffer.getChannelData(channel);
      
      for (let i = trimStartSample; i < trimEndSample && i < inputData.length; i++) {
        const outputIndex = startSample + (i - trimStartSample);
        if (outputIndex < outputData.length) {
          outputData[outputIndex] += inputData[i];
        }
      }
    }
  }

  // Normalize to prevent clipping
  for (let channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
    const data = outputBuffer.getChannelData(channel);
    let max = 0;
    
    for (let i = 0; i < data.length; i++) {
      max = Math.max(max, Math.abs(data[i]));
    }
    
    if (max > 1) {
      const scale = 0.95 / max;
      for (let i = 0; i < data.length; i++) {
        data[i] *= scale;
      }
    }
  }

  return outputBuffer;
}
```

**Integrate into Export Pipeline:**
```typescript
// In exportTimeline function
if (includeAudio) {
  const audioBuffer = await createTimelineAudioBuffer(
    tracks,
    mediaFiles,
    duration
  );

  if (audioBuffer) {
    const audioSource = new AudioBufferSource({
      codec: format === "webm" ? "opus" : "aac",
      bitrate: qualityMap[quality],
    });
    output.addAudioTrack(audioSource);
    
    // Feed audio frames
    for (let frame = 0; frame < totalFrames; frame++) {
      const time = frame / fps;
      audioSource.writeFrame(audioBuffer, time);
    }
  }
}
```

#### 3. Type Updates (`apps/web/src/types/export.ts`)

```typescript
export interface ExportOptions {
  format: ExportFormat;
  quality: ExportQuality;
  fps?: number;
  includeAudio?: boolean;  // Add this field
  onProgress?: (progress: number) => void;
  onCancel?: () => boolean;
}

export const DEFAULT_EXPORT_OPTIONS: Partial<ExportOptions> = {
  format: 'mp4',
  quality: 'high',
  fps: 30,
  includeAudio: true,  // Default to include audio
};
```

## Complete Integration Steps

### Phase 1: Memory Management (Priority)

1. **Create Blob Manager**
   ```bash
   # Create new file
   touch apps/web/src/lib/blob-manager.ts
   # Add the BlobManager class code above
   ```

2. **Update FFmpeg Utils**
   - Open `apps/web/src/lib/ffmpeg-utils.ts`
   - Import BlobManager
   - Add try/finally blocks with cleanup
   - Replace `URL.createObjectURL` with `BlobManager.getInstance().createObjectURL`

3. **Update Timeline Store**
   - Open `apps/web/src/stores/timeline-store.ts`
   - Add cleanup method
   - Import and use BlobManager

4. **Update Editor Components**
   - Add cleanup in useEffect returns
   - Ensure proper unmount handling

### Phase 2: Audio Export Feature

1. **Update Dependencies**
   ```bash
   bun add mediabunny@latest
   ```

2. **Update Export UI**
   - Modify `export-button.tsx` with audio toggle
   - Ensure UI components are available

3. **Implement Audio Processing**
   - Add audio processing functions to `export.ts`
   - Update export pipeline
   - Add type definitions

4. **Test Audio Export**
   - Test with various audio formats
   - Verify sync with video
   - Check different quality settings

## Testing Checklist

### Memory Management
- [ ] Memory stabilizes after video processing
- [ ] Blob URLs are properly revoked
- [ ] FFmpeg instances are terminated
- [ ] No memory leaks on component unmount
- [ ] Memory released when switching projects

### Audio Export
- [ ] Audio toggle appears in export dialog
- [ ] Export works with audio included/excluded
- [ ] Audio syncs properly with video
- [ ] Multiple audio tracks mix correctly
- [ ] MP4 exports with AAC audio
- [ ] WebM exports with Opus audio

### Performance
- [ ] Export time reasonable (< 2x video duration)
- [ ] Memory usage stays under 2GB for typical projects
- [ ] No browser crashes or freezes
- [ ] Progress indicator accurate

## Verification Commands

```bash
# Run development server
bun dev

# Check for TypeScript errors
bun check-types

# Run linting
bun lint:clean

# Build for production
bun build

# Test Electron app
bun run electron:dev
```

## Rollback Plan

If issues occur:

1. **Immediate Rollback**
   ```bash
   git revert HEAD
   ```

2. **Partial Integration**
   - Implement memory fixes first (critical)
   - Add audio export as separate feature

3. **Debug Mode**
   ```typescript
   const DEBUG_MEMORY = true;
   const DEBUG_AUDIO = true;
   
   if (DEBUG_MEMORY) {
     console.log('Memory:', performance.memory.usedJSHeapSize);
   }
   ```

## Known Issues & Solutions

### Issue: FFmpeg Still Running
**Solution**: Ensure terminate() called in all code paths

### Issue: Audio Out of Sync
**Solution**: Verify frame rate matches project settings

### Issue: Export Fails with Audio
**Solution**: Check available memory, reduce project size

### Issue: Blob URLs Not Revoked
**Solution**: Use BlobManager consistently across all components

## Browser Compatibility

### Required APIs
- Web Audio API
- AudioContext or webkitAudioContext
- ArrayBuffer support
- Blob URL support
- FFmpeg WebAssembly

### Tested Browsers
- Chrome 90+ ✅
- Firefox 88+ ✅
- Edge 90+ ✅
- Safari 14+ (limited testing)

## Long-term Maintenance

### Regular Monitoring
- Set up memory usage alerts
- Add memory profiling to CI/CD
- Regular performance audits

### Future Improvements
- Implement streaming audio processing
- Add multi-channel audio support
- Create memory usage dashboard
- Add real-time audio preview
- Implement audio effects during export

## References
- [Original Commit](https://github.com/OpenCut-app/OpenCut/commit/70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0)
- [FFmpeg.wasm Memory Management](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/docs/memory-management.md)
- [Chrome Memory Profiling Guide](https://developer.chrome.com/docs/devtools/memory-problems/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MediaBunny Documentation](https://github.com/mediabunny/docs)