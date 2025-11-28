✅ onComplete callback finished
ai.tsx:545 [AI View] Progress: 100% - Generated 1 videos successfully!
ai.tsx:383 step 1: selectedModels updated -> [none]
ai.tsx:391 step 2: combinedCapabilities updated {aspectRatios: undefined, resolutions: undefined, durations: undefined}
ai.tsx:545 [AI View] Progress: 100% - Generated 1 videos successfully!
ai.tsx:383 step 1: selectedModels updated -> veo31_text_to_video
ai.tsx:391 step 2: combinedCapabilities updated {aspectRatios: Array(3), resolutions: Array(2), durations: Array(3)}
ai.tsx:545 [AI View] Progress: 100% - Generated 1 videos successfully!
ai.tsx:545 [AI View] Progress: 100% - Generated 1 videos successfully!
use-ai-generation.ts:726 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:727 ============================================================
use-ai-generation.ts:728 === handleGenerate CALLED ===
use-ai-generation.ts:729 ============================================================
use-ai-generation.ts:730 Timestamp: 2025-11-28T05:19:24.064Z
use-ai-generation.ts:731 Input parameters:
use-ai-generation.ts:732   - activeTab: text
use-ai-generation.ts:733   - prompt: 漂亮小姐姐cosplay 原神
use-ai-generation.ts:737   - prompt length: 15
use-ai-generation.ts:738   - selectedModels: ['veo31_text_to_video']
use-ai-generation.ts:739   - hasSelectedImage: false
use-ai-generation.ts:740   - imageFile: null
use-ai-generation.ts:748   - activeProject: 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:749   - activeProject name: New Project
use-ai-generation.ts:750   - addMediaItem available: true
use-ai-generation.ts:754 
use-ai-generation.ts:818 ✅ Validation passed, starting generation...
use-ai-generation.ts:819   - Models to process: 1
use-ai-generation.ts:820   - Active project: true
use-ai-generation.ts:821   - Media store available: true
use-ai-generation.ts:834 step 3a: pre-generation state check
use-ai-generation.ts:835    - activeProject: true 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:836    - addMediaItem available: true function
use-ai-generation.ts:841    - mediaStoreLoading: false
use-ai-generation.ts:842    - mediaStoreError: null
use-ai-generation.ts:845 
📦 Starting generation for 1 models
use-ai-generation.ts:919 step 4: sanitized params for veo31_text_to_video {unifiedParams: {…}, requestedDuration: 5}
use-ai-generation.ts:924 
🎬 [1/1] Processing model: veo31_text_to_video (Veo 3.1 Text-to-Video)
use-ai-generation.ts:947 step 5: sending generation request for veo31_text_to_video (text tab) {}
use-ai-generation.ts:953   📝 Processing text-to-video model veo31_text_to_video...
ai.tsx:545 [AI View] Progress: 100% - Generating with Veo 3.1 Text-to-Video (1/1)
74ai.tsx:545 [AI View] Progress: 100% - Generating with Veo 3.1 Text-to-Video (1/1)
use-ai-generation.ts:1090   ✅ Text-to-video response: {job_id: 'veo31_std_1764307238443', status: 'completed', message: 'Video generated successfully', video_url: 'https://v3b.fal.media/files/b/kangaroo/kCS2dOxfe3Sadn84Vdnaf_output.mp4'}
use-ai-generation.ts:1568 step 5a: post-API response analysis
use-ai-generation.ts:1569    - response received: true
use-ai-generation.ts:1571    - response.video_url: true https://v3b.fal.media/files/b/kangaroo/kCS2dOxfe3S...
use-ai-generation.ts:1576    - response.job_id: true veo31_std_1764307238443
use-ai-generation.ts:1581    - response keys: (4) ['job_id', 'status', 'message', 'video_url']
use-ai-generation.ts:1582    - response.status: completed
use-ai-generation.ts:1587 
  🔍 Response analysis for veo31_text_to_video:
use-ai-generation.ts:1588     - response exists: true
use-ai-generation.ts:1589     - response.job_id: veo31_std_1764307238443
use-ai-generation.ts:1590     - response.video_url: https://v3b.fal.media/files/b/kangaroo/kCS2dOxfe3Sadn84Vdnaf_output.mp4
use-ai-generation.ts:1591     - response.status: completed
use-ai-generation.ts:1592     - Full response: {
  "job_id": "veo31_std_1764307238443",
  "status": "completed",
  "message": "Video generated successfully",
  "video_url": "https://v3b.fal.media/files/b/kangaroo/kCS2dOxfe3Sadn84Vdnaf_output.mp4"
}
use-ai-generation.ts:1595 🔍 FIX VERIFICATION: Processing job_id response
use-ai-generation.ts:1596    - job_id exists: true
use-ai-generation.ts:1597    - video_url exists: true
use-ai-generation.ts:1601 🎉 FIX SUCCESS: Direct mode with job_id detected!
use-ai-generation.ts:1602 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/kangaroo/kCS2dOxfe3Sadn84Vdnaf_output.mp4
use-ai-generation.ts:1625 📦 Added to generations array: 1
use-ai-generation.ts:1628 step 6a: media integration condition check
use-ai-generation.ts:1633    - activeProject: true 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:1634    - addMediaItem: true function
use-ai-generation.ts:1635    - response.video_url: true EXISTS
use-ai-generation.ts:1647    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1650 step 6b: executing media integration block
use-ai-generation.ts:1651    - About to download from URL: https://v3b.fal.media/files/b/kangaroo/kCS2dOxfe3Sadn84Vdnaf_output.mp4
use-ai-generation.ts:1655    - Project ID for media: 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:1656    - addMediaItem function type: function
use-ai-generation.ts:1661 step 6: downloading video and adding to media store for veo31_text_to_video
use-ai-generation.ts:1665 🔄 Attempting to add to media store...
use-ai-generation.ts:1666    - Project ID: 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:1667    - addMediaItem available: true
use-ai-generation.ts:1671 📥 Downloading video from URL: https://v3b.fal.media/files/b/kangaroo/kCS2dOxfe3Sadn84Vdnaf_output.mp4
use-ai-generation.ts:1677 step 6c: video download progress
use-ai-generation.ts:1678    - videoResponse.ok: true
use-ai-generation.ts:1679    - videoResponse.status: 200
use-ai-generation.ts:1680    - videoResponse.headers content-type: video/mp4
2ai.tsx:545 [AI View] Progress: 100% - Generating with Veo 3.1 Text-to-Video (1/1)
use-ai-generation.ts:1692 ✅ Downloaded video blob, size: 5820682
use-ai-generation.ts:1696 📄 Created file: AI-Video-veo31_text_to_video-1764307240769.mp4
use-ai-generation.ts:1698 step 6d: file creation complete
use-ai-generation.ts:1699    - blob.size: 5820682 bytes
use-ai-generation.ts:1700    - blob.type: video/mp4
use-ai-generation.ts:1701    - file.name: AI-Video-veo31_text_to_video-1764307240769.mp4
use-ai-generation.ts:1702    - file.size: 5820682
use-ai-generation.ts:1705 step 6e: MANDATORY save to local disk starting
use-ai-generation.ts:1746 ✅ step 6e: video saved to disk successfully {localPath: 'C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\82080…_text_to_video-1764307240823-3510a93f173c7769.mp4', fileName: 'AI-Video-veo31_text_to_video-1764307240769-veo31_text_to_video-1764307240823-3510a93f173c7769.mp4', fileSize: 5820682}
blob-url-debug.ts:36 [BlobUrlDebug] 🟢 Created: blob:app://./6895a720-6fe3-4e5b-a7fa-e48ccf8ca33a
blob-url-debug.ts:37   📍 Source: at app://./assets/editor._project_id.lazy-DtHISzbT.js:108:3482
blob-url-debug.ts:38   📦 Type: File, Size: 5820682 bytes
use-ai-generation.ts:1778 step 6d details: {mediaUrl: 'blob:app://./6895a720-6fe3-4e5b-a7fa-e48ccf8ca33a', fileName: 'AI-Video-veo31_text_to_video-1764307240769.mp4', fileSize: 5820682}
use-ai-generation.ts:1783 📤 Adding to media store with item: {name: 'AI: 漂亮小姐姐cosplay 原神...', type: 'video', file: File, url: 'blob:app://./6895a720-6fe3-4e5b-a7fa-e48ccf8ca33a', originalUrl: 'https://v3b.fal.media/files/b/kangaroo/kCS2dOxfe3Sadn84Vdnaf_output.mp4', …}
use-ai-generation.ts:1785 step 6e: about to call addMediaItem
use-ai-generation.ts:1786    - mediaItem structure: {
  "name": "AI: 漂亮小姐姐cosplay 原神...",
  "type": "video",
  "file": {},
  "url": "blob:app://./6895a720-6fe3-4e5b-a7fa-e48ccf8ca33a",
  "originalUrl": "https://v3b.fal.media/files/b/kangaroo/kCS2dOxfe3Sadn84Vdnaf_output.mp4",
  "localPath": "C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\82080feb-400d-4fb7-bc15-873dbbc28a7b\\ai-videos\\AI-Video-veo31_text_to_video-1764307240769-veo31_text_to_video-1764307240823-3510a93f173c7769.mp4",
  "isLocalFile": true,
  "duration": 5,
  "width": 1920,
  "height": 1080,
  "metadata": {
    "source": "text2video",
    "model": "veo31_text_to_video",
    "prompt": "漂亮小姐姐cosplay 原神",
    "generatedAt": "2025-11-28T05:20:40.831Z"
  }
}
use-ai-generation.ts:1790    - projectId: 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:1791    - addMediaItem is function: true
media-store.ts:380 step 6g: media-store addMediaItem {projectId: '82080feb-400d-4fb7-bc15-873dbbc28a7b', id: undefined, hasFile: true, url: 'blob:app://./6895a720-6fe3-4e5b-a7fa-e48ccf8ca33a', originalUrl: 'https://v3b.fal.media/files/b/kangaroo/kCS2dOxfe3Sadn84Vdnaf_output.mp4', …}
media-store.ts:390 [MediaStore.addMediaItem] Called with projectId: 82080feb-400d-4fb7-bc15-873dbbc28a7b, item.name: AI: 漂亮小姐姐cosplay 原神...
media-store.ts:417 [MediaStore.addMediaItem] Saving media item {projectId: '82080feb-400d-4fb7-bc15-873dbbc28a7b', id: '55735575-1685-af98-4ef9-db23adcfca60', name: 'AI: 漂亮小姐姐cosplay 原神...', type: 'video', hasFile: true, …}
video-player.tsx:205 [VideoPlayer] Effect cleanup - blob URL marked for later: blob:app://./dd0d3c2b-a109-4b2c-b875-09fd663a10b2
ai.tsx:545 [AI View] Progress: 100% - Generating with Veo 3.1 Text-to-Video (1/1)
blob-manager.ts:78 [BlobManager] ♻️ Reusing URL (instance match): AI-Video-wan_25_preview-1764305601337.mp4
blob-manager.ts:81   📍 Original source: VideoPlayer
blob-manager.ts:82   🔄 Requested by: VideoPlayer
blob-manager.ts:83   📊 Ref count: 2
video-player.tsx:187 [VideoPlayer] Using blob URL for 62d75d8c-d270-40b9-71d7-4b8e3534b2ae: blob:app://./dd0d3c2b-a109-4b2c-b875-09fd663a10b2
video-player.tsx:264 [VideoPlayer] ✅ Video loaded: 62d75d8c-d270-40b9-71d7-4b8e3534b2ae
video-player.tsx:328 [VideoPlayer] ▶️ Video ready to play: 62d75d8c-d270-40b9-71d7-4b8e3534b2ae
media-store.ts:443 [MediaStore.addMediaItem] Saved to storage {projectId: '82080feb-400d-4fb7-bc15-873dbbc28a7b', id: '55735575-1685-af98-4ef9-db23adcfca60', name: 'AI: 漂亮小姐姐cosplay 原神...', type: 'video'}
use-ai-generation.ts:1801 step 6f: addMediaItem completed {newItemId: '55735575-1685-af98-4ef9-db23adcfca60', mediaUrl: 'blob:app://./6895a720-6fe3-4e5b-a7fa-e48ccf8ca33a', fileName: 'AI-Video-veo31_text_to_video-1764307240769.mp4', fileSize: 5820682}
use-ai-generation.ts:1807    - newItemId: 55735575-1685-af98-4ef9-db23adcfca60
use-ai-generation.ts:1808    - SUCCESS: Video added to media store!
use-ai-generation.ts:1810 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1811    - Item ID: 55735575-1685-af98-4ef9-db23adcfca60
use-ai-generation.ts:2078 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:2079   - Total generations created: 1
use-ai-generation.ts:2080   - Generations: [{…}]
use-ai-generation.ts:2085 step 7: generation flow complete; updating UI and callbacks
use-ai-generation.ts:2089 📤 Calling onComplete callback with 1 videos
ai.tsx:553 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:554 [AI View] Received 1 videos: [{…}]
ai.tsx:559 [AI View] onComplete callback finished
use-ai-generation.ts:2093 ✅ onComplete callback finished
ai.tsx:545 [AI View] Progress: 100% - Generated 1 videos successfully!
timeline-track.tsx:696 {"message":"Drop event started in timeline track","dataTransferTypes":["application/x-media-item"],"trackId":"d028c095-7141-4048-a5b0-a805a4163851","trackType":"media"}
timeline-track.tsx:938 [TimelineTrack] Processing media item drop: {dragDataId: '55735575-1685-af98-4ef9-db23adcfca60', dragDataType: 'video', dragDataName: 'AI: 漂亮小姐姐cosplay 原神...', mediaItemsCount: 18}
timeline-track.tsx:947 [TimelineTrack] Found media item: {found: true, mediaItemId: '55735575-1685-af98-4ef9-db23adcfca60', mediaItemUrl: 'blob:app://./6895a720-6fe3-4e5b-a7fa-e48ccf8ca33a', isBlobUrl: true, mediaItemType: 'video', …}
preview-panel-components.tsx:322 [PLAYBACK] Play/Pause button clicked {action: 'play', previousState: 'paused', currentTime: 2.894, willPause: false, willPlay: true}
video-player.tsx:328 [VideoPlayer] ▶️ Video ready to play: 62d75d8c-d270-40b9-71d7-4b8e3534b2ae
video-player.tsx:205 [VideoPlayer] Effect cleanup - blob URL marked for later: blob:app://./dd0d3c2b-a109-4b2c-b875-09fd663a10b2
video-player.tsx:235 [VideoPlayer] Component unmount - releasing: blob:app://./dd0d3c2b-a109-4b2c-b875-09fd663a10b2
blob-manager.ts:200 [BlobManager] 📉 Released: blob:app://./dd0d3c2b-a109-4b2c-b875-09fd663a10b2
blob-manager.ts:201   📍 Created by: VideoPlayer
blob-manager.ts:202   🔄 Released by: VideoPlayer-unmount
blob-manager.ts:203   📊 Remaining refs: 1
blob-url-debug.ts:36 [BlobUrlDebug] 🟢 Created: blob:app://./72ac944e-8ffe-4f8b-a45d-14c71981523b
blob-url-debug.ts:37   📍 Source: at no.getOrCreateObjectURL (app://./assets/index-DmzDeBWY.js:5:9446) →     at An (app://./assets/index-DmzDeBWY.js:8:1284)
blob-url-debug.ts:38   📦 Type: File, Size: 5820682 bytes
blob-manager.ts:133 [BlobManager] 🟢 Created (cached): blob:app://./72ac944e-8ffe-4f8b-a45d-14c71981523b
blob-manager.ts:134   📍 Source: VideoPlayer
blob-manager.ts:135   📦 Type: File, Size: 5820682 bytes
blob-manager.ts:138   🔑 File key: 5820682-AI-Video-veo31_text_to_video-1764307240769.mp4
video-player.tsx:187 [VideoPlayer] Using blob URL for 55735575-1685-af98-4ef9-db23adcfca60: blob:app://./72ac944e-8ffe-4f8b-a45d-14c71981523b
video-player.tsx:205 [VideoPlayer] Effect cleanup - blob URL marked for later: blob:app://./72ac944e-8ffe-4f8b-a45d-14c71981523b
video-player.tsx:235 [VideoPlayer] Component unmount - releasing: blob:app://./72ac944e-8ffe-4f8b-a45d-14c71981523b
blob-manager.ts:200 [BlobManager] 📉 Released: blob:app://./72ac944e-8ffe-4f8b-a45d-14c71981523b
blob-manager.ts:201   📍 Created by: VideoPlayer
blob-manager.ts:202   🔄 Released by: VideoPlayer-unmount
blob-manager.ts:203   📊 Remaining refs: 0
blob-manager.ts:234 [BlobManager] 🔴 Revoked (no refs): blob:app://./72ac944e-8ffe-4f8b-a45d-14c71981523b
blob-manager.ts:235   🕒 Lifespan: 2ms
blob-manager.ts:237   🏷️ Context: VideoPlayer-unmount
blob-url-debug.ts:36 [BlobUrlDebug] 🟢 Created: blob:app://./110cca23-f523-4a3c-b688-e7a45d05d686
blob-url-debug.ts:37   📍 Source: at no.getOrCreateObjectURL (app://./assets/index-DmzDeBWY.js:5:9446) →     at An (app://./assets/index-DmzDeBWY.js:8:1284)
blob-url-debug.ts:38   📦 Type: File, Size: 5820682 bytes
blob-manager.ts:133 [BlobManager] 🟢 Created (cached): blob:app://./110cca23-f523-4a3c-b688-e7a45d05d686
blob-manager.ts:134   📍 Source: VideoPlayer
blob-manager.ts:135   📦 Type: File, Size: 5820682 bytes
blob-manager.ts:138   🔑 File key: 5820682-AI-Video-veo31_text_to_video-1764307240769.mp4
video-player.tsx:187 [VideoPlayer] Using blob URL for 55735575-1685-af98-4ef9-db23adcfca60: blob:app://./110cca23-f523-4a3c-b688-e7a45d05d686
video-player.tsx:264 [VideoPlayer] ✅ Video loaded: 55735575-1685-af98-4ef9-db23adcfca60
video-player.tsx:328 [VideoPlayer] ▶️ Video ready to play: 55735575-1685-af98-4ef9-db23adcfca60
preview-panel-components.tsx:322 [PLAYBACK] Play/Pause button clicked {action: 'pause', previousState: 'playing', currentTime: 9.045, willPause: true, willPlay: false}