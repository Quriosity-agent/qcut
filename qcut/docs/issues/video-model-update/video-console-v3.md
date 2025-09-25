[AI View] Progress: 0% - 
use-ai-generation.ts:403 
🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀
use-ai-generation.ts:404 Input parameters:
use-ai-generation.ts:405   - activeTab: text
use-ai-generation.ts:406   - prompt: A massive stone hand erupts forcefully from the rocky cliffs, shattering the surrounding rock and du
use-ai-generation.ts:407   - selectedModels: Array(1)
use-ai-generation.ts:408   - hasSelectedImage: false
use-ai-generation.ts:409   - activeProject: 4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf
use-ai-generation.ts:410   - addMediaItem available: true
use-ai-generation.ts:424 ✅ Validation passed, starting generation...
use-ai-generation.ts:437 🔍 DEBUG STEP 1: Pre-Generation State Check
use-ai-generation.ts:438    - activeProject: true 4769ffd3-cbcf-4329-b2bf-3cd5135d9bcf
use-ai-generation.ts:439    - addMediaItem available: true function
use-ai-generation.ts:440    - mediaStoreLoading: false
use-ai-generation.ts:441    - mediaStoreError: null
use-ai-generation.ts:444 
📦 Starting generation for 1 models
use-ai-generation.ts:451 
🎬 [1/1] Processing model: wan_25_preview (WAN v2.5 Preview)
use-ai-generation.ts:473   📝 Calling generateVideo for wan_25_preview...
ai-video-client.ts:102 🔑 FAL API Key present: Yes (length: 69)
ai-video-client.ts:115 🎬 Generating video with FAL AI: fal-ai/wan-25-preview/text-to-video
ai-video-client.ts:116 📝 Prompt: A massive stone hand erupts forcefully from the rocky cliffs, shattering the surrounding rock and dust clouds as its enormous fingers clamp tightly around a struggling pikaqiu-like creature. The captured pikaqiu thrashes and screeches wildly, while the rest of the pikaqiu flock swiftly scatters in chaotic panic, dodging the sudden danger. The camera, handheld and shaking vigorously as if impacted by the hand's force, follows the action closely, zooming in on the intense struggle and swiftly pann
ai-video-client.ts:157 📤 Sending request to fal-ai/wan-25-preview/text-to-video with payload: Object
use-ai-generation.ts:462   📊 Progress for wan_25_preview: Object
ai-video-client.ts:173 📤 Attempting queue submission with payload: Object
4ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
182ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
25ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
ai-video-client.ts:209 ✅ FAL Response received: {video: {…}, seed: 325502816, actual_prompt: 'Low angle shot, wide shot, daylight, side lighting…of splitting rock, chaotic squeals, gusting wind.'}
ai-video-client.ts:210 🗋 Response structure: {hasRequestId: false, hasVideo: true, hasVideoUrl: true, keys: Array(3), fullResponse: {…}}
ai-video-client.ts:235 ⚡ Direct mode: video ready immediately
use-ai-generation.ts:462   📊 Progress for wan_25_preview: {status: 'completed', progress: 100, message: 'Video generated successfully with wan_25_preview', elapsedTime: 212}
use-ai-generation.ts:481   ✅ generateVideo returned: {job_id: 'job_nixbtstmx_1758780734496', status: 'completed', message: 'Video generated successfully with wan_25_preview', estimated_time: 212, video_url: 'https://v3b.fal.media/files/b/monkey/zh1VdIX0nKbWnXX5hmxis.mp4', …}
use-ai-generation.ts:492 🔍 DEBUG STEP 2: Post-API Response Analysis
use-ai-generation.ts:493    - response received: true
use-ai-generation.ts:495    - response.video_url: true https://v3b.fal.media/files/b/monkey/zh1VdIX0nKbWn...
use-ai-generation.ts:496    - response.job_id: true job_nixbtstmx_1758780734496
use-ai-generation.ts:497    - response keys: (6) ['job_id', 'status', 'message', 'estimated_time', 'video_url', 'video_data']
use-ai-generation.ts:498    - response.status: completed
use-ai-generation.ts:503 
  🔍 Response analysis for wan_25_preview:
use-ai-generation.ts:504     - response exists: true
use-ai-generation.ts:505     - response.job_id: job_nixbtstmx_1758780734496
use-ai-generation.ts:506     - response.video_url: https://v3b.fal.media/files/b/monkey/zh1VdIX0nKbWnXX5hmxis.mp4
use-ai-generation.ts:507     - response.status: completed
use-ai-generation.ts:508     - Full response: {
  "job_id": "job_nixbtstmx_1758780734496",
  "status": "completed",
  "message": "Video generated successfully with wan_25_preview",
  "estimated_time": 212,
  "video_url": "https://v3b.fal.media/files/b/monkey/zh1VdIX0nKbWnXX5hmxis.mp4",
  "video_data": {
    "video": {
      "url": "https://v3b.fal.media/files/b/monkey/zh1VdIX0nKbWnXX5hmxis.mp4",
      "content_type": "video/mp4",
      "file_name": "zh1VdIX0nKbWnXX5hmxis.mp4",
      "file_size": null,
      "width": 1920,
      "height": 1080,
      "fps": 24,
      "duration": 5.042,
      "num_frames": 121
    },
    "seed": 325502816,
    "actual_prompt": "Low angle shot, wide shot, daylight, side lighting, high contrast, cool color palette, dynamic handheld camera movement. A massive stone hand erupts violently from the jagged rocky cliffs, cracking through layers of granite with explosive force, sending shards and dust clouds flying into the air. The enormous fingers—rough with moss and embedded stones—clamp down with crushing pressure around a small, bright yellow pikaqiu-like creature, its fur sparking faintly with static energy. The captured pikaqiu thrashes wildly, limbs flailing, tail whipping as it lets out sharp, high-pitched screeches: \"Pika! Pika!\" Nearby, the rest of the pikaqiu flock bolts in all directions, leaping over boulders and skidding across loose gravel, their panicked chirps echoing: \"Chu! Chu! Run!\" Dust trembles with each movement. The camera shakes intensely, mimicking the seismic impact of the hand’s emergence, then rapidly zooms in on the struggling creature’s wide, terrified eyes before panning to follow the fleeing flock. Background: stormy sky, distant mountain peaks, wind howling. Sound: deep rumbling stone fractures, sudden crack of splitting rock, chaotic squeals, gusting wind."
  }
}
use-ai-generation.ts:649 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:650   - Total generations created: 1
use-ai-generation.ts:651   - Generations: [{…}]
use-ai-generation.ts:656 📤 Calling onComplete callback with 1 videos
ai.tsx:79 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:80 [AI View] Received 1 videos: [{…}]
ai.tsx:85 [AI View] onComplete callback finished
use-ai-generation.ts:658 ✅ onComplete callback finished
ai.tsx:71 [AI View] Progress: 100% - Generated 1 videos successfully!