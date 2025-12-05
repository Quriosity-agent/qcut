✅ Validation passed, starting generation...
use-ai-generation.ts:849   - Models to process: 1
use-ai-generation.ts:850   - Active project: true
use-ai-generation.ts:851   - Media store available: true
use-ai-generation.ts:864 step 3a: pre-generation state check
use-ai-generation.ts:865    - activeProject: true 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:866    - addMediaItem available: true function
use-ai-generation.ts:871    - mediaStoreLoading: false
use-ai-generation.ts:872    - mediaStoreError: null
use-ai-generation.ts:875 
📦 Starting generation for 1 models
use-ai-generation.ts:949 step 4: sanitized params for kling_o1_v2v_edit Object
use-ai-generation.ts:954 
🎬 [1/1] Processing model: kling_o1_v2v_edit (Kling O1 Video Edit)
use-ai-generation.ts:977 step 5: sending generation request for kling_o1_v2v_edit (avatar tab) Object
use-ai-generation.ts:1605   🎬 Calling generateKlingO1Video for kling_o1_v2v_edit with source video...
ai-video-client.ts:2397 🎬 Starting Kling O1 video-to-video generation
ai-video-client.ts:2398 📝 Model: kling_o1_v2v_edit
ai-video-client.ts:2399 📝 Prompt: change raining into summer...
ai-video-client.ts:2402 📤 Converting source video to base64...
ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Video Edit (1/1)
ai-video-client.ts:2404 ✅ Video converted to data URL
ai-video-client.ts:2427 🎬 Generating video with: fal-ai/kling-video/o1/video-to-video/edit
ai-video-client.ts:2428 📝 Payload: Object
6ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Video Edit (1/1)
8ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Video Edit (1/1)
use-save-on-visibility-change.ts:44 [SaveOnVisibilityChange] Saved timeline on page hide {projectId: '82080feb-400d-4fb7-bc15-873dbbc28a7b', trackCount: 1}
59ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Video Edit (1/1)
edit:1  Failed to load resource: the server responded with a status of 422 ()
error-handler.ts:145 🚨 Error ERR-1764815383096-J4Y88W [MEDIUM]
error-handler.ts:146 Timestamp: 2025-12-04T02:29:43.096Z
error-handler.ts:147 Operation: Generate Kling O1 video
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:62 Original Error: Error: FAL API error: [object Object]
    at wC (ai-video-client.ts:2465:15)
    at async use-ai-generation.ts:1606:26
console.error @ index.html:62
Hr @ error-handler.ts:152
ae @ error-handler.ts:185
Un @ error-handler.ts:300
wC @ ai-video-client.ts:2491
index.html:62 Stack Trace: Error: FAL API error: [object Object]
    at wC (app://./assets/editor._project_id.lazy-BpdKHqhq.js:105:42168)
    at async app://./assets/editor._project_id.lazy-BpdKHqhq.js:107:8792
console.error @ index.html:62
Hr @ error-handler.ts:154
ae @ error-handler.ts:185
Un @ error-handler.ts:300
wC @ ai-video-client.ts:2491
error-handler.ts:161 Metadata: {model: 'kling_o1_v2v_edit', prompt: 'change raining into summer', operation: 'generateKlingO1Video'}
index.html:62 ❌❌❌ GENERATION FAILED ❌❌❌ Error: FAL API error: [object Object]
    at wC (ai-video-client.ts:2465:15)
    at async use-ai-generation.ts:1606:26
console.error @ index.html:62
(anonymous) @ use-ai-generation.ts:2154
index.html:62 [AI View] Error occurred: FAL API error: [object Object]
console.error @ index.html:62
onError @ ai.tsx:571
(anonymous) @ use-ai-generation.ts:2156
ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Video Edit (1/1)