# FFmpeg Export Issues - Problem Documentation

## 🚨 **Critical Issues Identified** (2025-09-22)

### **Problem 1: Excessive Windows Explorer Windows Opening**
**Issue**: Every single frame opens a new Windows Explorer window
**Evidence**: Console shows `🗂️ DEBUG: Opened frames folder in Windows Explorer` for EVERY frame (30+ times)
**Location**: `export-engine-cli.ts:712`
**Impact**: System becomes unusable with 30+ Explorer windows opening during export

### **Problem 2: PNG Frames Created But Then Deleted**
**Issue**: Debug frames are being created successfully but disappear
**Evidence**:
- Console shows successful saves: `✅ DEBUG: Saved debug_frame-0000.png`
- User reports files are deleted after creation
**Location**: Temp folder `%TEMP%\qcut-export\[sessionId]\frames\`
**Possible Causes**:
- Cleanup process running too early
- FFmpeg deleting frames after processing
- Windows temp folder auto-cleanup

### **Problem 3: Filter Chain Not Being Applied**
**Issue**: FFmpeg filter chain generated but may not be passed to FFmpeg correctly
**Evidence**:
- Filter chain generated: `🎨 EFFECTS STORE: Generated FFmpeg filter chain for element 48d560e9-42a7-4397-b77d-6f806d46efa4: "hue=s=0"`
- But export may not apply it to final video
**Location**: Between `export-engine-cli.ts` and `ffmpeg-handler.ts`

---

## 🔧 **Required Fixes**

### **Fix 1: Stop Opening Explorer Windows**
**File**: `apps/web/src/lib/export-engine-cli.ts`
**Line**: 712
**Solution**: Remove or comment out the line that opens Explorer for every frame
```typescript
// Comment out or remove:
// await window.electronAPI.shell.openPath(frameDir);
```

### **Fix 2: Prevent Frame Deletion**
**Investigation Needed**:
1. Check if FFmpeg is deleting frames after processing
2. Check cleanup timing in export completion
3. Add flag to preserve frames for debugging

### **Fix 3: Ensure Filter Chain Is Applied**
**Files to Check**:
1. `export-engine-cli.ts` - Verify filter chain is passed to export options
2. `electron/ffmpeg-handler.ts` - Verify filter chain is added to FFmpeg command
3. Add logging to confirm filter chain in FFmpeg arguments

---

## ✅ **Working Components** (Confirmed)

### **Successfully Implemented**:
1. **FFmpeg Filter Chain Generation** ✅
   - Filter chains are correctly generated: `"hue=s=0"` for Black & White
   - Effects store integration working

2. **Frame Rendering** ✅
   - Frames are being rendered correctly to canvas
   - PNG conversion working
   - Frame saving to temp folder working (but files disappear)

3. **Effect Detection** ✅
   - Effects are properly retrieved from store
   - Filter chains are generated for each frame

---

## 📝 **Debugging Information**

### **Console Output Analysis**:
1. **Frame Processing**: 36 frames processed (0-35) over 1.167 seconds
2. **Temp Path**: `C:\Users\zdhpe\AppData\Local\Temp\qcut-export\1758520908839\frames`
3. **File Naming**: Two patterns used:
   - `debug_frame-XXXX.png` (sequential)
   - `debug_2025-09-22T06-01-XX-XXXz_frame-XXXX.png` (timestamped)
4. **Explorer Opening**: Called after EVERY frame save (problem!)

### **Key Code Locations**:
- Frame saving: `export-engine-cli.ts:687-712`
- Filter generation: `effects-store.ts:755-758`
- Export handler: `electron/ffmpeg-handler.ts`

### **Next Steps for Investigation**:
1. Check if `openExternal` or `shell.openPath` is being called in loop
2. Verify FFmpeg command includes filter chain parameter
3. Add flag to disable auto-cleanup of frames
4. Check if frames exist after export completes

---

## 🎯 **Summary**

### **What's Working**:
- Filter chain generation ✅
- Frame rendering ✅
- Effects detection ✅
- PNG export ✅

### **What's Broken**:
1. **Too many Explorer windows** - Opens 30+ windows during export
2. **Frames disappear** - PNG files are created then deleted
3. **Unknown if filters applied** - Need to verify FFmpeg command

### **Priority Fixes**:
1. **URGENT**: Stop opening Explorer windows for every frame
2. **HIGH**: Prevent frame deletion/cleanup
3. **MEDIUM**: Verify filter chain is passed to FFmpeg