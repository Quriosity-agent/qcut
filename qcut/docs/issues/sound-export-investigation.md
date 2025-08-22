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
