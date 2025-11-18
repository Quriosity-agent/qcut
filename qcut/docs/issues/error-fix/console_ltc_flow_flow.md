5ai.tsx:508 [AI View] Progress: 0% - 
use-ai-generation.ts:710 ============================================================
use-ai-generation.ts:711 === handleGenerate CALLED ===
use-ai-generation.ts:712 ============================================================
use-ai-generation.ts:713 Timestamp: 2025-11-18T05:52:27.479Z
use-ai-generation.ts:714 Input parameters:
use-ai-generation.ts:715   - activeTab: text
use-ai-generation.ts:716   - prompt: Motorcycle roars in with aggressive engine sound, drift-brakes dramatically with tire smoke and spar...
use-ai-generation.ts:721   - prompt length: 500
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
ai-video-client.ts:1841 📝 Prompt: Motorcycle roars in with aggressive engine sound, drift-brakes dramatically with tire smoke and spar
ai-video-client.ts:1842 📐 Resolution: 1080p
2ai.tsx:508 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
33ai.tsx:508 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
use-ai-generation.ts:899   📊 Progress for ltxv2_fast_t2v: {status: 'completed', progress: 100, message: 'Video with audio generated using LTX Video 2.0 Fast T2V'}
use-ai-generation.ts:1047   ✅ Text-to-video response: {job_id: 'job_aorhppq5n_1763445147480', status: 'completed', message: 'Video generated successfully with ltxv2_fast_t2v', estimated_time: 0, video_url: 'https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4', …}
use-ai-generation.ts:1525 🔍 DEBUG STEP 2: Post-API Response Analysis
use-ai-generation.ts:1526    - response received: true
use-ai-generation.ts:1528    - response.video_url: true https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9...
use-ai-generation.ts:1533    - response.job_id: true job_aorhppq5n_1763445147480
use-ai-generation.ts:1538    - response keys: (6) ['job_id', 'status', 'message', 'estimated_time', 'video_url', 'video_data']
use-ai-generation.ts:1539    - response.status: completed
use-ai-generation.ts:1544 
  🔍 Response analysis for ltxv2_fast_t2v:
use-ai-generation.ts:1545     - response exists: true
use-ai-generation.ts:1546     - response.job_id: job_aorhppq5n_1763445147480
use-ai-generation.ts:1547     - response.video_url: https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4
use-ai-generation.ts:1548     - response.status: completed
use-ai-generation.ts:1549     - Full response: {
  "job_id": "job_aorhppq5n_1763445147480",
  "status": "completed",
  "message": "Video generated successfully with ltxv2_fast_t2v",
  "estimated_time": 0,
  "video_url": "https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4",
      "content_type": "video/mp4",
      "file_name": "dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4",
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
use-ai-generation.ts:1559 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4
use-ai-generation.ts:1582 📦 Added to generations array: 1
use-ai-generation.ts:1585 🔍 DEBUG STEP 3: Media Integration Condition Check
use-ai-generation.ts:1586    - activeProject check: true → b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1592    - addMediaItem check: true → function
use-ai-generation.ts:1598    - response.video_url check: true → EXISTS
use-ai-generation.ts:1604    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1610 🔍 DEBUG STEP 4: ✅ EXECUTING Media Integration Block
use-ai-generation.ts:1613    - About to download from URL: https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4
use-ai-generation.ts:1617    - Project ID for media: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1618    - addMediaItem function type: function
use-ai-generation.ts:1623 🔄 Attempting to add to media store...
use-ai-generation.ts:1624    - Project ID: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1625    - addMediaItem available: true
use-ai-generation.ts:1629 📥 Downloading video from URL: https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4
2ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1635 🔍 DEBUG STEP 5: Video Download Progress
use-ai-generation.ts:1636    - videoResponse.ok: true
use-ai-generation.ts:1637    - videoResponse.status: 200
use-ai-generation.ts:1638    - videoResponse.headers content-type: video/mp4
ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1650 ✅ Downloaded video blob, size: 5963825
use-ai-generation.ts:1654 📄 Created file: AI-Video-ltxv2_fast_t2v-1763445184989.mp4
use-ai-generation.ts:1656 🔍 DEBUG STEP 6: File Creation Complete
use-ai-generation.ts:1657    - blob.size: 5963825 bytes
use-ai-generation.ts:1658    - blob.type: video/mp4
use-ai-generation.ts:1659    - file.name: AI-Video-ltxv2_fast_t2v-1763445184989.mp4
use-ai-generation.ts:1660    - file.size: 5963825
use-ai-generation.ts:1673 📤 Adding to media store with item: {name: 'AI: Motorcycle roars in with aggre...', type: 'video', file: File, url: 'https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4', duration: 6.12, …}
use-ai-generation.ts:1675 🔍 DEBUG STEP 7: About to Call addMediaItem
use-ai-generation.ts:1676    - mediaItem structure: {
  "name": "AI: Motorcycle roars in with aggre...",
  "type": "video",
  "file": {},
  "url": "https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4",
  "duration": 6.12,
  "width": 1920,
  "height": 1080
}
use-ai-generation.ts:1680    - projectId: b7b8104f-86b3-47fd-a863-fe46fe49fc5e
use-ai-generation.ts:1681    - addMediaItem is function: true
media-store.ts:326 [MediaStore.addMediaItem] Called with projectId: b7b8104f-86b3-47fd-a863-fe46fe49fc5e, item.name: AI: Motorcycle roars in with aggre...
media-store.ts:353 [MediaStore.addMediaItem] Saving media item {projectId: 'b7b8104f-86b3-47fd-a863-fe46fe49fc5e', id: 'c829d560-001f-7598-0617-05df1e99f2e2', name: 'AI: Motorcycle roars in with aggre...', type: 'video', hasFile: true, …}
ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
media-store.ts:379 [MediaStore.addMediaItem] Saved to storage {projectId: 'b7b8104f-86b3-47fd-a863-fe46fe49fc5e', id: 'c829d560-001f-7598-0617-05df1e99f2e2', name: 'AI: Motorcycle roars in with aggre...', type: 'video'}
use-ai-generation.ts:1691 🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED
use-ai-generation.ts:1692    - newItemId: c829d560-001f-7598-0617-05df1e99f2e2
use-ai-generation.ts:1693    - SUCCESS: Video added to media store!
use-ai-generation.ts:1695 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1696    - Item ID: c829d560-001f-7598-0617-05df1e99f2e2
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
timeline-track.tsx:696 {"message":"Drop event started in timeline track","dataTransferTypes":["application/x-media-item"],"trackId":"3c648053-4967-4943-a514-0fd4e0ee6b09","trackType":"media"}
timeline-track.tsx:938 [TimelineTrack] Processing media item drop: {dragDataId: 'c829d560-001f-7598-0617-05df1e99f2e2', dragDataType: 'video', dragDataName: 'AI: Motorcycle roars in with aggre...', mediaItemsCount: 1}
timeline-track.tsx:947 [TimelineTrack] Found media item: {found: true, mediaItemId: 'c829d560-001f-7598-0617-05df1e99f2e2', mediaItemUrl: 'https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4', isBlobUrl: false, mediaItemType: 'video', …}
preview-panel.tsx:75 🎬 PREVIEW PANEL: Retrieved 0 effects for element a0104f26-6076-4717-972c-e61fa177394d
preview-panel.tsx:83 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
preview-panel.tsx:75 🎬 PREVIEW PANEL: Retrieved 0 effects for element a0104f26-6076-4717-972c-e61fa177394d
preview-panel.tsx:83 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4:1  GET https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4 net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
index.html:62 [VideoPlayer] Video error: t {_reactName: 'onError', _targetInst: null, type: 'error', nativeEvent: Event, target: video.object-contain.object-cover, …} src: https://v3b.fal.media/files/b/kangaroo/dGqMvHdUSN9v2Ved4rt5R_X8doAaYN.mp4
console.error @ index.html:62
onError @ video-player.tsx:153
qe @ react-dom.development.js:4164
vR @ react-dom.development.js:4213
Iv @ react-dom.development.js:4277
Sk @ react-dom.development.js:4291
DE @ react-dom.development.js:9041
pI @ react-dom.development.js:9073
PE @ react-dom.development.js:9086
hI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Qg @ react-dom.development.js:26179
pR @ react-dom.development.js:3991
Fm @ react-dom.development.js:9287
$L @ react-dom.development.js:6465
Cm @ react-dom.development.js:6457
index.html:62 🚨 CSP FIX NEEDED: FAL.ai video blocked by Content Security Policy
console.error @ index.html:62
onError @ video-player.tsx:155
qe @ react-dom.development.js:4164
vR @ react-dom.development.js:4213
Iv @ react-dom.development.js:4277
Sk @ react-dom.development.js:4291
DE @ react-dom.development.js:9041
pI @ react-dom.development.js:9073
PE @ react-dom.development.js:9086
hI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Qg @ react-dom.development.js:26179
pR @ react-dom.development.js:3991
Fm @ react-dom.development.js:9287
$L @ react-dom.development.js:6465
Cm @ react-dom.development.js:6457
index.html:62    - Add https://fal.media https://v3.fal.media https://v3b.fal.media to media-src CSP directive
console.error @ index.html:62
onError @ video-player.tsx:158
qe @ react-dom.development.js:4164
vR @ react-dom.development.js:4213
Iv @ react-dom.development.js:4277
Sk @ react-dom.development.js:4291
DE @ react-dom.development.js:9041
pI @ react-dom.development.js:9073
PE @ react-dom.development.js:9086
hI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Qg @ react-dom.development.js:26179
pR @ react-dom.development.js:3991
Fm @ react-dom.development.js:9287
$L @ react-dom.development.js:6465
Cm @ react-dom.development.js:6457
canvas-utils.ts:21 Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently
s.createCanvasClone @ html2canvas.esm.js:5347
s.createElementClone @ html2canvas.esm.js:5275
s.cloneNode @ html2canvas.esm.js:5422
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s @ html2canvas.esm.js:5207
(anonymous) @ html2canvas.esm.js:7746
c @ html2canvas.esm.js:80
(anonymous) @ html2canvas.esm.js:61
(anonymous) @ html2canvas.esm.js:54
us @ html2canvas.esm.js:50
fO @ html2canvas.esm.js:7705
mO @ html2canvas.esm.js:7700
Jb @ canvas-utils.ts:21
vO @ canvas-utils.ts:115
Ef @ canvas-utils.ts:126
(anonymous) @ preview-panel.tsx:453
(anonymous) @ use-frame-cache.ts:318
(anonymous) @ use-frame-cache.ts:329
requestIdleCallback
(anonymous) @ use-frame-cache.ts:309
(anonymous) @ use-frame-cache.ts:313
(anonymous) @ preview-panel.tsx:444
setTimeout
(anonymous) @ preview-panel.tsx:471
Go @ react-dom.development.js:23189
X4 @ react-dom.development.js:24970
K4 @ react-dom.development.js:24930
Y4 @ react-dom.development.js:24917
q4 @ react-dom.development.js:24905
AF @ react-dom.development.js:27078
vo @ react-dom.development.js:27023
DF @ react-dom.development.js:26974
Vi @ react-dom.development.js:26721
ax @ react-dom.development.js:26156
zo @ react-dom.development.js:12042
(anonymous) @ react-dom.development.js:25690
canvas-utils.ts:21 Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently
s.createCanvasClone @ html2canvas.esm.js:5347
s.createElementClone @ html2canvas.esm.js:5275
s.cloneNode @ html2canvas.esm.js:5422
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s.appendChildNode @ html2canvas.esm.js:5395
s.cloneChildNodes @ html2canvas.esm.js:5409
s.cloneNode @ html2canvas.esm.js:5439
s @ html2canvas.esm.js:5207
(anonymous) @ html2canvas.esm.js:7746
c @ html2canvas.esm.js:80
(anonymous) @ html2canvas.esm.js:61
(anonymous) @ html2canvas.esm.js:54
us @ html2canvas.esm.js:50
fO @ html2canvas.esm.js:7705
mO @ html2canvas.esm.js:7700
Jb @ canvas-utils.ts:21
vO @ canvas-utils.ts:115
Ef @ canvas-utils.ts:126
(anonymous) @ preview-panel.tsx:453
(anonymous) @ use-frame-cache.ts:318
(anonymous) @ use-frame-cache.ts:329
requestIdleCallback
(anonymous) @ use-frame-cache.ts:309
(anonymous) @ use-frame-cache.ts:313
(anonymous) @ preview-panel.tsx:444
setTimeout
(anonymous) @ preview-panel.tsx:471
Go @ react-dom.development.js:23189
X4 @ react-dom.development.js:24970
K4 @ react-dom.development.js:24930
Y4 @ react-dom.development.js:24917
q4 @ react-dom.development.js:24905
AF @ react-dom.development.js:27078
vo @ react-dom.development.js:27023
DF @ react-dom.development.js:26974
Vi @ react-dom.development.js:26721
ax @ react-dom.development.js:26156
zo @ react-dom.development.js:12042
(anonymous) @ react-dom.development.js:25690
ai.tsx:508 [AI View] Progress: 0% - 
ai.tsx:508 [AI View] Progress: 0% - 
ai.tsx:508 [AI View] Progress: 0% - 