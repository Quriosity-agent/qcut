  ⏱️ Lifespan: 1060ms
9ai.tsx:508 [AI View] Progress: 0% - 
use-ai-generation.ts:636 
🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀
use-ai-generation.ts:637 Input parameters:
use-ai-generation.ts:638   - activeTab: text
use-ai-generation.ts:639   - prompt: Rapid cuts between elements, diamond spinning with light trails, silhouettes walking in slow motion 
use-ai-generation.ts:640   - selectedModels: Array(1)
use-ai-generation.ts:641   - hasSelectedImage: false
use-ai-generation.ts:642   - activeProject: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:643   - addMediaItem available: true
use-ai-generation.ts:701 ✅ Validation passed, starting generation...
use-ai-generation.ts:714 🔍 DEBUG STEP 1: Pre-Generation State Check
use-ai-generation.ts:715    - activeProject: true 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:716    - addMediaItem available: true function
use-ai-generation.ts:721    - mediaStoreLoading: false
use-ai-generation.ts:722    - mediaStoreError: null
use-ai-generation.ts:725 
📦 Starting generation for 1 models
use-ai-generation.ts:770 
🎬 [1/1] Processing model: sora2_text_to_video (Sora 2 Text-to-Video)
use-ai-generation.ts:794   📝 Processing text-to-video model sora2_text_to_video...
ai-video-client.ts:460 🔑 FAL API Key present: Yes (length: 69)
ai-video-client.ts:479 🎬 Generating video with FAL AI: fal-ai/sora-2/text-to-video
ai-video-client.ts:480 📝 Prompt: Rapid cuts between elements, diamond spinning with light trails, silhouettes walking in slow motion through neon rain, code scrolling fast, camera zooms into diamond showing title reflection, pulsing electronic music sync
ai-video-client.ts:559 📤 Sending request to fal-ai/sora-2/text-to-video with payload: Object
use-ai-generation.ts:783   📊 Progress for sora2_text_to_video: Object
ai-video-client.ts:575 📤 Attempting queue submission with payload: Object
2ai.tsx:508 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
fal.run/fal-ai/sora-2/text-to-video:1  Failed to load resource: the server responded with a status of 422 ()
error-handler.ts:145 🚨 Error ERR-1763364206023-EQ8VLQ [MEDIUM]
error-handler.ts:146 Timestamp: 2025-11-17T07:23:26.023Z
error-handler.ts:147 Operation: Submit FAL AI request to queue
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:61 Original Error: Error: FAL Queue Submit Error: 422 
    at mx (ai-video-client.ts:593:9)
    at async use-ai-generation.ts:902:24
console.error @ index.html:61
index.html:61 Stack Trace: Error: FAL Queue Submit Error: 422 
    at mx (app://./assets/editor._project_id.lazy-BVdnQMB0.js:105:17951)
    at async app://./assets/editor._project_id.lazy-BVdnQMB0.js:108:1860
console.error @ index.html:61
error-handler.ts:161 Metadata: Object
error-handler.ts:145 🚨 Error ERR-1763364206025-FLCXTM [MEDIUM]
error-handler.ts:146 Timestamp: 2025-11-17T07:23:26.025Z
error-handler.ts:147 Operation: AI Video Generation
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:61 Original Error: Error: Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}
    at mx (ai-video-client.ts:607:13)
    at async use-ai-generation.ts:902:24
console.error @ index.html:61
index.html:61 Stack Trace: Error: Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}
    at mx (app://./assets/editor._project_id.lazy-BVdnQMB0.js:105:18163)
    at async app://./assets/editor._project_id.lazy-BVdnQMB0.js:108:1860
console.error @ index.html:61
error-handler.ts:161 Metadata: Object
use-ai-generation.ts:783   📊 Progress for sora2_text_to_video: Object
index.html:61 ❌❌❌ GENERATION FAILED ❌❌❌ Error: Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}
    at mx (ai-video-client.ts:607:13)
    at async use-ai-generation.ts:902:24
console.error @ index.html:61
index.html:61 [AI View] Error occurred: Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}
console.error @ index.html:61
ai.tsx:508 [AI View] Progress: 0% - Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}