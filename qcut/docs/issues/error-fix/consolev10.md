step 1: selectedModels updated -> [none]
ai.tsx:366 step 2: combinedCapabilities updated Object
ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:358 step 1: selectedModels updated -> [none]
ai.tsx:366 step 2: combinedCapabilities updated Object
2ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:358 step 1: selectedModels updated -> ltxv2_fast_t2v
ai.tsx:366 step 2: combinedCapabilities updated Object
4ai.tsx:524 [AI View] Progress: 0% - 
use-ai-generation.ts:710 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:711 ============================================================
use-ai-generation.ts:712 === handleGenerate CALLED ===
use-ai-generation.ts:713 ============================================================
use-ai-generation.ts:714 Timestamp: 2025-11-19T07:12:14.760Z
use-ai-generation.ts:715 Input parameters:
use-ai-generation.ts:716   - activeTab: text
use-ai-generation.ts:717   - prompt: supermodel dance
use-ai-generation.ts:722   - prompt length: 16
use-ai-generation.ts:723   - selectedModels: Array(1)
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
use-ai-generation.ts:887 step 4: sanitized params for ltxv2_fast_t2v Object
use-ai-generation.ts:892 
🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
use-ai-generation.ts:915 step 5: sending generation request for ltxv2_fast_t2v (text tab) Object
use-ai-generation.ts:921   📝 Processing text-to-video model ltxv2_fast_t2v...
use-ai-generation.ts:905   📊 Progress for ltxv2_fast_t2v: Object
ai-video-client.ts:1840 🎬 Starting LTX Video 2.0 generation with FAL AI
ai-video-client.ts:1841 📝 Prompt: supermodel dance
ai-video-client.ts:1842 📐 Resolution: 1080p
4ai.tsx:524 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
30ai.tsx:524 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
use-ai-generation.ts:905   📊 Progress for ltxv2_fast_t2v: {status: 'completed', progress: 100, message: 'Video with audio generated using LTX Video 2.0 Fast T2V'}
use-ai-generation.ts:1058   ✅ Text-to-video response: {job_id: 'job_122kkipe6_1763536334761', status: 'completed', message: 'Video generated successfully with ltxv2_fast_t2v', estimated_time: 0, video_url: 'https://v3b.fal.media/files/b/elephant/8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4', …}
use-ai-generation.ts:1536 step 5a: post-API response analysis
use-ai-generation.ts:1537    - response received: true
use-ai-generation.ts:1539    - response.video_url: true https://v3b.fal.media/files/b/elephant/8wUUrEYlkTf...
use-ai-generation.ts:1544    - response.job_id: true job_122kkipe6_1763536334761
use-ai-generation.ts:1549    - response keys: (6) ['job_id', 'status', 'message', 'estimated_time', 'video_url', 'video_data']
use-ai-generation.ts:1550    - response.status: completed
use-ai-generation.ts:1555 
  🔍 Response analysis for ltxv2_fast_t2v:
use-ai-generation.ts:1556     - response exists: true
use-ai-generation.ts:1557     - response.job_id: job_122kkipe6_1763536334761
use-ai-generation.ts:1558     - response.video_url: https://v3b.fal.media/files/b/elephant/8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4
use-ai-generation.ts:1559     - response.status: completed
use-ai-generation.ts:1560     - Full response: {
  "job_id": "job_122kkipe6_1763536334761",
  "status": "completed",
  "message": "Video generated successfully with ltxv2_fast_t2v",
  "estimated_time": 0,
  "video_url": "https://v3b.fal.media/files/b/elephant/8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/elephant/8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4",
      "content_type": "video/mp4",
      "file_name": "8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4",
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
use-ai-generation.ts:1570 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/elephant/8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4
use-ai-generation.ts:1593 📦 Added to generations array: 1
use-ai-generation.ts:1596 step 6a: media integration condition check
use-ai-generation.ts:1601    - activeProject: true 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1602    - addMediaItem: true function
use-ai-generation.ts:1603    - response.video_url: true EXISTS
use-ai-generation.ts:1615    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1618 step 6b: executing media integration block
use-ai-generation.ts:1621    - About to download from URL: https://v3b.fal.media/files/b/elephant/8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4
use-ai-generation.ts:1625    - Project ID for media: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1626    - addMediaItem function type: function
use-ai-generation.ts:1631 step 6: downloading video and adding to media store for ltxv2_fast_t2v
use-ai-generation.ts:1633 🔄 Attempting to add to media store...
use-ai-generation.ts:1634    - Project ID: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1635    - addMediaItem available: true
use-ai-generation.ts:1639 📥 Downloading video from URL: https://v3b.fal.media/files/b/elephant/8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4
2ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1645 step 6c: video download progress
use-ai-generation.ts:1646    - videoResponse.ok: true
use-ai-generation.ts:1647    - videoResponse.status: 200
use-ai-generation.ts:1648    - videoResponse.headers content-type: video/mp4
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1660 ✅ Downloaded video blob, size: 5160052
use-ai-generation.ts:1664 📄 Created file: AI-Video-ltxv2_fast_t2v-1763536370970.mp4
use-ai-generation.ts:1666 step 6d: file creation complete
use-ai-generation.ts:1667    - blob.size: 5160052 bytes
use-ai-generation.ts:1668    - blob.type: video/mp4
use-ai-generation.ts:1669    - file.name: AI-Video-ltxv2_fast_t2v-1763536370970.mp4
use-ai-generation.ts:1670    - file.size: 5160052
use-ai-generation.ts:1673 step 6e: MANDATORY save to local disk starting
use-ai-generation.ts:1709 ✅ step 6e: video saved to disk successfully {localPath: 'C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\8ee6a…ltxv2_fast_t2v-1763536371019-10c2d1cfcb01c863.mp4', fileName: 'AI-Video-ltxv2_fast_t2v-1763536370970-ltxv2_fast_t2v-1763536371019-10c2d1cfcb01c863.mp4', fileSize: 5160052}
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./cc2479c6-4823-47da-afb5-af678dac640e
blob-url-debug.ts:35   📍 Source: at app://./assets/editor._project_id.lazy-D6micUdZ.js:108:3482
blob-url-debug.ts:36   📦 Type: File, Size: 5160052 bytes
use-ai-generation.ts:1741 step 6d details: {mediaUrl: 'blob:app://./cc2479c6-4823-47da-afb5-af678dac640e', fileName: 'AI-Video-ltxv2_fast_t2v-1763536370970.mp4', fileSize: 5160052}
use-ai-generation.ts:1746 📤 Adding to media store with item: {name: 'AI: supermodel dance...', type: 'video', file: File, url: 'blob:app://./cc2479c6-4823-47da-afb5-af678dac640e', originalUrl: 'https://v3b.fal.media/files/b/elephant/8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4', …}
use-ai-generation.ts:1748 step 6e: about to call addMediaItem
use-ai-generation.ts:1749    - mediaItem structure: {
  "name": "AI: supermodel dance...",
  "type": "video",
  "file": {},
  "url": "blob:app://./cc2479c6-4823-47da-afb5-af678dac640e",
  "originalUrl": "https://v3b.fal.media/files/b/elephant/8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4",
  "localPath": "C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\8ee6a680-1bb3-4c4a-906e-9b6c7271e97a\\ai-videos\\AI-Video-ltxv2_fast_t2v-1763536370970-ltxv2_fast_t2v-1763536371019-10c2d1cfcb01c863.mp4",
  "isLocalFile": true,
  "duration": 6.12,
  "width": 1920,
  "height": 1080,
  "metadata": {
    "source": "text2video",
    "model": "ltxv2_fast_t2v",
    "prompt": "supermodel dance",
    "generatedAt": "2025-11-19T07:12:51.029Z"
  }
}
use-ai-generation.ts:1753    - projectId: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1754    - addMediaItem is function: true
media-store.ts:325 step 6g: media-store addMediaItem {projectId: '8ee6a680-1bb3-4c4a-906e-9b6c7271e97a', id: undefined, hasFile: true, url: 'blob:app://./cc2479c6-4823-47da-afb5-af678dac640e', originalUrl: 'https://v3b.fal.media/files/b/elephant/8wUUrEYlkTfYhqoBYFPGs_LMkfOtEF.mp4', …}
media-store.ts:335 [MediaStore.addMediaItem] Called with projectId: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a, item.name: AI: supermodel dance...
media-store.ts:362 [MediaStore.addMediaItem] Saving media item {projectId: '8ee6a680-1bb3-4c4a-906e-9b6c7271e97a', id: 'd11e4e0d-55b4-6162-2577-fdef97e00d5a', name: 'AI: supermodel dance...', type: 'video', hasFile: true, …}
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
media-store.ts:388 [MediaStore.addMediaItem] Saved to storage {projectId: '8ee6a680-1bb3-4c4a-906e-9b6c7271e97a', id: 'd11e4e0d-55b4-6162-2577-fdef97e00d5a', name: 'AI: supermodel dance...', type: 'video'}
use-ai-generation.ts:1764 step 6f: addMediaItem completed {newItemId: 'd11e4e0d-55b4-6162-2577-fdef97e00d5a', mediaUrl: 'blob:app://./cc2479c6-4823-47da-afb5-af678dac640e', fileName: 'AI-Video-ltxv2_fast_t2v-1763536370970.mp4', fileSize: 5160052}
use-ai-generation.ts:1770    - newItemId: d11e4e0d-55b4-6162-2577-fdef97e00d5a
use-ai-generation.ts:1771    - SUCCESS: Video added to media store!
use-ai-generation.ts:1773 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1774    - Item ID: d11e4e0d-55b4-6162-2577-fdef97e00d5a
use-ai-generation.ts:2036 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:2037   - Total generations created: 1
use-ai-generation.ts:2038   - Generations: [{…}]
use-ai-generation.ts:2043 step 7: generation flow complete; updating UI and callbacks
use-ai-generation.ts:2045 📤 Calling onComplete callback with 1 videos
ai.tsx:532 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:533 [AI View] Received 1 videos: [{…}]
ai.tsx:538 [AI View] onComplete callback finished
use-ai-generation.ts:2049 ✅ onComplete callback finished
ai.tsx:524 [AI View] Progress: 100% - Generated 1 videos successfully!
export-all-button.tsx:39 step 8: export-all clicked {totalItems: 2, isExporting: false}
export-all-button.tsx:106 step 8: export-all start zipping {totalItems: 2, hasFiles: 2, remoteUrls: Array(0)}
use-zip-export.ts:34 step 8a: use-zip-export exportToZip called {itemsCount: 2, itemsWithFile: 2, itemsWithLocalPath: 1, options: {…}}
use-zip-export.ts:54 step 8c: creating ZipManager instance
use-zip-export.ts:58 step 8d: starting addMediaItems
zip-manager.ts:34 step 9: zip-manager starting addMediaItems {totalItems: 2, itemsWithFile: 2, itemsWithLocalPath: 1, itemsWithUrl: 2, electronAPIAvailable: true, …}
zip-manager.ts:52 step 9a: processing item {index: 0, name: 'AI: supermodel dance...', hasFile: true, hasLocalPath: false, localPath: undefined, …}
zip-manager.ts:156 step 9b: adding file directly to ZIP {filename: 'AI_ supermodel dance...', fileSize: 3764014, fileType: '', isAIGenerated: false}
zip-manager.ts:163 step 9c: file added successfully via File object
use-zip-export.ts:60 step 8e: addMediaItems progress {progress: 0.5}
zip-manager.ts:298 step 9m: item processing complete {itemName: 'AI: supermodel dance...', completed: 1, total: 2, progress: '1/2'}
zip-manager.ts:52 step 9a: processing item {index: 1, name: 'AI: supermodel dance...', hasFile: true, hasLocalPath: true, localPath: 'C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\8ee6a…ltxv2_fast_t2v-1763536371019-10c2d1cfcb01c863.mp4', …}
zip-manager.ts:113 step 9b-ai: AI video detected, prioritizing localPath read {filename: 'AI_ supermodel dance.. (1).', localPath: 'C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\8ee6a…ltxv2_fast_t2v-1763536371019-10c2d1cfcb01c863.mp4', metadataSource: 'text2video', name: 'AI: supermodel dance...'}
zip-manager.ts:122 step 9b-ai-read: readFile returned for AI video {bufferExists: true, bufferLength: 5160052}
zip-manager.ts:133 step 9b-ai-success: AI video added from localPath {fileName: 'AI_ supermodel dance.. (1).', fileSize: 5160052, localPath: 'C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\8ee6a…ltxv2_fast_t2v-1763536371019-10c2d1cfcb01c863.mp4'}
use-zip-export.ts:60 step 8e: addMediaItems progress {progress: 1}
zip-manager.ts:298 step 9m: item processing complete {itemName: 'AI: supermodel dance...', completed: 2, total: 2, progress: '2/2'}
zip-manager.ts:313 step 9o: all items processed {totalProcessed: 2, totalItems: 2, zipFiles: 2, zipFileNames: Array(2)}
use-zip-export.ts:68 step 8f: addMediaItems complete
use-zip-export.ts:71 step 8g: starting compression
zip-manager.ts:324 step 10: generating ZIP blob {filesInZip: 2, compression: 'DEFLATE', compressionLevel: 6}
zip-manager.ts:341 step 10a: ZIP blob generated {blobSize: 8817683, blobType: 'application/zip', sizeKB: '8611.02', sizeMB: '8.41'}
use-zip-export.ts:79 step 8h: compression complete {blobSize: 8817683, blobType: 'application/zip'}
use-zip-export.ts:85 step 8i: starting download
use-zip-export.ts:97 step 8j: calling downloadZipSafely {filename: 'media-export-2025-11-19T07-13-10.zip', blobSize: 8817683}
zip-manager.ts:394 step 11: downloadZipSafely called {blobSize: 8817683, blobType: 'application/zip', filename: 'media-export-2025-11-19T07-13-10.zip', electronAPIAvailable: true, saveBlobAvailable: true}
zip-manager.ts:405 step 11a: converting blob to array buffer
zip-manager.ts:408 step 11b: arrayBuffer created {byteLength: 8817683}
zip-manager.ts:413 step 11c: calling electronAPI.saveBlob {uint8ArrayLength: 8817683, uint8ArrayByteLength: 8817683, filename: 'media-export-2025-11-19T07-13-10.zip'}
zip-manager.ts:420 step 11d: saveBlob returned {success: true, filePath: 'C:\\Users\\zdhpe\\Desktop\\media-export-2025-11-19T07-13-10.zip', canceled: undefined, error: undefined}
zip-manager.ts:428 ✅ ZIP saved successfully via Electron: C:\Users\zdhpe\Desktop\media-export-2025-11-19T07-13-10.zip
use-zip-export.ts:102 step 8k: downloadZipSafely complete
use-zip-export.ts:105 step 8l: export complete, updating state
export-all-button.tsx:127 step 8: export-all zip completed {phase: 'idle', totalFiles: 2, completedFiles: 2}