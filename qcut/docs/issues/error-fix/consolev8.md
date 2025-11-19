step 1: selectedModels updated -> [none]
ai.tsx:366 step 2: combinedCapabilities updated Object
ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:358 step 1: selectedModels updated -> [none]
ai.tsx:366 step 2: combinedCapabilities updated Object
2ai.tsx:524 [AI View] Progress: 0% - 
ai.tsx:358 step 1: selectedModels updated -> ltxv2_fast_t2v
ai.tsx:366 step 2: combinedCapabilities updated Object
9ai.tsx:524 [AI View] Progress: 0% - 
use-ai-generation.ts:710 step 3: handleGenerate invoked (AI video flow)
use-ai-generation.ts:711 ============================================================
use-ai-generation.ts:712 === handleGenerate CALLED ===
use-ai-generation.ts:713 ============================================================
use-ai-generation.ts:714 Timestamp: 2025-11-19T06:22:24.618Z
use-ai-generation.ts:715 Input parameters:
use-ai-generation.ts:716   - activeTab: text
use-ai-generation.ts:717   - prompt: supermodel dance 
use-ai-generation.ts:722   - prompt length: 17
use-ai-generation.ts:723   - selectedModels: Array(1)
use-ai-generation.ts:724   - hasSelectedImage: false
use-ai-generation.ts:725   - imageFile: null
use-ai-generation.ts:733   - activeProject: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:734   - activeProject name: New Project
use-ai-generation.ts:735   - addMediaItem available: true
use-ai-generation.ts:736 
use-ai-generation.ts:801 ✅ Validation passed, starting generation...
use-ai-generation.ts:802   - Models to process: 1
use-ai-generation.ts:803   - Active project: true
use-ai-generation.ts:804   - Media store available: true
use-ai-generation.ts:817 step 3a: pre-generation state check
use-ai-generation.ts:818    - activeProject: true 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:819    - addMediaItem available: true function
use-ai-generation.ts:824    - mediaStoreLoading: false
use-ai-generation.ts:825    - mediaStoreError: null
use-ai-generation.ts:828 
📦 Starting generation for 1 models
use-ai-generation.ts:887 step 4: sanitized params for ltxv2_fast_t2v Object
use-ai-generation.ts:892 
🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
use-ai-generation.ts:915 step 5: sending generation request for ltxv2_fast_t2v (text tab) Object
use-ai-generation.ts:921   📝 Processing text-to-video model ltxv2_fast_t2v...
use-ai-generation.ts:905   📊 Progress for ltxv2_fast_t2v: Object
ai-video-client.ts:1840 🎬 Starting LTX Video 2.0 generation with FAL AI
ai-video-client.ts:1841 📝 Prompt: supermodel dance
ai-video-client.ts:1842 📐 Resolution: 1080p
2ai.tsx:524 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
33ai.tsx:524 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
use-ai-generation.ts:905   📊 Progress for ltxv2_fast_t2v: {status: 'completed', progress: 100, message: 'Video with audio generated using LTX Video 2.0 Fast T2V'}
use-ai-generation.ts:1058   ✅ Text-to-video response: {job_id: 'job_mi5a5togq_1763533344619', status: 'completed', message: 'Video generated successfully with ltxv2_fast_t2v', estimated_time: 0, video_url: 'https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4', …}
use-ai-generation.ts:1536 step 5a: post-API response analysis
use-ai-generation.ts:1537    - response received: true
use-ai-generation.ts:1539    - response.video_url: true https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJ...
use-ai-generation.ts:1544    - response.job_id: true job_mi5a5togq_1763533344619
use-ai-generation.ts:1549    - response keys: (6) ['job_id', 'status', 'message', 'estimated_time', 'video_url', 'video_data']
use-ai-generation.ts:1550    - response.status: completed
use-ai-generation.ts:1555 
  🔍 Response analysis for ltxv2_fast_t2v:
use-ai-generation.ts:1556     - response exists: true
use-ai-generation.ts:1557     - response.job_id: job_mi5a5togq_1763533344619
use-ai-generation.ts:1558     - response.video_url: https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4
use-ai-generation.ts:1559     - response.status: completed
use-ai-generation.ts:1560     - Full response: {
  "job_id": "job_mi5a5togq_1763533344619",
  "status": "completed",
  "message": "Video generated successfully with ltxv2_fast_t2v",
  "estimated_time": 0,
  "video_url": "https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4",
      "content_type": "video/mp4",
      "file_name": "J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4",
      "file_size": null,
      "width": 1920,
      "height": 1080,
      "fps": 25,
      "duration": 6.12,
      "num_frames": 153
    }
  }
}
use-ai-generation.ts:1563 🔍 FIX VERIFICATION: Processing job_id response
use-ai-generation.ts:1564    - job_id exists: true
use-ai-generation.ts:1565    - video_url exists: true
use-ai-generation.ts:1569 🎉 FIX SUCCESS: Direct mode with job_id detected!
use-ai-generation.ts:1570 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4
use-ai-generation.ts:1593 📦 Added to generations array: 1
use-ai-generation.ts:1596 step 6a: media integration condition check
use-ai-generation.ts:1601    - activeProject: true 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1602    - addMediaItem: true function
use-ai-generation.ts:1603    - response.video_url: true EXISTS
use-ai-generation.ts:1615    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1618 step 6b: executing media integration block
use-ai-generation.ts:1621    - About to download from URL: https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4
use-ai-generation.ts:1625    - Project ID for media: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1626    - addMediaItem function type: function
use-ai-generation.ts:1631 step 6: downloading video and adding to media store for ltxv2_fast_t2v
use-ai-generation.ts:1633 🔄 Attempting to add to media store...
use-ai-generation.ts:1634    - Project ID: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1635    - addMediaItem available: true
use-ai-generation.ts:1639 📥 Downloading video from URL: https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4
2ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1645 step 6c: video download progress
use-ai-generation.ts:1646    - videoResponse.ok: true
use-ai-generation.ts:1647    - videoResponse.status: 200
use-ai-generation.ts:1648    - videoResponse.headers content-type: video/mp4
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1660 ✅ Downloaded video blob, size: 3209025
use-ai-generation.ts:1664 📄 Created file: AI-Video-ltxv2_fast_t2v-1763533381705.mp4
use-ai-generation.ts:1666 step 6d: file creation complete
use-ai-generation.ts:1667    - blob.size: 3209025 bytes
use-ai-generation.ts:1668    - blob.type: video/mp4
use-ai-generation.ts:1669    - file.name: AI-Video-ltxv2_fast_t2v-1763533381705.mp4
use-ai-generation.ts:1670    - file.size: 3209025
use-ai-generation.ts:1673 step 6e: MANDATORY save to local disk starting
use-ai-generation.ts:1709 ✅ step 6e: video saved to disk successfully {localPath: 'C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\8ee6a…ltxv2_fast_t2v-1763533381747-5238f4074864b17c.mp4', fileName: 'AI-Video-ltxv2_fast_t2v-1763533381705-ltxv2_fast_t2v-1763533381747-5238f4074864b17c.mp4', fileSize: 3209025}
blob-url-debug.ts:34 [BlobUrlDebug] 🟢 Created: blob:app://./ea00a6ae-ce52-4b15-a537-67278a4a45f2
blob-url-debug.ts:35   📍 Source: at app://./assets/editor._project_id.lazy-D48-_JDO.js:108:3482
blob-url-debug.ts:36   📦 Type: File, Size: 3209025 bytes
use-ai-generation.ts:1735 step 6d details: {mediaUrl: 'blob:app://./ea00a6ae-ce52-4b15-a537-67278a4a45f2', fileName: 'AI-Video-ltxv2_fast_t2v-1763533381705.mp4', fileSize: 3209025}
use-ai-generation.ts:1740 📤 Adding to media store with item: {name: 'AI: supermodel dance...', type: 'video', file: File, url: 'blob:app://./ea00a6ae-ce52-4b15-a537-67278a4a45f2', originalUrl: 'https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4', …}
use-ai-generation.ts:1742 step 6e: about to call addMediaItem
use-ai-generation.ts:1743    - mediaItem structure: {
  "name": "AI: supermodel dance...",
  "type": "video",
  "file": {},
  "url": "blob:app://./ea00a6ae-ce52-4b15-a537-67278a4a45f2",
  "originalUrl": "https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4",
  "localPath": "C:\\Users\\zdhpe\\AppData\\Roaming\\qcut\\projects\\8ee6a680-1bb3-4c4a-906e-9b6c7271e97a\\ai-videos\\AI-Video-ltxv2_fast_t2v-1763533381705-ltxv2_fast_t2v-1763533381747-5238f4074864b17c.mp4",
  "isLocalFile": true,
  "duration": 6.12,
  "width": 1920,
  "height": 1080
}
use-ai-generation.ts:1747    - projectId: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a
use-ai-generation.ts:1748    - addMediaItem is function: true
media-store.ts:325 step 6g: media-store addMediaItem {projectId: '8ee6a680-1bb3-4c4a-906e-9b6c7271e97a', id: undefined, hasFile: true, url: 'blob:app://./ea00a6ae-ce52-4b15-a537-67278a4a45f2', originalUrl: 'https://v3b.fal.media/files/b/lion/J6DQkTaeB9rphPJqd8vyP_4SMhTg2v.mp4', …}
media-store.ts:335 [MediaStore.addMediaItem] Called with projectId: 8ee6a680-1bb3-4c4a-906e-9b6c7271e97a, item.name: AI: supermodel dance...
media-store.ts:362 [MediaStore.addMediaItem] Saving media item {projectId: '8ee6a680-1bb3-4c4a-906e-9b6c7271e97a', id: 'cfd91c2c-cc16-c98d-fcf3-de8fbb505935', name: 'AI: supermodel dance...', type: 'video', hasFile: true, …}
ai.tsx:524 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
media-store.ts:388 [MediaStore.addMediaItem] Saved to storage {projectId: '8ee6a680-1bb3-4c4a-906e-9b6c7271e97a', id: 'cfd91c2c-cc16-c98d-fcf3-de8fbb505935', name: 'AI: supermodel dance...', type: 'video'}
use-ai-generation.ts:1758 step 6f: addMediaItem completed {newItemId: 'cfd91c2c-cc16-c98d-fcf3-de8fbb505935', mediaUrl: 'blob:app://./ea00a6ae-ce52-4b15-a537-67278a4a45f2', fileName: 'AI-Video-ltxv2_fast_t2v-1763533381705.mp4', fileSize: 3209025}
use-ai-generation.ts:1764    - newItemId: cfd91c2c-cc16-c98d-fcf3-de8fbb505935
use-ai-generation.ts:1765    - SUCCESS: Video added to media store!
use-ai-generation.ts:1767 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1768    - Item ID: cfd91c2c-cc16-c98d-fcf3-de8fbb505935
use-ai-generation.ts:2030 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:2031   - Total generations created: 1
use-ai-generation.ts:2032   - Generations: [{…}]
use-ai-generation.ts:2037 step 7: generation flow complete; updating UI and callbacks
use-ai-generation.ts:2039 📤 Calling onComplete callback with 1 videos
ai.tsx:532 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:533 [AI View] Received 1 videos: [{…}]
ai.tsx:538 [AI View] onComplete callback finished
use-ai-generation.ts:2043 ✅ onComplete callback finished
ai.tsx:524 [AI View] Progress: 100% - Generated 1 videos successfully!
export-all-button.tsx:39 step 8: export-all clicked {totalItems: 2, isExporting: false}
export-all-button.tsx:106 step 8: export-all start zipping {totalItems: 2, hasFiles: 2, remoteUrls: Array(0)}hasFiles: 2remoteUrls: []length: 0[[Prototype]]: Array(0)at: ƒ at()concat: ƒ concat()constructor: ƒ Array()copyWithin: ƒ copyWithin()entries: ƒ entries()every: ƒ every()fill: ƒ fill()filter: ƒ filter()find: ƒ find()findIndex: ƒ findIndex()findLast: ƒ findLast()findLastIndex: ƒ findLastIndex()flat: ƒ flat()flatMap: ƒ flatMap()forEach: ƒ forEach()includes: ƒ includes()indexOf: ƒ indexOf()join: ƒ join()keys: ƒ keys()lastIndexOf: ƒ lastIndexOf()length: 0map: ƒ map()pop: ƒ pop()push: ƒ push()reduce: ƒ reduce()reduceRight: ƒ reduceRight()reverse: ƒ reverse()shift: ƒ shift()slice: ƒ slice()some: ƒ some()sort: ƒ sort()splice: ƒ splice()toLocaleString: ƒ toLocaleString()toReversed: ƒ toReversed()toSorted: ƒ toSorted()toSpliced: ƒ toSpliced()toString: ƒ toString()unshift: ƒ unshift()values: ƒ values()with: ƒ with()Symbol(Symbol.iterator): ƒ values()Symbol(Symbol.unscopables): {at: true, copyWithin: true, entries: true, fill: true, find: true, …}[[Prototype]]: ObjecttotalItems: 2[[Prototype]]: Object
export-all-button.tsx:127 step 8: export-all zip completed {phase: 'idle', totalFiles: 2, completedFiles: 2}