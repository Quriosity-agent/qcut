# Complete Audio Export Integration Guide (Non-Breaking)

## Source Commit
**Repository**: OpenCut-app/OpenCut  
**Commit**: [70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0](https://github.com/OpenCut-app/OpenCut/commit/70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0)  
**Author**: Ali Sabet  
**Date**: December 12, 2024  
**Message**: Add audio export functionality

## ✅ Current Implementation Status

### Already Implemented in Our Codebase:
1. **BlobManager** ✅ - Complete implementation at `apps/web/src/lib/blob-manager.ts`
   - Automatic cleanup of blob URLs
   - Memory leak prevention
   - Auto-cleanup timer (5 minutes)
   - Debug utilities

2. **FFmpeg Cleanup** ✅ - Implemented in `apps/web/src/lib/ffmpeg-utils.ts`
   - Proper terminate() calls
   - Cleanup timer after inactivity
   - Try/finally blocks for resource cleanup

3. **Audio Export Documentation** ✅ - Analysis at `docs/completed/audio_export.md`
   - Web Audio API approach (recommended)
   - FFmpeg command line approach
   - Technical considerations documented

### NOT Yet Implemented:
1. **Audio Export UI** ❌ - No includeAudio toggle in export dialog
2. **Audio Mixing Pipeline** ❌ - No Web Audio API mixing implementation
3. **Audio in Export Engines** ❌ - Export engines don't handle audio tracks

## ⚠️ Important: Existing System Compatibility
Our codebase already has:
- ExportSettings interface with different structure (uses "1080p"/"720p"/"480p" not "high"/"medium"/"low")
- ExportStore managing export state
- Multiple export engines (FFmpeg, CLI, Optimized)
- Export presets for various platforms
- Memory management already in place

## What's Already Implemented (No Action Needed)

### ✅ Memory Management - ALREADY COMPLETE

#### BlobManager (`apps/web/src/lib/blob-manager.ts`)
Our implementation is MORE ADVANCED than the commit's version:
- ✅ Singleton pattern with global instance
- ✅ Automatic cleanup timer (5 minutes)
- ✅ Old blob cleanup (10 minutes max age)
- ✅ Debug utilities and statistics
- ✅ Source tracking for debugging

```typescript
// Already implemented - no changes needed
import { createObjectURL, revokeObjectURL } from "@/lib/blob-manager";
```

#### FFmpeg Cleanup (`apps/web/src/lib/ffmpeg-utils.ts`)
Already includes comprehensive cleanup:
- ✅ `terminateFFmpeg()` function implemented
- ✅ Cleanup timer after inactivity
- ✅ Try/finally blocks in processing functions
- ✅ Proper resource management

```typescript
// Already implemented
export const terminateFFmpeg = async (): Promise<void> => {
  if (ffmpeg) {
    if (typeof ffmpeg.terminate === 'function') {
      await ffmpeg.terminate();
    }
  }
  // ... cleanup logic
};
```

### ⚠️ Memory Testing Verification (Optional)
Since memory management is already implemented, testing is optional but recommended:

#### Chrome DevTools Memory Profiling
```javascript
// Check current implementation effectiveness
performance.memory.usedJSHeapSize
// Run video operations
// Check again
performance.memory.usedJSHeapSize

// Debug blob usage (DEV only)
window.debugBlobs(); // Shows active blobs and stats
```

## Part 2: Audio Export Feature (TO BE IMPLEMENTED)

### ⚠️ Current Status - CONFIRMED
- **Export Dialog**: Exists at `apps/web/src/components/export-dialog.tsx` ✅
  - Has caption export options with formats (SRT, VTT, ASS, TTML)
  - NO audio export options currently ❌
- **Audio Toggle UI**: Missing - needs to be added ❌
  - Commit adds `includeAudio` checkbox in PropertyGroup
  - Uses `DEFAULT_EXPORT_OPTIONS.includeAudio || true`
- **Audio Mixing**: No Web Audio API implementation ❌
- **Export Engines**: Don't handle audio tracks ❌
- **Documentation**: Web Audio API approach documented ✅

### Recommended Implementation Approach
Based on `docs/completed/audio_export.md`, use Web Audio API (Option A):
- ✅ Works in browser and Electron
- ✅ No external dependencies
- ✅ WYSIWYG - preview matches export
- ⚠️ Real-time export speed
- ⚠️ Limited to WebM/Opus in Chrome

### Key Features to Add
1. **Audio Export Toggle**: UI checkbox to include/exclude audio
2. **Audio Mixing Pipeline**: Web Audio API for multiple tracks
3. **Format-Specific Codecs**: AAC for MP4, Opus for WebM

### Implementation Details

#### 1. Export Dialog UI Update (`apps/web/src/components/export-dialog.tsx`)

**Note**: The commit references `export-button.tsx` but our codebase uses `export-dialog.tsx`. The audio UI needs to be added to the existing export dialog, NOT creating a new export button.

```typescript
// In export-dialog.tsx, after caption export state (around line 56):
const [includeAudio, setIncludeAudio] = useState<boolean>(true);

// Check if there are audio tracks available (similar to caption check)
const hasAudio = tracks.some(
  (track) => track.type === "audio" && track.elements.length > 0
);

// Add to the dialog UI, after caption export section:
{hasAudio && (
  <div className="space-y-4 mt-4">
    <div className="flex items-center space-x-2">
      <Checkbox
        id="include-audio"
        checked={includeAudio}
        onCheckedChange={(checked) => setIncludeAudio(!!checked)}
      />
      <Label htmlFor="include-audio">
        Include audio in export
      </Label>
    </div>
  </div>
)}

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

#### 3. Type Updates - BACKWARD COMPATIBLE APPROACH

**DO NOT MODIFY** the existing `ExportSettings` interface in `apps/web/src/types/export.ts`

Instead, **EXTEND** the existing types:

```typescript
// In apps/web/src/types/export.ts - ADD to existing file, don't replace

// Audio export extension interface
export interface AudioExportOptions {
  includeAudio?: boolean;
  audioCodec?: 'aac' | 'opus' | 'mp3';
  audioBitrate?: number; // in kbps
}

// Extended export settings for audio support
export interface ExportSettingsWithAudio extends ExportSettings, AudioExportOptions {}

// Helper function to check if audio is requested
export const shouldIncludeAudio = (settings: ExportSettings | ExportSettingsWithAudio): boolean => {
  if ('includeAudio' in settings) {
    return (settings as ExportSettingsWithAudio).includeAudio ?? true;
  }
  return true; // Default to include audio for backward compatibility
};

// Default audio options
export const DEFAULT_AUDIO_OPTIONS: AudioExportOptions = {
  includeAudio: true,
  audioCodec: 'aac',
  audioBitrate: 128,
};
```

## Safe Integration Strategy

### ⚠️ Current System Analysis
Before integration, understand our existing system:

1. **Export Types** (`apps/web/src/types/export.ts`):
   - Uses `ExportSettings` with format, quality, filename, width, height
   - Quality values: "1080p", "720p", "480p" (NOT "high", "medium", "low")
   - Formats: "webm", "mp4", "mov"

2. **Export Store** (`apps/web/src/stores/export-store.ts`):
   - Manages dialog state, settings, progress, history
   - No audio-related fields

3. **Export Engines**:
   - Multiple engines: FFmpeg, CLI, Optimized
   - Located in `apps/web/src/lib/export-engine-*.ts`

### Phase 0: Non-Breaking Audio Extension Preparation

1. **Create Audio Export Extension Module**
   ```bash
   # Create new file for audio extensions
   touch apps/web/src/lib/audio-export-extension.ts
   ```

2. **Implement Audio Extension (NEW FILE)**:
   ```typescript
   // apps/web/src/lib/audio-export-extension.ts
   import { ExportSettings } from '@/types/export';
   
   export interface AudioExportConfig {
     enabled: boolean;
     codec?: 'aac' | 'opus';
     bitrate?: number;
   }
   
   // Store audio config separately to avoid breaking changes
   let audioExportConfig: AudioExportConfig = {
     enabled: true,
     codec: 'aac',
     bitrate: 128,
   };
   
   export const setAudioExportConfig = (config: Partial<AudioExportConfig>) => {
     audioExportConfig = { ...audioExportConfig, ...config };
   };
   
   export const getAudioExportConfig = (): AudioExportConfig => {
     return { ...audioExportConfig };
   };
   
   // Check if we should include audio based on format
   export const shouldIncludeAudioForFormat = (format: string): boolean => {
     if (!audioExportConfig.enabled) return false;
     
     // All our formats support audio
     return ['mp4', 'webm', 'mov'].includes(format);
   };
   ```

3. **Update Export Store (ADDITIVE ONLY)**:
   ```typescript
   // In apps/web/src/stores/export-store.ts - ADD these fields
   
   interface ExportStore {
     // ... existing fields ...
     
     // Audio export settings (new)
     audioEnabled?: boolean;
     audioCodec?: 'aac' | 'opus';
     audioBitrate?: number;
     
     // Audio actions (new)
     setAudioEnabled?: (enabled: boolean) => void;
     setAudioSettings?: (codec: 'aac' | 'opus', bitrate: number) => void;
   }
   
   // In the store implementation, add:
   audioEnabled: true,
   audioCodec: 'aac',
   audioBitrate: 128,
   
   setAudioEnabled: (enabled) => set({ audioEnabled: enabled }),
   setAudioSettings: (codec, bitrate) => set({ audioCodec: codec, audioBitrate: bitrate }),
   ```

## Implementation Summary

### ✅ What You DON'T Need to Do:
1. **Memory Management** - Already implemented with BlobManager
2. **FFmpeg Cleanup** - Already has terminate() and cleanup timers
3. **Create New Export Button** - Use existing export-dialog.tsx
4. **Change Export Types Structure** - Keep existing "1080p"/"720p"/"480p" quality values

### ❌ What You NEED to Implement:
1. **Audio UI Toggle** in export-dialog.tsx
2. **Web Audio API Mixing** for combining audio tracks
3. **Audio Stream Integration** in export engines
4. **Audio Config Extension** without breaking existing types

## Implementation Steps (Only What's Needed)

### ✅ Phase 1: Memory Management - SKIP (Already Complete)
No action needed - BlobManager and FFmpeg cleanup already implemented.

### 🚧 Phase 2: Audio Export Feature - TO IMPLEMENT

#### Step 1: Create Audio Extension Module
```bash
# Create new file for audio without breaking existing code
touch apps/web/src/lib/audio-export-extension.ts
```

```typescript
// apps/web/src/lib/audio-export-extension.ts
export interface AudioExportConfig {
  enabled: boolean;
  codec?: 'aac' | 'opus';
  bitrate?: number;
}

let audioConfig: AudioExportConfig = {
  enabled: true,
  codec: 'aac',
  bitrate: 128,
};

export const setAudioExportConfig = (config: Partial<AudioExportConfig>) => {
  audioConfig = { ...audioConfig, ...config };
};

export const getAudioExportConfig = (): AudioExportConfig => audioConfig;
```

#### Step 2: Extend Export Types (Don't Modify Existing)
```typescript
// ADD to apps/web/src/types/export.ts - don't replace existing

// Audio export extension
export interface AudioExportOptions {
  includeAudio?: boolean;
  audioCodec?: 'aac' | 'opus';
  audioBitrate?: number;
}

// Extended settings for components that support audio
export interface ExportSettingsWithAudio extends ExportSettings, AudioExportOptions {}
```

#### Step 3: Update Export Store (Additive Only)
```typescript
// In export-store.ts, ADD these optional fields to interface:
audioEnabled?: boolean;
setAudioEnabled?: (enabled: boolean) => void;

// In implementation, ADD:
audioEnabled: true,
setAudioEnabled: (enabled) => set({ audioEnabled: enabled }),
```

#### Step 4: Implement Web Audio Mixing
Based on our existing documentation (`docs/completed/audio_export.md`):

```typescript
// apps/web/src/lib/audio-mixer.ts
export async function mixTimelineAudio(
  tracks: any[],
  duration: number
): Promise<MediaStream | null> {
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  
  // Mix audio tracks using Web Audio API
  for (const track of tracks) {
    if (track.type === 'audio' && !track.muted) {
      // Load and connect audio sources
      // ... implementation from audio_export.md
    }
  }
  
  return destination.stream;
}
```

#### Step 5: Test Without Breaking Existing Features
```bash
# Test existing export first
bun dev
# Export without audio changes - must work

# Then test with audio
# Enable feature flag if using one
VITE_ENABLE_AUDIO_EXPORT=true bun dev
```

## Backward Compatibility Checklist

### Existing Features Must Continue Working
- [ ] All existing export presets still function
- [ ] Export dialog opens without errors
- [ ] Quality settings ("1080p", "720p", "480p") work correctly
- [ ] Format selection (WebM, MP4, MOV) unchanged
- [ ] Export history tracking still works
- [ ] Progress reporting remains accurate
- [ ] Filename generation works as before
- [ ] Export engines (FFmpeg, CLI, Optimized) not broken

### New Audio Features (Optional Enhancement)
- [ ] Audio toggle only appears if audio tracks exist
- [ ] Default behavior includes audio (backward compatible)
- [ ] Audio can be disabled without affecting video export
- [ ] Audio codec auto-selected based on format
- [ ] No errors if audio processing fails (graceful fallback)

## Testing Checklist

### Regression Testing (Critical)
1. **Test WITHOUT Audio Changes First**
   - [ ] Export a video using existing UI
   - [ ] Verify all formats work
   - [ ] Check all quality presets
   - [ ] Confirm file sizes are reasonable

2. **Test WITH Audio Features**
   - [ ] Audio toggle appears in export dialog
   - [ ] Export works with audio included/excluded
   - [ ] Audio syncs properly with video
   - [ ] Multiple audio tracks mix correctly
   - [ ] MP4 exports with AAC audio
   - [ ] WebM exports with Opus audio

### Memory Management
- [ ] Memory stabilizes after video processing
- [ ] Blob URLs are properly revoked
- [ ] FFmpeg instances are terminated
- [ ] No memory leaks on component unmount
- [ ] Memory released when switching projects

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

## Migration Path & Rollback Plan

### Phased Rollout Strategy

#### Phase 1: Memory Improvements Only (Low Risk)
- Implement BlobManager
- Add cleanup methods
- Test thoroughly
- Deploy if stable

#### Phase 2: Audio Infrastructure (Medium Risk)
- Add audio extension module
- Update types with extensions (not modifications)
- Deploy behind feature flag

#### Phase 3: UI Integration (Low Risk)
- Add audio toggle UI
- Connect to audio extension
- Test with users
- Full rollout

### Feature Flag Implementation
```typescript
// apps/web/src/lib/feature-flags.ts
export const FEATURES = {
  AUDIO_EXPORT: process.env.VITE_ENABLE_AUDIO_EXPORT === 'true',
  MEMORY_OPTIMIZATION: true, // Always on after testing
};

// Usage in components
import { FEATURES } from '@/lib/feature-flags';

if (FEATURES.AUDIO_EXPORT) {
  // Show audio options
}
```

### Rollback Plan

If issues occur at any phase:

1. **Phase-Specific Rollback**
   ```bash
   # Rollback only the problematic phase
   git revert <commit-hash>
   ```

2. **Feature Flag Disable**
   ```bash
   # Disable in .env
   VITE_ENABLE_AUDIO_EXPORT=false
   ```

3. **Emergency Hotfix**
   ```typescript
   // Quick disable in code
   const AUDIO_EXPORT_ENABLED = false; // Emergency kill switch
   ```

4. **Debug Mode**
   ```typescript
   const DEBUG = {
     MEMORY: true,
     AUDIO: true,
     EXPORT: true,
   };
   
   if (DEBUG.MEMORY) {
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