AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
use-ai-generation.ts:905   📊 Progress for ltxv2_fast_t2v: {status: 'completed', progress: 100, message: 'Video with audio generated using LTX Video 2.0 Fast T2V'}
use-ai-generation.ts:1058   ✅ Text-to-video response: {job_id: 'job_27hd5hmpc_1763527130063', status: 'completed', message: 'Video generated successfully with ltxv2_fast_t2v', estimated_time: 0, video_url: 'https://v3b.fal.media/files/b/lion/Q0FmGipkB1Ok_yRTusZz4_7V1UL2p8.mp4', …}
use-ai-generation.ts:1536 step 5a: post-API response analysis
use-ai-generation.ts:1537    - response received: true
use-ai-generation.ts:1539    - response.video_url: true https://v3b.fal.media/files/b/lion/Q0FmGipkB1Ok_yR...
use-ai-generation.ts:1544    - response.job_id: true job_27hd5hmpc_1763527130063
use-ai-generation.ts:1549    - response keys: (6) ['job_id', 'status', 'message', 'estimated_time', 'video_url', 'video_data']
use-ai-generation.ts:1550    - response.status: completed
use-ai-generation.ts:1555 
  🔍 Response analysis for ltxv2_fast_t2v:
use-ai-generation.ts:1556     - response exists: true
use-ai-generation.ts:1557     - response.job_id: job_27hd5hmpc_1763527130063
use-ai-generation.ts:1558     - response.video_url: https://v3b.fal.media/files/b/lion/Q0FmGipkB1Ok_yRTusZz4_7V1UL2p8.mp4
use-ai-generation.ts:1559     - response.status: completed
use-ai-generation.ts:1560     - Full response: {
  "job_id": "job_27hd5hmpc_1763527130063",
  "status": "completed",
  "message": "Video generated successfully with ltxv2_fast_t2v",
  "estimated_time": 0,
  "video_url": "https://v3b.fal.media/files/b/lion/Q0FmGipkB1Ok_yRTusZz4_7V1UL2p8.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/lion/Q0FmGipkB1Ok_yRTusZz4_7V1UL2p8.mp4",
      "content_type": "video/mp4",
      "file_name": "Q0FmGipkB1Ok_yRTusZz4_7V1UL2p8.mp4",
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
use-ai-generation.ts:1570 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/lion/Q0FmGipkB1Ok_yRTusZz4_7V1UL2p8.mp4
use-ai-generation.ts:1593 📦 Added to generations array: 1
use-ai-generation.ts:1596 step 6a: media integration condition check
use-ai-generation.ts:1601    - activeProject: true b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1602    - addMediaItem: true function
use-ai-generation.ts:1603    - response.video_url: true EXISTS
use-ai-generation.ts:1615    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1618 step 6b: executing media integration block
use-ai-generation.ts:1621    - About to download from URL: https://v3b.fal.media/files/b/lion/Q0FmGipkB1Ok_yRTusZz4_7V1UL2p8.mp4
use-ai-generation.ts:1625    - Project ID for media: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1626    - addMediaItem function type: function
use-ai-generation.ts:1631 step 6: downloading video and adding to media store for ltxv2_fast_t2v
use-ai-generation.ts:1633 🔄 Attempting to add to media store...
use-ai-generation.ts:1634    - Project ID: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1635    - addMediaItem available: true
use-ai-generation.ts:1639 📥 Downloading video from URL: https://v3b.fal.media/files/b/lion/Q0FmGipkB1Ok_yRTusZz4_7V1UL2p8.mp4
2ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1645 step 6c: video download progress
use-ai-generation.ts:1646    - videoResponse.ok: true
use-ai-generation.ts:1647    - videoResponse.status: 200
use-ai-generation.ts:1648    - videoResponse.headers content-type: video/mp4
2ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1660 ✅ Downloaded video blob, size: 3096904
use-ai-generation.ts:1664 📄 Created file: AI-Video-ltxv2_fast_t2v-1763527164402.mp4
use-ai-generation.ts:1666 step 6d: file creation complete
use-ai-generation.ts:1667    - blob.size: 3096904 bytes
use-ai-generation.ts:1668    - blob.type: video/mp4
use-ai-generation.ts:1669    - file.name: AI-Video-ltxv2_fast_t2v-1763527164402.mp4
use-ai-generation.ts:1670    - file.size: 3096904
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./c93115cb-1dbd-4c2d-b9bc-fe8cd88e26b3
blob-url-debug.ts:35   📍 Source: at app://./assets/editor._project_id.lazy-Bk4REfPO.js:108:2666
blob-url-debug.ts:36   📦 Type: File, Size: 3096904 bytes
use-ai-generation.ts:1688 step 6d details: {mediaUrl: 'blob:app://./c93115cb-1dbd-4c2d-b9bc-fe8cd88e26b3', fileName: 'AI-Video-ltxv2_fast_t2v-1763527164402.mp4', fileSize: 3096904}
use-ai-generation.ts:1693 📤 Adding to media store with item: {name: 'AI: Black screen. Water dripping e...', type: 'video', file: File, url: 'blob:app://./c93115cb-1dbd-4c2d-b9bc-fe8cd88e26b3', originalUrl: 'https://v3b.fal.media/files/b/lion/Q0FmGipkB1Ok_yRTusZz4_7V1UL2p8.mp4', …}
use-ai-generation.ts:1695 step 6e: about to call addMediaItem
use-ai-generation.ts:1696    - mediaItem structure: {
  "name": "AI: Black screen. Water dripping e...",
  "type": "video",
  "file": {},
  "url": "blob:app://./c93115cb-1dbd-4c2d-b9bc-fe8cd88e26b3",
  "originalUrl": "https://v3b.fal.media/files/b/lion/Q0FmGipkB1Ok_yRTusZz4_7V1UL2p8.mp4",
  "duration": 6.12,
  "width": 1920,
  "height": 1080
}
use-ai-generation.ts:1700    - projectId: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1701    - addMediaItem is function: true
media-store.ts:326 [MediaStore.addMediaItem] Called with projectId: b7b8104f-86b3-47fd-a863-fe46fe49fc5e, item.name: AI: Black screen. Water dripping e...
media-store.ts:353 [MediaStore.addMediaItem] Saving media item {projectId: 'b7b8104f-86b3-47fd-a863-fe46fe49fc5e', id: 'bf7f1c36-39a6-d91d-34cd-b9e4227840e9', name: 'AI: Black screen. Water dripping e...', type: 'video', hasFile: true, …}
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
media-store.ts:379 [MediaStore.addMediaItem] Saved to storage {projectId: 'b7b8104f-86b3-47fd-a863-fe46fe49fc5e', id: 'bf7f1c36-39a6-d91d-34cd-b9e4227840e9', name: 'AI: Black screen. Water dripping e...', type: 'video'}
use-ai-generation.ts:1711 step 6f: addMediaItem completed {newItemId: 'bf7f1c36-39a6-d91d-34cd-b9e4227840e9', mediaUrl: 'blob:app://./c93115cb-1dbd-4c2d-b9bc-fe8cd88e26b3', fileName: 'AI-Video-ltxv2_fast_t2v-1763527164402.mp4', fileSize: 3096904}
use-ai-generation.ts:1717    - newItemId: bf7f1c36-39a6-d91d-34cd-b9e4227840e9
use-ai-generation.ts:1718    - SUCCESS: Video added to media store!
use-ai-generation.ts:1720 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1721    - Item ID: bf7f1c36-39a6-d91d-34cd-b9e4227840e9
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