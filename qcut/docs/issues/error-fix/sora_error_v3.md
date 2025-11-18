  ⏱️ Lifespan: 1110ms
11ai.tsx:508 [AI View] Progress: 0% - 
use-ai-generation.ts:636 
🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀
use-ai-generation.ts:637 Input parameters:
use-ai-generation.ts:638   - activeTab: text
use-ai-generation.ts:639   - prompt: #### 镜头6.8：逃脱 | Shot 6.8: Escape
**时长 Duration**: 15秒

**分镜描述 (中文)**:
白光消散。蒙面人已经上了货车，疾驰而去。

星璇和唐悦恢复视
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
ai-video-client.ts:480 📝 Prompt: #### 镜头6.8：逃脱 | Shot 6.8: Escape
**时长 Duration**: 15秒

**分镜描述 (中文)**:
白光消散。蒙面人已经上了货车，疾驰而去。

星璇和唐悦恢复视力，但为时已晚。

地上只留下一张黑色名片。

**Storyboard Description (English)**:
White light fades. Masked figures already in van, speeding away.

Star and Joy recover vision, but too late.

Only a black business card left on ground.

**台词 | Dialogue**:
唐悦 Joy: "该死！又让他们跑了！" "Damn! They got away again!"

星璇 Star: (捡起名片，脸色大变) "这是..." (Picks up card, expression changes drastically) "This is..."

(名片特写：烫金字体写着："The Collector - 我们很快会再见面，星璇。") (Card close-up: Gold embossed text: "The Collector - We'll meet again soon, Xingxuan.")
ai-video-client.ts:559 📤 Sending request to fal-ai/sora-2/text-to-video with payload: Object
use-ai-generation.ts:783   📊 Progress for sora2_text_to_video: Object
ai-video-client.ts:575 📤 Attempting queue submission with payload: Object
22ai.tsx:508 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
fal.run/fal-ai/sora-2/text-to-video:1  Failed to load resource: net::ERR_NAME_NOT_RESOLVED
error-handler.ts:145 🚨 Error ERR-1763430008004-Z0V929 [MEDIUM]
error-handler.ts:146 Timestamp: 2025-11-18T01:40:08.004Z
error-handler.ts:147 Operation: AI Video Generation
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:61 Original Error: TypeError: Failed to fetch
    at e (blob-url-debug.ts:96:26)
    at mx (ai-video-client.ts:577:33)
    at use-ai-generation.ts:902:30
    at HTMLUnknownElement.qe (react-dom.development.js:4164:14)
    at Object.vR (react-dom.development.js:4213:16)
    at Iv (react-dom.development.js:4277:31)
    at Sk (react-dom.development.js:4291:25)
    at DE (react-dom.development.js:9041:3)
    at pI (react-dom.development.js:9073:7)
    at PE (react-dom.development.js:9086:5)
console.error @ index.html:61
index.html:61 Stack Trace: TypeError: Failed to fetch
    at e (app://./assets/index-C9ACdPvl.js:10:25)
    at mx (app://./assets/editor._project_id.lazy-BVdnQMB0.js:105:17720)
    at app://./assets/editor._project_id.lazy-BVdnQMB0.js:108:1866
    at HTMLUnknownElement.qe (app://./assets/vendor-react-B3J_7M5d.js:78:33002)
    at Object.vR (app://./assets/vendor-react-B3J_7M5d.js:78:33341)
    at Iv (app://./assets/vendor-react-B3J_7M5d.js:78:34306)
    at Sk (app://./assets/vendor-react-B3J_7M5d.js:78:34363)
    at DE (app://./assets/vendor-react-B3J_7M5d.js:90:10738)
    at pI (app://./assets/vendor-react-B3J_7M5d.js:90:11078)
    at PE (app://./assets/vendor-react-B3J_7M5d.js:90:11186)
console.error @ index.html:61
error-handler.ts:161 Metadata: Object
use-ai-generation.ts:783   📊 Progress for sora2_text_to_video: Object
index.html:61 ❌❌❌ GENERATION FAILED ❌❌❌ TypeError: Failed to fetch
    at e (blob-url-debug.ts:96:26)
    at mx (ai-video-client.ts:577:33)
    at use-ai-generation.ts:902:30
    at HTMLUnknownElement.qe (react-dom.development.js:4164:14)
    at Object.vR (react-dom.development.js:4213:16)
    at Iv (react-dom.development.js:4277:31)
    at Sk (react-dom.development.js:4291:25)
    at DE (react-dom.development.js:9041:3)
    at pI (react-dom.development.js:9073:7)
    at PE (react-dom.development.js:9086:5)
console.error @ index.html:61
index.html:61 [AI View] Error occurred: Failed to fetch
console.error @ index.html:61
ai.tsx:508 [AI View] Progress: 0% - Failed to fetch

[AI View] Progress: 0% - Submitting request to FAL.ai queue...
blob-url-debug.ts:96  POST https://fal.run/fal-ai/sora-2/text-to-video 422 (Unprocessable Content)
e @ blob-url-debug.ts:96
mx @ ai-video-client.ts:577
(anonymous) @ use-ai-generation.ts:902
qe @ react-dom.development.js:4164
vR @ react-dom.development.js:4213
Iv @ react-dom.development.js:4277
Sk @ react-dom.development.js:4291
DE @ react-dom.development.js:9041
pI @ react-dom.development.js:9073
PE @ react-dom.development.js:9086
hI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Qg @ react-dom.development.js:26179
pR @ react-dom.development.js:3991
Fm @ react-dom.development.js:9287
$L @ react-dom.development.js:6465
Cm @ react-dom.development.js:6457
UL @ react-dom.development.js:6430
error-handler.ts:145 🚨 Error ERR-1763430874008-HG0MR5 [MEDIUM]
error-handler.ts:146 Timestamp: 2025-11-18T01:54:34.008Z
error-handler.ts:147 Operation: Submit FAL AI request to queue
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:61 Original Error: Error: FAL Queue Submit Error: 422 
    at mx (ai-video-client.ts:593:9)
    at async use-ai-generation.ts:902:24
console.error @ index.html:61
Fr @ error-handler.ts:152
ae @ error-handler.ts:185
_n @ error-handler.ts:300
mx @ ai-video-client.ts:592
await in mx
(anonymous) @ use-ai-generation.ts:902
qe @ react-dom.development.js:4164
vR @ react-dom.development.js:4213
Iv @ react-dom.development.js:4277
Sk @ react-dom.development.js:4291
DE @ react-dom.development.js:9041
pI @ react-dom.development.js:9073
PE @ react-dom.development.js:9086
hI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Qg @ react-dom.development.js:26179
pR @ react-dom.development.js:3991
Fm @ react-dom.development.js:9287
$L @ react-dom.development.js:6465
Cm @ react-dom.development.js:6457
UL @ react-dom.development.js:6430
index.html:61 Stack Trace: Error: FAL Queue Submit Error: 422 
    at mx (app://./assets/editor._project_id.lazy-BVdnQMB0.js:105:17951)
    at async app://./assets/editor._project_id.lazy-BVdnQMB0.js:108:1860
console.error @ index.html:61
Fr @ error-handler.ts:154
ae @ error-handler.ts:185
_n @ error-handler.ts:300
mx @ ai-video-client.ts:592
await in mx
(anonymous) @ use-ai-generation.ts:902
qe @ react-dom.development.js:4164
vR @ react-dom.development.js:4213
Iv @ react-dom.development.js:4277
Sk @ react-dom.development.js:4291
DE @ react-dom.development.js:9041
pI @ react-dom.development.js:9073
PE @ react-dom.development.js:9086
hI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Qg @ react-dom.development.js:26179
pR @ react-dom.development.js:3991
Fm @ react-dom.development.js:9287
$L @ react-dom.development.js:6465
Cm @ react-dom.development.js:6457
UL @ react-dom.development.js:6430
error-handler.ts:161 Metadata: {status: 422, statusText: '', errorData: {…}, endpoint: 'fal-ai/sora-2/text-to-video', operation: 'queueSubmit'}
error-handler.ts:145 🚨 Error ERR-1763430874010-EXGUVV [MEDIUM]
error-handler.ts:146 Timestamp: 2025-11-18T01:54:34.010Z
error-handler.ts:147 Operation: AI Video Generation
error-handler.ts:148 Category: ai_service
error-handler.ts:149 Severity: medium
index.html:61 Original Error: Error: Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}
    at mx (ai-video-client.ts:607:13)
    at async use-ai-generation.ts:902:24
console.error @ index.html:61
Fr @ error-handler.ts:152
ae @ error-handler.ts:185
_n @ error-handler.ts:300
mx @ ai-video-client.ts:780
await in mx
(anonymous) @ use-ai-generation.ts:902
qe @ react-dom.development.js:4164
vR @ react-dom.development.js:4213
Iv @ react-dom.development.js:4277
Sk @ react-dom.development.js:4291
DE @ react-dom.development.js:9041
pI @ react-dom.development.js:9073
PE @ react-dom.development.js:9086
hI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Qg @ react-dom.development.js:26179
pR @ react-dom.development.js:3991
Fm @ react-dom.development.js:9287
$L @ react-dom.development.js:6465
Cm @ react-dom.development.js:6457
UL @ react-dom.development.js:6430
index.html:61 Stack Trace: Error: Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}
    at mx (app://./assets/editor._project_id.lazy-BVdnQMB0.js:105:18163)
    at async app://./assets/editor._project_id.lazy-BVdnQMB0.js:108:1860
console.error @ index.html:61
Fr @ error-handler.ts:154
ae @ error-handler.ts:185
_n @ error-handler.ts:300
mx @ ai-video-client.ts:780
await in mx
(anonymous) @ use-ai-generation.ts:902
qe @ react-dom.development.js:4164
vR @ react-dom.development.js:4213
Iv @ react-dom.development.js:4277
Sk @ react-dom.development.js:4291
DE @ react-dom.development.js:9041
pI @ react-dom.development.js:9073
PE @ react-dom.development.js:9086
hI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Qg @ react-dom.development.js:26179
pR @ react-dom.development.js:3991
Fm @ react-dom.development.js:9287
$L @ react-dom.development.js:6465
Cm @ react-dom.development.js:6457
UL @ react-dom.development.js:6430
error-handler.ts:161 Metadata: {operation: 'generateVideo'}
use-ai-generation.ts:783   📊 Progress for sora2_text_to_video: {status: 'failed', progress: 0, message: 'Invalid request parameters: {"detail":[{"loc":["bo….const","ctx":{"given":6,"permitted":[4,8,12]}}]}', elapsedTime: 0}
index.html:61 ❌❌❌ GENERATION FAILED ❌❌❌ Error: Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}
    at mx (ai-video-client.ts:607:13)
    at async use-ai-generation.ts:902:24
console.error @ index.html:61
(anonymous) @ use-ai-generation.ts:1797
await in (anonymous)
qe @ react-dom.development.js:4164
vR @ react-dom.development.js:4213
Iv @ react-dom.development.js:4277
Sk @ react-dom.development.js:4291
DE @ react-dom.development.js:9041
pI @ react-dom.development.js:9073
PE @ react-dom.development.js:9086
hI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Qg @ react-dom.development.js:26179
pR @ react-dom.development.js:3991
Fm @ react-dom.development.js:9287
$L @ react-dom.development.js:6465
Cm @ react-dom.development.js:6457
UL @ react-dom.development.js:6430
index.html:61 [AI View] Error occurred: Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}
console.error @ index.html:61
onError @ ai.tsx:512
(anonymous) @ use-ai-generation.ts:1799
await in (anonymous)
qe @ react-dom.development.js:4164
vR @ react-dom.development.js:4213
Iv @ react-dom.development.js:4277
Sk @ react-dom.development.js:4291
DE @ react-dom.development.js:9041
pI @ react-dom.development.js:9073
PE @ react-dom.development.js:9086
hI @ react-dom.development.js:9097
(anonymous) @ react-dom.development.js:9288
Qg @ react-dom.development.js:26179
pR @ react-dom.development.js:3991
Fm @ react-dom.development.js:9287
$L @ react-dom.development.js:6465
Cm @ react-dom.development.js:6457
UL @ react-dom.development.js:6430
ai.tsx:508 [AI View] Progress: 0% - Invalid request parameters: {"detail":[{"loc":["body","duration"],"msg":"unexpected value; permitted: 4, 8, 12","type":"value_error.const","ctx":{"given":6,"permitted":[4,8,12]}}]}