# Sound Export Issue Investigation

**Issue:** When exporting a video with a sound track, the audio is not properly included in the exported video.

**Date:** 2025-08-22
**Version:** 0.2.5

## Investigation Log

### 1. Export Engines Available
The application has three export engines:
- Standard MediaRecorder (browser API)
- FFmpeg WASM (WebAssembly)
- Native FFmpeg CLI (Electron only)

### 2. Key Files to Investigate
- `src/lib/export-engine.ts` - Base export engine
- `src/lib/export-engine-factory.ts` - Export engine factory
- `src/lib/export-engine-ffmpeg.ts` - FFmpeg WASM engine
- `src/lib/export-engine-cli.ts` - Native FFmpeg CLI engine
- `src/lib/export-engine-optimized.ts` - Optimized export engine
- `src/lib/webcodecs-export-engine.ts` - WebCodecs engine
- `src/components/export-canvas.tsx` - Canvas rendering for export
- `src/stores/timeline-store.ts` - Timeline state with audio elements
- `src/stores/sounds-store.ts` - Sound/audio store

### 3. Initial Findings

#### Audio Element Types
The timeline can contain different types of audio:
- Media files with audio tracks (videos with sound)
- Standalone audio files (MP3, WAV, etc.)
- Sound effects from the sounds library

#### Export Process Overview
1. Canvas captures video frames
2. Audio should be mixed from all audio sources
3. Video and audio should be muxed together

### 4. Potential Issues to Check

#### A. Audio Context Not Being Captured
- [ ] Check if Web Audio API context is being used
- [ ] Verify audio streams are being added to MediaRecorder
- [ ] Check if audio tracks are being included in export

#### B. Audio Mixing Issues
- [ ] Multiple audio tracks may not be mixed properly
- [ ] Audio timing/synchronization issues
- [ ] Volume levels not being applied

#### C. Engine-Specific Issues
- [ ] MediaRecorder may not capture audio from canvas
- [ ] FFmpeg command may be missing audio parameters
- [ ] WebCodecs may not handle audio properly

### 5. Code Analysis

#### Export Canvas (export-canvas.tsx)
- **FINDING**: The export canvas is a hidden HTML canvas element used only for visual rendering
- **ISSUE**: No audio handling whatsoever - it's purely visual
- The canvas dimensions are set based on export settings
- Canvas is hidden off-screen during export

#### Export Engine (export-engine.ts)
- **FINDING**: Uses `canvas.captureStream(0)` to capture video frames
- **ISSUE**: Only captures video track, no audio tracks are added
- Line 537: `const stream = existingStream || this.canvas.captureStream(0);`
- Line 674: Gets video tracks only: `videoTrack = stream.getVideoTracks()[0];`
- No code to handle audio tracks or mix audio sources

#### Timeline Store (timeline-store.ts)
- Supports audio track type: `type === "audio"`
- Has `separateAudio` function for audio track separation
- Audio elements exist in timeline but aren't processed during export

### 6. ROOT CAUSE IDENTIFIED

**The export process only captures the visual canvas and completely ignores audio tracks.**

The current export flow:
1. ✅ Visual elements are rendered to canvas
2. ✅ Canvas frames are captured via `captureStream()`
3. ❌ Audio tracks from timeline are NOT processed
4. ❌ No audio mixing or synchronization
5. ❌ MediaRecorder/FFmpeg only receives video stream

### 7. Required Fix

To properly export audio, we need to:

1. **Create an Audio Context**
   - Initialize Web Audio API context
   - Create destination node for mixing

2. **Collect Audio Sources**
   - Get all audio elements from timeline
   - Load audio files/media with audio tracks
   - Create audio source nodes for each

3. **Mix Audio Tracks**
   - Connect all sources to audio context
   - Apply volume levels from timeline
   - Handle timing/synchronization

4. **Combine Audio with Video**
   - Add audio track to MediaStream
   - Ensure video/audio sync
   - Pass combined stream to export engine

### 8. Implementation Approach

#### Option A: Web Audio API Mixing (Recommended)
```javascript
// Create audio context and destination
const audioContext = new AudioContext();
const audioDestination = audioContext.createMediaStreamDestination();

// For each audio element in timeline
audioElements.forEach(element => {
  const source = audioContext.createBufferSource();
  // Load and connect audio
  source.connect(audioDestination);
  source.start(element.startTime);
});

// Combine with video stream
const videoStream = canvas.captureStream();
const audioTrack = audioDestination.stream.getAudioTracks()[0];
videoStream.addTrack(audioTrack);

// Use combined stream for export
mediaRecorder = new MediaRecorder(videoStream);
```

#### Option B: FFmpeg Command Line (Electron only)
- Pass audio file paths to FFmpeg
- Use FFmpeg's audio mixing capabilities
- More complex but more powerful

#### Option C: Silent Audio Track (Quick Fix)
- Add a silent audio track to ensure audio channel exists
- Won't include actual audio but prevents "no audio" issues

### 9. Files That Need Modification

1. **export-engine.ts**
   - Add audio context initialization
   - Modify stream creation to include audio
   - Handle audio/video synchronization

2. **export-canvas.tsx** or new **export-audio-mixer.ts**
   - Create audio mixing component
   - Handle audio loading and timing

3. **use-export-progress.ts**
   - Pass audio elements to export engine
   - Configure audio settings

4. **timeline-store.ts**
   - Add method to get all audio elements for export
   - Include timing information

### 10. Testing Requirements

1. Export video with single audio track
2. Export video with multiple audio tracks
3. Export video with video+audio media files
4. Test volume levels are applied
5. Test audio/video synchronization
6. Test with different export engines

### 11. Known Limitations

- Web Audio API has CORS restrictions for external audio URLs
- Browser autoplay policies may affect audio context
- Memory usage increases with audio processing
- Real-time audio mixing can be CPU intensive

## Detailed Analysis of Each Option

### Option A: Web Audio API Mixing

**How it works:**
- Create AudioContext and destination node
- Load all audio elements from timeline into audio buffers
- Connect sources to destination with proper timing
- Add audio track to video stream before export

**PROS:**
✅ Works in all browsers (not just Electron)
✅ Real-time audio preview possible
✅ Precise timing control
✅ Can apply effects (volume, fade, etc.)
✅ No changes to existing export engines needed
✅ MediaRecorder will automatically mux audio/video

**CONS:**
❌ Memory intensive - loads all audio into RAM
❌ CORS issues with external audio URLs (Freesound API)
❌ Complex timing synchronization code needed
❌ May have browser autoplay policy issues
❌ Performance impact on large projects
❌ Difficult to handle dynamic audio loading

**Impact on existing code:**
- Minimal breaking changes
- Add audio mixing before stream creation in export-engine.ts
- Timeline store already has audio elements ready

**Implementation complexity:** Medium-High

---

### Option B: FFmpeg Command Line (Electron only)

**Current state in code:**
- `ffmpeg-handler.js` line 290-309: buildFFmpegArgs only handles video
- No audio inputs in FFmpeg command
- No audio file paths passed from frontend

**How to implement:**
- Pass audio file URLs/paths from timeline to Electron
- Modify buildFFmpegArgs to include multiple `-i` inputs for audio
- Use FFmpeg's amerge or amix filter for mixing
- Add `-map` parameters for stream selection

**PROS:**
✅ Most powerful and flexible solution
✅ Handles any audio format
✅ Professional audio mixing capabilities
✅ Can handle large files efficiently
✅ Hardware acceleration possible
✅ No memory issues - FFmpeg streams data

**CONS:**
❌ Only works in Electron (desktop app)
❌ Complex FFmpeg command construction
❌ Need to pass audio file paths through IPC
❌ Blob URLs won't work - need actual file paths
❌ Timing sync more complex with multiple inputs
❌ Error handling more difficult

**Required changes:**
```javascript
// ffmpeg-handler.js - Modified buildFFmpegArgs
function buildFFmpegArgs(inputDir, outputFile, width, height, fps, quality, audioFiles) {
  const args = [
    "-y",
    "-framerate", String(fps),
    "-i", path.join(inputDir, "frame-%04d.png"), // Video input
  ];
  
  // Add audio inputs
  audioFiles.forEach(audio => {
    args.push("-i", audio.path);
    // Add offset if audio doesn't start at beginning
    if (audio.startTime > 0) {
      args.push("-itsoffset", String(audio.startTime));
    }
  });
  
  // Mix audio streams
  if (audioFiles.length > 0) {
    args.push("-filter_complex", `[1:a]${audioFiles.length > 1 ? '[2:a]amerge=inputs=' + audioFiles.length : 'acopy'}[aout]`);
    args.push("-map", "0:v"); // Video from first input
    args.push("-map", "[aout]"); // Mixed audio
  }
  
  // Rest of encoding parameters...
}
```

**Impact on existing code:**
- Major changes to CLI export engine
- Need to track audio file paths
- IPC message structure changes

**Implementation complexity:** High

---

### Option C: Silent Audio Track (Quick Fix)

**How it works:**
- Generate silent audio track programmatically
- Add to stream to ensure audio channel exists
- Doesn't include actual audio content

**PROS:**
✅ Very simple to implement
✅ Ensures exported video has audio track
✅ Prevents player compatibility issues
✅ No memory or performance impact
✅ Works with all export engines
✅ Can be done immediately

**CONS:**
❌ Doesn't actually export audio content
❌ User's audio is lost
❌ Not a real solution
❌ May confuse users (silent video)

**Implementation:**
```javascript
// In export-engine.ts setupMediaRecorder()
const audioContext = new AudioContext();
const oscillator = audioContext.createOscillator();
oscillator.frequency.value = 0; // Silent
const dest = audioContext.createMediaStreamDestination();
oscillator.connect(dest);
oscillator.start();

const videoStream = this.canvas.captureStream(0);
const silentAudioTrack = dest.stream.getAudioTracks()[0];
videoStream.addTrack(silentAudioTrack);
```

**Impact on existing code:**
- Minimal - just add silent track before export
- No breaking changes

**Implementation complexity:** Very Low

---

## Recommendation

**For immediate fix:** Implement Option C (Silent Audio) to prevent errors
**For proper solution:** Implement Option A (Web Audio API) for browser compatibility
**For best quality:** Implement Option B (FFmpeg CLI) for Electron builds

The app should detect the environment and use the best available option:
1. Electron + FFmpeg CLI available → Option B
2. Browser or no CLI → Option A
3. Fallback → Option C

## Current Blockers

1. **Audio URLs are Blob URLs** - Created in sounds-store.ts line 303
   - FFmpeg CLI can't access blob URLs
   - Need to save audio files to temp directory for CLI

2. **No audio element tracking** - Timeline doesn't track audio file paths
   - Need to add audio URL/path to timeline elements
   - Media store needs to preserve original URLs

3. **Timing information missing** - Audio start times not passed to export
   - Timeline store has timing but not connected to export
   - Need to calculate offsets for each audio element

## Detailed Integration Plans

### Option A: Web Audio API Integration Plan

**Total time: ~2-3 hours | Risk: Low | No breaking changes**

#### Task A1: Create Audio Mixer Utility (10 min)
**File to create:** `src/lib/audio-mixer.ts`
```typescript
export class AudioMixer {
  private audioContext: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  
  async initialize() {
    this.audioContext = new AudioContext();
    this.destination = this.audioContext.createMediaStreamDestination();
  }
  
  getAudioTrack(): MediaStreamTrack | null {
    return this.destination?.stream.getAudioTracks()[0] || null;
  }
}
```
**Testing:** Create instance, verify audio context creation

#### Task A2: Add Method to Get Audio Elements (10 min)
**File to modify:** `src/stores/timeline-store.ts`
```typescript
// Add around line 150
getAudioElements: () => {
  const elements = [];
  get().tracks.forEach(track => {
    track.elements.forEach(element => {
      if (element.type === 'media' || element.type === 'audio') {
        elements.push({
          ...element,
          trackId: track.id,
          absoluteStart: element.start
        });
      }
    });
  });
  return elements;
}
```
**Testing:** Add audio to timeline, verify method returns elements

#### Task A3: Load Audio URLs into Buffers (10 min)
**File to modify:** `src/lib/audio-mixer.ts`
```typescript
async loadAudioBuffer(url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return await this.audioContext!.decodeAudioData(arrayBuffer);
}
```
**Testing:** Load a single audio file, verify buffer creation

#### Task A4: Schedule Audio Playback (10 min)
**File to modify:** `src/lib/audio-mixer.ts`
```typescript
scheduleAudio(buffer: AudioBuffer, startTime: number, volume: number = 1) {
  const source = this.audioContext!.createBufferSource();
  const gainNode = this.audioContext!.createGain();
  
  source.buffer = buffer;
  gainNode.gain.value = volume;
  
  source.connect(gainNode);
  gainNode.connect(this.destination!);
  
  source.start(startTime);
  return source;
}
```
**Testing:** Schedule single audio, verify it connects

#### Task A5: Integrate Mixer with Export Engine (10 min)
**File to modify:** `src/lib/export-engine.ts` (line ~523)
```typescript
private async setupMediaRecorder(existingStream?: MediaStream): Promise<void> {
  // Add before line 537
  const audioMixer = new AudioMixer();
  await audioMixer.initialize();
  
  const audioElements = useTimelineStore.getState().getAudioElements();
  
  // Load and schedule all audio
  for (const element of audioElements) {
    const mediaItem = useMediaStore.getState().mediaItems.find(m => m.id === element.mediaId);
    if (mediaItem?.url) {
      const buffer = await audioMixer.loadAudioBuffer(mediaItem.url);
      audioMixer.scheduleAudio(buffer, element.absoluteStart, element.volume || 1);
    }
  }
  
  // Get the mixed audio track
  const audioTrack = audioMixer.getAudioTrack();
  
  // Original code continues...
  const stream = existingStream || this.canvas.captureStream(0);
  
  // Add audio track to stream
  if (audioTrack) {
    stream.addTrack(audioTrack);
  }
}
```
**Testing:** Export with single audio track, verify audio included

#### Task A6: Handle CORS for External Audio (10 min)
**File to modify:** `src/lib/audio-mixer.ts`
```typescript
async loadAudioBuffer(url: string): Promise<AudioBuffer> {
  try {
    // For blob URLs and same-origin, direct fetch
    if (url.startsWith('blob:') || url.startsWith(window.location.origin)) {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      return await this.audioContext!.decodeAudioData(arrayBuffer);
    }
    
    // For external URLs, may need proxy or stored blob
    console.warn('External audio URL may have CORS issues:', url);
    // Fallback to silent audio if CORS fails
    return this.createSilentBuffer(1); // 1 second of silence
  } catch (error) {
    console.error('Failed to load audio:', error);
    return this.createSilentBuffer(1);
  }
}
```
**Testing:** Test with Freesound URL, handle CORS gracefully

#### Task A7: Add Cleanup (5 min)
**File to modify:** `src/lib/audio-mixer.ts`
```typescript
dispose() {
  if (this.audioContext) {
    this.audioContext.close();
    this.audioContext = null;
  }
  this.destination = null;
}
```
**Testing:** Call dispose after export, verify cleanup

---

### Option B: FFmpeg CLI Integration Plan

**Total time: ~3-4 hours | Risk: Medium | Electron only**

#### Task B1: Add Audio File Tracking (10 min)
**File to modify:** `src/stores/media-store.ts` (line ~307)
```typescript
// When adding media item, preserve original URL
addMediaItem: async (projectId, mediaData) => {
  // ... existing code ...
  const item = {
    // ... existing fields ...
    originalUrl: mediaData.url, // Add this to preserve URL
    localPath: null, // Will be set for Electron
  };
}
```
**Testing:** Add audio, verify originalUrl is preserved

#### Task B2: Create Temp Audio Files in Electron (10 min)
**File to create:** `electron/audio-temp-handler.js`
```javascript
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

async function saveAudioToTemp(audioData, filename) {
  const tempDir = path.join(app.getPath('temp'), 'qcut-audio');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const filePath = path.join(tempDir, filename);
  fs.writeFileSync(filePath, Buffer.from(audioData));
  return filePath;
}

module.exports = { saveAudioToTemp };
```
**Testing:** Save single audio file, verify file creation

#### Task B3: Add IPC Handler for Audio Files (10 min)
**File to modify:** `electron/main.js` (add after line 285)
```javascript
ipcMain.handle('save-audio-for-export', async (event, { audioData, filename }) => {
  const { saveAudioToTemp } = require('./audio-temp-handler.js');
  return await saveAudioToTemp(audioData, filename);
});
```
**Testing:** Call from renderer, verify IPC works

#### Task B4: Collect Audio Files for Export (10 min)
**File to modify:** `src/lib/export-engine-cli.ts` (add method around line 400)
```typescript
private async prepareAudioFiles(): Promise<Array<{path: string, startTime: number}>> {
  const audioFiles = [];
  const audioElements = useTimelineStore.getState().getAudioElements();
  
  for (const element of audioElements) {
    const mediaItem = useMediaStore.getState().mediaItems.find(m => m.id === element.mediaId);
    if (mediaItem?.url) {
      // Fetch audio data
      const response = await fetch(mediaItem.url);
      const arrayBuffer = await response.arrayBuffer();
      
      // Save to temp file via IPC
      const tempPath = await window.electronAPI.invoke('save-audio-for-export', {
        audioData: arrayBuffer,
        filename: `audio_${element.id}.mp3`
      });
      
      audioFiles.push({
        path: tempPath,
        startTime: element.start
      });
    }
  }
  
  return audioFiles;
}
```
**Testing:** Prepare audio files, verify temp files created

#### Task B5: Pass Audio Files to FFmpeg Handler (10 min)
**File to modify:** `src/lib/export-engine-cli.ts` (line ~573)
```typescript
private async exportWithCLI(progressCallback?: ProgressCallback): Promise<string> {
  // ... existing code ...
  
  // Add audio file preparation
  const audioFiles = await this.prepareAudioFiles();
  
  const result = await window.electronAPI.invoke("export-video-cli", {
    sessionId: this.sessionId,
    width: this.canvas.width,
    height: this.canvas.height,
    fps: 30,
    quality: this.settings.quality || "medium",
    audioFiles: audioFiles // Add this
  });
  
  return result.outputFile;
}
```
**Testing:** Pass audio files array, verify IPC receives it

#### Task B6: Update FFmpeg Command Builder (10 min)
**File to modify:** `electron/ffmpeg-handler.js` (line 278)
```javascript
function buildFFmpegArgs(inputDir, outputFile, width, height, fps, quality, audioFiles = []) {
  const qualitySettings = {
    "high": { crf: "18", preset: "slow" },
    "medium": { crf: "23", preset: "fast" },
    "low": { crf: "28", preset: "veryfast" },
  };

  const { crf, preset } = qualitySettings[quality] || qualitySettings.medium;
  const inputPattern = path.join(inputDir, "frame-%04d.png");

  const args = ["-y"];
  
  // Add video input
  args.push("-framerate", String(fps), "-i", inputPattern);
  
  // Add audio inputs with timing offsets
  audioFiles.forEach((audio, index) => {
    if (audio.startTime > 0) {
      args.push("-itsoffset", String(audio.startTime));
    }
    args.push("-i", audio.path);
  });
  
  // Video encoding settings
  args.push("-c:v", "libx264", "-preset", preset, "-crf", crf);
  
  // Audio mixing if we have audio files
  if (audioFiles.length > 0) {
    if (audioFiles.length === 1) {
      args.push("-c:a", "aac", "-b:a", "192k");
    } else {
      // Mix multiple audio streams
      const filterInputs = audioFiles.map((_, i) => `[${i + 1}:a]`).join('');
      args.push("-filter_complex", 
        `${filterInputs}amix=inputs=${audioFiles.length}:duration=longest[aout]`,
        "-map", "0:v", "-map", "[aout]"
      );
    }
  } else {
    // No audio - add silent track
    args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest");
  }
  
  args.push("-pix_fmt", "yuv420p", "-movflags", "+faststart", outputFile);
  
  return args;
}
```
**Testing:** Build command with audio, verify correct FFmpeg syntax

#### Task B7: Update IPC Handler (10 min)
**File to modify:** `electron/ffmpeg-handler.js` (line 81)
```javascript
ipcMain.handle("export-video-cli", async (event, options) => {
  const { sessionId, width, height, fps, quality, audioFiles = [] } = options; // Add audioFiles
  
  return new Promise((resolve, reject) => {
    const frameDir = tempManager.getFrameDir(sessionId);
    const outputDir = tempManager.getOutputDir(sessionId);
    const outputFile = path.join(outputDir, "output.mp4");
    
    const ffmpegPath = getFFmpegPath();
    const args = buildFFmpegArgs(
      frameDir,
      outputFile,
      width,
      height,
      fps,
      quality,
      audioFiles // Pass to builder
    );
    
    // ... rest of existing code ...
  });
});
```
**Testing:** Export with audio, verify FFmpeg receives audio inputs

#### Task B8: Cleanup Temp Audio Files (5 min)
**File to modify:** `electron/audio-temp-handler.js`
```javascript
function cleanupAudioFiles(sessionId) {
  const tempDir = path.join(app.getPath('temp'), 'qcut-audio');
  if (fs.existsSync(tempDir)) {
    fs.readdirSync(tempDir).forEach(file => {
      if (file.startsWith(`audio_${sessionId}`)) {
        fs.unlinkSync(path.join(tempDir, file));
      }
    });
  }
}
```
**Testing:** Call cleanup, verify temp files removed

---

### Option C: Silent Audio Track Integration Plan

**Total time: ~30 minutes | Risk: Very Low | No breaking changes**

#### Task C1: Create Silent Audio Generator (10 min)
**File to create:** `src/lib/silent-audio.ts`
```typescript
export class SilentAudioGenerator {
  private audioContext: AudioContext | null = null;
  
  async createSilentTrack(duration: number = 10): Promise<MediaStreamTrack> {
    this.audioContext = new AudioContext();
    const destination = this.audioContext.createMediaStreamDestination();
    
    // Create oscillator with 0 frequency (silent)
    const oscillator = this.audioContext.createOscillator();
    oscillator.frequency.value = 0;
    oscillator.connect(destination);
    oscillator.start();
    
    // Stop after duration
    setTimeout(() => oscillator.stop(), duration * 1000);
    
    return destination.stream.getAudioTracks()[0];
  }
  
  dispose() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
```
**Testing:** Generate silent track, verify it exists

#### Task C2: Integrate with Export Engine (10 min)
**File to modify:** `src/lib/export-engine.ts` (line ~537)
```typescript
private async setupMediaRecorder(existingStream?: MediaStream): Promise<void> {
  // ... existing code ...
  
  const stream = existingStream || this.canvas.captureStream(0);
  
  // Add silent audio track if no audio exists
  if (stream.getAudioTracks().length === 0) {
    const silentGen = new SilentAudioGenerator();
    const silentTrack = await silentGen.createSilentTrack(this.totalDuration);
    stream.addTrack(silentTrack);
    
    // Clean up when export is done
    this.cleanupCallbacks.push(() => silentGen.dispose());
  }
  
  // ... rest of existing code ...
}
```
**Testing:** Export video, verify audio track exists (even if silent)

#### Task C3: Add Cleanup Array (5 min)
**File to modify:** `src/lib/export-engine.ts` (add around line 60)
```typescript
export class ExportEngine {
  // ... existing properties ...
  private cleanupCallbacks: Array<() => void> = [];
  
  // Add cleanup method around line 800
  async cleanup(): Promise<void> {
    this.cleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.warn('Cleanup error:', error);
      }
    });
    this.cleanupCallbacks = [];
    
    // ... existing cleanup code ...
  }
}
```
**Testing:** Call cleanup after export, verify no memory leaks

#### Task C4: Test All Export Engines (5 min)
**Files to test:**
- Standard MediaRecorder export
- FFmpeg WASM export  
- FFmpeg CLI export

**Testing:** Export with each engine, verify all produce videos with audio tracks

---

## Implementation Order Recommendation

1. **Start with Option C** (30 min)
   - Immediate fix
   - Prevents "no audio" errors
   - Safe fallback for other options

2. **Then implement Option A** (2-3 hours)
   - Works for all users
   - Good baseline solution
   - Can be enhanced later

3. **Finally add Option B** (3-4 hours)
   - Best quality for desktop
   - Optional enhancement
   - Can be done incrementally

## Testing Checklist

- [ ] Export with no audio - should have silent track
- [ ] Export with single audio track
- [ ] Export with multiple audio tracks  
- [ ] Export with video that has embedded audio
- [ ] Test volume levels are applied
- [ ] Test audio timing/sync
- [ ] Test with each export engine
- [ ] Test in browser vs Electron
- [ ] Test memory cleanup after export
- [ ] Test CORS handling for external audio
