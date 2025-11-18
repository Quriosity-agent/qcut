# Console Logging Implementation Plan - Video Generation & Storage Flow

## Overview

This document provides a detailed implementation plan for adding comprehensive console logging throughout the video generation and media storage process. The logging strategy will help identify exactly where failures occur in the flow: **Generation → API → MediaStore**.

---

## Flow Diagram

```
User Input (Prompt)
    ↓
handleGenerate (use-ai-generation.ts)
    ↓
[1] Validate Parameters
    ↓
[2] Send API Request (ai-video-client.ts)
    ↓
[3] Receive Response (video_url + metadata)
    ↓
[4] Download Video from URL
    ↓
[5] Create File Object
    ↓
[6] Create Media Item (metadata)
    ↓
[7] Add to MediaStore (media-store.ts)
    ↓
[8] Save to Storage (OPFS/IndexedDB)
    ↓
Success / Failure
```

---

## Implementation Plan

### Phase 1: Entry Point Logging (use-ai-generation.ts)

#### File: `qcut/apps/web/src/hooks/use-ai-generation.ts`

#### Step 1.1: Log Generation Start

**Location**: Beginning of `handleGenerate` function (around line 636)

```typescript
const handleGenerate = async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀');
  console.log('═══════════════════════════════════════════════════════');
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('');

  console.log('📋 Input parameters:');
  console.log('  - activeTab:', activeTab);
  console.log('  - prompt:', prompt?.substring(0, 100) + (prompt?.length > 100 ? '...' : ''));
  console.log('  - prompt length:', prompt?.length);
  console.log('  - selectedModels:', selectedModels.map(m => m.id));
  console.log('  - hasSelectedImage:', hasSelectedImage);
  console.log('  - imageFile:', imageFile ? `${imageFile.name} (${imageFile.size} bytes)` : 'null');
  console.log('  - activeProject:', activeProject?.id);
  console.log('  - activeProject name:', activeProject?.name);
  console.log('  - addMediaItem available:', typeof addMediaItem === 'function');
  console.log('');

  // Continue with existing validation...
};
```

**Expected Output:**
```
═══════════════════════════════════════════════════════
🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀
═══════════════════════════════════════════════════════
⏰ Timestamp: 2025-11-18T10:30:45.123Z

📋 Input parameters:
  - activeTab: text
  - prompt: Elevator door opens, 5th floor hallway has dark wooden floor, walls displaying Venetian mask...
  - prompt length: 150
  - selectedModels: ["ltxv2_fast_t2v"]
  - hasSelectedImage: false
  - imageFile: null
  - activeProject: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
  - activeProject name: My Project
  - addMediaItem available: true
```

#### Step 1.2: Log Validation Results

**Location**: After validation logic (around line 701)

```typescript
// After validation
console.log('✅ Validation passed, starting generation...');
console.log('  - Models to process:', selectedModels.length);
console.log('  - Active project validated:', !!activeProject);
console.log('  - Media store available:', !!addMediaItem);
console.log('');

// OR if validation fails
console.error('❌ Validation failed!');
console.error('  - Reason:', validationError);
console.error('  - Missing prompt:', !prompt);
console.error('  - No models selected:', selectedModels.length === 0);
console.error('  - No active project:', !activeProject);
return;
```

**Expected Output (Success):**
```
✅ Validation passed, starting generation...
  - Models to process: 1
  - Active project validated: true
  - Media store available: true
```

**Expected Output (Failure):**
```
❌ Validation failed!
  - Reason: No prompt provided
  - Missing prompt: true
  - No models selected: false
  - No active project: false
```

#### Step 1.3: Log Model Processing Loop

**Location**: Inside model processing loop (around line 770)

```typescript
console.log('═══════════════════════════════════════════════════════');
console.log(`🎬 [${index + 1}/${selectedModels.length}] Processing model: ${model.id} (${model.name})`);
console.log('═══════════════════════════════════════════════════════');
console.log('  - Model type:', model.type);
console.log('  - Model category:', model.category);
console.log('  - Model provider:', model.provider || 'Unknown');
console.log('');

const startTime = Date.now();

try {
  // Model processing...
} catch (error) {
  const elapsed = Date.now() - startTime;
  console.error('❌ Model processing failed');
  console.error('  - Model:', model.id);
  console.error('  - Elapsed time:', elapsed + 'ms');
  console.error('  - Error:', error);
}
```

**Expected Output:**
```
═══════════════════════════════════════════════════════
🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
═══════════════════════════════════════════════════════
  - Model type: text-to-video
  - Model category: video
  - Model provider: FAL.ai
```

---

### Phase 2: API Request Logging (ai-video-client.ts)

#### File: `qcut/apps/web/src/services/ai-video-client.ts`

#### Step 2.1: Log API Request Preparation

**Location**: Before sending API request (model-specific function)

```typescript
// Example for LTX Video generation
export async function generateLTXVideo(params: LTXVideoParams) {
  console.log('───────────────────────────────────────────────────────');
  console.log('🎬 Starting LTX Video 2.0 generation with FAL AI');
  console.log('───────────────────────────────────────────────────────');
  console.log('📝 Prompt:', params.prompt?.substring(0, 100) + '...');
  console.log('📐 Resolution:', params.resolution || 'default');
  console.log('⏱️  Duration:', params.duration || 'default');
  console.log('🎨 Aspect ratio:', params.aspectRatio || 'default');
  console.log('');

  console.log('🔍 Request Parameters:');
  console.log(JSON.stringify(params, null, 2));
  console.log('');

  const requestStartTime = Date.now();

  try {
    console.log('📤 Sending request to FAL API...');
    console.log('  - Endpoint:', 'fal-ai/ltx-video-2/text-to-video');
    console.log('  - Method: POST');

    // Send request...
  } catch (error) {
    console.error('❌ API request failed');
    console.error('  - Elapsed time:', Date.now() - requestStartTime + 'ms');
    throw error;
  }
}
```

**Expected Output:**
```
───────────────────────────────────────────────────────
🎬 Starting LTX Video 2.0 generation with FAL AI
───────────────────────────────────────────────────────
📝 Prompt: Elevator door opens, 5th floor hallway has dark wooden floor, walls displaying Venetian mask...
📐 Resolution: 1080p
⏱️  Duration: 6
🎨 Aspect ratio: 16:9

🔍 Request Parameters:
{
  "prompt": "Elevator door opens...",
  "resolution": "1080p",
  "duration": 6,
  "aspectRatio": "16:9"
}

📤 Sending request to FAL API...
  - Endpoint: fal-ai/ltx-video-2/text-to-video
  - Method: POST
```

#### Step 2.2: Log API Response

**Location**: After receiving API response

```typescript
const response = await fal.queue.submit(endpoint, { input: params });

console.log('✅ API request submitted successfully');
console.log('  - Request time:', Date.now() - requestStartTime + 'ms');
console.log('  - Job ID:', response.job_id || response.request_id);
console.log('');

console.log('⏳ Polling for result...');
const pollStartTime = Date.now();

const result = await response.get();

console.log('✅ Generation completed!');
console.log('  - Total time:', Date.now() - requestStartTime + 'ms');
console.log('  - Poll time:', Date.now() - pollStartTime + 'ms');
console.log('');

console.log('📊 Response Data:');
console.log('  - Status:', result.status);
console.log('  - Video URL:', result.video_url);
console.log('  - Video URL domain:', new URL(result.video_url).hostname);
console.log('');

if (result.video_data) {
  console.log('📹 Video Metadata:');
  console.log('  - Width:', result.video_data.video?.width);
  console.log('  - Height:', result.video_data.video?.height);
  console.log('  - FPS:', result.video_data.video?.fps);
  console.log('  - Duration:', result.video_data.video?.duration + 's');
  console.log('  - Frames:', result.video_data.video?.num_frames);
  console.log('');
}

console.log('🔗 Full Response:');
console.log(JSON.stringify(result, null, 2));
console.log('');

return result;
```

**Expected Output:**
```
✅ API request submitted successfully
  - Request time: 1250ms
  - Job ID: job_8hqqqclqc_1763435992707

⏳ Polling for result...
✅ Generation completed!
  - Total time: 45320ms
  - Poll time: 44070ms

📊 Response Data:
  - Status: completed
  - Video URL: https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4
  - Video URL domain: v3b.fal.media

📹 Video Metadata:
  - Width: 1920
  - Height: 1080
  - FPS: 25
  - Duration: 6.12s
  - Frames: 153

🔗 Full Response:
{
  "job_id": "job_8hqqqclqc_1763435992707",
  "status": "completed",
  "video_url": "https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4",
  "video_data": {
    "video": {
      "width": 1920,
      "height": 1080,
      "fps": 25,
      "duration": 6.12,
      "num_frames": 153
    }
  }
}
```

#### Step 2.3: Log API Errors

**Location**: Error handling in API client

```typescript
catch (error) {
  console.error('═══════════════════════════════════════════════════════');
  console.error('❌ API REQUEST FAILED');
  console.error('═══════════════════════════════════════════════════════');
  console.error('⏰ Timestamp:', new Date().toISOString());
  console.error('🕐 Total elapsed time:', Date.now() - requestStartTime + 'ms');
  console.error('');

  console.error('🔍 Error Details:');
  console.error('  - Error type:', error.constructor.name);
  console.error('  - Error message:', error.message);
  console.error('  - Error code:', error.code || 'N/A');
  console.error('  - HTTP status:', error.status || error.statusCode || 'N/A');
  console.error('');

  if (error.response) {
    console.error('📡 Response Data:');
    console.error(JSON.stringify(error.response, null, 2));
    console.error('');
  }

  if (error.stack) {
    console.error('📚 Stack Trace:');
    console.error(error.stack);
    console.error('');
  }

  throw error;
}
```

**Expected Output (Error):**
```
═══════════════════════════════════════════════════════
❌ API REQUEST FAILED
═══════════════════════════════════════════════════════
⏰ Timestamp: 2025-11-18T10:31:30.456Z
🕐 Total elapsed time: 3500ms

🔍 Error Details:
  - Error type: Error
  - Error message: Request failed with status 422
  - Error code: N/A
  - HTTP status: 422

📡 Response Data:
{
  "detail": [
    {
      "loc": ["body", "duration"],
      "msg": "unexpected value; permitted: 4, 8, 12",
      "type": "value_error.const",
      "ctx": {
        "given": 6,
        "permitted": [4, 8, 12]
      }
    }
  ]
}
```

---

### Phase 3: Video Download Logging (use-ai-generation.ts)

#### File: `qcut/apps/web/src/hooks/use-ai-generation.ts`

#### Step 3.1: Log Download Start

**Location**: Before fetching video URL (around line 1569)

```typescript
console.log('───────────────────────────────────────────────────────');
console.log('📥 Downloading video from URL');
console.log('───────────────────────────────────────────────────────');
console.log('  - Video URL:', videoUrl);
console.log('  - URL domain:', new URL(videoUrl).hostname);
console.log('  - URL path:', new URL(videoUrl).pathname);
console.log('');

const downloadStartTime = Date.now();

console.log('🔍 DEBUG STEP 5: Video Download Progress');

try {
  console.log('📤 Fetching video...');
  const videoResponse = await fetch(videoUrl);

  console.log('  - Response received');
  console.log('  - videoResponse.ok:', videoResponse.ok);
  console.log('  - videoResponse.status:', videoResponse.status);
  console.log('  - videoResponse.statusText:', videoResponse.statusText);
  console.log('  - videoResponse.headers content-type:', videoResponse.headers.get('content-type'));
  console.log('  - videoResponse.headers content-length:', videoResponse.headers.get('content-length'));
  console.log('');

  if (!videoResponse.ok) {
    throw new Error(`Video download failed: ${videoResponse.status} ${videoResponse.statusText}`);
  }

  // Continue with blob conversion...
} catch (error) {
  console.error('❌ Video download failed');
  console.error('  - Download time:', Date.now() - downloadStartTime + 'ms');
  console.error('  - Error:', error);
  throw error;
}
```

**Expected Output (Success):**
```
───────────────────────────────────────────────────────
📥 Downloading video from URL
───────────────────────────────────────────────────────
  - Video URL: https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4
  - URL domain: v3b.fal.media
  - URL path: /files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4

🔍 DEBUG STEP 5: Video Download Progress
📤 Fetching video...
  - Response received
  - videoResponse.ok: true
  - videoResponse.status: 200
  - videoResponse.statusText: OK
  - videoResponse.headers content-type: video/mp4
  - videoResponse.headers content-length: 2817575
```

**Expected Output (Failure):**
```
❌ Video download failed
  - Download time: 5000ms
  - Error: Error: Video download failed: 404 Not Found
```

#### Step 3.2: Log Blob Conversion

**Location**: After converting response to blob

```typescript
console.log('🔄 Converting to blob...');
const videoBlob = await videoResponse.blob();

console.log('✅ Downloaded video blob');
console.log('  - Download time:', Date.now() - downloadStartTime + 'ms');
console.log('  - Blob size:', videoBlob.size, 'bytes');
console.log('  - Blob size (MB):', (videoBlob.size / 1024 / 1024).toFixed(2) + ' MB');
console.log('  - Blob type:', videoBlob.type);
console.log('');
```

**Expected Output:**
```
🔄 Converting to blob...
✅ Downloaded video blob
  - Download time: 2340ms
  - Blob size: 2817575 bytes
  - Blob size (MB): 2.69 MB
  - Blob type: video/mp4
```

#### Step 3.3: Log File Creation

**Location**: After creating File object

```typescript
const fileName = `AI-Video-${model.id}-${Date.now()}.mp4`;
const videoFile = new File([videoBlob], fileName, { type: 'video/mp4' });

console.log('📄 Created file object');
console.log('  - File name:', videoFile.name);
console.log('  - File size:', videoFile.size, 'bytes');
console.log('  - File type:', videoFile.type);
console.log('  - Last modified:', new Date(videoFile.lastModified).toISOString());
console.log('');
```

**Expected Output:**
```
📄 Created file object
  - File name: AI-Video-ltxv2_fast_t2v-1763436029098.mp4
  - File size: 2817575 bytes
  - File type: video/mp4
  - Last modified: 2025-11-18T10:31:45.123Z
```

---

### Phase 4: Media Store Integration Logging

#### File: `qcut/apps/web/src/hooks/use-ai-generation.ts`

#### Step 4.1: Log Media Item Preparation

**Location**: Before calling `addMediaItem`

```typescript
console.log('───────────────────────────────────────────────────────');
console.log('💾 Preparing to add media item to store');
console.log('───────────────────────────────────────────────────────');
console.log('🔍 DEBUG STEP 6: Media Item Preparation');
console.log('  - Project ID:', activeProject.id);
console.log('  - Project name:', activeProject.name);
console.log('  - Media name:', `AI: ${prompt.substring(0, 30)}...`);
console.log('  - Media type: video');
console.log('  - File:', videoFile.name);
console.log('  - File size:', videoFile.size);
console.log('  - Remote URL:', videoUrl);
console.log('');

console.log('📊 Video Metadata:');
console.log('  - Duration:', metadata.duration || 'unknown');
console.log('  - Width:', metadata.width || 'unknown');
console.log('  - Height:', metadata.height || 'unknown');
console.log('  - FPS:', metadata.fps || 'unknown');
console.log('');
```

**Expected Output:**
```
───────────────────────────────────────────────────────
💾 Preparing to add media item to store
───────────────────────────────────────────────────────
🔍 DEBUG STEP 6: Media Item Preparation
  - Project ID: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
  - Project name: My Project
  - Media name: AI: Elevator door opens, 5th flo...
  - Media type: video
  - File: AI-Video-ltxv2_fast_t2v-1763436029098.mp4
  - File size: 2817575
  - Remote URL: https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4

📊 Video Metadata:
  - Duration: 6.12
  - Width: 1920
  - Height: 1080
  - FPS: 25
```

#### Step 4.2: Log addMediaItem Call

**Location**: When calling `addMediaItem`

```typescript
console.log('📞 Calling addMediaItem...');
console.log('  - Function available:', typeof addMediaItem === 'function');

const addMediaStartTime = Date.now();

try {
  const newItemId = await addMediaItem(activeProject.id, {
    name: `AI: ${prompt.substring(0, 30)}...`,
    type: 'video',
    file: videoFile,
    url: videoUrl,
    duration: metadata.duration ?? 0,
    width: metadata.width ?? 1920,
    height: metadata.height ?? 1080,
    metadata: {
      model: model.id,
      modelName: model.name,
      prompt: prompt,
      generatedAt: new Date().toISOString(),
      provider: 'FAL.ai',
      ...metadata
    }
  });

  console.log('🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED');
  console.log('  - Call time:', Date.now() - addMediaStartTime + 'ms');
  console.log('  - newItemId:', newItemId);
  console.log('  - SUCCESS: Video added to media store!');
  console.log('');

} catch (error) {
  console.error('🔍 DEBUG STEP 8: ❌ addMediaItem FAILED');
  console.error('  - Call time:', Date.now() - addMediaStartTime + 'ms');
  console.error('  - Error type:', error.constructor.name);
  console.error('  - Error message:', error.message);
  console.error('');

  throw error;
}
```

**Expected Output (Success):**
```
📞 Calling addMediaItem...
  - Function available: true

🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED
  - Call time: 245ms
  - newItemId: 23f4be8d-76d1-1928-ad33-dc7feaf7675e
  - SUCCESS: Video added to media store!
```

**Expected Output (Failure):**
```
📞 Calling addMediaItem...
  - Function available: true

🔍 DEBUG STEP 8: ❌ addMediaItem FAILED
  - Call time: 120ms
  - Error type: Error
  - Error message: Failed to save media item to storage
```

---

### Phase 5: Media Store Internal Logging

#### File: `qcut/apps/web/src/stores/media-store.ts`

#### Step 5.1: Log addMediaItem Entry

**Location**: Beginning of `addMediaItem` method

```typescript
async addMediaItem(projectId: string, itemData: MediaItemData) {
  console.log('═══════════════════════════════════════════════════════');
  console.log('[MediaStore.addMediaItem] Called');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  - projectId:', projectId);
  console.log('  - item name:', itemData.name);
  console.log('  - item type:', itemData.type);
  console.log('  - file:', itemData.file?.name);
  console.log('  - file size:', itemData.file?.size);
  console.log('  - url:', itemData.url?.substring(0, 50) + '...');
  console.log('');

  const itemId = generateId();
  const storeStartTime = Date.now();

  console.log('[MediaStore.addMediaItem] Generated item ID:', itemId);
  console.log('');

  // Continue with implementation...
}
```

**Expected Output:**
```
═══════════════════════════════════════════════════════
[MediaStore.addMediaItem] Called
═══════════════════════════════════════════════════════
  - projectId: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
  - item name: AI: Elevator door opens, 5th flo...
  - item type: video
  - file: AI-Video-ltxv2_fast_t2v-1763436029098.mp4
  - file size: 2817575
  - url: https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkF...

[MediaStore.addMediaItem] Generated item ID: 23f4be8d-76d1-1928-ad33-dc7feaf7675e
```

#### Step 5.2: Log State Update

**Location**: After adding to state

```typescript
// Add to state
set((state) => ({
  mediaItems: [...state.mediaItems, newItem]
}));

console.log('[MediaStore.addMediaItem] ✅ Item added to state');
console.log('  - Total items in store:', get().mediaItems.length);
console.log('  - State update time:', Date.now() - stateUpdateStart + 'ms');
console.log('');
```

**Expected Output:**
```
[MediaStore.addMediaItem] ✅ Item added to state
  - Total items in store: 42
  - State update time: 5ms
```

#### Step 5.3: Log Storage Save

**Location**: During storage save operation

```typescript
console.log('[MediaStore.addMediaItem] 💾 Saving to persistent storage...');
const storageStartTime = Date.now();

try {
  await storageService.saveMediaItem(newItem);

  console.log('[MediaStore.addMediaItem] ✅ Saved to storage');
  console.log('  - Storage save time:', Date.now() - storageStartTime + 'ms');
  console.log('  - Total addMediaItem time:', Date.now() - storeStartTime + 'ms');
  console.log('');

  return itemId;

} catch (error) {
  console.error('[MediaStore.addMediaItem] ❌ Storage save FAILED');
  console.error('  - Storage save time:', Date.now() - storageStartTime + 'ms');
  console.error('  - Error type:', error.constructor.name);
  console.error('  - Error message:', error.message);
  console.error('');

  // Handle error (keep in state as unsaved, etc.)
  // ...existing error handling code...
}
```

**Expected Output (Success):**
```
[MediaStore.addMediaItem] 💾 Saving to persistent storage...
[MediaStore.addMediaItem] ✅ Saved to storage
  - Storage save time: 230ms
  - Total addMediaItem time: 245ms
```

**Expected Output (Failure):**
```
[MediaStore.addMediaItem] 💾 Saving to persistent storage...
[MediaStore.addMediaItem] ❌ Storage save FAILED
  - Storage save time: 120ms
  - Error type: Error
  - Error message: QuotaExceededError: Storage quota exceeded
```

---

### Phase 6: Completion Logging

#### File: `qcut/apps/web/src/hooks/use-ai-generation.ts`

#### Step 6.1: Log Generation Complete

**Location**: After all models processed

```typescript
console.log('═══════════════════════════════════════════════════════');
console.log('✅✅✅ GENERATION LOOP COMPLETE ✅✅✅');
console.log('═══════════════════════════════════════════════════════');
console.log('⏰ Total generation time:', Date.now() - generationStartTime + 'ms');
console.log('📊 Summary:');
console.log('  - Models processed:', processedCount);
console.log('  - Successes:', successCount);
console.log('  - Failures:', failureCount);
console.log('  - Items added to media store:', addedItemsCount);
console.log('');

if (failures.length > 0) {
  console.error('⚠️ Failures occurred:');
  failures.forEach((failure, idx) => {
    console.error(`  ${idx + 1}. ${failure.model}: ${failure.error}`);
  });
  console.error('');
}

console.log('🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉');
console.log('');
```

**Expected Output:**
```
═══════════════════════════════════════════════════════
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
═══════════════════════════════════════════════════════
⏰ Total generation time: 48920ms
📊 Summary:
  - Models processed: 1
  - Successes: 1
  - Failures: 0
  - Items added to media store: 1

🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
```

---

## Quick Reference: Console Message Patterns

### Success Messages
```typescript
✅ // Success indicator
🎉 // Celebration/completion
✓  // Checkmark
```

### Error Messages
```typescript
❌ // Error indicator
🚨 // Critical error
⚠️  // Warning
```

### Process Indicators
```typescript
🚀 // Start/launch
📤 // Sending/uploading
📥 // Downloading
💾 // Saving
🔄 // Processing/converting
⏳ // Waiting/polling
```

### Information
```typescript
📋 // Parameters/config
📊 // Data/statistics
🔍 // Debug/details
📝 // Content/text
📹 // Video metadata
🔗 // Links/URLs
```

---

## Testing Checklist

### Success Path Testing
- [ ] All console logs appear in correct order
- [ ] Timestamps are present and accurate
- [ ] Success emojis (✅) appear at each step
- [ ] Final summary shows correct counts
- [ ] No error messages in console

### Failure Path Testing
- [ ] API errors are logged with full details
- [ ] Download failures show HTTP status
- [ ] Storage errors show error type and message
- [ ] Stack traces are included for debugging
- [ ] Error messages use ❌ emoji

### Performance Logging
- [ ] All timing measurements are present
- [ ] Total time matches sum of individual steps
- [ ] Long-running operations are identified
- [ ] Timing helps identify bottlenecks

---

## Example: Complete Successful Flow Output

```
═══════════════════════════════════════════════════════
🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀
═══════════════════════════════════════════════════════
⏰ Timestamp: 2025-11-18T10:30:45.123Z

📋 Input parameters:
  - activeTab: text
  - prompt: Elevator door opens, 5th floor hallway...
  - selectedModels: ["ltxv2_fast_t2v"]
  - activeProject: 91792c80-b639-4b2a-bf54-6b7da08e2ff1

✅ Validation passed, starting generation...

═══════════════════════════════════════════════════════
🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
═══════════════════════════════════════════════════════

───────────────────────────────────────────────────────
🎬 Starting LTX Video 2.0 generation with FAL AI
───────────────────────────────────────────────────────
📝 Prompt: Elevator door opens...
📐 Resolution: 1080p

📤 Sending request to FAL API...
✅ API request submitted successfully
⏳ Polling for result...
✅ Generation completed!
  - Total time: 45320ms

📊 Response Data:
  - Video URL: https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4

───────────────────────────────────────────────────────
📥 Downloading video from URL
───────────────────────────────────────────────────────
📤 Fetching video...
  - videoResponse.ok: true
  - videoResponse.status: 200

✅ Downloaded video blob
  - Blob size: 2.69 MB

📄 Created file object
  - File name: AI-Video-ltxv2_fast_t2v-1763436029098.mp4

───────────────────────────────────────────────────────
💾 Preparing to add media item to store
───────────────────────────────────────────────────────
  - Project ID: 91792c80-b639-4b2a-bf54-6b7da08e2ff1

═══════════════════════════════════════════════════════
[MediaStore.addMediaItem] Called
═══════════════════════════════════════════════════════
[MediaStore.addMediaItem] ✅ Item added to state
[MediaStore.addMediaItem] 💾 Saving to persistent storage...
[MediaStore.addMediaItem] ✅ Saved to storage
  - Total addMediaItem time: 245ms

🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED
  - newItemId: 23f4be8d-76d1-1928-ad33-dc7feaf7675e
  - SUCCESS: Video added to media store!

═══════════════════════════════════════════════════════
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
═══════════════════════════════════════════════════════
⏰ Total generation time: 48920ms
📊 Summary:
  - Models processed: 1
  - Successes: 1
  - Items added to media store: 1

🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
```

---

## Troubleshooting with Console Logs

### If video doesn't appear in media store:

1. **Search for**: `addMediaItem COMPLETED`
   - Present = Media store integration succeeded
   - Missing = Check for `addMediaItem FAILED`

2. **Search for**: `Storage save FAILED`
   - Present = Storage error, but item should still be visible
   - Check if `unsaved` flag was set

3. **Search for**: `Project ID`
   - Verify it matches current active project
   - Check if project was switched after generation

4. **Search for**: `CSP` or `BLOCKED_BY_RESPONSE`
   - Present = CSP blocking playback (not storage)
   - Fix CSP configuration

### If generation fails:

1. **Search for**: `API REQUEST FAILED`
   - Check error details and HTTP status
   - Look for validation errors (422)

2. **Search for**: `Video download failed`
   - Check network connection
   - Verify video URL is accessible

3. **Search for**: `Validation failed`
   - Check input parameters
   - Verify prompt and model selection

---

## Implementation Priority

1. **Phase 1**: Entry point logging (1 hour)
2. **Phase 2**: API request/response logging (1.5 hours)
3. **Phase 3**: Video download logging (1 hour)
4. **Phase 4**: Media store integration logging (1 hour)
5. **Phase 5**: Media store internal logging (1.5 hours)
6. **Phase 6**: Completion logging (0.5 hours)

**Total estimated time: 6.5 hours**
