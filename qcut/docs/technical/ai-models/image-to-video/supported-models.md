# Image-to-Video - Supported Models

This document lists all the AI models supported for image-to-video generation in QCut.

## Overview

The Image-to-Video panel supports **19 different AI models** from various providers including OpenAI, ByteDance, Google, Minimax, and fal.ai. These models animate static images into dynamic videos.

---

## Supported Models

### 1. Kling v2.6 Pro I2V
- **Provider:** ByteDance
- **Price:** $0.70
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Category:** Image-to-Video
- **Description:** Top-tier image-to-video with cinematic visuals and native audio generation
- **Features:**
  - Cinematic quality motion
  - Native audio generation
  - Professional-grade animation
  - High-quality 1080p output
- **Supported Durations:** 5s, 10s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1
- **Parameters:**
  - Duration: 5s, 10s (default: 5s)
  - Aspect Ratio: 16:9, 9:16, 1:1 (default: 16:9)
  - CFG Scale: 0.5 (default)
  - Generate Audio: true (default)
  - Negative Prompt: "blur, distort, and low quality" (default)

---

### 2. Sora 2 Image-to-Video Pro
- **Provider:** OpenAI
- **Price:** $0.30-0.50
- **Resolution:** 720p / 1080p
- **Max Duration:** 12 seconds
- **Category:** Image-to-Video
- **Description:** High-quality image-to-video with 1080p support
- **Features:**
  - Multiple resolution options
  - Extended duration support
  - Auto aspect ratio detection
  - Advanced motion synthesis
- **Supported Resolutions:** 720p, 1080p
- **Parameters:**
  - Duration: 4s (default)
  - Resolution: auto (default)
  - Aspect Ratio: auto (default)

---

### 3. Veo 3.1 Image-to-Video
- **Provider:** Google
- **Price:** $3.20
- **Resolution:** 720p / 1080p
- **Max Duration:** 8 seconds
- **Category:** Image-to-Video
- **Description:** Google's Veo 3.1 - Premium quality image animation with motion
- **Features:**
  - Premium quality animation
  - Native audio generation
  - High-fidelity motion
  - Professional results
- **Supported Resolutions:** 720p, 1080p
- **Parameters:**
  - Duration: 8s (default)
  - Resolution: 720p (default)
  - Aspect Ratio: 16:9 (default)
  - Generate Audio: true (default)

---

### 4. WAN v2.6 I2V
- **Provider:** fal.ai
- **Price:** $0.10-0.15/s
- **Resolution:** 720p / 1080p
- **Max Duration:** 15 seconds
- **Category:** Image-to-Video
- **Description:** Animate images with WAN 2.6 - 15s duration, audio sync, multi-shot support
- **Features:**
  - 15-second maximum duration (longest)
  - Audio synchronization support
  - Multi-shot mode
  - Prompt expansion
  - Per-second pricing
- **Supported Resolutions:** 720p, 1080p
- **Supported Durations:** 5s, 10s, 15s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1, 4:3, 3:4
- **Per-Second Pricing:**
  - 720p: $0.10/s
  - 1080p: $0.15/s
- **Parameters:**
  - Duration: 5s, 10s, 15s (default: 5s)
  - Resolution: 720p, 1080p (default: 1080p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - Enable Prompt Expansion: true (default)

---

### 5. LTX Video 2.0 Fast I2V
- **Provider:** Lightricks
- **Price:** $0.04-0.16
- **Resolution:** 1080p / 1440p / 2160p (4K)
- **Max Duration:** 20 seconds
- **Category:** Image-to-Video
- **Description:** Image-to-video with audio generation (6-20s, up to 4K)
- **Features:**
  - Up to 4K resolution (2160p)
  - 20-second maximum duration
  - Audio generation
  - Variable FPS support
  - Cost-effective pricing
- **Supported Resolutions:** 1080p, 1440p, 2160p
- **Supported Durations:** 6s, 8s, 10s, 12s, 14s, 16s, 18s, 20s
- **Parameters:**
  - Duration: 6-20s (default: 6s)
  - Resolution: 1080p, 1440p, 2160p (default: 1080p)
  - Aspect Ratio: 16:9 only
  - FPS: 25 (default)
  - Generate Audio: true (default)

---

### 6. LTX Video 2.0 I2V
- **Provider:** Lightricks
- **Price:** $0.36
- **Resolution:** 1080p / 1440p / 2160p (4K)
- **Max Duration:** 10 seconds
- **Category:** Image-to-Video
- **Description:** Image-to-video with audio generation (6-10s, up to 4K)
- **Features:**
  - Up to 4K resolution
  - Audio generation
  - Professional quality
  - Variable FPS support
- **Supported Resolutions:** 1080p, 1440p, 2160p
- **Supported Durations:** 6s, 8s, 10s
- **Parameters:**
  - Duration: 6-10s (default: 6s)
  - Resolution: 1080p, 1440p, 2160p (default: 1080p)
  - Aspect Ratio: 16:9 only
  - FPS: 25 (default)
  - Generate Audio: true (default)

---

### 7. Hailuo 2.3 Pro
- **Provider:** Minimax
- **Price:** $0.49
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Category:** Image-to-Video
- **Description:** Premium 1080p image-to-video with highest fidelity
- **Features:**
  - Premium quality 1080p
  - Prompt optimizer
  - High fidelity animation
- **Parameters:**
  - Duration: 6s (default)
  - Resolution: 1080p (default)
  - Prompt Optimizer: true (default)

---

### 8. Seedance v1 Pro I2V
- **Provider:** ByteDance
- **Price:** $0.62
- **Resolution:** 480p / 720p / 1080p
- **Max Duration:** 12 seconds
- **Category:** Image-to-Video
- **Description:** Premium quality image-to-video with highest fidelity (2-12s)
- **Features:**
  - Premium quality animation
  - Wide aspect ratio support
  - Camera control options
  - End-frame support
- **Supported Resolutions:** 480p, 720p, 1080p
- **Supported Durations:** 2s-12s (all increments)
- **Supported Aspect Ratios:** 21:9, 16:9, 4:3, 1:1, 3:4, 9:16, auto
- **Parameters:**
  - Duration: 2-12s (default: 5s)
  - Resolution: 480p, 720p, 1080p (default: 1080p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - Camera Fixed: false (default)
  - Enable Safety Checker: false (default)
  - Seed: supported
  - End Image URL: supported (for Pro only)

---

### 9. Veo 3.1 Fast Image-to-Video
- **Provider:** Google
- **Price:** $1.20
- **Resolution:** 720p / 1080p
- **Max Duration:** 8 seconds
- **Category:** Image-to-Video
- **Description:** Google's Veo 3.1 Fast - Animate static images with motion (faster, budget-friendly)
- **Features:**
  - Faster generation
  - Budget-friendly
  - Audio generation
  - Quality animation
- **Supported Resolutions:** 720p, 1080p
- **Parameters:**
  - Duration: 8s (default)
  - Resolution: 720p (default)
  - Aspect Ratio: 16:9 (default)
  - Generate Audio: true (default)

---

### 10. Kling v2.5 Turbo Pro I2V
- **Provider:** ByteDance
- **Price:** $0.35
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Category:** Image-to-Video
- **Description:** Top-tier Kling model with cinematic motion and multi-ratio output
- **Features:**
  - Cinematic motion quality
  - Multi-aspect ratio support
  - Prompt enhancement
  - Negative prompts
- **Supported Resolutions:** 1080p
- **Supported Durations:** 5s, 10s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1, 4:3, 3:4
- **Parameters:**
  - Duration: 5s, 10s (default: 5s)
  - Resolution: 1080p (default)
  - Aspect Ratio: Multiple options (default: 16:9)
  - CFG Scale: 0.5 (default)
  - Enhance Prompt: true (default)
  - Negative Prompt: "blur, distort, low quality" (default)

---

### 11. Seedance v1 Pro Fast I2V
- **Provider:** ByteDance
- **Price:** $0.24
- **Resolution:** 480p / 720p / 1080p
- **Max Duration:** 12 seconds
- **Category:** Image-to-Video
- **Description:** Fast image-to-video generation with balanced quality and speed (2-12s)
- **Features:**
  - Fast generation
  - Balanced quality/speed
  - Wide aspect ratio support
  - Camera control
- **Supported Resolutions:** 480p, 720p, 1080p
- **Supported Durations:** 2s-12s (all increments)
- **Supported Aspect Ratios:** 21:9, 16:9, 4:3, 1:1, 3:4, 9:16, auto
- **Parameters:**
  - Duration: 2-12s (default: 5s)
  - Resolution: 480p, 720p, 1080p (default: 1080p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - Camera Fixed: false (default)
  - Enable Safety Checker: false (default)
  - Seed: supported

---

### 12. Hailuo 2.3 Fast Pro
- **Provider:** Minimax
- **Price:** $0.33
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Category:** Image-to-Video
- **Description:** Balanced 1080p image-to-video with faster generation
- **Features:**
  - Faster generation
  - Good quality 1080p
  - Prompt optimizer
- **Parameters:**
  - Duration: 6s (default)
  - Resolution: 1080p (default)
  - Prompt Optimizer: true (default)

---

### 13. Sora 2 Image-to-Video
- **Provider:** OpenAI
- **Price:** $0.10/s
- **Resolution:** 720p
- **Max Duration:** 12 seconds
- **Category:** Image-to-Video
- **Description:** Convert images to dynamic videos with Sora 2 (720p)
- **Features:**
  - State-of-the-art quality
  - Auto settings
  - Extended duration
- **Parameters:**
  - Duration: 4s (default)
  - Resolution: auto (default)
  - Aspect Ratio: auto (default)

---

### 14. Hailuo 2.3 Standard
- **Provider:** Minimax
- **Price:** $0.28-0.56
- **Resolution:** 768p
- **Max Duration:** 10 seconds
- **Category:** Image-to-Video
- **Description:** Budget-friendly image-to-video with 768p quality
- **Features:**
  - Budget-friendly
  - Good quality for cost
  - Prompt optimizer
- **Parameters:**
  - Duration: 6s (default)
  - Resolution: 768p (default)
  - Prompt Optimizer: true (default)

---

### 15. WAN v2.5 Preview I2V
- **Provider:** fal.ai
- **Price:** $0.05-0.15/s
- **Resolution:** 480p / 720p / 1080p
- **Max Duration:** 10 seconds
- **Category:** Image-to-Video
- **Description:** Animate images with WAN 2.5 Preview, optional music + prompt expansion
- **Features:**
  - Prompt expansion
  - Multiple resolutions
  - Per-second pricing
- **Supported Resolutions:** 480p, 720p, 1080p
- **Supported Durations:** 5s, 10s
- **Per-Second Pricing:**
  - 480p: $0.05/s
  - 720p: $0.10/s
  - 1080p: $0.15/s
- **Parameters:**
  - Duration: 5s, 10s (default: 5s)
  - Resolution: 480p, 720p, 1080p (default: 1080p)
  - Enable Prompt Expansion: true (default)

---

### 16. Vidu Q2 Turbo I2V
- **Provider:** Vidu
- **Price:** $0.05
- **Resolution:** 720p
- **Max Duration:** 8 seconds
- **Category:** Image-to-Video
- **Description:** High-quality image-to-video with motion control (2-8s)
- **Features:**
  - Motion amplitude control
  - Cost-effective
  - Good quality for price
- **Parameters:**
  - Duration: 2-8s (default: 4s)
  - Resolution: 720p (default)
  - Movement Amplitude: auto (default)

---

### 17. Veo 3.1 Frame-to-Video
- **Provider:** Google
- **Price:** $3.20
- **Resolution:** 720p / 1080p
- **Max Duration:** 8 seconds
- **Category:** Image-to-Video
- **Required Inputs:** First Frame + Last Frame
- **Description:** Google's Veo 3.1 - Premium quality animation between first and last frames
- **Features:**
  - First + last frame interpolation
  - Premium quality
  - Smooth motion between frames
  - Audio generation
- **Supported Resolutions:** 720p, 1080p
- **Parameters:**
  - Duration: 8s (default)
  - Resolution: 720p (default)
  - Aspect Ratio: 16:9 (default)
  - Generate Audio: true (default)

---

### 18. Veo 3.1 Fast Frame-to-Video
- **Provider:** Google
- **Price:** $1.20
- **Resolution:** 720p / 1080p
- **Max Duration:** 8 seconds
- **Category:** Image-to-Video
- **Required Inputs:** First Frame + Last Frame
- **Description:** Google's Veo 3.1 Fast - Animate between first and last frames (faster, budget-friendly)
- **Features:**
  - First + last frame interpolation
  - Faster generation
  - Budget-friendly
  - Audio generation
- **Supported Resolutions:** 720p, 1080p
- **Parameters:**
  - Duration: 8s (default)
  - Resolution: 720p (default)
  - Aspect Ratio: auto (default)
  - Generate Audio: true (default)

---

### 19. Kling O1 Image-to-Video
- **Provider:** ByteDance
- **Price:** $0.112
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Category:** Image-to-Video
- **Required Inputs:** First Frame (End Frame optional)
- **Description:** Animate transitions between start and end frames with cinematic motion
- **Features:**
  - Start/end frame support
  - Cinematic motion
  - Cost-effective
- **Supported Durations:** 5s, 10s
- **Parameters:**
  - Duration: 5s, 10s (default: 5s)

---

## Comparison Tables

### By Maximum Duration
| Model | Max Duration |
|-------|-------------|
| LTX Video 2.0 Fast I2V | 20s |
| WAN v2.6 I2V | 15s |
| Sora 2 Image-to-Video (both) | 12s |
| Seedance v1 Pro (both) | 12s |
| Most Others | 10s |
| Veo 3.1 (all variants), Vidu Q2 | 8s |

### By Resolution
| Resolution | Models |
|-----------|---------|
| **4K (2160p)** | LTX Video 2.0 Fast I2V, LTX Video 2.0 I2V |
| **1440p** | LTX Video 2.0 Fast I2V, LTX Video 2.0 I2V |
| **1080p** | Most models support |
| **720p** | All models support |
| **480p** | Seedance v1 Pro (both), WAN v2.5 Preview I2V |

### By Price (Low to High)
1. LTX Video 2.0 Fast I2V - $0.04-0.16
2. Vidu Q2 Turbo I2V - $0.05
3. WAN v2.5 Preview I2V - $0.05-0.15/s
4. Sora 2 Image-to-Video - $0.10/s
5. WAN v2.6 I2V - $0.10-0.15/s
6. Kling O1 I2V - $0.112
7. Seedance v1 Pro Fast I2V - $0.24
8. Hailuo 2.3 Standard - $0.28-0.56
9. Sora 2 Image-to-Video Pro - $0.30-0.50
10. Hailuo 2.3 Fast Pro - $0.33
11. Kling v2.5 Turbo Pro I2V - $0.35
12. LTX Video 2.0 I2V - $0.36
13. Hailuo 2.3 Pro - $0.49
14. Seedance v1 Pro I2V - $0.62
15. Kling v2.6 Pro I2V - $0.70
16. Veo 3.1 Fast (both) - $1.20
17. Veo 3.1 (both) - $3.20

### By Provider
- **Google (Veo 3.1):** 4 models (I2V, Frame-to-Video, each with Fast variant)
- **OpenAI (Sora 2):** 2 models (Standard, Pro)
- **ByteDance:** 6 models (Kling, Seedance)
- **Minimax (Hailuo 2.3):** 3 models (Standard, Fast Pro, Pro)
- **Lightricks (LTX Video 2.0):** 2 models (Standard, Fast)
- **fal.ai (WAN):** 2 models (v2.5, v2.6)
- **Vidu:** 1 model (Q2 Turbo)

---

## Special Model Types

### Frame-to-Frame Interpolation
These models require both a first and last frame to create smooth animation between them:
- Veo 3.1 Frame-to-Video
- Veo 3.1 Fast Frame-to-Video

### Start/End Frame Support
These models support optional end frames:
- Kling O1 I2V
- Seedance v1 Pro I2V (end_image_url parameter)

---

## Feature Comparison

### Audio Generation Support
- Kling v2.6 Pro I2V
- Kling v2.6 Pro T2V
- Veo 3.1 (all variants)
- LTX Video 2.0 (both variants)
- WAN v2.6 I2V

### Prompt Expansion
- WAN v2.6 I2V
- WAN v2.5 Preview I2V
- Kling v2.5 Turbo Pro I2V

### Negative Prompt Support
- Kling v2.6 Pro I2V
- Kling v2.5 Turbo Pro I2V

### Camera Control
- Seedance v1 Pro I2V (camera_fixed parameter)
- Seedance v1 Pro Fast I2V (camera_fixed parameter)

### Motion Control
- Vidu Q2 Turbo I2V (movement_amplitude parameter)

---

## Technical Implementation

All models are accessed via the FAL.ai API through the image-to-video generator module located at:
```
qcut/apps/web/src/lib/ai-video/generators/image-to-video.ts
```

Model configurations are defined in:
```
qcut/apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts
```

---

## Model Selection Priority Order

Models are displayed in the UI in this order (premium to cost-effective):
1. Kling v2.6 Pro I2V
2. Sora 2 Image-to-Video Pro
3. Veo 3.1 Image-to-Video
4. WAN v2.6 I2V
5. LTX Video 2.0 Fast I2V
6. LTX Video 2.0 I2V
7. Hailuo 2.3 Pro
8. Seedance v1 Pro I2V
9. Veo 3.1 Fast Image-to-Video
10. Kling v2.5 Turbo Pro I2V
11. Seedance v1 Pro Fast I2V
12. Hailuo 2.3 Fast Pro
13. Sora 2 Image-to-Video
14. Hailuo 2.3 Standard
15. WAN v2.5 Preview I2V
16. Vidu Q2 Turbo I2V
17. Veo 3.1 Frame-to-Video
18. Veo 3.1 Fast Frame-to-Video
19. Kling O1 I2V

---

## Related Documentation

- [Image-to-Video Generator](../../../../apps/web/src/lib/ai-video/generators/image-to-video.ts)
- [Image-to-Video Model Config](../../../../apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts)
- [AI Video Workflow](../../ai-video-workflow.md)
