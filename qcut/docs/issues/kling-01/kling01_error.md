ai.tsx:566 [AI View] Progress: 0% - 
ai.tsx:404 step 1: selectedModels updated -> kling_o1_ref2video
ai.tsx:412 step 2: combinedCapabilities updated Object
39ai.tsx:566 [AI View] Progress: 0% - 
use-ai-generation.ts:726 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:727 ============================================================
use-ai-generation.ts:728 === handleGenerate CALLED ===
use-ai-generation.ts:729 ============================================================
use-ai-generation.ts:730 Timestamp: 2025-12-03T00:18:44.414Z
use-ai-generation.ts:731 Input parameters:
use-ai-generation.ts:732   - activeTab: avatar
use-ai-generation.ts:733   - prompt: Element 1 and Element 2 dance together
use-ai-generation.ts:737   - prompt length: 38
use-ai-generation.ts:738   - selectedModels: Array(1)
use-ai-generation.ts:739   - hasSelectedImage: false
use-ai-generation.ts:740   - imageFile: null
use-ai-generation.ts:748   - activeProject: 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:749   - activeProject name: New Project
use-ai-generation.ts:750   - addMediaItem available: true
use-ai-generation.ts:754 
use-ai-generation.ts:842 ✅ Validation passed, starting generation...
use-ai-generation.ts:843   - Models to process: 1
use-ai-generation.ts:844   - Active project: true
use-ai-generation.ts:845   - Media store available: true
use-ai-generation.ts:858 step 3a: pre-generation state check
use-ai-generation.ts:859    - activeProject: true 82080feb-400d-4fb7-bc15-873dbbc28a7b
use-ai-generation.ts:860    - addMediaItem available: true function
use-ai-generation.ts:865    - mediaStoreLoading: false
use-ai-generation.ts:866    - mediaStoreError: null
use-ai-generation.ts:869 
📦 Starting generation for 1 models
use-ai-generation.ts:943 step 4: sanitized params for kling_o1_ref2video Object
use-ai-generation.ts:948 
🎬 [1/1] Processing model: kling_o1_ref2video (Kling O1 Reference-to-Video)
use-ai-generation.ts:971 step 5: sending generation request for kling_o1_ref2video (avatar tab) Object
use-ai-generation.ts:1592 step 5a: post-API response analysis
use-ai-generation.ts:1593    - response received: false
use-ai-generation.ts:1608    - response is undefined/null
use-ai-generation.ts:1611 
  🔍 Response analysis for kling_o1_ref2video:
use-ai-generation.ts:1612     - response exists: false
use-ai-generation.ts:1613     - response.job_id: undefined
use-ai-generation.ts:1614     - response.video_url: undefined
use-ai-generation.ts:1615     - response.status: undefined
use-ai-generation.ts:1616     - Full response: undefined
use-ai-generation.ts:2095 ⚠️ Response has neither job_id nor video_url: undefined
(anonymous) @ use-ai-generation.ts:2095
use-ai-generation.ts:2102 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:2103   - Total generations created: 0
use-ai-generation.ts:2104   - Generations: Array(0)
use-ai-generation.ts:2109 step 7: generation flow complete; updating UI and callbacks
use-ai-generation.ts:2113 📤 Calling onComplete callback with 0 videos
ai.tsx:574 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:575 [AI View] Received 0 videos: Array(0)
ai.tsx:580 [AI View] onComplete callback finished
use-ai-generation.ts:2117 ✅ onComplete callback finished
ai.tsx:566 [AI View] Progress: 0% - Generated 0 videos successfully!