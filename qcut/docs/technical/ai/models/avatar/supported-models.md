# Avatar - Supported Models

This document lists all the AI models supported for avatar and video transformation in QCut.

## Overview

The Avatar feature supports **14 different AI models** from various providers including Kling AI, ByteDance, WAN Labs, Sync Labs, and Google Veo. These models enable talking head generation, video-to-video transformation, lip-sync, and video extension.

---

## Model Categories

### Talking Head / Avatar Generation
Models that create talking avatar videos from a character image and audio:
- Kling Avatar v2 Pro
- Kling Avatar v2 Standard
- ByteDance OmniHuman v1.5
- Kling Avatar Pro
- Kling Avatar Standard

### Lip-Sync & Video Replacement
Models that sync lip movements to audio or replace characters:
- Sync Lipsync React-1
- WAN Animate/Replace

### Video Transformation & Editing
Models that transform or edit existing videos:
- Kling O1 Video Reference
- Kling O1 Video Edit
- Kling O1 Reference-to-Video
- WAN v2.6 Ref2V
- Sora 2 Video-to-Video Remix

### Video Extension
Models that extend video duration:
- Veo 3.1 Extend
- Veo 3.1 Fast Extend

---

## Supported Models

### 1. Kling Avatar v2 Pro
- **Provider:** Kling AI
- **Category:** Talking Head / Avatar Generation
- **Estimated Cost:** $0.115 per second
- **Resolution:** 1080p
- **Max Duration:** 60 seconds
- **Description:** Premium avatar video generation with enhanced quality and realism. Ideal for professional productions.
- **Required Inputs:**
  - Character image (portrait photo)
  - Audio file (2-60 seconds, max 5MB)
- **Best For:**
  - Professional video productions
  - High-quality marketing content
  - Premium talking head videos
  - Realistic human avatars
- **Strengths:**
  - Premium quality and realism
  - Supports up to 60 seconds
  - Works with humans, animals, cartoons, or stylized characters
  - Audio-synchronized lip-sync
  - Professional-grade output
- **Limitations:**
  - Higher cost ($0.115/second)
  - Requires pre-uploaded files to FAL storage
  - 2-60 second audio constraint
  - Max 5MB audio file size
- **Parameters:**
  - **Resolution:** 1080p (fixed)
  - **Prompt:** Optional text prompt for additional guidance
  - **Audio Duration:** 2-60 seconds
  - **Audio File Size:** Max 5MB
- **Cost Example:**
  - 10-second video: ~$1.15
  - 30-second video: ~$3.45
  - 60-second video: ~$6.90

---

### 2. Kling Avatar v2 Standard
- **Provider:** Kling AI
- **Category:** Talking Head / Avatar Generation
- **Estimated Cost:** $0.0562 per second
- **Resolution:** 1080p
- **Max Duration:** 60 seconds
- **Description:** Create talking avatar videos with realistic humans, animals, cartoons, or stylized characters. Audio-synchronized lip-sync.
- **Required Inputs:**
  - Character image (portrait photo)
  - Audio file (2-60 seconds, max 5MB)
- **Best For:**
  - Cost-effective avatar videos
  - Marketing and social media
  - E-learning content
  - Chatbot avatars
- **Strengths:**
  - Affordable pricing ($0.0562/second)
  - Good quality for most use cases
  - Supports diverse character types
  - Audio-synchronized lip-sync
  - Up to 60 seconds duration
- **Limitations:**
  - Lower quality than Pro version
  - Requires pre-uploaded files to FAL storage
  - 2-60 second audio constraint
  - Max 5MB audio file size
- **Parameters:**
  - **Resolution:** 1080p (fixed)
  - **Prompt:** Optional text prompt
  - **Audio Duration:** 2-60 seconds
  - **Audio File Size:** Max 5MB
- **Cost Example:**
  - 10-second video: ~$0.56
  - 30-second video: ~$1.69
  - 60-second video: ~$3.37

---

### 3. ByteDance OmniHuman v1.5
- **Provider:** ByteDance
- **Category:** Talking Head / Avatar Generation
- **Estimated Cost:** $0.20 per generation
- **Resolution:** 1080p
- **Max Duration:** 30 seconds
- **Description:** Realistic human avatar with emotion-synced audio
- **Required Inputs:**
  - Character image
  - Audio file
- **Best For:**
  - Realistic human avatars
  - Emotion-synced content
  - Professional presentations
  - Training videos
- **Strengths:**
  - Realistic human avatar generation
  - Emotion synchronization with audio
  - 1080p resolution
  - Up to 30 seconds
- **Limitations:**
  - Fixed cost per generation (not per second)
  - Shorter max duration (30s vs 60s)
  - Focused on human avatars only
- **Parameters:**
  - **Resolution:** 1080p (fixed)
- **Cost Example:**
  - Any duration up to 30s: $0.20

---

### 4. Sync Lipsync React-1
- **Provider:** Sync Labs
- **Category:** Lip-Sync & Video Replacement
- **Estimated Cost:** $0.10 per generation
- **Resolution:** Preserves source resolution
- **Max Duration:** 15 seconds
- **Description:** Emotion-aware lip-sync: sync video to audio with expressions (happy, sad, angry, etc.)
- **Required Inputs:**
  - Source video (existing video with face)
  - Audio file (replacement audio)
- **Best For:**
  - Adding emotions to lip-sync
  - Dubbing videos in different languages
  - Changing audio on existing videos
  - Creating expressive talking heads
- **Strengths:**
  - Emotion-aware synchronization
  - Preserves source video quality
  - Affordable pricing ($0.10 per use)
  - Multiple emotion options
  - Flexible lip-sync modes
- **Limitations:**
  - Max 15 seconds duration
  - Requires existing video with face
  - Limited to face/lips/head modes
- **Parameters:**
  - **Emotion:** happy, angry, sad, neutral, disgusted, surprised (default: neutral)
  - **Model Mode:** lips, face, head (default: face)
  - **Lipsync Mode:** cut_off, loop, bounce, silence, remap (default: bounce)
  - **Temperature:** 0.0-1.0 (default: 0.5) - Controls variation
- **Supported Emotions:**
  - Happy
  - Angry
  - Sad
  - Neutral
  - Disgusted
  - Surprised

---

### 5. WAN v2.6 Ref2V
- **Provider:** WAN Labs
- **Category:** Video Transformation & Editing
- **Estimated Cost:** $0.10-0.15 per second
- **Resolution:** 720p / 1080p
- **Max Duration:** 15 seconds
- **Description:** Generate videos guided by reference video clips - transfers motion/style to new content
- **Required Inputs:**
  - Source video (reference for motion/style)
- **Best For:**
  - Motion transfer
  - Style transfer to new content
  - Creating variations of existing videos
  - Preserving camera movement
- **Strengths:**
  - Reference-guided generation
  - Multiple resolution options
  - Flexible aspect ratios (5 options)
  - Prompt expansion available
- **Limitations:**
  - Variable pricing based on resolution
  - Max 15 seconds
  - 1080p costs 50% more than 720p
- **Parameters:**
  - **Duration:** 5, 10, or 15 seconds (default: 5)
  - **Resolution:** 720p ($0.10/s) or 1080p ($0.15/s)
  - **Aspect Ratio:** 16:9, 9:16, 1:1, 4:3, 3:4
  - **Enable Prompt Expansion:** boolean (default: true)
- **Cost Example:**
  - 5s @ 720p: $0.50
  - 10s @ 1080p: $1.50
  - 15s @ 1080p: $2.25

---

### 6. Kling O1 Video Reference
- **Provider:** Kling AI
- **Category:** Video Transformation & Editing
- **Estimated Cost:** $0.112 per generation
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Description:** Generate new shots guided by input reference video, preserving motion and camera style
- **Required Inputs:**
  - Source video (reference)
- **Best For:**
  - Creating video variations
  - Preserving camera movement
  - Style-consistent video generation
  - Motion-guided synthesis
- **Strengths:**
  - Preserves motion and camera style
  - 1080p output
  - Flexible aspect ratios
  - Affordable pricing
- **Limitations:**
  - Max 10 seconds
  - Limited duration options (5 or 10s only)
- **Parameters:**
  - **Duration:** 5 or 10 seconds (default: 5)
  - **Aspect Ratio:** auto, 16:9, 9:16, 1:1

---

### 7. Kling O1 Video Edit
- **Provider:** Kling AI
- **Category:** Video Transformation & Editing
- **Estimated Cost:** $0.168 per generation
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Description:** Edit videos through natural language instructions while preserving motion structure
- **Required Inputs:**
  - Source video
  - Text prompt (editing instructions)
- **Best For:**
  - Natural language video editing
  - Quick video modifications
  - Style changes while preserving motion
  - AI-powered video transformation
- **Strengths:**
  - Natural language editing
  - Preserves motion structure
  - 1080p output
  - Simple prompt-based interface
- **Limitations:**
  - Higher cost ($0.168)
  - Max 10 seconds
  - Limited duration options (5 or 10s)
- **Parameters:**
  - **Duration:** 5 or 10 seconds (default: 5)

---

### 8. Kling O1 Reference-to-Video
- **Provider:** Kling AI
- **Category:** Video Transformation & Editing
- **Estimated Cost:** $0.112 per generation
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Description:** Transform reference images and elements into consistent video scenes
- **Required Inputs:**
  - Reference images (one or more)
- **Best For:**
  - Multi-image to video
  - Consistent character animation
  - Reference-based video creation
  - Image sequence animation
- **Strengths:**
  - Multiple reference images supported
  - Consistent character rendering
  - Negative prompt support
  - CFG scale control
- **Limitations:**
  - Max 10 seconds
  - Requires quality reference images
- **Parameters:**
  - **Duration:** 5 or 10 seconds (default: 5)
  - **Aspect Ratio:** 16:9, 9:16, 1:1
  - **CFG Scale:** 0.0-1.0 (default: 0.5)
  - **Negative Prompt:** Text (default: "blur, distort, low quality")

---

### 9. Veo 3.1 Extend
- **Provider:** Google Veo
- **Category:** Video Extension
- **Estimated Cost:** $0.40 per second
- **Resolution:** 720p
- **Max Duration:** 7 seconds extension
- **Description:** Extend videos by 7s with premium quality motion continuation
- **Required Inputs:**
  - Source video (to be extended)
- **Best For:**
  - Premium quality extensions
  - Natural motion continuation
  - Professional video extension
  - High-quality output
- **Strengths:**
  - Premium quality motion continuation
  - Natural video extension
  - Audio generation support
  - Auto-fix option
- **Limitations:**
  - Expensive ($0.40/second)
  - Fixed 7-second extension
  - 720p only
- **Parameters:**
  - **Duration:** 7 seconds (fixed)
  - **Resolution:** 720p
  - **Aspect Ratio:** auto, 16:9, 9:16
  - **Generate Audio:** boolean (default: true)
  - **Auto Fix:** boolean (default: false)
- **Cost Example:**
  - 7-second extension: $2.80

---

### 10. Veo 3.1 Fast Extend
- **Provider:** Google Veo
- **Category:** Video Extension
- **Estimated Cost:** $0.15 per second
- **Resolution:** 720p
- **Max Duration:** 7 seconds extension
- **Description:** Extend videos by 7s with motion continuation (faster, budget-friendly)
- **Required Inputs:**
  - Source video (to be extended)
- **Best For:**
  - Budget-friendly extensions
  - Quick video extension
  - Social media content
  - Fast turnaround needed
- **Strengths:**
  - Affordable pricing ($0.15/second)
  - Fast processing
  - Audio generation support
  - Same features as premium version
- **Limitations:**
  - Lower quality than Veo 3.1 Extend
  - Fixed 7-second extension
  - 720p only
- **Parameters:**
  - **Duration:** 7 seconds (fixed)
  - **Resolution:** 720p
  - **Aspect Ratio:** auto, 16:9, 9:16
  - **Generate Audio:** boolean (default: true)
  - **Auto Fix:** boolean (default: false)
- **Cost Example:**
  - 7-second extension: $1.05

---

### 11. WAN Animate/Replace
- **Provider:** WAN Labs
- **Category:** Lip-Sync & Video Replacement
- **Estimated Cost:** $0.075 per generation
- **Resolution:** 480p-720p
- **Max Duration:** 30 seconds
- **Description:** Replace characters in existing videos
- **Required Inputs:**
  - Character image
  - Source video
- **Best For:**
  - Character replacement in videos
  - Face swapping
  - Avatar animation from video
  - Budget-friendly character animation
- **Strengths:**
  - Very affordable ($0.075)
  - Up to 30 seconds
  - Character replacement capability
  - High video quality option
- **Limitations:**
  - Lower resolution (480p-720p)
  - Quality varies by input
- **Parameters:**
  - **Resolution:** 480p or 720p (default: 480p)
  - **Video Quality:** high, medium, low (default: high)

---

### 12. Kling Avatar Pro
- **Provider:** Kling AI
- **Category:** Talking Head / Avatar Generation
- **Estimated Cost:** $0.25 per generation
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Description:** Premium avatar video generation from image + audio
- **Required Inputs:**
  - Character image
  - Audio file
- **Best For:**
  - Legacy Kling Avatar projects
  - 10-second avatar videos
  - Professional quality avatars
- **Strengths:**
  - Premium quality
  - 1080p resolution
  - Simple interface
- **Limitations:**
  - Superseded by Kling Avatar v2
  - Shorter max duration (10s vs 60s)
  - Higher cost per second than v2
- **Parameters:**
  - **Resolution:** 1080p (fixed)
- **Note:** Consider using Kling Avatar v2 Pro for better value and longer duration.

---

### 13. Kling Avatar Standard
- **Provider:** Kling AI
- **Category:** Talking Head / Avatar Generation
- **Estimated Cost:** $0.15 per generation
- **Resolution:** 720p
- **Max Duration:** 10 seconds
- **Description:** Standard avatar video generation from image + audio
- **Required Inputs:**
  - Character image
  - Audio file
- **Best For:**
  - Legacy Kling Avatar projects
  - Budget avatar videos
  - Quick avatar generation
- **Strengths:**
  - Affordable
  - Simple interface
  - Good quality for the price
- **Limitations:**
  - Superseded by Kling Avatar v2
  - Lower resolution (720p)
  - Shorter max duration (10s vs 60s)
- **Parameters:**
  - **Resolution:** 720p (fixed)
- **Note:** Consider using Kling Avatar v2 Standard for better value and longer duration.

---

### 14. Sora 2 Video-to-Video Remix
- **Provider:** OpenAI
- **Category:** Video Transformation & Editing
- **Estimated Cost:** $0.00 (requires existing Sora video)
- **Resolution:** Preserves source resolution
- **Max Duration:** 12 seconds
- **Description:** Transform Sora-generated videos with style changes (requires existing Sora video)
- **Required Inputs:**
  - Video ID (from previously generated Sora video)
- **Best For:**
  - Remixing Sora-generated videos
  - Style variations of existing content
  - Iterating on Sora outputs
- **Strengths:**
  - Free transformation (no additional cost)
  - Preserves source quality
  - Works with existing Sora videos
- **Limitations:**
  - Requires existing Sora video ID
  - Max 12 seconds
  - Limited to Sora-generated content only
- **Parameters:**
  - None (uses video ID reference)

---

## Model Comparison Tables

### Talking Head Models Comparison

| Model | Cost | Resolution | Max Duration | Quality | Best For |
|-------|------|------------|--------------|---------|----------|
| Kling Avatar v2 Pro | $0.115/s | 1080p | 60s | Premium | Professional productions |
| Kling Avatar v2 Standard | $0.0562/s | 1080p | 60s | Good | Cost-effective avatars |
| ByteDance OmniHuman v1.5 | $0.20 | 1080p | 30s | High | Realistic humans |
| Kling Avatar Pro (Legacy) | $0.25 | 1080p | 10s | Premium | Legacy projects |
| Kling Avatar Standard (Legacy) | $0.15 | 720p | 10s | Good | Legacy projects |

### Video Transformation Models Comparison

| Model | Cost | Resolution | Max Duration | Type |
|-------|------|------------|--------------|------|
| WAN v2.6 Ref2V | $0.10-0.15/s | 720p-1080p | 15s | Motion/style transfer |
| Kling O1 Video Reference | $0.112 | 1080p | 10s | Motion preservation |
| Kling O1 Video Edit | $0.168 | 1080p | 10s | Natural language editing |
| Kling O1 Ref2Video | $0.112 | 1080p | 10s | Image-to-video |
| Sora 2 V2V Remix | $0.00 | Source | 12s | Sora remixing |

### Lip-Sync & Character Models Comparison

| Model | Cost | Resolution | Max Duration | Features |
|-------|------|------------|--------------|----------|
| Sync Lipsync React-1 | $0.10 | Source | 15s | Emotion-aware |
| WAN Animate/Replace | $0.075 | 480p-720p | 30s | Character replacement |

### Video Extension Models Comparison

| Model | Cost | Resolution | Extension | Quality |
|-------|------|------------|-----------|---------|
| Veo 3.1 Extend | $0.40/s | 720p | 7s | Premium |
| Veo 3.1 Fast Extend | $0.15/s | 720p | 7s | Good |

---

## Cost Analysis

### Most Affordable Options
1. **WAN Animate/Replace** - $0.075 per generation (character replacement)
2. **Sync Lipsync React-1** - $0.10 per generation (lip-sync with emotion)
3. **Kling Avatar v2 Standard** - $0.0562/second (talking head)
4. **ByteDance OmniHuman v1.5** - $0.20 per generation (realistic avatar)

### Premium Options
1. **Veo 3.1 Extend** - $0.40/second (premium video extension)
2. **Kling Avatar Pro** - $0.25 per generation (legacy, limited to 10s)
3. **Kling O1 Video Edit** - $0.168 per generation (AI editing)

### Best Value for Money
- **Talking Head (60s):** Kling Avatar v2 Standard @ $0.0562/s
- **Quick Avatar (10s):** ByteDance OmniHuman @ $0.20 flat
- **Lip-Sync:** Sync Lipsync React-1 @ $0.10 flat
- **Video Extension:** Veo 3.1 Fast Extend @ $0.15/s

---

## Use Case Guide

### Creating Talking Head Videos
**Recommended Models:**
1. **Professional Quality:** Kling Avatar v2 Pro ($0.115/s, up to 60s)
2. **Budget-Friendly:** Kling Avatar v2 Standard ($0.0562/s, up to 60s)
3. **Realistic Humans:** ByteDance OmniHuman v1.5 ($0.20, up to 30s)

**Workflow:**
1. Upload character portrait image (face clearly visible)
2. Upload audio file (2-60 seconds, max 5MB)
3. Optional: Add prompt for guidance
4. Generate video

### Dubbing & Lip-Sync
**Recommended Model:** Sync Lipsync React-1 ($0.10, up to 15s)

**Workflow:**
1. Upload existing video with face
2. Upload replacement audio
3. Choose emotion (happy, sad, angry, etc.)
4. Select model mode (lips, face, or head)
5. Generate synced video

### Video Transformation
**Recommended Models:**
- **Motion Transfer:** WAN v2.6 Ref2V ($0.10-0.15/s)
- **Natural Language Editing:** Kling O1 Video Edit ($0.168)
- **Reference-Based:** Kling O1 Ref2Video ($0.112)

### Video Extension
**Recommended Models:**
- **Premium Quality:** Veo 3.1 Extend ($0.40/s, 7s extension)
- **Budget-Friendly:** Veo 3.1 Fast Extend ($0.15/s, 7s extension)

**Use When:**
- Video ends too abruptly
- Need smooth motion continuation
- Extending for timing requirements

### Character Replacement
**Recommended Model:** WAN Animate/Replace ($0.075)

**Use When:**
- Need to replace face in video
- Creating avatar from motion reference
- Face swapping applications

---

## Technical Implementation

All models are accessed via the FAL.ai API through the avatar generator module located at:
```
qcut/apps/web/src/lib/ai-video/generators/avatar.ts
```

### Model Configuration
Model configurations are defined in:
```
qcut/apps/web/src/components/editor/media-panel/views/ai/constants/avatar-models-config.ts
```

### Avatar UI Component
The Avatar tab UI is located at:
```
qcut/apps/web/src/components/editor/media-panel/views/ai/tabs/ai-avatar-tab.tsx
```

---

## Model Priority Order

Models are displayed in this order in the UI (by capability and popularity):
1. Kling Avatar v2 Pro
2. Kling Avatar v2 Standard
3. ByteDance OmniHuman v1.5
4. Sync Lipsync React-1
5. WAN v2.6 Ref2V
6. Kling O1 Video Reference
7. Kling O1 Video Edit
8. Kling O1 Reference-to-Video
9. Veo 3.1 Extend
10. Veo 3.1 Fast Extend
11. WAN Animate/Replace
12. Kling Avatar Pro (Legacy)
13. Kling Avatar Standard (Legacy)
14. Sora 2 Video-to-Video Remix

---

## Best Practices

### For Talking Head Videos
1. Use high-quality portrait images with clear face visibility
2. Ensure audio is clear and within duration limits (2-60s)
3. For professional work, use Kling Avatar v2 Pro
4. For budget work, use Kling Avatar v2 Standard
5. Keep audio file under 5MB

### For Lip-Sync
1. Source video should have clear face visibility
2. Audio should match approximate duration of video
3. Choose appropriate emotion for the content
4. Use "face" mode for best results in most cases
5. Temperature of 0.5 provides good balance

### For Video Transformation
1. Provide clear reference videos/images
2. Use descriptive prompts for best results
3. Start with shorter durations to test
4. Consider aspect ratio of final output

### For Video Extension
1. Source video should end with natural motion
2. Use Veo 3.1 Extend for important projects
3. Use Veo 3.1 Fast Extend for quick iterations
4. Enable audio generation if needed
5. Consider aspect ratio consistency

---

## Limitations & Constraints

### File Upload Requirements
- **Kling Avatar v2:** Requires pre-upload to FAL storage (not direct file upload)
- **Audio Files:** Max 5MB for Kling Avatar v2 models
- **Video Duration:** 2-60 seconds for Kling Avatar v2 audio

### Resolution Limitations
- Most models are fixed resolution (cannot customize)
- Video extension models limited to 720p
- Legacy Kling Avatar Standard only supports 720p

### Duration Constraints
- Kling Avatar v2: 2-60 seconds
- Sync Lipsync React-1: Max 15 seconds
- Video Extension: Fixed 7-second extension
- Most other models: 5-15 seconds

### Processing Time
- Talking head generation: 30-120 seconds
- Video transformation: 60-180 seconds
- Lip-sync: 20-60 seconds
- Video extension: 30-90 seconds

---

## Error Handling

Common errors and solutions:

### "Audio duration too short/long"
- **Solution:** Ensure audio is 2-60 seconds for Kling Avatar v2
- **Workaround:** Trim or extend audio to meet requirements

### "File size too large"
- **Solution:** Compress audio to under 5MB
- **Workaround:** Reduce audio bitrate or use MP3 format

### "Pre-uploaded URL required"
- **Solution:** Upload files to FAL storage first
- **Models affected:** Kling Avatar v2, Sync Lipsync React-1

### "Face not detected"
- **Solution:** Ensure clear face visibility in image/video
- **Tip:** Use frontal face photos with good lighting

---

## Future Enhancements

Potential improvements being considered:
- Direct file upload support (eliminate FAL storage requirement)
- Longer duration support for more models
- Higher resolution options (4K)
- Real-time preview capabilities
- Batch processing for multiple avatars
- Custom voice cloning integration
- Multi-language lip-sync support
- Advanced emotion control
- Background replacement options

---

## Related Documentation

- [Avatar Generator Module](../../apps/web/src/lib/ai-video/generators/avatar.ts)
- [Avatar Models Configuration](../../apps/web/src/components/editor/media-panel/views/ai/constants/avatar-models-config.ts)
- [Avatar Tab UI Component](../../apps/web/src/components/editor/media-panel/views/ai/tabs/ai-avatar-tab.tsx)
- [AI Types Definitions](../../apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts)
- [Cost Calculators](../../apps/web/src/components/editor/media-panel/views/ai/utils/ai-cost-calculators.ts)
