# Migration to FFmpeg Filter Chains (CLI Only) - Implementation Guide

## 🎯 **Overview**

This document outlines the migration from Canvas Pre-Processing to **FFmpeg Filter Chains** for video effects in QCut's CLI Export Engine. This approach will provide professional-grade video processing by leveraging FFmpeg's native filter system.

## 🚀 **Why FFmpeg Filters?**

### **Quality Benefits**
- **No Quality Loss**: Effects applied during encoding, not pre-processing
- **Professional Grade**: Same filters used in Hollywood productions
- **GPU Acceleration**: Hardware-accelerated processing when available
- **Advanced Effects**: Color grading, noise reduction, temporal filters

### **Performance Benefits**
- **Optimized Processing**: FFmpeg is highly optimized C code
- **Memory Efficient**: Processes video in streaming fashion
- **Multi-threading**: Automatic parallelization across CPU cores
- **Hardware Support**: NVENC, Quick Sync, VideoToolbox acceleration

---

## 📋 **Migration Plan**

### **Phase 1: Environment Setup** (Week 1)
1. Verify FFmpeg CLI availability in Electron
2. Test FFmpeg filter syntax compatibility
3. Create effect parameter mapping system
4. Build filter chain generator

### **Phase 2: Core Implementation** (Week 2-3)
1. Modify CLI Export Engine to use filters
2. Create effects-to-FFmpeg translator
3. Update IPC communication for filter parameters
4. Implement filter chain validation

### **Phase 3: Testing & Refinement** (Week 4)
1. Test all existing effects with FFmpeg filters
2. Compare output quality with canvas approach
3. Performance benchmarking
4. Error handling and fallbacks

---

## 🔧 **Technical Implementation**

### **1. FFmpeg Filter Chain Architecture**

**Current Canvas Approach:**
```typescript
// Apply effects to canvas before capture
ctx.filter = "brightness(120%) contrast(110%)";
ctx.drawImage(video, x, y, width, height);
```

**New FFmpeg Approach:**
```typescript
// Send raw frames + filter parameters to FFmpeg
const filterChain = "eq=brightness=0.2:contrast=0.1,unsharp=5:5:0.8";
ffmpeg.run(['-i', 'input.mp4', '-vf', filterChain, 'output.mp4']);
```

### **2. Effects Parameter Mapping**

| QCut Effect | Current CSS | FFmpeg Filter | Parameters |
|-------------|-------------|---------------|------------|
| **Brightness** | `brightness(120%)` | `eq=brightness=0.2` | -1.0 to 1.0 |
| **Contrast** | `contrast(110%)` | `eq=contrast=1.1` | 0.0 to 2.0 |
| **Saturation** | `saturate(140%)` | `eq=saturation=1.4` | 0.0 to 3.0 |
| **Hue Rotate** | `hue-rotate(45deg)` | `hue=h=45` | 0 to 360 degrees |
| **Blur** | `blur(5px)` | `boxblur=5:1` | radius:power |
| **Sepia** | `sepia(80%)` | `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131` | complex matrix |
| **Grayscale** | `grayscale(100%)` | `colorchannelmixer=.299:.587:.114:0:.299:.587:.114:0:.299:.587:.114` | RGB weights |

### **3. Filter Chain Generator**

```typescript
interface EffectParameters {
  brightness?: number;  // -100 to 100
  contrast?: number;    // -100 to 100
  saturation?: number;  // -100 to 100
  blur?: number;        // 0 to 20
  // ... other effects
}

class FFmpegFilterChain {
  private filters: string[] = [];

  addBrightness(value: number): this {
    // Convert QCut range (-100 to 100) to FFmpeg range (-1.0 to 1.0)
    const ffmpegValue = value / 100;
    this.filters.push(`eq=brightness=${ffmpegValue}`);
    return this;
  }

  addContrast(value: number): this {
    // Convert QCut range (-100 to 100) to FFmpeg range (0.0 to 2.0)
    const ffmpegValue = 1 + (value / 100);
    this.filters.push(`eq=contrast=${ffmpegValue}`);
    return this;
  }

  addBlur(radius: number): this {
    this.filters.push(`boxblur=${radius}:1`);
    return this;
  }

  build(): string {
    return this.filters.join(',');
  }
}

// Usage
const filterChain = new FFmpegFilterChain()
  .addBrightness(20)
  .addContrast(10)
  .addBlur(2)
  .build();
// Result: "eq=brightness=0.2,eq=contrast=1.1,boxblur=2:1"
```

---

## 🏗️ **Implementation Details**

### **1. Modify CLI Export Engine**

**File**: `apps/web/src/lib/export-engine-cli.ts`

```typescript
// Current approach: Send frames with effects applied
async exportVideo(frames: ImageData[], effects: EffectParameters[]): Promise<Blob>

// New approach: Send raw frames + filter parameters
async exportVideo(frames: ImageData[], filterChain: string): Promise<Blob>
```

**Changes Needed:**
- Remove canvas effect application
- Add filter chain parameter to IPC calls
- Update Electron handler to accept filter strings

### **2. Update Electron IPC Handler**

**File**: `electron/ffmpeg-handler.ts`

```typescript
interface ExportOptions {
  // ... existing options
  filterChain?: string;  // New: FFmpeg filter string
}

ipcMain.handle('ffmpeg:export', async (event, options: ExportOptions) => {
  const ffmpegArgs = [
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${options.width}x${options.height}`,
    '-r', options.fps.toString(),
    '-i', 'pipe:0',  // Raw frames from stdin
  ];

  // Add filter chain if provided
  if (options.filterChain) {
    ffmpegArgs.push('-vf', options.filterChain);
  }

  ffmpegArgs.push(
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    options.outputPath
  );

  // Spawn FFmpeg with filter chain
  const ffmpeg = spawn('ffmpeg', ffmpegArgs);
  // ... rest of implementation
});
```

### **3. Effects Store Integration**

**File**: `apps/web/src/stores/effects-store.ts`

```typescript
// Add new method to generate FFmpeg filter chain
export const useEffectsStore = create<EffectsStore>((set, get) => ({
  // ... existing methods

  getFFmpegFilterChain: (elementId: string): string => {
    const effects = get().getElementEffects(elementId);
    const filterChain = new FFmpegFilterChain();

    effects.forEach(effect => {
      if (!effect.enabled) return;

      const params = effect.parameters;
      if (params.brightness !== undefined) {
        filterChain.addBrightness(params.brightness);
      }
      if (params.contrast !== undefined) {
        filterChain.addContrast(params.contrast);
      }
      if (params.blur !== undefined) {
        filterChain.addBlur(params.blur);
      }
      // ... handle other effects
    });

    return filterChain.build();
  },
}));
```

---

## 🔄 **Preview vs Export Sync**

### **Challenge**: Preview uses CSS, Export uses FFmpeg

**Solution 1: Dual Preview System**
```typescript
// Show both CSS preview and FFmpeg preview
<div className="preview-container">
  {/* Current CSS preview */}
  <video style={{ filter: cssFilterString }} />

  {/* FFmpeg preview (generated thumbnail) */}
  <img src={ffmpegPreviewThumbnail} className="ffmpeg-preview" />
</div>
```

**Solution 2: CSS-to-FFmpeg Approximation**
```typescript
// Generate CSS that approximates FFmpeg output
function approximateFFmpegWithCSS(filterChain: string): string {
  // Parse FFmpeg filters and generate equivalent CSS
  // Not perfect but close enough for preview
}
```

**Solution 3: Live FFmpeg Preview** (Advanced)
```typescript
// Generate real-time FFmpeg preview
async function generateLivePreview(videoFrame: ImageData, filterChain: string): Promise<Blob> {
  // Use FFmpeg to process single frame with filters
  // More accurate but slower
}
```

---

## 🧪 **Testing Strategy**

### **1. Unit Tests**
```typescript
describe('FFmpeg Filter Chain', () => {
  it('should convert brightness correctly', () => {
    const chain = new FFmpegFilterChain().addBrightness(20).build();
    expect(chain).toBe('eq=brightness=0.2');
  });

  it('should handle multiple effects', () => {
    const chain = new FFmpegFilterChain()
      .addBrightness(10)
      .addContrast(-5)
      .addBlur(3)
      .build();
    expect(chain).toBe('eq=brightness=0.1,eq=contrast=0.95,boxblur=3:1');
  });
});
```

### **2. Integration Tests**
- Test each effect in isolation
- Test complex effect combinations
- Compare output quality with original
- Verify performance improvements

### **3. Visual Comparison Tests**
```typescript
// Generate test videos with known effects
// Compare pixel-by-pixel with expected output
async function visualComparisonTest(effectParams: EffectParameters) {
  const cssOutput = await generateWithCanvas(effectParams);
  const ffmpegOutput = await generateWithFFmpeg(effectParams);

  const similarity = compareFrames(cssOutput, ffmpegOutput);
  expect(similarity).toBeGreaterThan(0.95); // 95% similar
}
```

---

## 📊 **Performance Expectations**

### **Current Canvas Approach**
- **Frame Processing**: ~5ms per frame (JavaScript)
- **Memory Usage**: High (large canvas buffers)
- **Quality**: Good (some degradation from multiple operations)

### **Expected FFmpeg Approach**
- **Frame Processing**: ~1ms per frame (optimized C code)
- **Memory Usage**: Low (streaming processing)
- **Quality**: Excellent (professional-grade filters)
- **Export Speed**: 50-80% faster overall

---

## 🚨 **Risk Mitigation**

### **1. FFmpeg Availability**
```typescript
// Check if FFmpeg is available
async function checkFFmpegAvailability(): Promise<boolean> {
  try {
    const result = await window.electronAPI.invoke('ffmpeg:version');
    return result.success;
  } catch (error) {
    return false;
  }
}

// Fallback to canvas approach if FFmpeg unavailable
const exportEngine = await checkFFmpegAvailability()
  ? new CliExportEngineWithFilters()
  : new StandardExportEngine();
```

### **2. Filter Validation**
```typescript
// Validate filter syntax before export
async function validateFilterChain(filterChain: string): Promise<boolean> {
  return window.electronAPI.invoke('ffmpeg:validate-filter', filterChain);
}
```

### **3. Graceful Degradation**
```typescript
// If FFmpeg filters fail, fall back to canvas
try {
  await exportWithFFmpegFilters(filterChain);
} catch (error) {
  console.warn('FFmpeg filters failed, falling back to canvas');
  await exportWithCanvasEffects(effectParams);
}
```

---

## 📅 **Implementation Timeline**

### **Week 1: Foundation**
- [ ] Set up FFmpeg CLI testing environment
- [ ] Create filter chain generator classes
- [ ] Map all existing effects to FFmpeg equivalents
- [ ] Test basic filter combinations

### **Week 2: Core Implementation**
- [ ] Modify CLI export engine for filter support
- [ ] Update Electron IPC handlers
- [ ] Integrate with effects store
- [ ] Implement parameter conversion

### **Week 3: Integration**
- [ ] Connect preview system to filter chains
- [ ] Add error handling and validation
- [ ] Implement fallback mechanisms
- [ ] Performance optimization

### **Week 4: Testing & Polish**
- [ ] Comprehensive effect testing
- [ ] Visual comparison validation
- [ ] Performance benchmarking
- [ ] Documentation and examples

---

## 🎯 **Success Criteria**

### **Must Have**
- ✅ All existing effects work with FFmpeg filters
- ✅ Export quality matches or exceeds canvas approach
- ✅ Performance improvement of 30%+ in export speed
- ✅ Fallback to canvas approach if FFmpeg unavailable

### **Nice to Have**
- ✅ Preview closely matches export output
- ✅ Support for advanced FFmpeg-only effects
- ✅ GPU acceleration when available
- ✅ Real-time filter parameter adjustment

---

## 🔧 **Development Commands**

```bash
# Test FFmpeg availability
cd electron && node -e "console.log(require('child_process').execSync('ffmpeg -version').toString())"

# Test filter syntax
ffmpeg -f lavfi -i testsrc2=duration=1:size=320x240:rate=1 -vf "eq=brightness=0.2,eq=contrast=1.1" test.mp4

# Benchmark filter performance
ffmpeg -i input.mp4 -vf "eq=brightness=0.2" -f null - -benchmark

# Validate filter chain
ffmpeg -f lavfi -i testsrc2=duration=1:size=320x240:rate=1 -vf "YOUR_FILTER_CHAIN" -f null -
```

---

## 📝 **Notes & Considerations**

1. **Environment**: This approach only works in Electron with FFmpeg CLI available
2. **Browser Fallback**: Must maintain canvas approach for browser environments
3. **Preview Accuracy**: CSS preview will approximate but not exactly match FFmpeg output
4. **Effect Complexity**: Some advanced effects may require multiple FFmpeg filters
5. **Error Handling**: FFmpeg errors need to be properly caught and handled
6. **Performance**: While faster overall, initial filter validation adds slight overhead

This migration will position QCut as a professional-grade video editor with industry-standard effect processing while maintaining the existing user experience.