
🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀
use-ai-generation.ts:679 Input parameters:
use-ai-generation.ts:680   - activeTab: text
use-ai-generation.ts:681   - prompt: Elevator door opens, 5th floor hallway has dark wooden floor, walls displaying Venetian mask artwork
use-ai-generation.ts:682   - selectedModels: Array(1)
use-ai-generation.ts:683   - hasSelectedImage: false
use-ai-generation.ts:684   - activeProject: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:685   - addMediaItem available: true
use-ai-generation.ts:743 ✅ Validation passed, starting generation...
use-ai-generation.ts:756 🔍 DEBUG STEP 1: Pre-Generation State Check
use-ai-generation.ts:757    - activeProject: true 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:758    - addMediaItem available: true function
use-ai-generation.ts:763    - mediaStoreLoading: false
use-ai-generation.ts:764    - mediaStoreError: null
use-ai-generation.ts:767 
📦 Starting generation for 1 models
use-ai-generation.ts:826 
🎬 [1/1] Processing model: ltxv2_fast_t2v (LTX Video 2.0 Fast T2V)
use-ai-generation.ts:850   📝 Processing text-to-video model ltxv2_fast_t2v...
use-ai-generation.ts:839   📊 Progress for ltxv2_fast_t2v: Object
ai-video-client.ts:1840 🎬 Starting LTX Video 2.0 generation with FAL AI
ai-video-client.ts:1841 📝 Prompt: Elevator door opens, 5th floor hallway has dark wooden floor, walls displaying Venetian mask artwork
ai-video-client.ts:1842 📐 Resolution: 1080p
34ai.tsx:508 [AI View] Progress: 10% - Submitting LTX Video 2.0 Fast T2V request...
use-ai-generation.ts:839   📊 Progress for ltxv2_fast_t2v: Object
use-ai-generation.ts:987   ✅ Text-to-video response: Object
use-ai-generation.ts:1465 🔍 DEBUG STEP 2: Post-API Response Analysis
use-ai-generation.ts:1466    - response received: true
use-ai-generation.ts:1468    - response.video_url: true https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkF...
use-ai-generation.ts:1473    - response.job_id: true job_8hqqqclqc_1763435992707
use-ai-generation.ts:1478    - response keys: Array(6)
use-ai-generation.ts:1479    - response.status: completed
use-ai-generation.ts:1484 
  🔍 Response analysis for ltxv2_fast_t2v:
use-ai-generation.ts:1485     - response exists: true
use-ai-generation.ts:1486     - response.job_id: job_8hqqqclqc_1763435992707
use-ai-generation.ts:1487     - response.video_url: https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4
use-ai-generation.ts:1488     - response.status: completed
use-ai-generation.ts:1489     - Full response: {
  "job_id": "job_8hqqqclqc_1763435992707",
  "status": "completed",
  "message": "Video generated successfully with ltxv2_fast_t2v",
  "estimated_time": 0,
  "video_url": "https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4",
      "content_type": "video/mp4",
      "file_name": "sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4",
      "file_size": null,
      "width": 1920,
      "height": 1080,
      "fps": 25,
      "duration": 6.12,
      "num_frames": 153
    }
  }
}
use-ai-generation.ts:1492 🔍 FIX VERIFICATION: Processing job_id response
use-ai-generation.ts:1493    - job_id exists: true
use-ai-generation.ts:1494    - video_url exists: true
use-ai-generation.ts:1498 🎉 FIX SUCCESS: Direct mode with job_id detected!
use-ai-generation.ts:1499 🎯 DIRECT MODE WITH JOB_ID - Video URL: https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4
use-ai-generation.ts:1522 📦 Added to generations array: 1
use-ai-generation.ts:1525 🔍 DEBUG STEP 3: Media Integration Condition Check
use-ai-generation.ts:1526    - activeProject check: true → 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:1532    - addMediaItem check: true → function
use-ai-generation.ts:1538    - response.video_url check: true → EXISTS
use-ai-generation.ts:1544    - WILL EXECUTE MEDIA INTEGRATION: true
use-ai-generation.ts:1550 🔍 DEBUG STEP 4: ✅ EXECUTING Media Integration Block
use-ai-generation.ts:1553    - About to download from URL: https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4
use-ai-generation.ts:1557    - Project ID for media: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:1558    - addMediaItem function type: function
use-ai-generation.ts:1563 🔄 Attempting to add to media store...
use-ai-generation.ts:1564    - Project ID: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:1565    - addMediaItem available: true
use-ai-generation.ts:1569 📥 Downloading video from URL: https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4
2ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1575 🔍 DEBUG STEP 5: Video Download Progress
use-ai-generation.ts:1576    - videoResponse.ok: true
use-ai-generation.ts:1577    - videoResponse.status: 200
use-ai-generation.ts:1578    - videoResponse.headers content-type: video/mp4
ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1590 ✅ Downloaded video blob, size: 2817575
use-ai-generation.ts:1594 📄 Created file: AI-Video-ltxv2_fast_t2v-1763436029098.mp4
use-ai-generation.ts:1596 🔍 DEBUG STEP 6: File Creation Complete
use-ai-generation.ts:1597    - blob.size: 2817575 bytes
use-ai-generation.ts:1598    - blob.type: video/mp4
use-ai-generation.ts:1599    - file.name: AI-Video-ltxv2_fast_t2v-1763436029098.mp4
use-ai-generation.ts:1600    - file.size: 2817575
use-ai-generation.ts:1613 📤 Adding to media store with item: Object
use-ai-generation.ts:1615 🔍 DEBUG STEP 7: About to Call addMediaItem
use-ai-generation.ts:1616    - mediaItem structure: {
  "name": "AI: Elevator door opens, 5th floor...",
  "type": "video",
  "file": {},
  "url": "https://v3b.fal.media/files/b/zebra/sEZrHtwps4_FkFtZ-XHr8_5QLd7HRV.mp4",
  "duration": 6.12,
  "width": 1920,
  "height": 1080
}
use-ai-generation.ts:1620    - projectId: 91792c80-b639-4b2a-bf54-6b7da08e2ff1
use-ai-generation.ts:1621    - addMediaItem is function: true
media-store.ts:326 [MediaStore.addMediaItem] Called with projectId: 91792c80-b639-4b2a-bf54-6b7da08e2ff1, item.name: AI: Elevator door opens, 5th floor...
ai.tsx:508 [AI View] Progress: 100% - Video with audio generated using LTX Video 2.0 Fast T2V
use-ai-generation.ts:1631 🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED
use-ai-generation.ts:1632    - newItemId: 23f4be8d-76d1-1928-ad33-dc7feaf7675e
use-ai-generation.ts:1633    - SUCCESS: Video added to media store!
use-ai-generation.ts:1635 ✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!
use-ai-generation.ts:1636    - Item ID: 23f4be8d-76d1-1928-ad33-dc7feaf7675e
use-ai-generation.ts:1840 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:1841   - Total generations created: 1
use-ai-generation.ts:1842   - Generations: Array(1)
use-ai-generation.ts:1847 📤 Calling onComplete callback with 1 videos
ai.tsx:516 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:517 [AI View] Received 1 videos: Array(1)
ai.tsx:522 [AI View] onComplete callback finished
use-ai-generation.ts:1851 ✅ onComplete callback finished
ai.tsx:508 [AI View] Progress: 100% - Generated 1 videos successfully!