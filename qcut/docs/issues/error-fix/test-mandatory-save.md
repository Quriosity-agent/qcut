# Testing Mandatory AI Video Save to Disk

## Implementation Summary
We've implemented a **mandatory** local disk save for all AI-generated videos. If the save fails, the entire operation is aborted and the video is NOT added to the media store.

## Key Changes Made

### 1. Electron IPC Handler
- **File**: `qcut/electron/ai-video-save-handler.ts`
- Saves videos to: `userData/projects/{projectId}/ai-videos/`
- Includes comprehensive error handling and disk space checks
- Returns error if save fails - NO FALLBACKS

### 2. Preload Script
- **File**: `qcut/electron/preload.ts`
- Exposes `window.electronAPI.video.saveToDisk()` method
- Also includes verify, delete, and getProjectDir methods

### 3. Main Process Registration
- **File**: `qcut/electron/main.ts`
- Registers the AI video handlers on app startup

### 4. Frontend Integration
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- Added step 6e: Mandatory save to disk after blob creation
- Aborts entire operation if save fails
- Shows error toast to user

### 5. Type Definitions
- **Files**:
  - `qcut/apps/web/src/stores/media-store-types.ts` - Added `isLocalFile` flag
  - `qcut/apps/web/src/types/electron.d.ts` - Added AI video save methods

## Testing Steps

### Prerequisites
1. Compile TypeScript files:
   ```bash
   cd qcut/electron
   bun x tsc
   ```

2. Build the application:
   ```bash
   cd qcut
   bun run build
   ```

### Test Scenarios

#### ✅ Test 1: Successful Save
1. Start Electron app: `bun run electron:dev`
2. Create or open a project
3. Go to Media Panel → AI tab
4. Select an AI video model (e.g., LTX Video 2.0)
5. Enter a prompt and click Generate
6. **Expected Result**:
   - Console shows: `step 6e: video saved to disk successfully`
   - Video appears in media panel
   - Check file exists at: `%APPDATA%/QCut/projects/{projectId}/ai-videos/`

#### ❌ Test 2: Disk Full Error
1. Fill up your disk to near capacity (leave < 100MB free)
2. Try to generate an AI video
3. **Expected Result**:
   - Console shows: `🚨 step 6e: CRITICAL - Save to disk FAILED: Insufficient disk space`
   - Error toast appears: "Failed to save video to disk: Insufficient disk space"
   - Video is NOT added to media panel
   - Generation stops immediately

#### ❌ Test 3: Permission Denied
1. Manually create read-only directory: `%APPDATA%/QCut/projects/{projectId}/`
2. Set folder to read-only permissions
3. Try to generate an AI video
4. **Expected Result**:
   - Console shows: `🚨 step 6e: CRITICAL - Save to disk FAILED: Failed to create project directory`
   - Error toast appears with permission error
   - Video is NOT added to media panel

#### ✅ Test 4: Verify File Persistence
1. Generate an AI video successfully
2. Close the application
3. Reopen the application
4. Load the same project
5. **Expected Result**:
   - Video file still exists on disk
   - Can be loaded and played from local path

#### ✅ Test 5: Multiple Videos
1. Generate 3-5 AI videos in sequence
2. **Expected Result**:
   - Each video saved with unique filename including timestamp
   - All files exist in project directory
   - No filename collisions

## Console Log Verification

Look for these key log messages in the console:

### Success Flow:
```
step 6d: file creation complete
step 6e: MANDATORY save to local disk starting
✅ AI Video saved successfully to disk: C:\Users\...\ai-videos\AI-Video-ltxv2_fast_t2v-{timestamp}-{uniqueId}.mp4 (2.88MB)
✅ step 6e: video saved to disk successfully { localPath: "...", fileName: "...", fileSize: 2880866 }
step 6f: addMediaItem completed
✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
```

### Error Flow:
```
step 6d: file creation complete
step 6e: MANDATORY save to local disk starting
AI Video Save Error: {specific error message}
🚨 step 6e: CRITICAL - Save to disk FAILED: {error}
[Toast Error]: Failed to save video to disk: {error}
[Generation stops - no step 6f or beyond]
```

## File System Verification

### Check saved videos location:
- **Windows**: `%APPDATA%\QCut\projects\{projectId}\ai-videos\`
- **macOS**: `~/Library/Application Support/QCut/projects/{projectId}/ai-videos/`
- **Linux**: `~/.config/QCut/projects/{projectId}/ai-videos/`

### File naming pattern:
```
AI-Video-{modelId}-{timestamp}-{uniqueId}.mp4
```
Example: `AI-Video-ltxv2_fast_t2v-1763529508058-a1b2c3d4e5f67890.mp4`

## Troubleshooting

### Issue: "Electron API not available"
- **Cause**: Running in browser instead of Electron
- **Solution**: Use `bun run electron:dev` not `bun dev`

### Issue: Files not saving but no error
- **Check**: TypeScript compilation - run `cd qcut/electron && bun x tsc`
- **Check**: Handler registration in main.ts
- **Check**: Console for any uncaught errors

### Issue: "Failed to write video file to disk"
- **Check**: Disk space available (need video size + 10% buffer)
- **Check**: Folder permissions
- **Check**: Anti-virus not blocking file creation

## Success Criteria

✅ **Implementation is successful when:**
1. AI videos ALWAYS save to local disk
2. Save failures PREVENT media store addition
3. Error messages clearly explain failures
4. Files persist after app restart
5. No fallback to blob-only storage

❌ **Implementation has issues if:**
1. Videos added to media without local save
2. Silent failures (no error message)
3. Files disappear after restart
4. Blob URLs used instead of local paths