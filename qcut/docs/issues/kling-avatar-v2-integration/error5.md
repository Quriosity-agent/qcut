Timestamp: 2025-12-05T05:19:06.970Z
use-ai-generation.ts:742 Input parameters:
use-ai-generation.ts:743   - activeTab: avatar
use-ai-generation.ts:744   - prompt: 
use-ai-generation.ts:748   - prompt length: 0
use-ai-generation.ts:749   - selectedModels: 
Array(1)
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
use-ai-generation.ts:958 step 4: sanitized params for kling_avatar_v2_standard 
Object
use-ai-generation.ts:963 
🎬 [1/1] Processing model: kling_avatar_v2_standard (Kling Avatar v2 Standard)
use-ai-generation.ts:986 step 5: sending generation request for kling_avatar_v2_standard (avatar tab) 
Object
use-ai-generation.ts:1658   🎭 Calling generateAvatarVideo for kling_avatar_v2_standard...
use-ai-generation.ts:1671   📤 Uploading files to FAL storage for Kling Avatar v2...
fal-ai-client.ts:357 [FAL Upload] ?? Using Electron IPC for image upload (bypasses CORS)
fal-ai-client.ts:360 [FAL Upload] ?? File: G7PebGOW8AALh2P.jpg, Size: 1783617 bytes
fal-ai-client.ts:357 [FAL Upload] ?? Using Electron IPC for audio upload (bypasses CORS)
fal-ai-client.ts:360 [FAL Upload] ?? File: Inworld_inworld-tts-1-max_Ashley_12-05-2025 15-03-50.mp3, Size: 185516 bytes
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)
fal-ai-client.ts:372 [FAL Upload] ??? Routing to Electron image upload IPC...
fal-ai-client.ts:377 [FAL Upload] ?? Routing to Electron audio upload IPC...
2
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)
fal-ai-client.ts:398 [FAL Upload] ? IPC upload successful: https://v3b.fal.media/files/b/0a850aba/VtoIzDCptN3X1y7qP1sAu_Inworld_inworld-tts-1-max_Ashley_12-05-2025%2015-03-50.mp3
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)
fal-ai-client.ts:398 [FAL Upload] ? IPC upload successful: https://v3b.fal.media/files/b/0a850aba/m_YjPnzpJr8m3zOuwpnfy_G7PebGOW8AALh2P.jpg
use-ai-generation.ts:1685   ✅ Files uploaded to FAL storage
use-ai-generation.ts:1686     - Image URL: https://v3b.fal.media/files/b/0a850aba/m_YjPnzpJr8...
use-ai-generation.ts:1687     - Audio URL: https://v3b.fal.media/files/b/0a850aba/VtoIzDCptN3...
ai-video-client.ts:3080 🎭 Starting avatar video generation with FAL AI
ai-video-client.ts:3081 🎬 Model: kling_avatar_v2_standard
ai-video-client.ts:3238 🎭 Generating avatar video with: fal-ai/kling-video/ai-avatar/v2/standard
ai-video-client.ts:3239 📝 Payload: 
Object
ai-video-client.ts:3252 📊 Payload size: 263 bytes
ai-video-client.ts:3259 🚀 Sending request to FAL AI...
11
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)
use-save-on-visibility-change.ts:44 [SaveOnVisibilityChange] Saved timeline on page hide 
Object
69
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)
4
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)
use-save-on-visibility-change.ts:44 [SaveOnVisibilityChange] Saved timeline on page hide 
{projectId: '82080feb-400d-4fb7-bc15-873dbbc28a7b', trackCount: 1}
12
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)
index.html:62 ❌ Request timeout after 3 minutes
error-handler.ts:145 🚨 Error ERR-1764912130200-2X3EM6 [MEDIUM]
error-handler.ts:146 Timestamp: 2025-12-05T05:22:10.200Z
error-handler.ts:147 Operation: Generate avatar video
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:62 Original Error: Error: Avatar generation timed out after 3 minutes. The video/image files may be too large.
    at du (ai-video-client.ts:3314:15)
    at async use-ai-generation.ts:1689:26
index.html:62 Stack Trace: Error: Avatar generation timed out after 3 minutes. The video/image files may be too large.
    at du (app://./assets/editor._project_id.lazy-DY6gxRRH.js:105:52223)
    at async app://./assets/editor._project_id.lazy-DY6gxRRH.js:107:9967
error-handler.ts:161 Metadata: 
{model: 'kling_avatar_v2_standard', operation: 'generateAvatarVideo'}
index.html:62 ❌❌❌ GENERATION FAILED ❌❌❌ Error: Avatar generation timed out after 3 minutes. The video/image files may be too large.
    at du (ai-video-client.ts:3314:15)
    at async use-ai-generation.ts:1689:26
index.html:62 [AI View] Error occurred: Avatar generation timed out after 3 minutes. The video/image files may be too large.
ai.tsx:588 [AI View] Progress: 0% - Generating with Kling Avatar v2 Standard (1/1)
use-save-on-visibility-change.ts:44 [SaveOnVisibilityChange] Saved timeline on page hide 
{projectId: '82080feb-400d-4fb7-bc15-873dbbc28a7b', trackCount: 1}
use-save-on-visibility-change.ts:44 [SaveOnVisibilityChange] Saved timeline on page hide 
{projectId: '82080feb-400d-4fb7-bc15-873dbbc28a7b', trackCount: 1}
use-save-on-visibility-change.ts:44 [SaveOnVisibilityChange] Saved timeline on page hide 
{projectId: '82080feb-400d-4fb7-bc15-873dbbc28a7b', trackCount: 1}
use-save-on-visibility-change.ts:44 [SaveOnVisibilityChange] Saved timeline on page hide 
{projectId: '82080feb-400d-4fb7-bc15-873dbbc28a7b', trackCount: 1}
projectId
: 
"82080feb-400d-4fb7-bc15-873dbbc28a7b"
trackCount
: 
1
[[Prototype]]
: 
Object