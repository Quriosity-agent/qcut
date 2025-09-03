# Audio Export Integration Guide - 10-Minute Tasks

## Quick Reference
**Time Estimate**: 6 tasks × 10 minutes = 1 hour total
**Risk Level**: Low (non-breaking additions only)
**Dependencies**: None (memory management already complete)

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

## 10-Minute Implementation Tasks

### Task 1: Add Audio Toggle UI (10 minutes)
**File**: `apps/web/src/components/export-dialog.tsx`
**Risk**: None - UI addition only

```typescript
// After line 56 (caption export state):
const [includeAudio, setIncludeAudio] = useState<boolean>(true);

// After line 61 (hasCaptions check):
const hasAudio = tracks.some(
  (track) => track.type === "audio" && track.elements.length > 0
);

// In the render, after caption export section (around line 200):
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
```
**Test**: Open export dialog, verify checkbox appears when audio tracks exist

---

### Task 2: Create Audio Export Config Module (10 minutes)
**File**: Create `apps/web/src/lib/audio-export-config.ts`
**Risk**: None - New isolated file

```typescript
// Complete file content:
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

export const getAudioExportConfig = (): AudioExportConfig => ({
  ...audioConfig
});

// Auto-select codec based on format
export const getCodecForFormat = (format: string): 'aac' | 'opus' => {
  return format === 'webm' ? 'opus' : 'aac';
};
```
**Test**: Import and call `getAudioExportConfig()` in console

---

### Task 3: Extend Export Types (10 minutes)
**File**: `apps/web/src/types/export.ts`
**Risk**: None - Only adding new interfaces

```typescript
// ADD at the end of file:

// Audio export extension (non-breaking)
export interface AudioExportOptions {
  includeAudio?: boolean;
  audioCodec?: 'aac' | 'opus';
  audioBitrate?: number;
}

// Extended settings for audio-aware components
export interface ExportSettingsWithAudio extends ExportSettings, AudioExportOptions {}

// Helper to check if audio should be included
export const shouldIncludeAudio = (
  settings: ExportSettings | ExportSettingsWithAudio
): boolean => {
  if ('includeAudio' in settings) {
    return (settings as AudioExportOptions).includeAudio ?? true;
  }
  return true; // Default: include audio
};
```
**Test**: TypeScript compilation should pass

---

### Task 4: Add Audio Fields to Export Store (10 minutes)
**File**: `apps/web/src/stores/export-store.ts`
**Risk**: Low - Optional fields only

```typescript
// In ExportStore interface (around line 40), ADD:
// Audio settings (optional for backward compatibility)
audioEnabled?: boolean;
audioCodec?: 'aac' | 'opus';
audioBitrate?: number;
setAudioEnabled?: (enabled: boolean) => void;
setAudioCodec?: (codec: 'aac' | 'opus') => void;

// In store creation (around line 80), ADD:
audioEnabled: true,
audioCodec: 'aac',
audioBitrate: 128,
setAudioEnabled: (enabled) => set({ audioEnabled: enabled }),
setAudioCodec: (codec) => set({ audioCodec: codec }),
```
**Test**: Check store in React DevTools, verify audio fields exist

---

### Task 5: Create Basic Audio Mixer (10 minutes)
**File**: Create `apps/web/src/lib/audio-mixer.ts`
**Risk**: None - New isolated file

```typescript
// Basic Web Audio API mixer setup:
export interface AudioMixerOptions {
  sampleRate?: number;
  channels?: number;
}

export class AudioMixer {
  private audioContext: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  
  constructor(options: AudioMixerOptions = {}) {
    this.audioContext = new AudioContext({
      sampleRate: options.sampleRate || 44100
    });
    this.destination = this.audioContext.createMediaStreamDestination();
  }
  
  getStream(): MediaStream {
    return this.destination.stream;
  }
  
  async addAudioTrack(audioElement: HTMLAudioElement): Promise<void> {
    const source = this.audioContext.createMediaElementSource(audioElement);
    source.connect(this.destination);
  }
  
  dispose(): void {
    this.audioContext.close();
  }
}
```
**Test**: Create instance in console, verify no errors

---

### Task 6: Wire Audio Toggle to Export (10 minutes)
**File**: `apps/web/src/components/export-dialog.tsx`
**Risk**: Low - Pass-through parameter only

```typescript
// In handleExport function (around line 250), ADD to export params:
const exportParams = {
  ...existingParams,
  includeAudio: includeAudio, // Add this line
};

// If using export store, also update it:
import { getAudioExportConfig, setAudioExportConfig } from '@/lib/audio-export-config';

// Before export:
setAudioExportConfig({ enabled: includeAudio });
```
**Test**: Toggle checkbox, verify state is passed to export function

## Testing After Each Task

### Quick Validation (1 minute per task)
```bash
# After each task:
bun dev                    # Start dev server
# Open export dialog
# Verify no console errors
# Check existing export still works
```

### Final Integration Test (5 minutes)
After all 6 tasks:
1. Open project with audio tracks
2. Open export dialog
3. Verify audio checkbox appears
4. Toggle audio on/off
5. Export with default settings
6. Verify no errors in console

## Rollback if Needed
Each task is isolated. If any task causes issues:
```bash
git stash              # Save current work
git checkout -- .      # Revert changes
# Or selectively revert:
git checkout -- path/to/file.ts
```

## Summary

### Total Time: ~1 hour (6 tasks × 10 minutes)

### What Gets Done:
✅ Audio toggle in export dialog  
✅ Audio configuration module  
✅ Type extensions (non-breaking)  
✅ Export store audio fields  
✅ Basic audio mixer class  
✅ Wire up audio state  

### What's NOT Included (Future Tasks):
- Full Web Audio API implementation
- Audio stream integration with MediaRecorder
- Audio track loading and timing
- Export engine modifications
- Advanced audio effects

### Success Criteria:
- Existing export functionality unchanged
- Audio checkbox visible when audio tracks exist
- Audio state properly managed
- No TypeScript errors
- No console errors

## Next Steps After These Tasks
Once the basic infrastructure is in place:
1. Implement full audio mixing logic (30 min)
2. Integrate with MediaRecorder (30 min)
3. Test with real projects (30 min)
4. Performance optimization (as needed)