# Audio Export Feature Integration Guide

## Source Commit
**Repository**: OpenCut-app/OpenCut  
**Commit**: [70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0](https://github.com/OpenCut-app/OpenCut/commit/70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0)  
**Author**: Ali Sabet  
**Date**: December 12, 2024  

## Overview
This commit adds comprehensive audio export functionality to the OpenCut video editor, allowing users to include or exclude audio tracks when exporting their projects. The implementation includes audio mixing, resampling, and codec selection based on the export format.

## Key Features

### 1. Audio Export Toggle
- New checkbox UI in export dialog
- Option to include/exclude audio in exports
- Persistent setting during export session

### 2. Audio Mixing Pipeline
- Collects all audio elements from timeline
- Handles multiple audio tracks
- Supports trimming and timing adjustments
- Mixes tracks into stereo output

### 3. Format-Specific Codecs
- MP4: Uses AAC audio codec
- WebM: Uses Opus audio codec
- Automatic codec selection based on format

## Files Modified

### `apps/web/src/components/editor/export-button.tsx`
```typescript
// Added audio toggle UI
const [includeAudio, setIncludeAudio] = useState<boolean>(
  DEFAULT_EXPORT_OPTIONS.includeAudio || true
);

// Added to export options
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
```

### `apps/web/src/lib/export.ts`
Major additions include:

#### Audio Element Interface
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

#### Timeline Audio Buffer Creation
```typescript
async function createTimelineAudioBuffer(
  tracks: any[],
  mediaFiles: any[],
  duration: number,
  sampleRate: number = 44100
): Promise<AudioBuffer | null>
```

This function:
- Decodes audio files using Web Audio API
- Handles resampling for different sample rates
- Mixes multiple tracks into stereo output
- Respects mute states and trim settings

#### Export Pipeline Integration
```typescript
// Add audio track if requested
if (includeAudio) {
  audioBuffer = await createTimelineAudioBuffer(
    tracks,
    mediaFiles,
    duration
  );

  if (audioBuffer) {
    audioSource = new AudioBufferSource({
      codec: format === "webm" ? "opus" : "aac",
      bitrate: qualityMap[quality],
    });
    output.addAudioTrack(audioSource);
  }
}
```

### `apps/web/src/types/export.ts`
```typescript
export interface ExportOptions {
  format: ExportFormat;
  quality: ExportQuality;
  fps?: number;
  includeAudio?: boolean;  // New field
  onProgress?: (progress: number) => void;
  onCancel?: () => boolean;
}
```

## Integration Steps

### Step 1: Update Dependencies
Ensure `mediabunny` package supports `AudioBufferSource`:
```bash
bun add mediabunny@latest
```

### Step 2: Copy Modified Files
1. Copy `export-button.tsx` to `apps/web/src/components/editor/`
2. Copy `export.ts` to `apps/web/src/lib/`
3. Copy `export.ts` to `apps/web/src/types/`

### Step 3: Update UI Components
Ensure these UI components are available:
- `Checkbox` from `@/components/ui/checkbox`
- `Label` from `@/components/ui/label`
- `PropertyGroup` component

### Step 4: Test Audio Processing
```javascript
// Test Web Audio API availability
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
console.log('Sample rate:', audioContext.sampleRate);
```

## Testing Checklist

### Basic Functionality
- [ ] Audio toggle appears in export dialog
- [ ] Toggle state persists during session
- [ ] Export works with audio included
- [ ] Export works with audio excluded

### Audio Quality
- [ ] Audio syncs properly with video
- [ ] No audio distortion or clipping
- [ ] Proper volume levels maintained
- [ ] Multiple audio tracks mix correctly

### Format Compatibility
- [ ] MP4 exports with AAC audio
- [ ] WebM exports with Opus audio
- [ ] Both formats play in browsers
- [ ] Both formats play in media players

### Edge Cases
- [ ] Export with no audio tracks
- [ ] Export with muted tracks
- [ ] Export with trimmed audio
- [ ] Export with different sample rates

## Performance Considerations

### Memory Usage
- Audio buffers are decoded into memory
- Large projects may use significant RAM
- Consider implementing streaming for large files

### Processing Time
- Audio processing adds ~5% to export time
- Resampling may slow down export
- Consider worker threads for audio processing

## Browser Compatibility

### Required APIs
- Web Audio API
- AudioContext or webkitAudioContext
- ArrayBuffer support
- Blob URL support

### Tested Browsers
- Chrome 90+
- Firefox 88+
- Edge 90+
- Safari 14+ (limited testing)

## Known Limitations

1. **Sample Rate**: Fixed at 44100 Hz
2. **Channels**: Stereo output only
3. **Resampling**: Simple linear interpolation
4. **Memory**: All audio loaded into memory

## Future Improvements

### Short Term
- [ ] Add sample rate selection
- [ ] Implement better resampling algorithm
- [ ] Add audio bitrate control
- [ ] Show audio waveform during export

### Long Term
- [ ] Streaming audio processing
- [ ] Multi-channel audio support
- [ ] Audio effects during export
- [ ] Real-time audio preview

## Troubleshooting

### Issue: No audio in export
**Solution**: Check browser console for audio decoding errors

### Issue: Audio out of sync
**Solution**: Verify frame rate matches project settings

### Issue: Export fails with audio
**Solution**: Check available memory, reduce project size

### Issue: Distorted audio
**Solution**: Check for clipping, reduce track volumes

## Related Documentation
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MediaBunny Documentation](https://github.com/mediabunny/docs)
- [Audio Codec Comparison](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs)