🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
use-ai-generation.ts:877   📝 Processing text-to-video model ltxv2_fast_t2v...
use-ai-generation.ts:866   📊 Progress for ltxv2_fast_t2v: {status: 'processing', progress: 10, message: 'Submitting LTX Video 2.0 Fast T2V request...'}
ai-video-client.ts:1840 🎬 Starting LTX Video 2.0 generation with FAL AI
ai-video-client.ts:1841 📝 Prompt: Camera slowly descends from ceiling through crystal chandeliers. Venue interior dreamlike: massive T
ai-video-client.ts:1842 📐 Resolution: 1080p
ai.tsx:508 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
35ai.tsx:508 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
use-ai-generation.ts:866   📊 Progress for ltxv2_fast_t2v: {status: 'completed', progress: 100, message: 'Video with audio generated using LTX Video 2.0 Fast T2V'}
use-ai-generation.ts:1014   ✅ Text-to-video response: {job_id: 'job_mvpcq6pys_1763437652856', status: 'completed', message: 'Video generated successfully with ltxv2_fast_t2v', estimated_time: 0, video_url: 'https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4', …}
use-ai-generation.ts:1492 🔍 DEBUG STEP 2: Post-API Response Analysis
use-ai-generation.ts:1493    - response received: true
use-ai-generation.ts:1495    - response.video_url: true https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l...
use-ai-generation.ts:1500    - response.job_id: true job_mvpcq6pys_1763437652856
use-ai-generation.ts:1505    - response keys: (6) ['job_id', 'status', 'message', 'estimated_time', 'video_url', 'video_data']
use-ai-generation.ts:1506    - response.status: completed
use-ai-generation.ts:1511 
  🔍 Response analysis for ltxv2_fast_t2v:
use-ai-generation.ts:1512     - response exists: true
use-ai-generation.ts:1513     - response.job_id: job_mvpcq6pys_1763437652856
use-ai-generation.ts:1514     - response.video_url: https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4
use-ai-generation.ts:1515     - response.status: completed
use-ai-generation.ts:1516     - Full response: {
  "job_id": "job_mvpcq6pys_1763437652856",
  "status": "completed",
  "message": "Video generated successfully with ltxv2_fast_t2v",
  "estimated_time": 0,
  "video_url": "https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4",
      "content_type": "video/mp4",
      "file_name": "hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4",
      "file_size": null,
      "width": 1920,
      "height": 1080,
      "fps": 25,
      "duration": 6.12,
      "num_frames": 153
    }
  }
}
use-ai-generation.ts:1519 🔍 FIX VERIFICATION: Processing job_id response
use-ai-generation.ts:1520    - job_id exists: true
use-ai-generation.ts:1521    - video_url exists: true
use-ai-generation.ts:1525 🎉 FIX SUCCESS: Direct mode with job_id detected!
use-ai-generation.ts:1526 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4
use-ai-generation.ts:1549 📦 Added to generations array: 1
use-ai-generation.ts:1552 🔍 DEBUG STEP 3: Media Integration Condition Check
use-ai-generation.ts:1553    - activeProject check: true → 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:1559    - addMediaItem check: true → function
use-ai-generation.ts:1565    - response.video_url check: true → EXISTS
use-ai-generation.ts:1571    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1577 🔍 DEBUG STEP 4: ✅ EXECUTING Media Integration Block
use-ai-generation.ts:1580    - About to download from URL: https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4
use-ai-generation.ts:1584    - Project ID for media: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:1585    - addMediaItem function type: function
use-ai-generation.ts:1590 🔄 Attempting to add to media store...
use-ai-generation.ts:1591    - Project ID: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:1592    - addMediaItem available: true
use-ai-generation.ts:1596 📥 Downloading video from URL: https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4
ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1602 🔍 DEBUG STEP 5: Video Download Progress
use-ai-generation.ts:1603    - videoResponse.ok: true
use-ai-generation.ts:1604    - videoResponse.status: 200
use-ai-generation.ts:1605    - videoResponse.headers content-type: video/mp4
2ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1617 ✅ Downloaded video blob, size: 7933788
use-ai-generation.ts:1621 📄 Created file: AI-Video-ltxv2_fast_t2v-1763437690677.mp4
use-ai-generation.ts:1623 🔍 DEBUG STEP 6: File Creation Complete
use-ai-generation.ts:1624    - blob.size: 7933788 bytes
use-ai-generation.ts:1625    - blob.type: video/mp4
use-ai-generation.ts:1626    - file.name: AI-Video-ltxv2_fast_t2v-1763437690677.mp4
use-ai-generation.ts:1627    - file.size: 7933788
use-ai-generation.ts:1640 📤 Adding to media store with item: {name: 'AI: Camera slowly descends from ce...', type: 'video', file: File, url: 'https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4', duration: 6.12, …}
use-ai-generation.ts:1642 🔍 DEBUG STEP 7: About to Call addMediaItem
use-ai-generation.ts:1643    - mediaItem structure: {
  "name": "AI: Camera slowly descends from ce...",
  "type": "video",
  "file": {},
  "url": "https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4",
  "duration": 6.12,
  "width": 1920,
  "height": 1080
}
use-ai-generation.ts:1647    - projectId: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:1648    - addMediaItem is function: true
media-store.ts:326 [MediaStore.addMediaItem] Called with projectId: 91792c80-b639-4b2a-bf54-6b7da08e2ff1, item.name: AI: Camera slowly descends from ce...
media-store.ts:353 [MediaStore.addMediaItem] Saving media item {projectId: '91792c80-b639-4b2a-bf54-6b7da08e2ff1', id: 'd404373d-7569-390a-bc34-eff725c74211', name: 'AI: Camera slowly descends from ce...', type: 'video', hasFile: true, …}
ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
media-store.ts:379 [MediaStore.addMediaItem] Saved to storage {projectId: '91792c80-b639-4b2a-bf54-6b7da08e2ff1', id: 'd404373d-7569-390a-bc34-eff725c74211', name: 'AI: Camera slowly descends from ce...', type: 'video'}
use-ai-generation.ts:1658 🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED
use-ai-generation.ts:1659    - newItemId: d404373d-7569-390a-bc34-eff725c74211
use-ai-generation.ts:1660    - SUCCESS: Video added to media store!
use-ai-generation.ts:1662 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1663    - Item ID: d404373d-7569-390a-bc34-eff725c74211
use-ai-generation.ts:1867 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:1868   - Total generations created: 1
use-ai-generation.ts:1869   - Generations: [{…}]
use-ai-generation.ts:1874 📤 Calling onComplete callback with 1 videos
ai.tsx:516 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:517 [AI View] Received 1 videos: [{…}]
ai.tsx:522 [AI View] onComplete callback finished
use-ai-generation.ts:1878 ✅ onComplete callback finished
ai.tsx:508 [AI View] Progress: 100% - Generated 1 videos successfully!
timeline-track.tsx:696 {"message":"Drop event started in timeline track","dataTransferTypes":["application/x-media-item"],"trackId":"b5945a60-5fde-40b3-b71a-260b41f1b8eb","trackType":"media"}
timeline-track.tsx:938 [TimelineTrack] Processing media item drop: {dragDataId: 'd404373d-7569-390a-bc34-eff725c74211', dragDataType: 'video', dragDataName: 'AI: Camera slowly descends from ce...', mediaItemsCount: 29}
timeline-track.tsx:947 [TimelineTrack] Found media item: {found: true, mediaItemId: 'd404373d-7569-390a-bc34-eff725c74211', mediaItemUrl: 'https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4', isBlobUrl: false, mediaItemType: 'video', …}
preview-panel.tsx:75 🎬 PREVIEW PANEL: Retrieved 0 effects for element bf50b480-ecea-4347-9492-ce14cbee88b2
preview-panel.tsx:83 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
preview-panel.tsx:75 🎬 PREVIEW PANEL: Retrieved 0 effects for element bf50b480-ecea-4347-9492-ce14cbee88b2
preview-panel.tsx:83 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4:1  GET https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4 net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
index.html:61 [VideoPlayer] Video error: t {_reactName: 'onError', _targetInst: null, type: 'error', nativeEvent: Event, target: video.object-contain.object-cover, …} src: https://v3b.fal.media/files/b/monkey/hxAFvLHQYdl_l6XZhA-7I_yDWCgiHw.mp4
console.error @ index.html:61
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
index.html:61 🚨 CSP FIX NEEDED: FAL.ai video blocked by Content Security Policy
console.error @ index.html:61
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
index.html:61    - Add https://fal.media https://v3.fal.media https://v3b.fal.media to media-src CSP directive
console.error @ index.html:61
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
ls @ html2canvas.esm.js:50
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