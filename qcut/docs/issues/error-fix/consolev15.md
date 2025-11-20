step 1: selectedModels updated -> ltxv2_fast_t2v
ai.tsx:366 step 2: combinedCapabilities updated Object
ai.tsx:524 [AI View] Progress: 0% - 
use-ai-generation.ts:710 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:711 ============================================================
use-ai-generation.ts:712 === handleGenerate CALLED ===
use-ai-generation.ts:713 ============================================================
use-ai-generation.ts:714 Timestamp: 2025-11-20T01:22:27.202Z
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
use-ai-generation.ts:887 step 4: sanitized params for ltxv2_fast_t2v Object
use-ai-generation.ts:892 
🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
use-ai-generation.ts:915 step 5: sending generation request for ltxv2_fast_t2v (text tab) Object
use-ai-generation.ts:921   📝 Processing text-to-video model ltxv2_fast_t2v...
use-ai-generation.ts:905   📊 Progress for ltxv2_fast_t2v: Object
ai-video-client.ts:1840 🎬 Starting LTX Video 2.0 generation with FAL AI
ai-video-client.ts:1841 📝 Prompt: supermodel dance
ai-video-client.ts:1842 📐 Resolution: 1080p
31ai.tsx:524 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
use-ai-generation.ts:905   📊 Progress for ltxv2_fast_t2v: Object
use-ai-generation.ts:1058   ✅ Text-to-video response: Object
use-ai-generation.ts:1536 step 5a: post-API response analysis
use-ai-generation.ts:1537    - response received: true
use-ai-generation.ts:1539    - response.video_url: true https://v3b.fal.media/files/b/monkey/YEXswezIMqFEG...
use-ai-generation.ts:1544    - response.job_id: true job_pjarbxrew_1763601747202
use-ai-generation.ts:1549    - response keys: Array(6)
use-ai-generation.ts:1550    - response.status: completed
use-ai-generation.ts:1555 
  🔍 Response analysis for ltxv2_fast_t2v:
use-ai-generation.ts:1556     - response exists: true
use-ai-generation.ts:1557     - response.job_id: job_pjarbxrew_1763601747202
use-ai-generation.ts:1558     - response.video_url: https://v3b.fal.media/files/b/monkey/YEXswezIMqFEGS2-3gd80_mcsEVs6g.mp4
use-ai-generation.ts:1559     - response.status: completed
use-ai-generation.ts:1560     - Full response: {
  "job_id": "job_pjarbxrew_1763601747202",
  "status": "completed",
  "message": "Video generated successfully with ltxv2_fast_t2v",
  "estimated_time": 0,
  "video_url": "https://v3b.fal.media/files/b/monkey/YEXswezIMqFEGS2-3gd80_mcsEVs6g.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/monkey/YEXswezIMqFEGS2-3gd80_mcsEVs6g.mp4",
      "content_type": "video/mp4",
      "file_name": "YEXswezIMqFEGS2-3gd80_mcsEVs6g.mp4",
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
use-ai-generation.ts:1570 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/monkey/YEXswezIMqFEGS2-3gd80_mcsEVs6g.mp4
use-ai-generation.ts:1593 📦 Added to generations array: 1
use-ai-generation.ts:1596 step 6a: media integration condition check
use-ai-generation.ts:1601    - activeProject: true 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9
use-ai-generation.ts:1602    - addMediaItem: true function
use-ai-generation.ts:1603    - response.video_url: true EXISTS
use-ai-generation.ts:1615    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1618 step 6b: executing media integration block
use-ai-generation.ts:1621    - About to download from URL: https://v3b.fal.media/files/b/monkey/YEXswezIMqFEGS2-3gd80_mcsEVs6g.mp4
use-ai-generation.ts:1625    - Project ID for media: 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9
use-ai-generation.ts:1626    - addMediaItem function type: function
use-ai-generation.ts:1631 step 6: downloading video and adding to media store for ltxv2_fast_t2v
use-ai-generation.ts:1633 🔄 Attempting to add to media store...
use-ai-generation.ts:1634    - Project ID: 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9
use-ai-generation.ts:1635    - addMediaItem available: true
use-ai-generation.ts:1639 📥 Downloading video from URL: https://v3b.fal.media/files/b/monkey/YEXswezIMqFEGS2-3gd80_mcsEVs6g.mp4
2ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1645 step 6c: video download progress
use-ai-generation.ts:1646    - videoResponse.ok: true
use-ai-generation.ts:1647    - videoResponse.status: 200
use-ai-generation.ts:1648    - videoResponse.headers content-type: video/mp4
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1660 ✅ Downloaded video blob, size: 6454888
use-ai-generation.ts:1664 📄 Created file: AI-Video-ltxv2_fast_t2v-1763601780201.mp4
use-ai-generation.ts:1666 step 6d: file creation complete
use-ai-generation.ts:1667    - blob.size: 6454888 bytes
use-ai-generation.ts:1668    - blob.type: video/mp4
use-ai-generation.ts:1669    - file.name: AI-Video-ltxv2_fast_t2v-1763601780201.mp4
use-ai-generation.ts:1670    - file.size: 6454888
use-ai-generation.ts:1673 step 6e: MANDATORY save to local disk starting
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1709 ✅ step 6e: video saved to disk successfully Object
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./7f0a4554-93c6-412d-bc9f-fbe69be2c187
blob-url-debug.ts:35   📍 Source: at app://./assets/editor._project_id.lazy-CYs72Rgp.js:108:3482
blob-url-debug.ts:36   📦 Type: File, Size: 6454888 bytes
use-ai-generation.ts:1741 step 6d details: Object
use-ai-generation.ts:1746 📤 Adding to media store with item: Object
use-ai-generation.ts:1748 step 6e: about to call addMediaItem
use-ai-generation.ts:1749    - mediaItem structure: {
  "name": "AI: supermodel dance...",
  "type": "video",
  "file": {},
  "url": "blob:app://./7f0a4554-93c6-412d-bc9f-fbe69be2c187",
  "originalUrl": "https://v3b.fal.media/files/b/monkey/YEXswezIMqFEGS2-3gd80_mcsEVs6g.mp4",
  "localPath": "C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\24f91afc-e2a7-4b5c-ad71-15ef6b21fae9\\ai-videos\\AI-Video-ltxv2_fast_t2v-1763601780201-ltxv2_fast_t2v-1763601780256-46f6bbdf215fd87d.mp4",
  "isLocalFile": true,
  "duration": 6.12,
  "width": 1920,
  "height": 1080,
  "metadata": {
    "source": "text2video",
    "model": "ltxv2_fast_t2v",
    "prompt": "supermodel dance",
    "generatedAt": "2025-11-20T01:23:00.265Z"
  }
}
use-ai-generation.ts:1753    - projectId: 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9
use-ai-generation.ts:1754    - addMediaItem is function: true
media-store.ts:325 step 6g: media-store addMediaItem Object
media-store.ts:335 [MediaStore.addMediaItem] Called with projectId: 24f91afc-e2a7-4b5c-ad71-15ef6b21fae9, item.name: AI: supermodel dance...
media-store.ts:362 [MediaStore.addMediaItem] Saving media item Object
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
media-store.ts:388 [MediaStore.addMediaItem] Saved to storage Object
use-ai-generation.ts:1764 step 6f: addMediaItem completed Object
use-ai-generation.ts:1770    - newItemId: 59f4142e-d2a9-14d6-c046-6b2e21890569
use-ai-generation.ts:1771    - SUCCESS: Video added to media store!
use-ai-generation.ts:1773 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1774    - Item ID: 59f4142e-d2a9-14d6-c046-6b2e21890569
use-ai-generation.ts:2036 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:2037   - Total generations created: 1
use-ai-generation.ts:2038   - Generations: Array(1)
use-ai-generation.ts:2043 step 7: generation flow complete; updating UI and callbacks
use-ai-generation.ts:2045 📤 Calling onComplete callback with 1 videos
ai.tsx:532 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:533 [AI View] Received 1 videos: Array(1)
ai.tsx:538 [AI View] onComplete callback finished
use-ai-generation.ts:2049 ✅ onComplete callback finished
ai.tsx:524 [AI View] Progress: 100% - Generated 1 videos successfully!
export-all-button.tsx:39 step 8: export-all clicked Object
export-all-button.tsx:106 step 8: export-all start zipping Object
use-zip-export.ts:34 step 8a: use-zip-export exportToZip called Object
use-zip-export.ts:63 step 8c: creating ZipManager instance
use-zip-export.ts:67 step 8d: starting addMediaItems
zip-manager.ts:34 step 9: zip-manager starting addMediaItems Object
zip-manager.ts:53 step 9a: processing item Object
zip-manager.ts:108 step 9a-filename Object
zip-manager.ts:148 step 9a-ai-check: AI detection Object
zip-manager.ts:163 step 9b-ai: AI video detected, prioritizing localPath read Object
zip-manager.ts:172 step 9b-ai-read: readFile returned for AI video Object
zip-manager.ts:471 step 9b-ai-buffer: normalized buffer Object
zip-manager.ts:188 step 9b-ai-success: AI video added from localPath ObjectfileName: "AI_ supermodel dance"fileSize: 6454888localPath: "C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\24f91afc-e2a7-4b5c-ad71-15ef6b21fae9\\ai-videos\\AI-Video-ltxv2_fast_t2v-1763601780201-ltxv2_fast_t2v-1763601780256-46f6bbdf215fd87d.mp4"[[Prototype]]: Object
use-zip-export.ts:69 step 8e: addMediaItems progress Objectprogress: 1[[Prototype]]: Objectconstructor: ƒ Object()hasOwnProperty: ƒ hasOwnProperty()isPrototypeOf: ƒ isPrototypeOf()propertyIsEnumerable: ƒ propertyIsEnumerable()toLocaleString: ƒ toLocaleString()toString: ƒ toString()valueOf: ƒ valueOf()__defineGetter__: ƒ __defineGetter__()__defineSetter__: ƒ __defineSetter__()__lookupGetter__: ƒ __lookupGetter__()__lookupSetter__: ƒ __lookupSetter__()__proto__: (...)get __proto__: ƒ __proto__()set __proto__: ƒ __proto__()
zip-manager.ts:350 step 9m: item processing complete Object
zip-manager.ts:365 step 9o: all items processed Object
use-zip-export.ts:77 step 8f: addMediaItems complete
use-zip-export.ts:80 step 8g: starting compression
zip-manager.ts:376 step 10: generating ZIP blob Object
zip-manager.ts:393 step 10a: ZIP blob generated Object
use-zip-export.ts:88 step 8h: compression complete Object
use-zip-export.ts:94 step 8i: starting download
use-zip-export.ts:106 step 8j: calling downloadZipSafely Object
zip-manager.ts:511 step 11: downloadZipSafely called Object
zip-manager.ts:522 step 11a: converting blob to array buffer
zip-manager.ts:525 step 11b: arrayBuffer created Object
zip-manager.ts:530 step 11c: calling electronAPI.saveBlob Object
zip-manager.ts:537 step 11d: saveBlob returned Object
zip-manager.ts:545 ✅ ZIP saved successfully via Electron: C:\Users\zdhpe\Desktop\media-export-2025-11-20T01-23-06.zip
use-zip-export.ts:111 step 8k: downloadZipSafely complete
use-zip-export.ts:114 step 8l: export complete, updating state
export-all-button.tsx:127 step 8: export-all zip completed Object