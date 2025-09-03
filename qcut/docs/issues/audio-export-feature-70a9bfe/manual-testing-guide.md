# Manual Testing Guide for Audio Export Implementation

## Prerequisites
- Project with at least one audio track in the timeline
- Development server running (`bun dev`)
- Chrome DevTools open (F12) for console monitoring

## Test Scenarios

### 🧪 Test 1: Audio UI Visibility (Basic)
**Purpose**: Verify audio toggle appears only when audio exists

#### Steps:
1. Open the application
2. Create or open a project WITHOUT audio tracks
3. Click Export button
4. **Expected**: No "Audio Export" section visible

5. Add an audio track to the timeline
6. Click Export button again
7. **Expected**: "Audio Export" section appears with checkbox

#### Pass Criteria:
- [ ] No audio section when no audio tracks
- [ ] Audio section appears when audio tracks exist
- [ ] Checkbox is checked by default

---

### 🧪 Test 2: Audio Toggle State Persistence
**Purpose**: Verify audio toggle state persists during session

#### Steps:
1. Open project with audio tracks
2. Click Export button
3. Uncheck "Include audio in export"
4. Close export dialog (ESC or X)
5. Open export dialog again
6. **Expected**: Checkbox remains unchecked

7. Check the audio checkbox
8. Close and reopen dialog
9. **Expected**: Checkbox is now checked

#### Pass Criteria:
- [ ] Toggle state persists when dialog closed/reopened
- [ ] State resets on page refresh (expected behavior)

---

### 🧪 Test 3: Export Store Integration
**Purpose**: Verify audio settings sync with export store

#### Steps:
1. Open Chrome DevTools Console
2. Type: `useExportStore.getState()`
3. Note the audio fields:
   ```javascript
   {
     audioEnabled: true,
     audioCodec: 'aac',
     audioBitrate: 128,
     audioSampleRate: 44100,
     audioChannels: 2
   }
   ```
4. Toggle audio checkbox in export dialog
5. Run `useExportStore.getState()` again
6. **Expected**: `audioEnabled` changes accordingly

#### Pass Criteria:
- [ ] Store shows default audio values
- [ ] `audioEnabled` reflects checkbox state
- [ ] `audioCodec` changes with format (aac for MP4, opus for WebM)

---

### 🧪 Test 4: Audio Config Module
**Purpose**: Test audio configuration management

#### Steps in Console:
```javascript
// Import the module (in browser console)
import('/src/lib/audio-export-config.ts').then(module => {
  // Test 1: Get current config
  console.log('Current:', module.getAudioExportConfig());
  
  // Test 2: Update config
  module.setAudioExportConfig({ enabled: false, bitrate: 192 });
  console.log('Updated:', module.getAudioExportConfig());
  
  // Test 3: Format-based codec
  console.log('MP4 codec:', module.getCodecForFormat('mp4')); // Should be 'aac'
  console.log('WebM codec:', module.getCodecForFormat('webm')); // Should be 'opus'
  
  // Test 4: Reset config
  module.resetAudioExportConfig();
  console.log('Reset:', module.getAudioExportConfig());
});
```

#### Pass Criteria:
- [ ] Config updates correctly
- [ ] Codec selection works for formats
- [ ] Reset restores defaults

---

### 🧪 Test 5: Format-Codec Auto-Selection
**Purpose**: Verify codec auto-selects based on export format

#### Steps:
1. Open export dialog with audio tracks
2. Select MP4 format
3. In console: `getAudioExportConfig()`
4. **Expected**: codec should be 'aac'

5. Change format to WebM
6. Click somewhere in dialog to trigger update
7. Check console again
8. **Expected**: codec should be 'opus'

#### Pass Criteria:
- [ ] MP4 → AAC codec
- [ ] WebM → Opus codec
- [ ] MOV → AAC codec

---

### 🧪 Test 6: Audio Mixer Initialization
**Purpose**: Test Web Audio API mixer creation

#### Steps in Console:
```javascript
// Test AudioMixer class
import('/src/lib/audio-mixer.ts').then(async module => {
  // Create mixer
  const mixer = new module.AudioMixer({
    sampleRate: 44100,
    channels: 2
  });
  
  // Check state
  console.log('Mixer state:', mixer.getState());
  
  // Get stream (for export)
  const stream = mixer.getStream();
  console.log('Audio stream:', stream);
  console.log('Audio tracks:', stream.getAudioTracks());
  
  // Cleanup
  await mixer.dispose();
  console.log('Disposed:', mixer.getState());
});
```

#### Pass Criteria:
- [ ] Mixer initializes without errors
- [ ] Stream is created
- [ ] State shows correct sample rate
- [ ] Dispose works correctly

---

### 🧪 Test 7: Export Parameters Validation
**Purpose**: Verify audio parameters are passed to export

#### Steps:
1. Open export dialog with audio
2. Open Network tab in DevTools
3. Click Export button
4. Look for export request or in Console for export parameters
5. **Expected**: Parameters include:
   ```javascript
   {
     includeAudio: true,
     audioCodec: 'aac', // or 'opus' for WebM
     audioBitrate: 128
   }
   ```

#### Pass Criteria:
- [ ] Audio parameters included in export call
- [ ] Parameters match current settings
- [ ] No errors when audio params present

---

### 🧪 Test 8: Backward Compatibility
**Purpose**: Ensure existing export still works

#### Steps:
1. Create project with only video (no audio)
2. Export normally
3. **Expected**: Export works as before

4. Open project that was created before audio feature
5. Try to export
6. **Expected**: No errors, export works

#### Pass Criteria:
- [ ] Video-only export still works
- [ ] Old projects export without issues
- [ ] No console errors about missing audio

---

### 🧪 Test 9: Error Handling
**Purpose**: Test graceful handling of edge cases

#### Steps:
1. **Test corrupt audio state:**
   ```javascript
   // In console, corrupt the state
   useExportStore.setState({ audioCodec: 'invalid' });
   ```
   Open export dialog
   **Expected**: No crash, falls back to default

2. **Test missing Web Audio API:**
   ```javascript
   // Temporarily disable
   window.AudioContext = undefined;
   ```
   Try to use audio features
   **Expected**: Graceful degradation

#### Pass Criteria:
- [ ] Invalid codec doesn't crash
- [ ] Missing API shows appropriate message or disables feature
- [ ] Export can proceed without audio if needed

---

### 🧪 Test 10: Performance Check
**Purpose**: Ensure no performance regression

#### Steps:
1. Open Performance tab in DevTools
2. Start recording
3. Open export dialog with audio tracks
4. Toggle audio checkbox multiple times
5. Close dialog
6. Stop recording

#### Check for:
- [ ] No memory leaks (heap should stabilize)
- [ ] No excessive re-renders
- [ ] Smooth UI interactions
- [ ] No console warnings about performance

---

## Quick Smoke Test Checklist

For quick validation after changes:

```bash
# 1. Start dev server
bun dev

# 2. Quick checks:
```

- [ ] Export dialog opens
- [ ] Audio checkbox visible (if audio tracks)
- [ ] Toggle works
- [ ] Console has no errors
- [ ] Build passes: `bun run build`

---

## Console Commands Reference

Useful commands for testing:

```javascript
// Check export store
useExportStore.getState()

// Check audio config
import('/src/lib/audio-export-config.ts').then(m => 
  console.log(m.getAudioExportConfig())
)

// Check if Web Audio is supported
!!(window.AudioContext || window.webkitAudioContext)

// Debug audio mixer
window.testAudioMixer = async () => {
  const { AudioMixer } = await import('/src/lib/audio-mixer.ts');
  const mixer = new AudioMixer();
  console.log('Mixer:', mixer.getState());
  return mixer;
}

// Check timeline for audio tracks
useTimelineStore.getState().tracks.filter(t => t.type === 'audio')
```

---

## Regression Testing

Before marking as complete, ensure:

### Existing Features Still Work:
- [ ] Video export without audio
- [ ] All export formats (MP4, WebM, MOV)
- [ ] All quality settings (1080p, 720p, 480p)
- [ ] Export progress indication
- [ ] Caption export
- [ ] Export history

### New Features Work:
- [ ] Audio toggle UI
- [ ] Audio config persistence
- [ ] Format-based codec selection
- [ ] Store integration

---

## Known Limitations (Expected)

These are NOT bugs, but expected limitations of current implementation:

1. **No actual audio in export** - Mixer not connected to MediaRecorder yet
2. **No audio waveform display** - Visual not implemented
3. **No per-track volume** - Basic implementation only
4. **No audio preview** - During export

---

## Bug Report Template

If you find issues, document them:

```markdown
### Issue: [Brief description]
**Steps to Reproduce:**
1. 
2. 

**Expected:** 
**Actual:** 
**Console Errors:** 
**Browser:** Chrome/Firefox/Safari version
**Screenshot:** [if applicable]
```

---

## Success Criteria ✅

Implementation is successful if:
- All 10 test scenarios pass
- No console errors during normal use
- Build completes without errors
- Existing export features unaffected
- UI responds smoothly

---

## Notes
- Test in Chrome first (best Web Audio support)
- Keep console open to catch any errors
- Test both with and without audio tracks
- Verify in both dev and production builds