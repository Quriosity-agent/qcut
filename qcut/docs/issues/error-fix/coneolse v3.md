step 1: selectedModels updated -> [none]
ai.tsx:366 step 2: combinedCapabilities updated Object
ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:358 step 1: selectedModels updated -> [none]
ai.tsx:366 step 2: combinedCapabilities updated Object
2ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:358 step 1: selectedModels updated -> ltxv2_fast_t2v
ai.tsx:366 step 2: combinedCapabilities updated Object
2ai.tsx:524 [AI View] Progress: 0% - 
use-ai-generation.ts:710 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:711 ============================================================
use-ai-generation.ts:712 === handleGenerate CALLED ===
use-ai-generation.ts:713 ============================================================
use-ai-generation.ts:714 Timestamp: 2025-11-19T04:21:14.326Z
use-ai-generation.ts:715 Input parameters:
use-ai-generation.ts:716   - activeTab: text
use-ai-generation.ts:717   - prompt: Black screen. Water dripping echoes. Camera slowly pushes in, abandoned underground parking garage, ...
use-ai-generation.ts:722   - prompt length: 309
use-ai-generation.ts:723   - selectedModels: Array(1)
use-ai-generation.ts:724   - hasSelectedImage: false
use-ai-generation.ts:725   - imageFile: null
use-ai-generation.ts:733   - activeProject: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:734   - activeProject name: New Project
use-ai-generation.ts:735   - addMediaItem available: true
use-ai-generation.ts:736 
use-ai-generation.ts:801 ✅ Validation passed, starting generation...
use-ai-generation.ts:802   - Models to process: 1
use-ai-generation.ts:803   - Active project: true
use-ai-generation.ts:804   - Media store available: true
use-ai-generation.ts:817 step 3a: pre-generation state check
use-ai-generation.ts:818    - activeProject: true b7b8104f-86b3-47fd-a863-fe46fe49fc5e
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
ai-video-client.ts:1841 📝 Prompt: Black screen. Water dripping echoes. Camera slowly pushes in, abandoned underground parking garage, 
ai-video-client.ts:1842 📐 Resolution: 1080p
2ai.tsx:524 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
ai.tsx:524 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
29ai.tsx:524 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
use-ai-generation.ts:905   📊 Progress for ltxv2_fast_t2v: {status: 'completed', progress: 100, message: 'Video with audio generated using LTX Video 2.0 Fast T2V'}
use-ai-generation.ts:1058   ✅ Text-to-video response: {job_id: 'job_lxu29qvra_1763526074328', status: 'completed', message: 'Video generated successfully with ltxv2_fast_t2v', estimated_time: 0, video_url: 'https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4', …}
use-ai-generation.ts:1536 step 5a: post-API response analysis
use-ai-generation.ts:1537    - response received: true
use-ai-generation.ts:1539    - response.video_url: true https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hc...
use-ai-generation.ts:1544    - response.job_id: true job_lxu29qvra_1763526074328
use-ai-generation.ts:1549    - response keys: (6) ['job_id', 'status', 'message', 'estimated_time', 'video_url', 'video_data']
use-ai-generation.ts:1550    - response.status: completed
use-ai-generation.ts:1555 
  🔍 Response analysis for ltxv2_fast_t2v:
use-ai-generation.ts:1556     - response exists: true
use-ai-generation.ts:1557     - response.job_id: job_lxu29qvra_1763526074328
use-ai-generation.ts:1558     - response.video_url: https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4
use-ai-generation.ts:1559     - response.status: completed
use-ai-generation.ts:1560     - Full response: {
  "job_id": "job_lxu29qvra_1763526074328",
  "status": "completed",
  "message": "Video generated successfully with ltxv2_fast_t2v",
  "estimated_time": 0,
  "video_url": "https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4",
      "content_type": "video/mp4",
      "file_name": "JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4",
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
use-ai-generation.ts:1570 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4
use-ai-generation.ts:1593 📦 Added to generations array: 1
use-ai-generation.ts:1596 step 6a: media integration condition check
use-ai-generation.ts:1601    - activeProject: true b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1602    - addMediaItem: true function
use-ai-generation.ts:1603    - response.video_url: true EXISTS
use-ai-generation.ts:1615    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1618 step 6b: executing media integration block
use-ai-generation.ts:1621    - About to download from URL: https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4
use-ai-generation.ts:1625    - Project ID for media: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1626    - addMediaItem function type: function
use-ai-generation.ts:1631 step 6: downloading video and adding to media store for ltxv2_fast_t2v
use-ai-generation.ts:1633 🔄 Attempting to add to media store...
use-ai-generation.ts:1634    - Project ID: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1635    - addMediaItem available: true
use-ai-generation.ts:1639 📥 Downloading video from URL: https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4
2ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1645 step 6c: video download progress
use-ai-generation.ts:1646    - videoResponse.ok: true
use-ai-generation.ts:1647    - videoResponse.status: 200
use-ai-generation.ts:1648    - videoResponse.headers content-type: video/mp4
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1660 ✅ Downloaded video blob, size: 1787004
use-ai-generation.ts:1664 📄 Created file: AI-Video-ltxv2_fast_t2v-1763526107802.mp4
use-ai-generation.ts:1666 step 6d: file creation complete
use-ai-generation.ts:1667    - blob.size: 1787004 bytes
use-ai-generation.ts:1668    - blob.type: video/mp4
use-ai-generation.ts:1669    - file.name: AI-Video-ltxv2_fast_t2v-1763526107802.mp4
use-ai-generation.ts:1670    - file.size: 1787004
use-ai-generation.ts:1683 step 6d details: {mediaUrl: 'https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4', fileName: 'AI-Video-ltxv2_fast_t2v-1763526107802.mp4', fileSize: 1787004}
use-ai-generation.ts:1688 📤 Adding to media store with item: {name: 'AI: Black screen. Water dripping e...', type: 'video', file: File, url: 'https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4', duration: 6.12, …}
use-ai-generation.ts:1690 step 6e: about to call addMediaItem
use-ai-generation.ts:1691    - mediaItem structure: {
  "name": "AI: Black screen. Water dripping e...",
  "type": "video",
  "file": {},
  "url": "https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4",
  "duration": 6.12,
  "width": 1920,
  "height": 1080
}
use-ai-generation.ts:1695    - projectId: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1696    - addMediaItem is function: true
media-store.ts:326 [MediaStore.addMediaItem] Called with projectId: b7b8104f-86b3-47fd-a863-fe46fe49fc5e, item.name: AI: Black screen. Water dripping e...
media-store.ts:353 [MediaStore.addMediaItem] Saving media item {projectId: 'b7b8104f-86b3-47fd-a863-fe46fe49fc5e', id: 'aabf8027-b857-60c6-872f-e9bf25d7eada', name: 'AI: Black screen. Water dripping e...', type: 'video', hasFile: true, …}
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
media-store.ts:379 [MediaStore.addMediaItem] Saved to storage {projectId: 'b7b8104f-86b3-47fd-a863-fe46fe49fc5e', id: 'aabf8027-b857-60c6-872f-e9bf25d7eada', name: 'AI: Black screen. Water dripping e...', type: 'video'}
use-ai-generation.ts:1706 step 6f: addMediaItem completed {newItemId: 'aabf8027-b857-60c6-872f-e9bf25d7eada', mediaUrl: 'https://v3b.fal.media/files/b/panda/JoHp0YofJHq2hcFz9nmLP_oUInAh5q.mp4', fileName: 'AI-Video-ltxv2_fast_t2v-1763526107802.mp4', fileSize: 1787004}
use-ai-generation.ts:1712    - newItemId: aabf8027-b857-60c6-872f-e9bf25d7eada
use-ai-generation.ts:1713    - SUCCESS: Video added to media store!
use-ai-generation.ts:1715 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1716    - Item ID: aabf8027-b857-60c6-872f-e9bf25d7eada
use-ai-generation.ts:1927 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:1928   - Total generations created: 1
use-ai-generation.ts:1929   - Generations: [{…}]
use-ai-generation.ts:1934 step 7: generation flow complete; updating UI and callbacks
use-ai-generation.ts:1936 📤 Calling onComplete callback with 1 videos
ai.tsx:532 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:533 [AI View] Received 1 videos: [{…}]
ai.tsx:538 [AI View] onComplete callback finished
use-ai-generation.ts:1940 ✅ onComplete callback finished
ai.tsx:524 [AI View] Progress: 100% - Generated 1 videos successfully!