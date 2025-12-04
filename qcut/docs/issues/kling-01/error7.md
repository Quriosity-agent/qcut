step 1: selectedModels updated -> [none]
ai.tsx:412 step 2: combinedCapabilities updated Object
ai.tsx:567 [AI View] Progress: 0% - 
ai.tsx:404 step 1: selectedModels updated -> [none]
ai.tsx:412 step 2: combinedCapabilities updated Object
36ai.tsx:567 [AI View] Progress: 0% - 
ai.tsx:404 step 1: selectedModels updated -> kling_o1_v2v_edit
ai.tsx:412 step 2: combinedCapabilities updated Object
ai.tsx:567 [AI View] Progress: 0% - 
use-ai-generation.ts:728 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:729 ============================================================
use-ai-generation.ts:730 === handleGenerate CALLED ===
use-ai-generation.ts:731 ============================================================
use-ai-generation.ts:732 Timestamp: 2025-12-04T03:08:49.236Z
use-ai-generation.ts:733 Input parameters:
use-ai-generation.ts:734   - activeTab: avatar
use-ai-generation.ts:735   - prompt: change rain weather into sunny
use-ai-generation.ts:739   - prompt length: 30
use-ai-generation.ts:740   - selectedModels: Array(1)
use-ai-generation.ts:741   - hasSelectedImage: false
use-ai-generation.ts:742   - imageFile: null
use-ai-generation.ts:750   - activeProject: 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:751   - activeProject name: New Project
use-ai-generation.ts:752   - addMediaItem available: true
use-ai-generation.ts:756 
use-ai-generation.ts:848 ✅ Validation passed, starting generation...
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
ai-video-client.ts:2399 📝 Prompt: change rain weather into sunny...
ai-video-client.ts:2406 🔍 [V2V Debug] Checking Electron IPC availability:
ai-video-client.ts:2407   - window.electronAPI exists: true
ai-video-client.ts:2408   - window.electronAPI?.fal exists: true
ai-video-client.ts:2409   - window.electronAPI?.fal?.uploadVideo exists: true
ai-video-client.ts:2413   - window.electronAPI?.isElectron: true
ai-video-client.ts:2417 ✅ [V2V] Using Electron IPC for video upload (bypasses CORS)
ai-video-client.ts:2418 📤 Uploading source video to FAL via Electron IPC...
ai-video-client.ts:2419   - File name: b9243b0e-af6b-4935-acc1-b661c45a62c6.mp4
ai-video-client.ts:2420   - File size: 8883644 bytes
ai-video-client.ts:2421   - File type: video/mp4
ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Video Edit (1/1)
ai-video-client.ts:2424   - ArrayBuffer size: 8883644 bytes
ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Video Edit (1/1)
ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Video Edit (1/1)
ai-video-client.ts:2432 📥 [V2V] Upload result: {success: false, hasUrl: false, error: 'Upload failed: 404 - 404: Not Found'}
error-handler.ts:145 🚨 Error ERR-1764817731294-A324IG [MEDIUM]
error-handler.ts:146 Timestamp: 2025-12-04T03:08:51.294Z
error-handler.ts:147 Operation: Generate Kling O1 video
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:62 Original Error: Error: Failed to upload video to FAL: Upload failed: 404 - 404: Not Found
    at wC (ai-video-client.ts:2439:15)
    at async use-ai-generation.ts:1606:26
console.error @ index.html:62
Hr @ error-handler.ts:152
ae @ error-handler.ts:185
Un @ error-handler.ts:300
wC @ ai-video-client.ts:2552
index.html:62 Stack Trace: Error: Failed to upload video to FAL: Upload failed: 404 - 404: Not Found
    at wC (app://./assets/editor._project_id.lazy-3dVCOtbj.js:105:42256)
    at async app://./assets/editor._project_id.lazy-3dVCOtbj.js:107:8792
console.error @ index.html:62
Hr @ error-handler.ts:154
ae @ error-handler.ts:185
Un @ error-handler.ts:300
wC @ ai-video-client.ts:2552
error-handler.ts:161 Metadata: {model: 'kling_o1_v2v_edit', prompt: 'change rain weather into sunny', operation: 'generateKlingO1Video'}
index.html:62 ❌❌❌ GENERATION FAILED ❌❌❌ Error: Failed to upload video to FAL: Upload failed: 404 - 404: Not Found
    at wC (ai-video-client.ts:2439:15)
    at async use-ai-generation.ts:1606:26
console.error @ index.html:62
(anonymous) @ use-ai-generation.ts:2154
index.html:62 [AI View] Error occurred: Failed to upload video to FAL: Upload failed: 404 - 404: Not Found
console.error @ index.html:62
onError @ ai.tsx:571
(anonymous) @ use-ai-generation.ts:2156
ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Video Edit (1/1)