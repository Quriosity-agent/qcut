step 1: selectedModels updated -> [none]
ai.tsx:366 step 2: combinedCapabilities updated {aspectRatios: undefined, resolutions: undefined, durations: undefined}
ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:358 step 1: selectedModels updated -> [none]
ai.tsx:366 step 2: combinedCapabilities updated {aspectRatios: undefined, resolutions: undefined, durations: undefined}
ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:358 step 1: selectedModels updated -> ltxv2_fast_t2v
ai.tsx:366 step 2: combinedCapabilities updated {aspectRatios: undefined, resolutions: Array(3), durations: Array(7)}
2ai.tsx:524 [AI View] Progress: 0% - 
use-ai-generation.ts:710 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:711 ============================================================
use-ai-generation.ts:712 === handleGenerate CALLED ===
use-ai-generation.ts:713 ============================================================
use-ai-generation.ts:714 Timestamp: 2025-11-19T05:17:30.006Z
use-ai-generation.ts:715 Input parameters:
use-ai-generation.ts:716   - activeTab: text
use-ai-generation.ts:717   - prompt: A harsh flash photograph taken with a disposable Kodak FunSaver camera in 1998. Inside a dimly lit, ...
use-ai-generation.ts:722   - prompt length: 500
use-ai-generation.ts:723   - selectedModels: ['ltxv2_fast_t2v']
use-ai-generation.ts:724   - hasSelectedImage: false
use-ai-generation.ts:725   - imageFile: null
use-ai-generation.ts:733   - activeProject: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:734   - activeProject name: New Project
use-ai-generation.ts:735   - addMediaItem available: true
use-ai-generation.ts:736 
use-ai-generation.ts:801 ✅ Validation passed, starting generation...
use-ai-generation.ts:802   - Models to process: 1
use-ai-generation.ts:803   - Active project: true
use-ai-generation.ts:804   - Media store available: true
use-ai-generation.ts:817 step 3a: pre-generation state check
use-ai-generation.ts:818    - activeProject: true 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:819    - addMediaItem available: true function
use-ai-generation.ts:824    - mediaStoreLoading: false
use-ai-generation.ts:825    - mediaStoreError: null
use-ai-generation.ts:828 
📦 Starting generation for 1 models
use-ai-generation.ts:887 step 4: sanitized params for ltxv2_fast_t2v {unifiedParams: {…}, requestedDuration: 4}
use-ai-generation.ts:892 
🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
use-ai-generation.ts:915 step 5: sending generation request for ltxv2_fast_t2v (text tab) {resolution: '1080p', duration: 4}
use-ai-generation.ts:921   📝 Processing text-to-video model ltxv2_fast_t2v...
use-ai-generation.ts:905   📊 Progress for ltxv2_fast_t2v: {status: 'processing', progress: 10, message: 'Submitting LTX Video 2.0 Fast T2V request...'}
ai-video-client.ts:1840 🎬 Starting LTX Video 2.0 generation with FAL AI
ai-video-client.ts:1841 📝 Prompt: A harsh flash photograph taken with a disposable Kodak FunSaver camera in 1998. Inside a dimly lit, 
ai-video-client.ts:1842 📐 Resolution: 1080p
ai.tsx:524 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
55ai.tsx:524 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
use-ai-generation.ts:905   📊 Progress for ltxv2_fast_t2v: {status: 'completed', progress: 100, message: 'Video with audio generated using LTX Video 2.0 Fast T2V'}
use-ai-generation.ts:1058   ✅ Text-to-video response: {job_id: 'job_sbfwban5a_1763529450010', status: 'completed', message: 'Video generated successfully with ltxv2_fast_t2v', estimated_time: 0, video_url: 'https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4', …}
use-ai-generation.ts:1536 step 5a: post-API response analysis
use-ai-generation.ts:1537    - response received: true
use-ai-generation.ts:1539    - response.video_url: true https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-F...
use-ai-generation.ts:1544    - response.job_id: true job_sbfwban5a_1763529450010
use-ai-generation.ts:1549    - response keys: (6) ['job_id', 'status', 'message', 'estimated_time', 'video_url', 'video_data']
use-ai-generation.ts:1550    - response.status: completed
use-ai-generation.ts:1555 
  🔍 Response analysis for ltxv2_fast_t2v:
use-ai-generation.ts:1556     - response exists: true
use-ai-generation.ts:1557     - response.job_id: job_sbfwban5a_1763529450010
use-ai-generation.ts:1558     - response.video_url: https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4
use-ai-generation.ts:1559     - response.status: completed
use-ai-generation.ts:1560     - Full response: {
  "job_id": "job_sbfwban5a_1763529450010",
  "status": "completed",
  "message": "Video generated successfully with ltxv2_fast_t2v",
  "estimated_time": 0,
  "video_url": "https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4",
      "content_type": "video/mp4",
      "file_name": "htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4",
      "file_size": null,
      "width": 1920,
      "height": 1080,
      "fps": 25,
      "duration": 6.12,
      "num_frames": 153
    }
  }
}
use-ai-generation.ts:1563 🔍 FIX VERIFICATION: Processing job_id response
use-ai-generation.ts:1564    - job_id exists: true
use-ai-generation.ts:1565    - video_url exists: true
use-ai-generation.ts:1569 🎉 FIX SUCCESS: Direct mode with job_id detected!
use-ai-generation.ts:1570 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4
use-ai-generation.ts:1593 📦 Added to generations array: 1
use-ai-generation.ts:1596 step 6a: media integration condition check
use-ai-generation.ts:1601    - activeProject: true 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1602    - addMediaItem: true function
use-ai-generation.ts:1603    - response.video_url: true EXISTS
use-ai-generation.ts:1615    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1618 step 6b: executing media integration block
use-ai-generation.ts:1621    - About to download from URL: https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4
use-ai-generation.ts:1625    - Project ID for media: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1626    - addMediaItem function type: function
use-ai-generation.ts:1631 step 6: downloading video and adding to media store for ltxv2_fast_t2v
use-ai-generation.ts:1633 🔄 Attempting to add to media store...
use-ai-generation.ts:1634    - Project ID: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1635    - addMediaItem available: true
use-ai-generation.ts:1639 📥 Downloading video from URL: https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4
2ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1645 step 6c: video download progress
use-ai-generation.ts:1646    - videoResponse.ok: true
use-ai-generation.ts:1647    - videoResponse.status: 200
use-ai-generation.ts:1648    - videoResponse.headers content-type: video/mp4
2ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1660 ✅ Downloaded video blob, size: 2880866
use-ai-generation.ts:1664 📄 Created file: AI-Video-ltxv2_fast_t2v-1763529508058.mp4
use-ai-generation.ts:1666 step 6d: file creation complete
use-ai-generation.ts:1667    - blob.size: 2880866 bytes
use-ai-generation.ts:1668    - blob.type: video/mp4
use-ai-generation.ts:1669    - file.name: AI-Video-ltxv2_fast_t2v-1763529508058.mp4
use-ai-generation.ts:1670    - file.size: 2880866
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./1829cd32-ce9a-4e03-81db-e69c07d9e4af
blob-url-debug.ts:35   📍 Source: at app://./assets/editor._project_id.lazy-Brw51C8P.js:108:2666
blob-url-debug.ts:36   📦 Type: File, Size: 2880866 bytes
use-ai-generation.ts:1688 step 6d details: {mediaUrl: 'blob:app://./1829cd32-ce9a-4e03-81db-e69c07d9e4af', fileName: 'AI-Video-ltxv2_fast_t2v-1763529508058.mp4', fileSize: 2880866}
use-ai-generation.ts:1693 📤 Adding to media store with item: {name: 'AI: A harsh flash photograph taken...', type: 'video', file: File, url: 'blob:app://./1829cd32-ce9a-4e03-81db-e69c07d9e4af', originalUrl: 'https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4', …}
use-ai-generation.ts:1695 step 6e: about to call addMediaItem
use-ai-generation.ts:1696    - mediaItem structure: {
  "name": "AI: A harsh flash photograph taken...",
  "type": "video",
  "file": {},
  "url": "blob:app://./1829cd32-ce9a-4e03-81db-e69c07d9e4af",
  "originalUrl": "https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4",
  "duration": 6.12,
  "width": 1920,
  "height": 1080
}
use-ai-generation.ts:1700    - projectId: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1701    - addMediaItem is function: true
media-store.ts:325 step 6g: media-store addMediaItem {projectId: '8ee6a680-1bb3-4c4a-906e-9b6c7271e97a', id: undefined, hasFile: true, url: 'blob:app://./1829cd32-ce9a-4e03-81db-e69c07d9e4af', originalUrl: 'https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4', …}hasFile: trueid: undefinedoriginalUrl: "https://v3b.fal.media/files/b/koala/htyEBiiz_SWy-FLLpAwNA_MhIuvTws.mp4"projectId: "8ee6a680-1bb3-4c4a-906e-9b6c7271e97a"size: 2880866type: "video"url: "blob:app://./1829cd32-ce9a-4e03-81db-e69c07d9e4af"[[Prototype]]: Objectconstructor: ƒ Object()hasOwnProperty: ƒ hasOwnProperty()isPrototypeOf: ƒ isPrototypeOf()propertyIsEnumerable: ƒ propertyIsEnumerable()toLocaleString: ƒ toLocaleString()toString: ƒ toString()valueOf: ƒ valueOf()__defineGetter__: ƒ __defineGetter__()__defineSetter__: ƒ __defineSetter__()__lookupGetter__: ƒ __lookupGetter__()__lookupSetter__: ƒ __lookupSetter__()__proto__: (...)get __proto__: ƒ __proto__()set __proto__: ƒ __proto__()
media-store.ts:335 [MediaStore.addMediaItem] Called with projectId: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a, item.name: AI: A harsh flash photograph taken...
media-store.ts:362 [MediaStore.addMediaItem] Saving media item {projectId: '8ee6a680-1bb3-4c4a-906e-9b6c7271e97a', id: '92746b5e-c3c8-ae1c-a41a-1b57ef12f79c', name: 'AI: A harsh flash photograph taken...', type: 'video', hasFile: true, …}
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
media-store.ts:388 [MediaStore.addMediaItem] Saved to storage {projectId: '8ee6a680-1bb3-4c4a-906e-9b6c7271e97a', id: '92746b5e-c3c8-ae1c-a41a-1b57ef12f79c', name: 'AI: A harsh flash photograph taken...', type: 'video'}
use-ai-generation.ts:1711 step 6f: addMediaItem completed {newItemId: '92746b5e-c3c8-ae1c-a41a-1b57ef12f79c', mediaUrl: 'blob:app://./1829cd32-ce9a-4e03-81db-e69c07d9e4af', fileName: 'AI-Video-ltxv2_fast_t2v-1763529508058.mp4', fileSize: 2880866}
use-ai-generation.ts:1717    - newItemId: 92746b5e-c3c8-ae1c-a41a-1b57ef12f79c
use-ai-generation.ts:1718    - SUCCESS: Video added to media store!
use-ai-generation.ts:1720 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1721    - Item ID: 92746b5e-c3c8-ae1c-a41a-1b57ef12f79c
use-ai-generation.ts:1937 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:1938   - Total generations created: 1
use-ai-generation.ts:1939   - Generations: [{…}]
use-ai-generation.ts:1944 step 7: generation flow complete; updating UI and callbacks
use-ai-generation.ts:1946 📤 Calling onComplete callback with 1 videos
ai.tsx:532 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:533 [AI View] Received 1 videos: [{…}]
ai.tsx:538 [AI View] onComplete callback finished
use-ai-generation.ts:1950 ✅ onComplete callback finished
ai.tsx:524 [AI View] Progress: 100% - Generated 1 videos successfully!
export-all-button.tsx:39 step 8: export-all clicked {totalItems: 1, isExporting: false}
export-all-button.tsx:106 step 8: export-all start zipping {totalItems: 1, hasFiles: 1, remoteUrls: Array(0)}
export-all-button.tsx:127 step 8: export-all zip completed {phase: 'idle', totalFiles: 0, completedFiles: 0}