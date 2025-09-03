# Audio Export Feature Commit Files

**Source Commit**: [70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0](https://github.com/OpenCut-app/OpenCut/commit/70a9bfebb196d5c0bde35ce0a165b696bb9ae1d0)  
**Repository**: OpenCut-app/OpenCut  
**Author**: Ali Sabet  
**Date**: December 12, 2024  

## Important Note
Despite the commit message mentioning "Fix memory leaks in FFmpeg processing and blob management", this commit actually implements **audio export functionality** for the video editor. The files `blob-manager.ts` and `ffmpeg-utils.ts` mentioned in the original commit message were not found in this commit.

## Files in this folder

### 1. `export-button.tsx`
- Adds audio export toggle to the export dialog
- New checkbox UI for including/excluding audio in exports
- Located at: `apps/web/src/components/editor/export-button.tsx`

### 2. `export.ts` 
- Core audio export implementation
- Creates timeline audio buffer by mixing all audio tracks
- Handles audio resampling and synchronization
- Supports both MP4 (AAC codec) and WebM (Opus codec) formats
- Located at: `apps/web/src/lib/export.ts`

### 3. `export-types.ts`
- TypeScript type definitions for export options
- Adds `includeAudio` boolean field to ExportOptions interface
- Located at: `apps/web/src/types/export.ts`

## Key Features Implemented

### Audio Mixing Pipeline
- Collects all audio elements from timeline tracks
- Decodes audio files using Web Audio API
- Handles trimming and timing adjustments
- Mixes multiple audio tracks into a single stereo output
- Supports resampling for different sample rates

### Export Options
- Toggle to include/exclude audio in video exports
- Audio codec selection based on format (AAC for MP4, Opus for WebM)
- Progress tracking for audio processing (5% of total progress)

### Audio Element Processing
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

## Integration Instructions

To integrate these changes into your codebase:

1. **Update Export Button Component**
   - Copy `export-button.tsx` to `apps/web/src/components/editor/`
   - Ensure Checkbox component from UI library is available

2. **Update Export Logic**
   - Copy `export.ts` to `apps/web/src/lib/`
   - Update imports if paths differ in your project

3. **Update Type Definitions**
   - Copy `export-types.ts` to `apps/web/src/types/`
   - Ensure all components using ExportOptions are updated

4. **Test Audio Export**
   - Import video with audio tracks
   - Toggle audio export option
   - Verify audio is included/excluded as expected
   - Test both MP4 and WebM formats

## Dependencies Required
- `mediabunny` - For video/audio encoding (includes AudioBufferSource)
- Web Audio API support in browser
- Existing UI components (Button, Checkbox, Label, RadioGroup, Progress)

## Browser Compatibility
- Requires Web Audio API support
- AudioContext or webkitAudioContext
- Modern browser with media encoding capabilities