step 1: selectedModels updated -> [none]
ai.tsx:366 step 2: combinedCapabilities updated Object
ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:358 step 1: selectedModels updated -> [none]
ai.tsx:366 step 2: combinedCapabilities updated Object
2ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:358 step 1: selectedModels updated -> veo31_fast_text_to_video
ai.tsx:366 step 2: combinedCapabilities updated Object
17ai.tsx:524 [AI View] Progress: 0% - 
use-ai-generation.ts:710 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:711 ============================================================
use-ai-generation.ts:712 === handleGenerate CALLED ===
use-ai-generation.ts:713 ============================================================
use-ai-generation.ts:714 Timestamp: 2025-11-19T23:21:06.544Z
use-ai-generation.ts:715 Input parameters:
use-ai-generation.ts:716   - activeTab: text
use-ai-generation.ts:717   - prompt: supermodel dance
use-ai-generation.ts:722   - prompt length: 16
use-ai-generation.ts:723   - selectedModels: Array(1)
use-ai-generation.ts:724   - hasSelectedImage: false
use-ai-generation.ts:725   - imageFile: null
use-ai-generation.ts:733   - activeProject: 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9
use-ai-generation.ts:734   - activeProject name: New Project
use-ai-generation.ts:735   - addMediaItem available: true
use-ai-generation.ts:736 
use-ai-generation.ts:801 ✅ Validation passed, starting generation...
use-ai-generation.ts:802   - Models to process: 1
use-ai-generation.ts:803   - Active project: true
use-ai-generation.ts:804   - Media store available: true
use-ai-generation.ts:817 step 3a: pre-generation state check
use-ai-generation.ts:818    - activeProject: true 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9
use-ai-generation.ts:819    - addMediaItem available: true function
use-ai-generation.ts:824    - mediaStoreLoading: false
use-ai-generation.ts:825    - mediaStoreError: null
use-ai-generation.ts:828 
📦 Starting generation for 1 models
use-ai-generation.ts:887 step 4: sanitized params for veo31_fast_text_to_video Object
use-ai-generation.ts:892 
🎬 [1/1] Processing model: veo31_fast_text_to_video (Veo 3.1 Fast Text-to-Video)
use-ai-generation.ts:915 step 5: sending generation request for veo31_fast_text_to_video (text tab) Object
use-ai-generation.ts:921   📝 Processing text-to-video model veo31_fast_text_to_video...
3ai.tsx:524 [AI View] Progress: 0% - Generating with Veo 3.1 Fast Text-to-Video (1/1)
ai.tsx:524 [AI View] Progress: 0% - Generating with Veo 3.1 Fast Text-to-Video (1/1)
use-ai-generation.ts:1058   ✅ Text-to-video response: {job_id: 'veo31_fast_1763594525557', status: 'completed', message: 'Video generated successfully', video_url: 'https://v3b.fal.media/files/b/monkey/z-yWt0fy7a1DpPZCUef_B_output.mp4'}
use-ai-generation.ts:1536 step 5a: post-API response analysis
use-ai-generation.ts:1537    - response received: true
use-ai-generation.ts:1539    - response.video_url: true https://v3b.fal.media/files/b/monkey/z-yWt0fy7a1Dp...
use-ai-generation.ts:1544    - response.job_id: true veo31_fast_1763594525557
use-ai-generation.ts:1549    - response keys: (4) ['job_id', 'status', 'message', 'video_url']
use-ai-generation.ts:1550    - response.status: completed
use-ai-generation.ts:1555 
  🔍 Response analysis for veo31_fast_text_to_video:
use-ai-generation.ts:1556     - response exists: true
use-ai-generation.ts:1557     - response.job_id: veo31_fast_1763594525557
use-ai-generation.ts:1558     - response.video_url: https://v3b.fal.media/files/b/monkey/z-yWt0fy7a1DpPZCUef_B_output.mp4
use-ai-generation.ts:1559     - response.status: completed
use-ai-generation.ts:1560     - Full response: {
  "job_id": "veo31_fast_1763594525557",
  "status": "completed",
  "message": "Video generated successfully",
  "video_url": "https://v3b.fal.media/files/b/monkey/z-yWt0fy7a1DpPZCUef_B_output.mp4"
}
use-ai-generation.ts:1563 🔍 FIX VERIFICATION: Processing job_id response
use-ai-generation.ts:1564    - job_id exists: true
use-ai-generation.ts:1565    - video_url exists: true
use-ai-generation.ts:1569 🎉 FIX SUCCESS: Direct mode with job_id detected!
use-ai-generation.ts:1570 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/monkey/z-yWt0fy7a1DpPZCUef_B_output.mp4
use-ai-generation.ts:1593 📦 Added to generations array: 1
use-ai-generation.ts:1596 step 6a: media integration condition check
use-ai-generation.ts:1601    - activeProject: true 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9
use-ai-generation.ts:1602    - addMediaItem: true function
use-ai-generation.ts:1603    - response.video_url: true EXISTS
use-ai-generation.ts:1615    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1618 step 6b: executing media integration block
use-ai-generation.ts:1621    - About to download from URL: https://v3b.fal.media/files/b/monkey/z-yWt0fy7a1DpPZCUef_B_output.mp4
use-ai-generation.ts:1625    - Project ID for media: 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9
use-ai-generation.ts:1626    - addMediaItem function type: function
use-ai-generation.ts:1631 step 6: downloading video and adding to media store for veo31_fast_text_to_video
use-ai-generation.ts:1633 🔄 Attempting to add to media store...
use-ai-generation.ts:1634    - Project ID: 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9
use-ai-generation.ts:1635    - addMediaItem available: true
use-ai-generation.ts:1639 📥 Downloading video from URL: https://v3b.fal.media/files/b/monkey/z-yWt0fy7a1DpPZCUef_B_output.mp4
use-ai-generation.ts:1645 step 6c: video download progress
use-ai-generation.ts:1646    - videoResponse.ok: true
use-ai-generation.ts:1647    - videoResponse.status: 200
use-ai-generation.ts:1648    - videoResponse.headers content-type: video/mp4
use-ai-generation.ts:1660 ✅ Downloaded video blob, size: 5962436
use-ai-generation.ts:1664 📄 Created file: AI-Video-veo31_fast_text_to_video-1763594527841.mp4
use-ai-generation.ts:1666 step 6d: file creation complete
use-ai-generation.ts:1667    - blob.size: 5962436 bytes
use-ai-generation.ts:1668    - blob.type: video/mp4
use-ai-generation.ts:1669    - file.name: AI-Video-veo31_fast_text_to_video-1763594527841.mp4
use-ai-generation.ts:1670    - file.size: 5962436
use-ai-generation.ts:1673 step 6e: MANDATORY save to local disk starting
use-ai-generation.ts:1709 ✅ step 6e: video saved to disk successfully {localPath: 'C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\24f91…_text_to_video-1763594527898-29e287b1c6e80b7a.mp4', fileName: 'AI-Video-veo31_fast_text_to_video-1763594527841-ve…_text_to_video-1763594527898-29e287b1c6e80b7a.mp4', fileSize: 5962436}
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./aeacc358-97f6-41f4-9641-4b59d73970ac
blob-url-debug.ts:35   📍 Source: at app://./assets/editor._project_id.lazy-DPwy8xyz.js:108:3482
blob-url-debug.ts:36   📦 Type: File, Size: 5962436 bytes
use-ai-generation.ts:1741 step 6d details: {mediaUrl: 'blob:app://./aeacc358-97f6-41f4-9641-4b59d73970ac', fileName: 'AI-Video-veo31_fast_text_to_video-1763594527841.mp4', fileSize: 5962436}
use-ai-generation.ts:1746 📤 Adding to media store with item: {name: 'AI: supermodel dance...', type: 'video', file: File, url: 'blob:app://./aeacc358-97f6-41f4-9641-4b59d73970ac', originalUrl: 'https://v3b.fal.media/files/b/monkey/z-yWt0fy7a1DpPZCUef_B_output.mp4', …}
use-ai-generation.ts:1748 step 6e: about to call addMediaItem
use-ai-generation.ts:1749    - mediaItem structure: {
  "name": "AI: supermodel dance...",
  "type": "video",
  "file": {},
  "url": "blob:app://./aeacc358-97f6-41f4-9641-4b59d73970ac",
  "originalUrl": "https://v3b.fal.media/files/b/monkey/z-yWt0fy7a1DpPZCUef_B_output.mp4",
  "localPath": "C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\24f91afc-e2a7-4b5c-ad71-15ef6b21fae9\\ai-videos\\AI-Video-veo31_fast_text_to_video-1763594527841-veo31_fast_text_to_video-1763594527898-29e287b1c6e80b7a.mp4",
  "isLocalFile": true,
  "duration": 5,
  "width": 1920,
  "height": 1080,
  "metadata": {
    "source": "text2video",
    "model": "veo31_fast_text_to_video",
    "prompt": "supermodel dance",
    "generatedAt": "2025-11-19T23:22:07.908Z"
  }
}
use-ai-generation.ts:1753    - projectId: 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9
use-ai-generation.ts:1754    - addMediaItem is function: true
media-store.ts:325 step 6g: media-store addMediaItem {projectId: '24f91afc-e2a7-4b5c-ad71-15ef6b21fae9', id: undefined, hasFile: true, url: 'blob:app://./aeacc358-97f6-41f4-9641-4b59d73970ac', originalUrl: 'https://v3b.fal.media/files/b/monkey/z-yWt0fy7a1DpPZCUef_B_output.mp4', …}
media-store.ts:335 [MediaStore.addMediaItem] Called with projectId: 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9, item.name: AI: supermodel dance...
media-store.ts:362 [MediaStore.addMediaItem] Saving media item {projectId: '24f91afc-e2a7-4b5c-ad71-15ef6b21fae9', id: '3d17e39a-33ff-5eb5-1dbe-e57e3eb382f4', name: 'AI: supermodel dance...', type: 'video', hasFile: true, …}
media-store.ts:388 [MediaStore.addMediaItem] Saved to storage {projectId: '24f91afc-e2a7-4b5c-ad71-15ef6b21fae9', id: '3d17e39a-33ff-5eb5-1dbe-e57e3eb382f4', name: 'AI: supermodel dance...', type: 'video'}
use-ai-generation.ts:1764 step 6f: addMediaItem completed {newItemId: '3d17e39a-33ff-5eb5-1dbe-e57e3eb382f4', mediaUrl: 'blob:app://./aeacc358-97f6-41f4-9641-4b59d73970ac', fileName: 'AI-Video-veo31_fast_text_to_video-1763594527841.mp4', fileSize: 5962436}
use-ai-generation.ts:1770    - newItemId: 3d17e39a-33ff-5eb5-1dbe-e57e3eb382f4
use-ai-generation.ts:1771    - SUCCESS: Video added to media store!
use-ai-generation.ts:1773 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1774    - Item ID: 3d17e39a-33ff-5eb5-1dbe-e57e3eb382f4
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
export-all-button.tsx:39 step 8: export-all clicked {totalItems: 1, isExporting: false}
export-all-button.tsx:106 step 8: export-all start zipping {totalItems: 1, hasFiles: 1, remoteUrls: Array(0)}
use-zip-export.ts:34 step 8a: use-zip-export exportToZip called {itemsCount: 1, itemsWithFile: 1, itemsWithLocalPath: 1, itemsWithMetadata: 1, itemsWithText2Video: 1, …}
use-zip-export.ts:63 step 8c: creating ZipManager instance
use-zip-export.ts:67 step 8d: starting addMediaItems
zip-manager.ts:34 step 9: zip-manager starting addMediaItems {totalItems: 1, itemsWithFile: 1, itemsWithLocalPath: 1, itemsWithUrl: 1, electronAPIAvailable: true, …}
zip-manager.ts:52 step 9a: processing item {index: 0, name: 'AI: supermodel dance...', hasFile: true, hasLocalPath: true, localPath: 'C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\24f91…_text_to_video-1763594527898-29e287b1c6e80b7a.mp4', …}
zip-manager.ts:123 step 9a-ai-check: AI detection {name: 'AI: supermodel dance...', metadata: {…}, nameCheck: 'ai: supermodel dance...', isAIGenerated: true, hasLocalPath: true, …}
zip-manager.ts:138 step 9b-ai: AI video detected, prioritizing localPath read {filename: 'AI_ supermodel dance...', localPath: 'C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\24f91…_text_to_video-1763594527898-29e287b1c6e80b7a.mp4', metadataSource: 'text2video', name: 'AI: supermodel dance...'}
zip-manager.ts:147 step 9b-ai-read: readFile returned for AI video {bufferExists: true, bufferLength: 5962436}
zip-manager.ts:157 step 9b-ai-buffer: Buffer details {dataType: '[object Uint8Array]', length: 5962436, firstBytes: '00 00 00 20 66 74 79 70 69 73 6f 6d 00 00 02 00 69 73 6f 6d'}
zip-manager.ts:165 step 9b-ai-success: AI video added from localPath {fileName: 'AI_ supermodel dance...', fileSize: 5962436, localPath: 'C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\24f91…_text_to_video-1763594527898-29e287b1c6e80b7a.mp4'}
use-zip-export.ts:69 step 8e: addMediaItems progress {progress: 1}
zip-manager.ts:320 step 9m: item processing complete {itemName: 'AI: supermodel dance...', completed: 1, total: 1, progress: '1/1'}
zip-manager.ts:335 step 9o: all items processed {totalProcessed: 1, totalItems: 1, zipFiles: 1, zipFileNames: Array(1)}
use-zip-export.ts:77 step 8f: addMediaItems complete
use-zip-export.ts:80 step 8g: starting compression
zip-manager.ts:346 step 10: generating ZIP blob {filesInZip: 1, compression: 'DEFLATE', compressionLevel: 6}
zip-manager.ts:363 step 10a: ZIP blob generated {blobSize: 5959260, blobType: 'application/zip', sizeKB: '5819.59', sizeMB: '5.68'}
use-zip-export.ts:88 step 8h: compression complete {blobSize: 5959260, blobType: 'application/zip'}
use-zip-export.ts:94 step 8i: starting download
use-zip-export.ts:106 step 8j: calling downloadZipSafely {filename: 'media-export-2025-11-19T23-22-44.zip', blobSize: 5959260}
zip-manager.ts:416 step 11: downloadZipSafely called {blobSize: 5959260, blobType: 'application/zip', filename: 'media-export-2025-11-19T23-22-44.zip', electronAPIAvailable: true, saveBlobAvailable: true}
zip-manager.ts:427 step 11a: converting blob to array buffer
zip-manager.ts:430 step 11b: arrayBuffer created {byteLength: 5959260}
zip-manager.ts:435 step 11c: calling electronAPI.saveBlob {uint8ArrayLength: 5959260, uint8ArrayByteLength: 5959260, filename: 'media-export-2025-11-19T23-22-44.zip'}
zip-manager.ts:442 step 11d: saveBlob returned {success: true, filePath: 'C:\\Users\\zdhpe\\Desktop\\media-export-2025-11-19T23-22-44.zip', canceled: undefined, error: undefined}
zip-manager.ts:450 ✅ ZIP saved successfully via Electron: C:\Users\zdhpe\Desktop\media-export-2025-11-19T23-22-44.zip
use-zip-export.ts:111 step 8k: downloadZipSafely complete
use-zip-export.ts:114 step 8l: export complete, updating state
export-all-button.tsx:127 step 8: export-all zip completed {phase: 'idle', totalFiles: 1, completedFiles: 1}