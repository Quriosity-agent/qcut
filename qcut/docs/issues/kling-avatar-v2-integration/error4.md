step 1: selectedModels updated -> kling_avatar_v2_standard
ai.tsx:425 step 2: combinedCapabilities updated Object
ai.tsx:588 [AI View] Progress: 0% - 
use-ai-generation.ts:737 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:738 ============================================================
use-ai-generation.ts:739 === handleGenerate CALLED ===
use-ai-generation.ts:740 ============================================================
use-ai-generation.ts:741 Timestamp: 2025-12-05T05:01:04.370Z
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
fal-ai-client.ts:344 [FAL Upload] 🔌 Using Electron IPC for image upload (bypasses CORS)
fal-ai-client.ts:347 [FAL Upload] 📁 File: G7PebGOW8AALh2P.jpg, Size: 1783617 bytes
fal-ai-client.ts:344 [FAL Upload] 🔌 Using Electron IPC for audio upload (bypasses CORS)
fal-ai-client.ts:347 [FAL Upload] 📁 File: Inworld_inworld-tts-1-max_Ashley_12-05-2025 15-03-50.mp3, Size: 185516 bytes
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)
fal-ai-client.ts:382 [FAL Upload] 📦 Using image upload IPC for image...
index.html:62 [FAL Upload] ❌ IPC upload failed: TypeError: window.electronAPI.fal.uploadImage is not a function
    at eD.uploadFileToFal (fal-ai-client.ts:385:49)
    at async use-ai-generation.ts:362:19
    at async Promise.all (index 0)
    at async use-ai-generation.ts:1676:53
console.error @ index.html:62
error-handler.ts:145 🚨 Error ERR-1764910864384-OWWMNH [MEDIUM]
error-handler.ts:146 Timestamp: 2025-12-05T05:01:04.384Z
error-handler.ts:147 Operation: FAL image upload (IPC)
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:62 Original Error: TypeError: window.electronAPI.fal.uploadImage is not a function
    at eD.uploadFileToFal (fal-ai-client.ts:385:49)
    at async use-ai-generation.ts:362:19
    at async Promise.all (index 0)
    at async use-ai-generation.ts:1676:53
console.error @ index.html:62
index.html:62 Stack Trace: TypeError: window.electronAPI.fal.uploadImage is not a function
    at eD.uploadFileToFal (app://./assets/editor._project_id.lazy-Bwwsi8mc.js:105:60245)
    at async app://./assets/editor._project_id.lazy-Bwwsi8mc.js:105:84572
    at async Promise.all (index 0)
    at async app://./assets/editor._project_id.lazy-Bwwsi8mc.js:107:9677
console.error @ index.html:62
error-handler.ts:161 Metadata: Object
index.html:62 ❌❌❌ GENERATION FAILED ❌❌❌ TypeError: window.electronAPI.fal.uploadImage is not a function
    at eD.uploadFileToFal (fal-ai-client.ts:385:49)
    at async use-ai-generation.ts:362:19
    at async Promise.all (index 0)
    at async use-ai-generation.ts:1676:53
console.error @ index.html:62
index.html:62 [AI View] Error occurred: window.electronAPI.fal.uploadImage is not a function
console.error @ index.html:62
fal-ai-client.ts:382 [FAL Upload] 📦 Using image upload IPC for audio...
index.html:62 [FAL Upload] ❌ IPC upload failed: TypeError: window.electronAPI.fal.uploadImage is not a function
    at eD.uploadFileToFal (fal-ai-client.ts:385:49)
    at async use-ai-generation.ts:376:19
    at async Promise.all (index 1)
console.error @ index.html:62
error-handler.ts:145 🚨 Error ERR-1764910864386-DKD7CU [MEDIUM]
error-handler.ts:146 Timestamp: 2025-12-05T05:01:04.386Z
error-handler.ts:147 Operation: FAL audio upload (IPC)
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:62 Original Error: TypeError: window.electronAPI.fal.uploadImage is not a function
    at eD.uploadFileToFal (fal-ai-client.ts:385:49)
    at async use-ai-generation.ts:376:19
    at async Promise.all (index 1)
console.error @ index.html:62
index.html:62 Stack Trace: TypeError: window.electronAPI.fal.uploadImage is not a function
    at eD.uploadFileToFal (app://./assets/editor._project_id.lazy-Bwwsi8mc.js:105:60245)
    at async app://./assets/editor._project_id.lazy-Bwwsi8mc.js:105:84834
    at async Promise.all (index 1)
console.error @ index.html:62
error-handler.ts:161 Metadata: Object
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)