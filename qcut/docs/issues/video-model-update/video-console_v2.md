🎬 [1/1] Processing model: wan_25_preview (WAN v2.5 Preview)
use-ai-generation.ts:467   📝 Calling generateVideo for wan_25_preview...
ai-video-client.ts:102 🔑 FAL API Key present: Yes (length: 69)
ai-video-client.ts:115 🎬 Generating video with FAL AI: fal-ai/wan-25-preview/text-to-video
ai-video-client.ts:116 📝 Prompt: Object POV cinematic shot: the arrow is launched from the bow, camera locked to the arrowhead as it cuts through the air at incredible speed. The archer’s intense blue glowing eyes fade into the background, motion blur streaking past forests and cliffs. Wind rushes around, leaves and sparks of light distort in bullet-time style. Hyper-detailed textures, ultra-realistic physics, IMAX cinematic framing, dynamic depth of field as the arrow races toward its target.
ai-video-client.ts:157 📤 Sending request to fal-ai/wan-25-preview/text-to-video with payload: {prompt: 'Object POV cinematic shot: the arrow is launched f…th of field as the arrow races toward its target.', duration: 5, resolution: '1080p', quality: 'high', style_preset: 'cinematic'}
use-ai-generation.ts:456   📊 Progress for wan_25_preview: {status: 'queued', progress: 0, message: 'Submitting request to FAL.ai queue...', elapsedTime: 0}
ai-video-client.ts:173 📤 Attempting queue submission with payload: {prompt: 'Object POV cinematic shot: the arrow is launched f…th of field as the arrow races toward its target.', duration: 5, resolution: '1080p', quality: 'high', style_preset: 'cinematic'}
ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
401ai.tsx:71 [AI View] Progress: 0% - Submitting request to FAL.ai queue...
ai-video-client.ts:209 ✅ FAL Response received: {video: {…}, seed: 712386720, actual_prompt: 'POV shot, locked to arrowhead, extreme close-up, m…tops, low-frequency rumble of approaching impact.'}
ai-video-client.ts:210 🗋 Response structure: {hasRequestId: false, hasVideo: true, hasVideoUrl: true, keys: Array(3), fullResponse: {…}}
ai-video-client.ts:235 ⚡ Direct mode: video ready immediately
use-ai-generation.ts:456   📊 Progress for wan_25_preview: {status: 'completed', progress: 100, message: 'Video generated successfully with wan_25_preview', elapsedTime: 401}
use-ai-generation.ts:475   ✅ generateVideo returned: {job_id: 'job_rdf7wyjuo_1758778299958', status: 'completed', message: 'Video generated successfully with wan_25_preview', estimated_time: 401, video_url: 'https://v3.fal.media/files/penguin/7H2_BK25ykTLu6KiXC3YY.mp4', …}
use-ai-generation.ts:486 
  🔍 Response analysis for wan_25_preview:
use-ai-generation.ts:487     - response exists: true
use-ai-generation.ts:488     - response.job_id: job_rdf7wyjuo_1758778299958
use-ai-generation.ts:489     - response.video_url: https://v3.fal.media/files/penguin/7H2_BK25ykTLu6KiXC3YY.mp4
use-ai-generation.ts:490     - response.status: completed
use-ai-generation.ts:491     - Full response: {
  "job_id": "job_rdf7wyjuo_1758778299958",
  "status": "completed",
  "message": "Video generated successfully with wan_25_preview",
  "estimated_time": 401,
  "video_url": "https://v3.fal.media/files/penguin/7H2_BK25ykTLu6KiXC3YY.mp4",
  "video_data": {
    "video": {
      "url": "https://v3.fal.media/files/penguin/7H2_BK25ykTLu6KiXC3YY.mp4",
      "content_type": "video/mp4",
      "file_name": "7H2_BK25ykTLu6KiXC3YY.mp4",
      "file_size": null,
      "width": 1920,
      "height": 1080,
      "fps": 24,
      "duration": 5.042,
      "num_frames": 121
    },
    "seed": 712386720,
    "actual_prompt": "POV shot, locked to arrowhead, extreme close-up, motion blur, side lighting, cool color palette, dynamic depth of field, IMAX cinematic framing. The arrow launches from a wooden bow with a sharp twang, accelerating through the air in bullet-time clarity. Wind tears around the arrow’s tip, distorting leaves and scattering sparks of light into streaked trails. As the camera surges forward with hyper-detailed textures, the archer’s intense blue glowing eyes recede rapidly into the distance, framed by a blurred forest canopy and jagged cliffs streaking past at hypersonic speed. Sunlight pierces through scattered clouds, casting overcast lighting across the terrain below. Center composition emphasizes the arrow’s trajectory. Audio: whooshing wind, snapping bowstring, crackling energy sparks. No dialogue. Background sound: distant eagle cry, rustling treetops, low-frequency rumble of approaching impact."
  }
}
use-ai-generation.ts:600 
✅✅✅ GENERATION LOOP COMPLETE ✅✅✅
use-ai-generation.ts:601   - Total generations created: 1
use-ai-generation.ts:602   - Generations: [{…}]
use-ai-generation.ts:607 📤 Calling onComplete callback with 1 videos
ai.tsx:79 
🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉
ai.tsx:80 [AI View] Received 1 videos: [{…}]
ai.tsx:85 [AI View] onComplete callback finished
use-ai-generation.ts:609 ✅ onComplete callback finished
ai.tsx:71 [AI View] Progress: 100% - Generated 1 videos successfully!