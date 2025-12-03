step 1: selectedModels updated -> [none]
ai.tsx:412 step 2: combinedCapabilities updated Object
ai.tsx:567 [AI View] Progress: 0% - 
ai.tsx:404 step 1: selectedModels updated -> [none]
ai.tsx:412 step 2: combinedCapabilities updated Object
4ai.tsx:567 [AI View] Progress: 0% - 
ai.tsx:404 step 1: selectedModels updated -> kling_o1_ref2video
ai.tsx:412 step 2: combinedCapabilities updated Object
32ai.tsx:567 [AI View] Progress: 0% - 
use-ai-generation.ts:727 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:728 ============================================================
use-ai-generation.ts:729 === handleGenerate CALLED ===
use-ai-generation.ts:730 ============================================================
use-ai-generation.ts:731 Timestamp: 2025-12-03T03:10:06.978Z
use-ai-generation.ts:732 Input parameters:
use-ai-generation.ts:733   - activeTab: avatar
use-ai-generation.ts:734   - prompt: element1 and element2 dance together
use-ai-generation.ts:738   - prompt length: 36
use-ai-generation.ts:739   - selectedModels: Array(1)
use-ai-generation.ts:740   - hasSelectedImage: false
use-ai-generation.ts:741   - imageFile: null
use-ai-generation.ts:749   - activeProject: 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:750   - activeProject name: New Project
use-ai-generation.ts:751   - addMediaItem available: true
use-ai-generation.ts:755 
use-ai-generation.ts:847 ✅ Validation passed, starting generation...
use-ai-generation.ts:848   - Models to process: 1
use-ai-generation.ts:849   - Active project: true
use-ai-generation.ts:850   - Media store available: true
use-ai-generation.ts:863 step 3a: pre-generation state check
use-ai-generation.ts:864    - activeProject: true 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:865    - addMediaItem available: true function
use-ai-generation.ts:870    - mediaStoreLoading: false
use-ai-generation.ts:871    - mediaStoreError: null
use-ai-generation.ts:874 
📦 Starting generation for 1 models
use-ai-generation.ts:948 step 4: sanitized params for kling_o1_ref2video Object
use-ai-generation.ts:953 
🎬 [1/1] Processing model: kling_o1_ref2video (Kling O1 Reference-to-Video)
use-ai-generation.ts:976 step 5: sending generation request for kling_o1_ref2video (avatar tab) Object
use-ai-generation.ts:1590   🎭 Calling generateAvatarVideo for kling_o1_ref2video with reference image...
ai-video-client.ts:2803 🎭 Starting avatar video generation with FAL AI
ai-video-client.ts:2804 🎬 Model: kling_o1_ref2video
ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Reference-to-Video (1/1)
ai-video-client.ts:2892 📤 Uploading reference image to FAL...
index.html#/editor/82080feb-400d-4fb7-bc15-873dbbc28a7b:1 Access to fetch at 'https://fal.run/upload' from origin 'app://.' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
fal.run/upload:1  Failed to load resource: net::ERR_FAILED
error-handler.ts:145 🚨 Error ERR-1764731407691-GGJ5D7 [MEDIUM]
error-handler.ts:146 Timestamp: 2025-12-03T03:10:07.691Z
error-handler.ts:147 Operation: FAL image upload
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:62 Original Error: TypeError: Failed to fetch
    at e (blob-url-debug.ts:100:26)
    at eC.uploadFileToFal (fal-ai-client.ts:345:30)
    at eC.uploadImageToFal (fal-ai-client.ts:399:17)
    at QA (ai-video-client.ts:2893:42)
    at async use-ai-generation.ts:1591:26
console.error @ index.html:62
index.html:62 Stack Trace: TypeError: Failed to fetch
    at e (app://./assets/index-ncLEN5GZ.js:11:25)
    at eC.uploadFileToFal (app://./assets/editor._project_id.lazy-3F5edk7J.js:105:18492)
    at eC.uploadImageToFal (app://./assets/editor._project_id.lazy-3F5edk7J.js:105:19226)
    at QA (app://./assets/editor._project_id.lazy-3F5edk7J.js:105:58782)
    at async app://./assets/editor._project_id.lazy-3F5edk7J.js:107:8528
console.error @ index.html:62
error-handler.ts:161 Metadata: Object
error-handler.ts:145 🚨 Error ERR-1764731407692-C8IKUL [MEDIUM]
error-handler.ts:146 Timestamp: 2025-12-03T03:10:07.692Z
error-handler.ts:147 Operation: Generate avatar video
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:62 Original Error: TypeError: Failed to fetch
    at e (blob-url-debug.ts:100:26)
    at eC.uploadFileToFal (fal-ai-client.ts:345:30)
    at eC.uploadImageToFal (fal-ai-client.ts:399:17)
    at QA (ai-video-client.ts:2893:42)
    at async use-ai-generation.ts:1591:26
console.error @ index.html:62
index.html:62 Stack Trace: TypeError: Failed to fetch
    at e (app://./assets/index-ncLEN5GZ.js:11:25)
    at eC.uploadFileToFal (app://./assets/editor._project_id.lazy-3F5edk7J.js:105:18492)
    at eC.uploadImageToFal (app://./assets/editor._project_id.lazy-3F5edk7J.js:105:19226)
    at QA (app://./assets/editor._project_id.lazy-3F5edk7J.js:105:58782)
    at async app://./assets/editor._project_id.lazy-3F5edk7J.js:107:8528
console.error @ index.html:62
error-handler.ts:161 Metadata: Object
index.html:62 ❌❌❌ GENERATION FAILED ❌❌❌ TypeError: Failed to fetch
    at e (blob-url-debug.ts:100:26)
    at eC.uploadFileToFal (fal-ai-client.ts:345:30)
    at eC.uploadImageToFal (fal-ai-client.ts:399:17)
    at QA (ai-video-client.ts:2893:42)
    at async use-ai-generation.ts:1591:26
console.error @ index.html:62
index.html:62 [AI View] Error occurred: Failed to fetch
console.error @ index.html:62
ai.tsx:567 [AI View] Progress: 0% - Generating with Kling O1 Reference-to-Video (1/1)