step 1: selectedModels updated -> kling_avatar_v2_standard
ai.tsx:425 step 2: combinedCapabilities updated Object
ai.tsx:588 [AI View] Progress: 0% - 
use-ai-generation.ts:737 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:738 ============================================================
use-ai-generation.ts:739 === handleGenerate CALLED ===
use-ai-generation.ts:740 ============================================================
use-ai-generation.ts:741 Timestamp: 2025-12-05T04:45:37.773Z
use-ai-generation.ts:742 Input parameters:
use-ai-generation.ts:743   - activeTab: avatar
use-ai-generation.ts:744   - prompt: 
use-ai-generation.ts:748   - prompt length: 0
use-ai-generation.ts:749   - selectedModels: Array(1)
use-ai-generation.ts:750   - hasSelectedImage: false
use-ai-generation.ts:751   - imageFile: null
use-ai-generation.ts:759   - activeProject: 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:760   - activeProject name: New Project
use-ai-generation.ts:761   - addMediaItem available: true
use-ai-generation.ts:765 
use-ai-generation.ts:857 ✅ Validation passed, starting generation...
use-ai-generation.ts:858   - Models to process: 1
use-ai-generation.ts:859   - Active project: true
use-ai-generation.ts:860   - Media store available: true
use-ai-generation.ts:873 step 3a: pre-generation state check
use-ai-generation.ts:874    - activeProject: true 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:875    - addMediaItem available: true function
use-ai-generation.ts:880    - mediaStoreLoading: false
use-ai-generation.ts:881    - mediaStoreError: null
use-ai-generation.ts:884 
📦 Starting generation for 1 models
use-ai-generation.ts:958 step 4: sanitized params for kling_avatar_v2_standard Object
use-ai-generation.ts:963 
🎬 [1/1] Processing model: kling_avatar_v2_standard (Kling Avatar v2 Standard)
use-ai-generation.ts:986 step 5: sending generation request for kling_avatar_v2_standard (avatar tab) Object
use-ai-generation.ts:1658   🎭 Calling generateAvatarVideo for kling_avatar_v2_standard...
use-ai-generation.ts:1671   📤 Uploading files to FAL storage for Kling Avatar v2...
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)
index.html#/editor/82080feb-400d-4fb7-bc15-873dbbc28a7b:1 Access to fetch at 'https://fal.run/upload' from origin 'app://.' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
fal.run/upload:1  Failed to load resource: net::ERR_FAILED
error-handler.ts:145 🚨 Error ERR-1764909938483-ZMZZUS [MEDIUM]
error-handler.ts:146 Timestamp: 2025-12-05T04:45:38.483Z
error-handler.ts:147 Operation: FAL image upload
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:62 Original Error: TypeError: Failed to fetch
    at e (blob-url-debug.ts:100:26)
    at eD.uploadFileToFal (fal-ai-client.ts:345:30)
    at eD.uploadImageToFal (fal-ai-client.ts:399:17)
    at use-ai-generation.ts:362:37
    at use-ai-generation.ts:1677:17
    at HTMLUnknownElement.qe (react-dom.development.js:4164:14)
    at Object.bR (react-dom.development.js:4213:16)
    at Uv (react-dom.development.js:4277:31)
    at Ak (react-dom.development.js:4291:25)
    at LE (react-dom.development.js:9041:3)
console.error @ index.html:62
index.html:62 Stack Trace: TypeError: Failed to fetch
    at e (app://./assets/index-kJ2K-ICj.js:11:25)
    at eD.uploadFileToFal (app://./assets/editor._project_id.lazy-xFD6s22w.js:105:59384)
    at eD.uploadImageToFal (app://./assets/editor._project_id.lazy-xFD6s22w.js:105:60118)
    at app://./assets/editor._project_id.lazy-xFD6s22w.js:105:83179
    at app://./assets/editor._project_id.lazy-xFD6s22w.js:107:9696
    at HTMLUnknownElement.qe (app://./assets/vendor-react-DzKotkad.js:78:33002)
    at Object.bR (app://./assets/vendor-react-DzKotkad.js:78:33341)
    at Uv (app://./assets/vendor-react-DzKotkad.js:78:34306)
    at Ak (app://./assets/vendor-react-DzKotkad.js:78:34363)
    at LE (app://./assets/vendor-react-DzKotkad.js:90:10738)
console.error @ index.html:62
error-handler.ts:161 Metadata: Object
index.html:62 ❌❌❌ GENERATION FAILED ❌❌❌ TypeError: Failed to fetch
    at e (blob-url-debug.ts:100:26)
    at eD.uploadFileToFal (fal-ai-client.ts:345:30)
    at eD.uploadImageToFal (fal-ai-client.ts:399:17)
    at use-ai-generation.ts:362:37
    at use-ai-generation.ts:1677:17
    at HTMLUnknownElement.qe (react-dom.development.js:4164:14)
    at Object.bR (react-dom.development.js:4213:16)
    at Uv (react-dom.development.js:4277:31)
    at Ak (react-dom.development.js:4291:25)
    at LE (react-dom.development.js:9041:3)
console.error @ index.html:62
index.html:62 [AI View] Error occurred: Failed to fetch
console.error @ index.html:62
index.html#/editor/82080feb-400d-4fb7-bc15-873dbbc28a7b:1 Access to fetch at 'https://fal.run/upload' from origin 'app://.' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
fal.run/upload:1  Failed to load resource: net::ERR_FAILED
error-handler.ts:145 🚨 Error ERR-1764909938484-1R5DYH [MEDIUM]
error-handler.ts:146 Timestamp: 2025-12-05T04:45:38.484Z
error-handler.ts:147 Operation: FAL audio upload
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:62 Original Error: TypeError: Failed to fetch
    at e (blob-url-debug.ts:100:26)
    at eD.uploadFileToFal (fal-ai-client.ts:345:30)
    at eD.uploadAudioToFal (fal-ai-client.ts:406:17)
    at use-ai-generation.ts:376:37
    at use-ai-generation.ts:1678:29
    at HTMLUnknownElement.qe (react-dom.development.js:4164:14)
    at Object.bR (react-dom.development.js:4213:16)
    at Uv (react-dom.development.js:4277:31)
    at Ak (react-dom.development.js:4291:25)
    at LE (react-dom.development.js:9041:3)
console.error @ index.html:62
index.html:62 Stack Trace: TypeError: Failed to fetch
    at e (app://./assets/index-kJ2K-ICj.js:11:25)
    at eD.uploadFileToFal (app://./assets/editor._project_id.lazy-xFD6s22w.js:105:59384)
    at eD.uploadAudioToFal (app://./assets/editor._project_id.lazy-xFD6s22w.js:105:60183)
    at app://./assets/editor._project_id.lazy-xFD6s22w.js:105:83441
    at app://./assets/editor._project_id.lazy-xFD6s22w.js:107:9704
    at HTMLUnknownElement.qe (app://./assets/vendor-react-DzKotkad.js:78:33002)
    at Object.bR (app://./assets/vendor-react-DzKotkad.js:78:33341)
    at Uv (app://./assets/vendor-react-DzKotkad.js:78:34306)
    at Ak (app://./assets/vendor-react-DzKotkad.js:78:34363)
    at LE (app://./assets/vendor-react-DzKotkad.js:90:10738)
console.error @ index.html:62
error-handler.ts:161 Metadata: Object
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)