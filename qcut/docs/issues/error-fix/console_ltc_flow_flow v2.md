5ai.tsx:508 [AI View] Progress: 0% - 
use-ai-generation.ts:710 ============================================================
use-ai-generation.ts:711 === handleGenerate CALLED ===
use-ai-generation.ts:712 ============================================================
use-ai-generation.ts:713 Timestamp: 2025-11-18T06:41:22.297Z
use-ai-generation.ts:714 Input parameters:
use-ai-generation.ts:715   - activeTab: text
use-ai-generation.ts:716   - prompt: She holds phone pretending to selfie, each pose displaying her perfect body curves, actually photogr...
use-ai-generation.ts:721   - prompt length: 143
use-ai-generation.ts:722   - selectedModels: Array(1)
use-ai-generation.ts:723   - hasSelectedImage: false
use-ai-generation.ts:724   - imageFile: null
use-ai-generation.ts:732   - activeProject: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:733   - activeProject name: New Project
use-ai-generation.ts:734   - addMediaItem available: true
use-ai-generation.ts:735 
use-ai-generation.ts:800 ✅ Validation passed, starting generation...
use-ai-generation.ts:801   - Models to process: 1
use-ai-generation.ts:802   - Active project: true
use-ai-generation.ts:803   - Media store available: true
use-ai-generation.ts:816 🔍 DEBUG STEP 1: Pre-Generation State Check
use-ai-generation.ts:817    - activeProject: true b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:818    - addMediaItem available: true function
use-ai-generation.ts:823    - mediaStoreLoading: false
use-ai-generation.ts:824    - mediaStoreError: null
use-ai-generation.ts:827 
📦 Starting generation for 1 models
use-ai-generation.ts:886 
🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
use-ai-generation.ts:910   📝 Processing text-to-video model ltxv2_fast_t2v...
use-ai-generation.ts:899   📊 Progress for ltxv2_fast_t2v: Object
ai-video-client.ts:1840 🎬 Starting LTX Video 2.0 generation with FAL AI
ai-video-client.ts:1841 📝 Prompt: She holds phone pretending to selfie, each pose displaying her perfect body curves, actually photogr
ai-video-client.ts:1842 📐 Resolution: 1080p
3ai.tsx:508 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
33ai.tsx:508 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
use-ai-generation.ts:899   📊 Progress for ltxv2_fast_t2v: {status: 'completed', progress: 100, message: 'Video with audio generated using LTX Video 2.0 Fast T2V'}
use-ai-generation.ts:1047   ✅ Text-to-video response: {job_id: 'job_idyam2op4_1763448082299', status: 'completed', message: 'Video generated successfully with ltxv2_fast_t2v', estimated_time: 0, video_url: 'https://v3b.fal.media/files/b/panda/MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4', …}
use-ai-generation.ts:1525 🔍 DEBUG STEP 2: Post-API Response Analysis
use-ai-generation.ts:1526    - response received: true
use-ai-generation.ts:1528    - response.video_url: true https://v3b.fal.media/files/b/panda/MIN8MNb1_GxIti...
use-ai-generation.ts:1533    - response.job_id: true job_idyam2op4_1763448082299
use-ai-generation.ts:1538    - response keys: (6) ['job_id', 'status', 'message', 'estimated_time', 'video_url', 'video_data']
use-ai-generation.ts:1539    - response.status: completed
use-ai-generation.ts:1544 
  🔍 Response analysis for ltxv2_fast_t2v:
use-ai-generation.ts:1545     - response exists: true
use-ai-generation.ts:1546     - response.job_id: job_idyam2op4_1763448082299
use-ai-generation.ts:1547     - response.video_url: https://v3b.fal.media/files/b/panda/MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4
use-ai-generation.ts:1548     - response.status: completed
use-ai-generation.ts:1549     - Full response: {
  "job_id": "job_idyam2op4_1763448082299",
  "status": "completed",
  "message": "Video generated successfully with ltxv2_fast_t2v",
  "estimated_time": 0,
  "video_url": "https://v3b.fal.media/files/b/panda/MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/panda/MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4",
      "content_type": "video/mp4",
      "file_name": "MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4",
      "file_size": null,
      "width": 1920,
      "height": 1080,
      "fps": 25,
      "duration": 6.12,
      "num_frames": 153
    }
  }
}
use-ai-generation.ts:1552 🔍 FIX VERIFICATION: Processing job_id response
use-ai-generation.ts:1553    - job_id exists: true
use-ai-generation.ts:1554    - video_url exists: true
use-ai-generation.ts:1558 🎉 FIX SUCCESS: Direct mode with job_id detected!
use-ai-generation.ts:1559 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/panda/MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4
use-ai-generation.ts:1582 📦 Added to generations array: 1
use-ai-generation.ts:1585 🔍 DEBUG STEP 3: Media Integration Condition Check
use-ai-generation.ts:1586    - activeProject check: true → b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1592    - addMediaItem check: true → function
use-ai-generation.ts:1598    - response.video_url check: true → EXISTS
use-ai-generation.ts:1604    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1610 🔍 DEBUG STEP 4: ✅ EXECUTING Media Integration Block
use-ai-generation.ts:1613    - About to download from URL: https://v3b.fal.media/files/b/panda/MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4
use-ai-generation.ts:1617    - Project ID for media: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1618    - addMediaItem function type: function
use-ai-generation.ts:1623 🔄 Attempting to add to media store...
use-ai-generation.ts:1624    - Project ID: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1625    - addMediaItem available: true
use-ai-generation.ts:1629 📥 Downloading video from URL: https://v3b.fal.media/files/b/panda/MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4
ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1635 🔍 DEBUG STEP 5: Video Download Progress
use-ai-generation.ts:1636    - videoResponse.ok: true
use-ai-generation.ts:1637    - videoResponse.status: 200
use-ai-generation.ts:1638    - videoResponse.headers content-type: video/mp4
2ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1650 ✅ Downloaded video blob, size: 4809464
use-ai-generation.ts:1654 📄 Created file: AI-Video-ltxv2_fast_t2v-1763448119851.mp4
use-ai-generation.ts:1656 🔍 DEBUG STEP 6: File Creation Complete
use-ai-generation.ts:1657    - blob.size: 4809464 bytes
use-ai-generation.ts:1658    - blob.type: video/mp4
use-ai-generation.ts:1659    - file.name: AI-Video-ltxv2_fast_t2v-1763448119851.mp4
use-ai-generation.ts:1660    - file.size: 4809464
use-ai-generation.ts:1673 📤 Adding to media store with item: {name: 'AI: She holds phone pretending to ...', type: 'video', file: File, url: 'https://v3b.fal.media/files/b/panda/MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4', duration: 6.12, …}
use-ai-generation.ts:1675 🔍 DEBUG STEP 7: About to Call addMediaItem
use-ai-generation.ts:1676    - mediaItem structure: {
  "name": "AI: She holds phone pretending to ...",
  "type": "video",
  "file": {},
  "url": "https://v3b.fal.media/files/b/panda/MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4",
  "duration": 6.12,
  "width": 1920,
  "height": 1080
}
use-ai-generation.ts:1680    - projectId: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1681    - addMediaItem is function: true
media-store.ts:326 [MediaStore.addMediaItem] Called with projectId: b7b8104f-86b3-47fd-a863-fe46fe49fc5e, item.name: AI: She holds phone pretending to ...
media-store.ts:353 [MediaStore.addMediaItem] Saving media item {projectId: 'b7b8104f-86b3-47fd-a863-fe46fe49fc5e', id: 'acfd5bed-3d4a-0a69-a763-4553dc601ca7', name: 'AI: She holds phone pretending to ...', type: 'video', hasFile: true, …}
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./7ce29a93-a11c-4eb4-b20b-8a3ea256e4f0
blob-url-debug.ts:35   📍 Source: at om (app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:83150) →     at q (app://./assets/editor._project_id.lazy-BTvKc6HC.js:300:20696)
blob-url-debug.ts:36   📦 Type: File, Size: 4116534 bytes
preview-panel.tsx:745 [PreviewPanel] Foreground video source: blob
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./b7f2bc69-8e85-4db2-9fc8-a06b98416c96
blob-url-debug.ts:35   📍 Source: at om (app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:83150) →     at q (app://./assets/editor._project_id.lazy-BTvKc6HC.js:300:20696)
blob-url-debug.ts:36   📦 Type: File, Size: 4116534 bytes
preview-panel.tsx:745 [PreviewPanel] Foreground video source: blob
blob-url-debug.ts:59 [BlobUrlDebug] 🔴 Revoked: blob:app://./eff17018-edd9-4794-98a0-9e783aee462e
blob-url-debug.ts:60   📍 Created by: at om (app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:83150) →     at q (app://./assets/editor._project_id.lazy-BTvKc6HC.js:300:20696)
blob-url-debug.ts:61   🗑️ Revoked by: at app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:80585 →     at lp (app://./assets/vendor-react-B3J_7M5d.js:161:20757)
blob-url-debug.ts:62   ⏱️ Lifespan: 77493ms
ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
media-store.ts:379 [MediaStore.addMediaItem] Saved to storage {projectId: 'b7b8104f-86b3-47fd-a863-fe46fe49fc5e', id: 'acfd5bed-3d4a-0a69-a763-4553dc601ca7', name: 'AI: She holds phone pretending to ...', type: 'video'}
use-ai-generation.ts:1691 🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED
use-ai-generation.ts:1692    - newItemId: acfd5bed-3d4a-0a69-a763-4553dc601ca7
use-ai-generation.ts:1693    - SUCCESS: Video added to media store!
use-ai-generation.ts:1695 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1696    - Item ID: acfd5bed-3d4a-0a69-a763-4553dc601ca7
use-ai-generation.ts:1900 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:1901   - Total generations created: 1
use-ai-generation.ts:1902   - Generations: [{…}]
use-ai-generation.ts:1907 📤 Calling onComplete callback with 1 videos
ai.tsx:516 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:517 [AI View] Received 1 videos: [{…}]
ai.tsx:522 [AI View] onComplete callback finished
use-ai-generation.ts:1911 ✅ onComplete callback finished
ai.tsx:508 [AI View] Progress: 100% - Generated 1 videos successfully!
video-player.tsx:177 ✅ [VideoPlayer] Video ready to play: blob:app://./b7f2bc69-8e85-4db2-9fc8-a06b98416c96
preview-panel.tsx:70 🎬 PREVIEW PANEL: No effects (enabled: true, elementId: null)
preview-panel.tsx:84 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
preview-panel.tsx:70 🎬 PREVIEW PANEL: No effects (enabled: true, elementId: null)
preview-panel.tsx:84 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
blob-url-debug.ts:59 [BlobUrlDebug] 🔴 Revoked: blob:app://./b7f2bc69-8e85-4db2-9fc8-a06b98416c96
blob-url-debug.ts:60   📍 Created by: at om (app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:83150) →     at q (app://./assets/editor._project_id.lazy-BTvKc6HC.js:300:20696)
blob-url-debug.ts:61   🗑️ Revoked by: at app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:80585 →     at lp (app://./assets/vendor-react-B3J_7M5d.js:161:20757)
blob-url-debug.ts:62   ⏱️ Lifespan: 13244ms
timeline-track.tsx:696 {"message":"Drop event started in timeline track","dataTransferTypes":["application/x-media-item"],"trackId":"67b0f962-ab22-414a-868a-3aa1d33e405c","trackType":"media"}
timeline-track.tsx:938 [TimelineTrack] Processing media item drop: {dragDataId: 'acfd5bed-3d4a-0a69-a763-4553dc601ca7', dragDataType: 'video', dragDataName: 'AI: She holds phone pretending to ...', mediaItemsCount: 2}
timeline-track.tsx:947 [TimelineTrack] Found media item: {found: true, mediaItemId: 'acfd5bed-3d4a-0a69-a763-4553dc601ca7', mediaItemUrl: 'https://v3b.fal.media/files/b/panda/MIN8MNb1_GxItiwaW97EA_Rpg9PYNe.mp4', isBlobUrl: false, mediaItemType: 'video', …}
preview-panel.tsx:76 🎬 PREVIEW PANEL: Retrieved 0 effects for element 674d1e68-3bcd-42a6-a19c-1daf8b06b7e3
preview-panel.tsx:84 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./9b42d24d-bb82-447c-952d-c806b719d8e1
blob-url-debug.ts:35   📍 Source: at om (app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:83150) →     at q (app://./assets/editor._project_id.lazy-BTvKc6HC.js:300:20696)
blob-url-debug.ts:36   📦 Type: File, Size: 4809464 bytes
preview-panel.tsx:745 [PreviewPanel] Foreground video source: blob
preview-panel.tsx:76 🎬 PREVIEW PANEL: Retrieved 0 effects for element 674d1e68-3bcd-42a6-a19c-1daf8b06b7e3
preview-panel.tsx:84 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./991bdd72-746f-4c5d-b1fd-2a34a048ccd5
blob-url-debug.ts:35   📍 Source: at om (app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:83150) →     at q (app://./assets/editor._project_id.lazy-BTvKc6HC.js:300:20696)
blob-url-debug.ts:36   📦 Type: File, Size: 4809464 bytes
preview-panel.tsx:745 [PreviewPanel] Foreground video source: blob
blob-url-debug.ts:59 [BlobUrlDebug] 🔴 Revoked: blob:app://./991bdd72-746f-4c5d-b1fd-2a34a048ccd5
blob-url-debug.ts:60   📍 Created by: at om (app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:83150) →     at q (app://./assets/editor._project_id.lazy-BTvKc6HC.js:300:20696)
blob-url-debug.ts:61   🗑️ Revoked by: at app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:80585 →     at lp (app://./assets/vendor-react-B3J_7M5d.js:161:20757)
blob-url-debug.ts:62   ⏱️ Lifespan: 14ms
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./8972349d-884d-4147-9ef0-6498a6e081e6
blob-url-debug.ts:35   📍 Source: at om (app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:83150) →     at q (app://./assets/editor._project_id.lazy-BTvKc6HC.js:300:20696)
blob-url-debug.ts:36   📦 Type: File, Size: 4809464 bytes
preview-panel.tsx:745 [PreviewPanel] Foreground video source: blob
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./b5fc2a1e-f243-43e0-a36f-c8a6d82f0380
blob-url-debug.ts:35   📍 Source: at om (app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:83150) →     at q (app://./assets/editor._project_id.lazy-BTvKc6HC.js:300:20696)
blob-url-debug.ts:36   📦 Type: File, Size: 4809464 bytes
preview-panel.tsx:745 [PreviewPanel] Foreground video source: blob
blob-url-debug.ts:64 [BlobUrlDebug] Revoked untracked: blob:app://./991bdd72-746f-4c5d-b1fd-2a34a048ccd5
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./d381edd5-66f9-4ec9-9b6c-60a3057c62ce
blob-url-debug.ts:35   📍 Source: at om (app://./assets/editor._project_id.lazy-BTvKc6HC.js:259:83150) →     at q (app://./assets/editor._project_id.lazy-BTvKc6HC.js:300:20696)
blob-url-debug.ts:36   📦 Type: File, Size: 4809464 bytes
preview-panel.tsx:745 [PreviewPanel] Foreground video source: blob
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./6f0d0a35-f71b-454a-b8b0-4b0842cd1327