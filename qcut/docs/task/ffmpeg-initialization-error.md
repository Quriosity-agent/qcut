# FFmpeg Initialization Error Analysis

## Error Message
```
[FFmpeg Utils] ❌ FFmpeg initialization failed: Error: FFmpeg initialization timed out after 60s. This may be due to slow network, large WASM files, or missing SharedArrayBuffer support.
```

## Root Cause Analysis

### 1. **Timeout Issue** (`ffmpeg-utils.ts:249-252`)
- **Location**: `apps/web/src/lib/ffmpeg-utils.ts:207-227`
- **Timeout Duration**: 60 seconds for SharedArrayBuffer environments, 120 seconds without
- **Triggered When**: FFmpeg WASM loading exceeds timeout threshold

### 2. **SharedArrayBuffer Dependency** (`ffmpeg-utils.ts:45-52`)
- **Critical Requirement**: FFmpeg WebAssembly requires SharedArrayBuffer for optimal performance
- **Missing Headers**: Requires `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers
- **Environment Check**: `typeof SharedArrayBuffer !== "undefined"`

### 3. **Resource Loading Chain** (`ffmpeg-utils.ts:154-165`)
The error occurs during this sequence:
1. `getFFmpegResourceUrl()` tries to fetch `ffmpeg-core.js` and `ffmpeg-core.wasm`
2. Resource resolution succeeds (app protocol works)
3. Blob conversion completes successfully  
4. **FFmpeg.load() hangs** during WASM initialization

## Technical Details

### Error Flow
```typescript
// ffmpeg-utils.ts:210-227
const loadPromise = ffmpeg.load({
  coreURL: coreBlobUrl,
  wasmURL: wasmBlobUrl,
});

const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => 
    reject(new Error(`FFmpeg load timeout after ${timeoutDuration / 1000} seconds`)),
    timeoutDuration
  );
});

await Promise.race([loadPromise, timeoutPromise]); // Times out here
```

### Environment Context
- **SharedArrayBuffer**: Available ✅ (confirmed in console logs)
- **Worker API**: Available ✅
- **Resource Fetching**: Working ✅ (app:// protocol succeeds)
- **WASM Loading**: **FAILING** ❌ (hangs indefinitely)

## Potential Causes

### 1. **Electron Security Context**
- Electron's security model may interfere with WASM execution
- Cross-origin isolation requirements not met in Electron environment

### 2. **WASM File Corruption/Size**
- Large WASM files (ffmpeg-core.wasm) may fail to load properly
- Network interruption during download in development

### 3. **Memory Constraints**
- FFmpeg WASM requires significant memory allocation
- Electron may have memory limits affecting WASM instantiation

### 4. **Threading Issues**
- SharedArrayBuffer threading conflicts in Electron's multi-process architecture
- Worker thread limitations in packaged Electron apps

## Recommended Solutions

### Immediate Fixes
1. **Increase Timeout**: Extend timeout beyond 60s for development
2. **Add More Diagnostics**: Log WASM loading progress
3. **Fallback Strategy**: Implement non-WASM video processing for Electron

### Long-term Solutions
1. **Electron Headers**: Configure proper COOP/COEP headers in Electron
2. **WASM Optimization**: Use smaller/optimized FFmpeg WASM builds
3. **Native Integration**: Replace WASM FFmpeg with native Electron FFmpeg binding

## Files Involved
- **Primary**: `apps/web/src/lib/ffmpeg-utils.ts:122-271`
- **Caller**: `apps/web/src/stores/media-store.ts:102` (via `getVideoInfo()`)
- **Trigger**: Timeline drag-and-drop operations with video files