blob:app://./e4bc27d8-4c77-4958-b959-70f3bdb6d397:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
5ai.tsx:71 [AI View] Progress: 0% - 
use-ai-generation.ts:403 
🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀
use-ai-generation.ts:404 Input parameters:
use-ai-generation.ts:405   - activeTab: text
use-ai-generation.ts:406   - prompt: Insane cinematic action sequence: a man sprints at full speed across a battlefield with a pistol in 
use-ai-generation.ts:407   - selectedModels: Array(1)
use-ai-generation.ts:408   - hasSelectedImage: false
use-ai-generation.ts:409   - activeProject: 4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf
use-ai-generation.ts:410   - addMediaItem available: true
use-ai-generation.ts:424 ✅ Validation passed, starting generation...
use-ai-generation.ts:437 🔍 DEBUG STEP 1: Pre-Generation State Check
use-ai-generation.ts:438    - activeProject: true 4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf
use-ai-generation.ts:439    - addMediaItem available: true function
use-ai-generation.ts:440    - mediaStoreLoading: false
use-ai-generation.ts:441    - mediaStoreError: null
use-ai-generation.ts:444 
📦 Starting generation for 1 models
use-ai-generation.ts:451 
🎬 [1/1] Processing model: wan_25_preview (WAN v2.5 Preview)
use-ai-generation.ts:473   📝 Calling generateVideo for wan_25_preview...
ai-video-client.ts:102 🔑 FAL API Key present: Yes (length: 69)
ai-video-client.ts:115 🎬 Generating video with FAL AI: fal-ai/wan-25-preview/text-to-video
ai-video-client.ts:116 📝 Prompt: Insane cinematic action sequence: a man sprints at full speed across a battlefield with a pistol in hand, the camera locked in extreme motion blur as explosions erupt behind him. Bullets tear through the air, sparks flying past his face in slow motion. The ground shakes, debris and dirt flying upward with each step. Handheld IMAX framing, ultra-dynamic movement, chaotic energy as if the entire world is collapsing around him while he runs with unstoppable determination. Hyper-detailed, raw intens
ai-video-client.ts:157 📤 Sending request to fal-ai/wan-25-preview/text-to-video with payload: Object
use-ai-generation.ts:462   📊 Progress for wan_25_preview: Object
ai-video-client.ts:173 📤 Attempting queue submission with payload: Object
4ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
200ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
106ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
ai-video-client.ts:209 ✅ FAL Response received: {video: {…}, seed: 1517011010, actual_prompt: 'Extreme wide shot, handheld IMAX framing, Dutch an…res, sustained artillery fire in the far horizon.'}
ai-video-client.ts:210 🗋 Response structure: {hasRequestId: false, hasVideo: true, hasVideoUrl: true, keys: Array(3), fullResponse: {…}}
ai-video-client.ts:235 ⚡ Direct mode: video ready immediately
use-ai-generation.ts:462   📊 Progress for wan_25_preview: {status: 'completed', progress: 100, message: 'Video generated successfully with wan_25_preview', elapsedTime: 310}
use-ai-generation.ts:481   ✅ generateVideo returned: {job_id: 'job_bl5j9stgt_1758782594745', status: 'completed', message: 'Video generated successfully with wan_25_preview', estimated_time: 310, video_url: 'https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4', …}
use-ai-generation.ts:492 🔍 DEBUG STEP 2: Post-API Response Analysis
use-ai-generation.ts:493    - response received: true
use-ai-generation.ts:495    - response.video_url: true https://v3.fal.media/files/elephant/ACoXYabPlJNr8G...
use-ai-generation.ts:496    - response.job_id: true job_bl5j9stgt_1758782594745
use-ai-generation.ts:497    - response keys: (6) ['job_id', 'status', 'message', 'estimated_time', 'video_url', 'video_data']
use-ai-generation.ts:498    - response.status: completed
use-ai-generation.ts:503 
  🔍 Response analysis for wan_25_preview:
use-ai-generation.ts:504     - response exists: true
use-ai-generation.ts:505     - response.job_id: job_bl5j9stgt_1758782594745
use-ai-generation.ts:506     - response.video_url: https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4
use-ai-generation.ts:507     - response.status: completed
use-ai-generation.ts:508     - Full response: {
  "job_id": "job_bl5j9stgt_1758782594745",
  "status": "completed",
  "message": "Video generated successfully with wan_25_preview",
  "estimated_time": 310,
  "video_url": "https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4",
  "video_data": {
    "video": {
      "url": "https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4",
      "content_type": "video/mp4",
      "file_name": "ACoXYabPlJNr8GDJv-1Q9.mp4",
      "file_size": null,
      "width": 1920,
      "height": 1080,
      "fps": 24,
      "duration": 5.042,
      "num_frames": 121
    },
    "seed": 1517011010,
    "actual_prompt": "Extreme wide shot, handheld IMAX framing, Dutch angle, mixed lighting (explosions and overcast daylight), high contrast, cool color palette with orange highlights from fire. A lone man sprints across a war-torn battlefield, his boots pounding the cracked earth, each step kicking up clods of dirt and shattered concrete as the ground trembles beneath him. He grips a black tactical pistol in his right hand, arm extended forward, body leaning into the sprint with fierce determination. His face is streaked with grime, jaw clenched, eyes locked ahead—unyielding. Behind him, massive explosions erupt in slow motion, flames and smoke blooming outward, sending debris flying into the air. Bullet trails rip through the space around him, visible as glowing streaks, while sparks zip past his face, some grazing his jacket, illuminating fine particles suspended in the air. The camera follows just behind, shaking violently with every footfall, capturing extreme motion blur on the periphery while maintaining sharp focus on the man’s silhouette. Overhead, dark storm clouds churn; the sky flickers with flashes of gunfire. Sound design: roaring explosions, sharp cracks of bullets, low-frequency rumbles, and the rhythmic thud of footsteps. No dialogue. Background audio: distant screams, collapsing structures, sustained artillery fire in the far horizon."
  }
}
use-ai-generation.ts:511 🔍 FIX VERIFICATION: Processing job_id response
use-ai-generation.ts:512    - job_id exists: true
use-ai-generation.ts:513    - video_url exists: true
use-ai-generation.ts:517 🎉 FIX SUCCESS: Direct mode with job_id detected!
use-ai-generation.ts:518 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4
use-ai-generation.ts:538 📦 Added to generations array: 1
use-ai-generation.ts:541 🔍 DEBUG STEP 3: Media Integration Condition Check
use-ai-generation.ts:542    - activeProject check: true → 4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf
use-ai-generation.ts:543    - addMediaItem check: true → function
use-ai-generation.ts:544    - response.video_url check: true → EXISTS
use-ai-generation.ts:545    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:548 🔍 DEBUG STEP 4: ✅ EXECUTING Media Integration Block
use-ai-generation.ts:549    - About to download from URL: https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4
use-ai-generation.ts:550    - Project ID for media: 4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf
use-ai-generation.ts:551    - addMediaItem function type: function
use-ai-generation.ts:553 🔄 Attempting to add to media store...
use-ai-generation.ts:554    - Project ID: 4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf
use-ai-generation.ts:555    - addMediaItem available: true
use-ai-generation.ts:559 📥 Downloading video from URL: https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4
3ai.tsx:71 [AI View] Progress: 100% - Video generated successfully with wan_25_preview
use-ai-generation.ts:562 🔍 DEBUG STEP 5: Video Download Progress
use-ai-generation.ts:563    - videoResponse.ok: true
use-ai-generation.ts:564    - videoResponse.status: 200
use-ai-generation.ts:565    - videoResponse.headers content-type: video/mp4
2ai.tsx:71 [AI View] Progress: 100% - Video generated successfully with wan_25_preview
use-ai-generation.ts:572 ✅ Downloaded video blob, size: 6544052
use-ai-generation.ts:576 📄 Created file: AI-Video-wan_25_preview-1758782908814.mp4
use-ai-generation.ts:578 🔍 DEBUG STEP 6: File Creation Complete
use-ai-generation.ts:579    - blob.size: 6544052 bytes
use-ai-generation.ts:580    - blob.type: video/mp4
use-ai-generation.ts:581    - file.name: AI-Video-wan_25_preview-1758782908814.mp4
use-ai-generation.ts:582    - file.size: 6544052
use-ai-generation.ts:595 📤 Adding to media store with item: {name: 'AI: Insane cinematic action sequen...', type: 'video', file: File, url: 'https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4', duration: 5.042, …}
use-ai-generation.ts:597 🔍 DEBUG STEP 7: About to Call addMediaItem
use-ai-generation.ts:598    - mediaItem structure: {
  "name": "AI: Insane cinematic action sequen...",
  "type": "video",
  "file": {},
  "url": "https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4",
  "duration": 5.042,
  "width": 1920,
  "height": 1080
}
use-ai-generation.ts:599    - projectId: 4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf
use-ai-generation.ts:600    - addMediaItem is function: true
ai.tsx:71 [AI View] Progress: 100% - Video generated successfully with wan_25_preview
use-ai-generation.ts:604 🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED
use-ai-generation.ts:605    - newItemId: adccf745-e982-eb92-5472-e23be9570fa9
use-ai-generation.ts:606    - SUCCESS: Video added to media store!
use-ai-generation.ts:608 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:609    - Item ID: adccf745-e982-eb92-5472-e23be9570fa9
use-ai-generation.ts:771 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:772   - Total generations created: 1
use-ai-generation.ts:773   - Generations: [{…}]
use-ai-generation.ts:778 📤 Calling onComplete callback with 1 videos
ai.tsx:79 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:80 [AI View] Received 1 videos: [{…}]
ai.tsx:85 [AI View] onComplete callback finished
use-ai-generation.ts:780 ✅ onComplete callback finished
ai.tsx:71 [AI View] Progress: 100% - Generated 1 videos successfully!
timeline-track.tsx:696 {"message":"Drop event started in timeline track","dataTransferTypes":["application/x-media-item"],"trackId":"9d73a6fc-4c86-4590-901a-2325093d839c","trackType":"media"}
timeline-track.tsx:938 [TimelineTrack] Processing media item drop: {dragDataId: 'adccf745-e982-eb92-5472-e23be9570fa9', dragDataType: 'video', dragDataName: 'AI: Insane cinematic action sequen...', mediaItemsCount: 2}
timeline-track.tsx:947 [TimelineTrack] Found media item: {found: true, mediaItemId: 'adccf745-e982-eb92-5472-e23be9570fa9', mediaItemUrl: 'https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4', isBlobUrl: false, mediaItemType: 'video', …}
preview-panel.tsx:75 🎬 PREVIEW PANEL: Retrieved 0 effects for element c8346b38-bab0-4dbc-a735-627d08e4fada
preview-panel.tsx:83 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
preview-panel.tsx:75 🎬 PREVIEW PANEL: Retrieved 0 effects for element c8346b38-bab0-4dbc-a735-627d08e4fada
preview-panel.tsx:83 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
index.html#/editor/4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf:1 Refused to load media from 'https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4' because it violates the following Content Security Policy directive: "media-src 'self' blob: data: app: https://freesound.org https://cdn.freesound.org".

index.html#/editor/4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf:1 Refused to load media from 'https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4' because it violates the following Content Security Policy directive: "media-src 'self' blob: data: app: https://freesound.org https://cdn.freesound.org".

index.html:61 [VideoPlayer] Video error: t {_reactName: 'onError', _targetInst: null, type: 'error', nativeEvent: Event, target: video.object-contain.object-cover, …} src: https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4
console.error @ index.html:61
onError @ video-player.tsx:153
qe @ react-dom.development.js:4164
f0 @ react-dom.development.js:4213
Nv @ react-dom.development.js:4277
hk @ react-dom.development.js:4291
wE @ react-dom.development.js:9041
sI @ react-dom.development.js:9073
TE @ react-dom.development.js:9086
lI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Xg @ react-dom.development.js:26179
u0 @ react-dom.development.js:3991
jm @ react-dom.development.js:9287
IL @ react-dom.development.js:6465
Em @ react-dom.development.js:6457
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
ht @ html2canvas.esm.js:50
jB @ html2canvas.esm.js:7705
zB @ html2canvas.esm.js:7700
$f @ canvas-utils.ts:21
VB @ canvas-utils.ts:115
_p @ canvas-utils.ts:126
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
V4 @ react-dom.development.js:24970
B4 @ react-dom.development.js:24930
$4 @ react-dom.development.js:24917
H4 @ react-dom.development.js:24905
wF @ react-dom.development.js:27078
vo @ react-dom.development.js:27023
xF @ react-dom.development.js:26974
Vi @ react-dom.development.js:26721
e1 @ react-dom.development.js:26156
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
ht @ html2canvas.esm.js:50
jB @ html2canvas.esm.js:7705
zB @ html2canvas.esm.js:7700
$f @ canvas-utils.ts:21
VB @ canvas-utils.ts:115
_p @ canvas-utils.ts:126
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
V4 @ react-dom.development.js:24970
B4 @ react-dom.development.js:24930
$4 @ react-dom.development.js:24917
H4 @ react-dom.development.js:24905
wF @ react-dom.development.js:27078
vo @ react-dom.development.js:27023
xF @ react-dom.development.js:26974
Vi @ react-dom.development.js:26721
e1 @ react-dom.development.js:26156
zo @ react-dom.development.js:12042
(anonymous) @ react-dom.development.js:25690
2index.html:61 Failed to capture frame: Error: Attempting to parse an unsupported color function "oklab"
    at Object.parse (html2canvas.esm.js:1720:23)
    at _o (html2canvas.esm.js:2021:25)
    at html2canvas.esm.js:2191:25
    at Array.forEach (<anonymous>)
    at AE (html2canvas.esm.js:2179:31)
    at Object.parse (html2canvas.esm.js:2452:20)
    at html2canvas.esm.js:2490:50
    at Array.map (<anonymous>)
    at Object.parse (html2canvas.esm.js:2490:14)
    at we (html2canvas.esm.js:3736:31)
console.error @ index.html:61
$f @ canvas-utils.ts:63
await in $f
VB @ canvas-utils.ts:115
_p @ canvas-utils.ts:126
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
V4 @ react-dom.development.js:24970
B4 @ react-dom.development.js:24930
$4 @ react-dom.development.js:24917
H4 @ react-dom.development.js:24905
wF @ react-dom.development.js:27078
vo @ react-dom.development.js:27023
xF @ react-dom.development.js:26974
Vi @ react-dom.development.js:26721
e1 @ react-dom.development.js:26156
zo @ react-dom.development.js:12042
(anonymous) @ react-dom.development.js:25690
preview-panel.tsx:69 🎬 PREVIEW PANEL: No effects (enabled: true, elementId: null)
preview-panel.tsx:83 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
preview-panel.tsx:69 🎬 PREVIEW PANEL: No effects (enabled: true, elementId: null)
preview-panel.tsx:83 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
timeline-track.tsx:696 {"message":"Drop event started in timeline track","dataTransferTypes":["application/x-media-item"],"trackId":"42785bef-b933-43ce-adb6-35f216b67f43","trackType":"media"}
timeline-track.tsx:938 [TimelineTrack] Processing media item drop: {dragDataId: 'adccf745-e982-eb92-5472-e23be9570fa9', dragDataType: 'video', dragDataName: 'AI: Insane cinematic action sequen...', mediaItemsCount: 2}
timeline-track.tsx:947 [TimelineTrack] Found media item: {found: true, mediaItemId: 'adccf745-e982-eb92-5472-e23be9570fa9', mediaItemUrl: 'https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4', isBlobUrl: false, mediaItemType: 'video', …}
preview-panel.tsx:75 🎬 PREVIEW PANEL: Retrieved 0 effects for element 88061e0a-f1ea-492f-afa4-78876dde4104
preview-panel.tsx:83 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
preview-panel.tsx:75 🎬 PREVIEW PANEL: Retrieved 0 effects for element 88061e0a-f1ea-492f-afa4-78876dde4104
preview-panel.tsx:83 🎨 PREVIEW PANEL: No filter style (enabled: true, effects: 0)
index.html#/editor/4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf:1 Refused to load media from 'https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4' because it violates the following Content Security Policy directive: "media-src 'self' blob: data: app: https://freesound.org https://cdn.freesound.org".

index.html#/editor/4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf:1 Refused to load media from 'https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4' because it violates the following Content Security Policy directive: "media-src 'self' blob: data: app: https://freesound.org https://cdn.freesound.org".

index.html:61 [VideoPlayer] Video error: t {_reactName: 'onError', _targetInst: null, type: 'error', nativeEvent: Event, target: video.object-contain.object-cover, …} src: https://v3.fal.media/files/elephant/ACoXYabPlJNr8GDJv-1Q9.mp4
console.error @ index.html:61
onError @ video-player.tsx:153
qe @ react-dom.development.js:4164
f0 @ react-dom.development.js:4213
Nv @ react-dom.development.js:4277
hk @ react-dom.development.js:4291
wE @ react-dom.development.js:9041
sI @ react-dom.development.js:9073
TE @ react-dom.development.js:9086
lI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Xg @ react-dom.development.js:26179
u0 @ react-dom.development.js:3991
jm @ react-dom.development.js:9287
IL @ react-dom.development.js:6465
Em @ react-dom.development.js:6457
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
ht @ html2canvas.esm.js:50
jB @ html2canvas.esm.js:7705
zB @ html2canvas.esm.js:7700
$f @ canvas-utils.ts:21
VB @ canvas-utils.ts:115
_p @ canvas-utils.ts:126
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
V4 @ react-dom.development.js:24970
B4 @ react-dom.development.js:24930
$4 @ react-dom.development.js:24917
H4 @ react-dom.development.js:24905
wF @ react-dom.development.js:27078
vo @ react-dom.development.js:27023
xF @ react-dom.development.js:26974
Vi @ react-dom.development.js:26721
e1 @ react-dom.development.js:26156
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
ht @ html2canvas.esm.js:50
jB @ html2canvas.esm.js:7705
zB @ html2canvas.esm.js:7700
$f @ canvas-utils.ts:21
VB @ canvas-utils.ts:115
_p @ canvas-utils.ts:126
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
V4 @ react-dom.development.js:24970
B4 @ react-dom.development.js:24930
$4 @ react-dom.development.js:24917
H4 @ react-dom.development.js:24905
wF @ react-dom.development.js:27078
vo @ react-dom.development.js:27023
xF @ react-dom.development.js:26974
Vi @ react-dom.development.js:26721
e1 @ react-dom.development.js:26156
zo @ react-dom.development.js:12042
(anonymous) @ react-dom.development.js:25690
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./13391531-fad7-4c63-ace3-8ea0f4c2a451
blob-url-debug.ts:35   📍 Source: at Pg (app://./assets/editor._project_id.lazy-Dyi_ex1C.js:101:92352) →     at async app://./assets/editor._project_id.lazy-Dyi_ex1C.js:101:93276
blob-url-debug.ts:36   📦 Type: Blob, Size: unknown
blob-url-debug.ts:59 [BlobUrlDebug] 🔴 Revoked: blob:app://./13391531-fad7-4c63-ace3-8ea0f4c2a451
blob-url-debug.ts:60   📍 Created by: at Pg (app://./assets/editor._project_id.lazy-Dyi_ex1C.js:101:92352) →     at async app://./assets/editor._project_id.lazy-Dyi_ex1C.js:101:93276
blob-url-debug.ts:61   🗑️ Revoked by: at app://./assets/editor._project_id.lazy-Dyi_ex1C.js:101:92671
blob-url-debug.ts:62   ⏱️ Lifespan: 118ms