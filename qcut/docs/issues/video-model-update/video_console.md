2ai.tsx:71 [AI View] Progress: 0% - 
use-ai-generation.ts:403 
🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀
use-ai-generation.ts:404 Input parameters:
use-ai-generation.ts:405   - activeTab: text
use-ai-generation.ts:406   - prompt: Object POV cinematic shot: the arrow is launched from the bow, camera locked to the arrowhead as it 
use-ai-generation.ts:407   - selectedModels: Array(1)
use-ai-generation.ts:408   - hasSelectedImage: false
use-ai-generation.ts:409   - activeProject: 4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf
use-ai-generation.ts:410   - addMediaItem available: true
use-ai-generation.ts:424 ✅ Validation passed, starting generation...
use-ai-generation.ts:438 
📦 Starting generation for 1 models
use-ai-generation.ts:445 
🎬 [1/1] Processing model: wan_25_preview (WAN v2.5 Preview)
use-ai-generation.ts:467   📝 Calling generateVideo for wan_25_preview...
ai-video-client.ts:102 🔑 FAL API Key present: Yes (length: 69)
ai-video-client.ts:115 🎬 Generating video with FAL AI: fal-ai/wan-25-preview/text-to-video
ai-video-client.ts:116 📝 Prompt: Object POV cinematic shot: the arrow is launched from the bow, camera locked to the arrowhead as it cuts through the air at incredible speed. The archer’s intense blue glowing eyes fade into the background, motion blur streaking past forests and cliffs. Wind rushes around, leaves and sparks of light distort in bullet-time style. Hyper-detailed textures, ultra-realistic physics, IMAX cinematic framing, dynamic depth of field as the arrow races toward its target.
ai-video-client.ts:157 📤 Sending request to fal-ai/wan-25-preview/text-to-video with payload: Object
use-ai-generation.ts:456   📊 Progress for wan_25_preview: Object
ai-video-client.ts:173 📤 Attempting queue submission with payload: Object
ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
10ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
fal.run/fal-ai/wan-25-preview/text-to-video:1  Failed to load resource: the server responded with a status of 422 ()
error-handler.ts:145 🚨 Error ERR-1758778050124-WOULED [MEDIUM]
error-handler.ts:146 Timestamp: 2025-09-25T05:27:30.124Z
error-handler.ts:147 Operation: Submit FAL AI request to queue
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:61 Original Error: Error: FAL Queue Submit Error: 422 
    at vv (ai-video-client.ts:191:9)
    at async use-ai-generation.ts:468:22
console.error @ index.html:61
Br @ error-handler.ts:152
ie @ error-handler.ts:185
jn @ error-handler.ts:300
vv @ ai-video-client.ts:190
index.html:61 Stack Trace: Error: FAL Queue Submit Error: 422 
    at vv (app://./assets/editor._project_id.lazy-Dt3rXZDD.js:105:15836)
    at async app://./assets/editor._project_id.lazy-Dt3rXZDD.js:108:344
console.error @ index.html:61
Br @ error-handler.ts:154
ie @ error-handler.ts:185
jn @ error-handler.ts:300
vv @ ai-video-client.ts:190
error-handler.ts:161 Metadata: Object
error-handler.ts:145 🚨 Error ERR-1758778050126-BQ9Z0W [MEDIUM]
error-handler.ts:146 Timestamp: 2025-09-25T05:27:30.126Z
error-handler.ts:147 Operation: AI Video Generation
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:61 Original Error: Error: Invalid request parameters: {"detail":[{"loc":["body"],"msg":"Access denied, please make sure your account is in good standing.","type":"invalid_request","input":{"prompt":"Object POV cinematic shot: the arrow is launched from the bow, camera locked to the arrowhead as it cuts through the air at incredible speed. The archer’s intense blue glowing eyes fade into the background, motion blur streaking past forests and cliffs. Wind rushes around, leaves and sparks of light distort in bullet-time style. Hyper-detailed textures, ultra-realistic physics, IMAX cinematic framing, dynamic depth of field as the arrow races toward its target.","aspect_ratio":"16:9","resolution":"1080p","negative_prompt":null,"enable_prompt_expansion":true,"seed":null}}]}
    at vv (ai-video-client.ts:205:13)
    at async use-ai-generation.ts:468:22
console.error @ index.html:61
Br @ error-handler.ts:152
ie @ error-handler.ts:185
jn @ error-handler.ts:300
vv @ ai-video-client.ts:334
index.html:61 Stack Trace: Error: Invalid request parameters: {"detail":[{"loc":["body"],"msg":"Access denied, please make sure your account is in good standing.","type":"invalid_request","input":{"prompt":"Object POV cinematic shot: the arrow is launched from the bow, camera locked to the arrowhead as it cuts through the air at incredible speed. The archer’s intense blue glowing eyes fade into the background, motion blur streaking past forests and cliffs. Wind rushes around, leaves and sparks of light distort in bullet-time style. Hyper-detailed textures, ultra-realistic physics, IMAX cinematic framing, dynamic depth of field as the arrow races toward its target.","aspect_ratio":"16:9","resolution":"1080p","negative_prompt":null,"enable_prompt_expansion":true,"seed":null}}]}
    at vv (app://./assets/editor._project_id.lazy-Dt3rXZDD.js:105:16048)
    at async app://./assets/editor._project_id.lazy-Dt3rXZDD.js:108:344
console.error @ index.html:61
Br @ error-handler.ts:154
ie @ error-handler.ts:185
jn @ error-handler.ts:300
vv @ ai-video-client.ts:334
error-handler.ts:161 Metadata: Object
use-ai-generation.ts:456   📊 Progress for wan_25_preview: Object
index.html:61 ❌❌❌ GENERATION FAILED ❌❌❌ Error: Invalid request parameters: {"detail":[{"loc":["body"],"msg":"Access denied, please make sure your account is in good standing.","type":"invalid_request","input":{"prompt":"Object POV cinematic shot: the arrow is launched from the bow, camera locked to the arrowhead as it cuts through the air at incredible speed. The archer’s intense blue glowing eyes fade into the background, motion blur streaking past forests and cliffs. Wind rushes around, leaves and sparks of light distort in bullet-time style. Hyper-detailed textures, ultra-realistic physics, IMAX cinematic framing, dynamic depth of field as the arrow races toward its target.","aspect_ratio":"16:9","resolution":"1080p","negative_prompt":null,"enable_prompt_expansion":true,"seed":null}}]}
    at vv (ai-video-client.ts:205:13)
    at async use-ai-generation.ts:468:22
console.error @ index.html:61
(anonymous) @ use-ai-generation.ts:611
index.html:61 [AI View] Error occurred: Invalid request parameters: {"detail":[{"loc":["body"],"msg":"Access denied, please make sure your account is in good standing.","type":"invalid_request","input":{"prompt":"Object POV cinematic shot: the arrow is launched from the bow, camera locked to the arrowhead as it cuts through the air at incredible speed. The archer’s intense blue glowing eyes fade into the background, motion blur streaking past forests and cliffs. Wind rushes around, leaves and sparks of light distort in bullet-time style. Hyper-detailed textures, ultra-realistic physics, IMAX cinematic framing, dynamic depth of field as the arrow races toward its target.","aspect_ratio":"16:9","resolution":"1080p","negative_prompt":null,"enable_prompt_expansion":true,"seed":null}}]}
console.error @ index.html:61
onError @ ai.tsx:75
(anonymous) @ use-ai-generation.ts:613
ai.tsx:71 [AI View] Progress: 0% - Invalid request parameters: {"detail":[{"loc":["body"],"msg":"Access denied, please make sure your account is in good standing.","type":"invalid_request","input":{"prompt":"Object POV cinematic shot: the arrow is launched from the bow, camera locked to the arrowhead as it cuts through the air at incredible speed. The archer’s intense blue glowing eyes fade into the background, motion blur streaking past forests and cliffs. Wind rushes around, leaves and sparks of light distort in bullet-time style. Hyper-detailed textures, ultra-realistic physics, IMAX cinematic framing, dynamic depth of field as the arrow races toward its target.","aspect_ratio":"16:9","resolution":"1080p","negative_prompt":null,"enable_prompt_expansion":true,"seed":null}}]}