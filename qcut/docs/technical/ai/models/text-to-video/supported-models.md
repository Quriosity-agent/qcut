# Text-to-Video - Supported Models

This document lists all the AI models supported for text-to-video generation in QCut.

## Overview

The Text-to-Video panel supports **15 different AI models** from various providers including OpenAI, ByteDance, Google, Alibaba, and Black Forest Labs.

---

## Supported Models

### 1. Kling v2.6 Pro T2V
- **Provider:** ByteDance
- **Price:** $0.70
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Description:** Top-tier text-to-video with cinematic visuals and native audio generation
- **Features:**
  - Cinematic quality visuals
  - Native audio generation
  - High-quality motion synthesis
  - Professional-grade output
- **Supported Durations:** 5s, 10s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1
- **Parameters:**
  - Duration: 5s, 10s (default: 5s)
  - Aspect Ratio: 16:9, 9:16, 1:1 (default: 16:9)
  - CFG Scale: 0.5 (default)
  - Generate Audio: true (default)
  - Negative Prompt: "blur, distort, and low quality" (default)

---

### 2. Sora 2 Text-to-Video Pro
- **Provider:** OpenAI
- **Price:** $0.30-0.50
- **Resolution:** 720p / 1080p
- **Max Duration:** 12 seconds
- **Description:** High-quality text-to-video with 1080p support
- **Features:**
  - Multiple resolution options
  - Extended duration support
  - Wide aspect ratio support
  - Advanced prompt adherence
- **Supported Resolutions:** 720p, 1080p
- **Supported Durations:** 2s, 3s, 4s, 5s, 6s, 8s, 10s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1, 4:3, 3:4, 21:9
- **Parameters:**
  - Duration: 2-10s (default: 5s)
  - Resolution: 720p, 1080p (default: 1080p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - Negative Prompt: supported
  - Prompt Expansion: supported
  - Seed: supported
  - Safety Checker: supported

---

### 3. Veo 3.1 Text-to-Video
- **Provider:** Google
- **Price:** $3.20
- **Resolution:** 720p / 1080p
- **Max Duration:** 8 seconds
- **Description:** Google's Veo 3.1 - Premium quality video generation from text prompts
- **Features:**
  - Premium quality output
  - Native audio generation
  - Prompt enhancement
  - Auto-fix capabilities
- **Supported Resolutions:** 720p, 1080p
- **Supported Durations:** 5s, 6s, 8s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1
- **Parameters:**
  - Duration: 5-8s (default: 8s)
  - Resolution: 720p, 1080p (default: 720p)
  - Aspect Ratio: 16:9, 9:16, 1:1 (default: 16:9)
  - Generate Audio: true (default)
  - Enhance Prompt: true (default)
  - Auto Fix: true (default)

---

### 4. WAN v2.6 T2V
- **Provider:** fal.ai
- **Price:** $0.75 (per-second pricing: $0.10-0.15/s)
- **Resolution:** 720p / 1080p
- **Max Duration:** 15 seconds
- **Description:** Latest WAN model with 15s duration, multi-shot support, and audio sync
- **Features:**
  - 15-second maximum duration (longest)
  - Multi-shot support
  - Audio synchronization
  - Prompt expansion
  - Per-second pricing based on resolution
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
  - Multi Shots: false (default)
  - Negative Prompt: supported
  - Seed: supported
  - Safety Checker: supported

---

### 5. LTX Video 2.0 Fast T2V
- **Provider:** Lightricks
- **Price:** $0.04-0.16
- **Resolution:** 1080p / 1440p / 2160p (4K)
- **Max Duration:** 20 seconds
- **Description:** Text-to-video with audio generation (6-20s, up to 4K)
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
  - Seed: supported

---

### 6. LTX Video 2.0 Pro T2V
- **Provider:** Lightricks
- **Price:** $0.06
- **Resolution:** 1080p / 1440p / 2160p (4K)
- **Max Duration:** 10 seconds
- **Description:** Text-to-video with audio generation (6-10s, up to 4K)
- **Features:**
  - Up to 4K resolution
  - Audio generation
  - Professional quality
  - Variable FPS support
- **Supported Resolutions:** 1080p, 1440p, 2160p
- **Supported Durations:** 2s, 3s, 4s, 5s, 6s, 8s, 10s
- **Parameters:**
  - Duration: 2-10s (default: 6s)
  - Resolution: 1080p, 1440p, 2160p (default: 1080p)
  - Aspect Ratio: 16:9 only
  - FPS: 25 (default)
  - Generate Audio: true (default)
  - Negative Prompt: supported
  - Seed: supported

---

### 7. Hailuo 2.3 Pro T2V
- **Provider:** Minimax
- **Price:** $0.49
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Description:** Premium 1080p text-to-video with cinematic camera control (use [Pan left], [Zoom in] in prompts)
- **Features:**
  - Cinematic camera control
  - Prompt optimizer
  - Professional quality 1080p
  - Special camera commands in prompts
- **Supported Resolutions:** 720p, 1080p
- **Supported Durations:** 2s, 3s, 4s, 5s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1, 4:3, 3:4
- **Parameters:**
  - Duration: 2-5s (default: 6s)
  - Resolution: 720p, 1080p (default: 1080p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - Prompt Optimizer: true (default)
  - Seed: supported

---

### 8. Veo 3.1 Fast Text-to-Video
- **Provider:** Google
- **Price:** $1.20
- **Resolution:** 720p / 1080p
- **Max Duration:** 8 seconds
- **Description:** Google's Veo 3.1 Fast - Generate videos from text prompts (faster, budget-friendly)
- **Features:**
  - Faster generation
  - Budget-friendly
  - Audio generation
  - Prompt enhancement
- **Supported Resolutions:** 720p, 1080p
- **Supported Durations:** 5s, 6s, 8s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1
- **Parameters:**
  - Duration: 5-8s (default: 8s)
  - Resolution: 720p, 1080p (default: 720p)
  - Aspect Ratio: 16:9, 9:16, 1:1 (default: 16:9)
  - Generate Audio: true (default)
  - Enhance Prompt: true (default)
  - Auto Fix: true (default)

---

### 9. Seedance v1 Pro
- **Provider:** ByteDance
- **Price:** $0.62
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Description:** High quality 1080p video generation
- **Features:**
  - High-quality 1080p output
  - Wide aspect ratio support
  - Extended duration range
- **Supported Resolutions:** 480p, 720p, 1080p
- **Supported Durations:** 2s-12s (all increments)
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1, 4:3, 3:4, 21:9
- **Parameters:**
  - Duration: 2-12s (default: 5s)
  - Resolution: 480p, 720p, 1080p (default: 1080p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - Seed: supported

---

### 10. Sora 2 Text-to-Video
- **Provider:** OpenAI
- **Price:** $0.10/s
- **Resolution:** 720p
- **Max Duration:** 12 seconds
- **Description:** OpenAI's state-of-the-art text-to-video generation (720p)
- **Features:**
  - State-of-the-art quality
  - Extended duration support
  - Multiple aspect ratios
  - Advanced controls
- **Supported Resolutions:** 720p, 1080p
- **Supported Durations:** 4s, 8s, 12s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1, 4:3, 3:4
- **Parameters:**
  - Duration: 4s, 8s, 12s (default: 4s)
  - Resolution: 720p, 1080p (default: 720p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - Negative Prompt: supported
  - Prompt Expansion: supported
  - Seed: supported
  - Safety Checker: supported

---

### 11. Hailuo 2.3 Standard T2V
- **Provider:** Minimax
- **Price:** $0.28-0.56
- **Resolution:** 768p
- **Max Duration:** 10 seconds
- **Description:** Budget-friendly text-to-video with 768p quality
- **Features:**
  - Budget-friendly pricing
  - Good quality for cost
  - Prompt optimizer
- **Supported Resolutions:** 720p, 1080p
- **Supported Durations:** 2s, 3s, 4s, 5s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1, 4:3, 3:4
- **Parameters:**
  - Duration: 2-5s (default: 5s)
  - Resolution: 720p, 1080p (default: 720p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - Prompt Optimizer: true (default)
  - Seed: supported

---

### 12. Kling v2.5 Turbo Pro
- **Provider:** ByteDance
- **Price:** $0.18
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Description:** Latest Kling model with enhanced turbo performance
- **Features:**
  - Enhanced turbo performance
  - Prompt enhancement
  - High-quality 1080p
- **Supported Resolutions:** 720p, 1080p
- **Supported Durations:** 5s, 10s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1, 4:3, 3:4
- **Parameters:**
  - Duration: 5s, 10s (default: 5s)
  - Resolution: 720p, 1080p (default: 1080p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - CFG Scale: 0.5 (default)
  - Enhance Prompt: true (default)
  - Negative Prompt: supported
  - Seed: supported

---

### 13. Kling v2.5 Turbo Standard
- **Provider:** ByteDance
- **Price:** $0.10
- **Resolution:** 720p
- **Max Duration:** 10 seconds
- **Description:** Standard Kling model for efficient text-to-video
- **Features:**
  - Cost-effective
  - Good quality for price
  - Standard performance
- **Supported Resolutions:** 720p, 1080p
- **Supported Durations:** 5s, 10s
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1, 4:3, 3:4
- **Parameters:**
  - Duration: 5s, 10s (default: 5s)
  - Resolution: 720p, 1080p (default: 720p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - Seed: supported

---

### 14. Seedance v1 Lite
- **Provider:** ByteDance
- **Price:** $0.18
- **Resolution:** 720p
- **Max Duration:** 10 seconds
- **Description:** Fast and efficient text-to-video generation
- **Features:**
  - Fast generation
  - Efficient processing
  - Budget-friendly
  - Wide aspect ratio support
- **Supported Resolutions:** 480p, 720p, 1080p
- **Supported Durations:** 2s-12s (all increments)
- **Supported Aspect Ratios:** 16:9, 9:16, 1:1, 4:3, 3:4, 21:9
- **Parameters:**
  - Duration: 2-12s (default: 5s)
  - Resolution: 480p, 720p, 1080p (default: 720p)
  - Aspect Ratio: Multiple options (default: 16:9)
  - Seed: supported

---

### 15. WAN v2.5 Preview
- **Provider:** fal.ai
- **Price:** $0.12
- **Resolution:** 1080p
- **Max Duration:** 10 seconds
- **Description:** Next-generation WAN model with improved quality
- **Features:**
  - Improved quality over v2.0
  - High quality preset
  - Cinematic style
- **Supported Resolutions:** 480p, 720p, 1080p
- **Supported Durations:** 5s, 10s
- **Parameters:**
  - Duration: 5s, 10s (default: 5s)
  - Resolution: 480p, 720p, 1080p (default: 1080p)
  - Quality: high (default)
  - Style Preset: cinematic (default)
  - Seed: supported
  - Safety Checker: supported

---

## Comparison Tables

### By Maximum Duration
| Model | Max Duration |
|-------|-------------|
| LTX Video 2.0 Fast T2V | 20s |
| WAN v2.6 T2V | 15s |
| Sora 2 (both versions) | 12s |
| Most Others | 10s |
| Veo 3.1 (both versions) | 8s |

### By Resolution
| Resolution | Models |
|-----------|---------|
| **4K (2160p)** | LTX Video 2.0 Fast T2V, LTX Video 2.0 Pro T2V |
| **1440p** | LTX Video 2.0 Fast T2V, LTX Video 2.0 Pro T2V |
| **1080p** | Most models support |
| **720p** | All models support |
| **480p** | Seedance v1 Lite, Seedance v1 Pro, WAN v2.5 Preview |

### By Price (Low to High)
1. LTX Video 2.0 Fast T2V - $0.04-0.16
2. LTX Video 2.0 Pro T2V - $0.06
3. Kling v2.5 Turbo Standard - $0.10
4. Sora 2 Text-to-Video - $0.10/s
5. WAN v2.5 Preview - $0.12
6. Kling v2.5 Turbo Pro - $0.18
7. Seedance v1 Lite - $0.18
8. Hailuo 2.3 Standard T2V - $0.28-0.56
9. Sora 2 Text-to-Video Pro - $0.30-0.50
10. Hailuo 2.3 Pro T2V - $0.49
11. Seedance v1 Pro - $0.62
12. Kling v2.6 Pro T2V - $0.70
13. WAN v2.6 T2V - $0.75
14. Veo 3.1 Fast - $1.20
15. Veo 3.1 - $3.20

### By Provider
- **Google (Veo):** 2 models (Fast, Pro)
- **OpenAI (Sora 2):** 2 models (Standard, Pro)
- **ByteDance:** 5 models (Kling v2.5/v2.6, Seedance)
- **Minimax (Hailuo 2.3):** 2 models (Standard, Pro)
- **Lightricks (LTX Video 2.0):** 2 models (Fast, Pro)
- **fal.ai (WAN):** 2 models (v2.5, v2.6)

---

## Feature Comparison

### Audio Generation Support
- Kling v2.6 Pro T2V
- Veo 3.1 (both versions)
- LTX Video 2.0 (both versions)

### Negative Prompt Support
- Sora 2 (both versions)
- Kling v2.6 Pro T2V
- Kling v2.5 Turbo Pro
- LTX Video 2.0 Pro T2V
- Veo 3.1 (both versions)
- WAN v2.6 T2V
- Hailuo 2.3 Pro T2V

### Prompt Expansion
- Sora 2 (both versions)
- WAN v2.6 T2V
- Veo 3.1 (both versions)

### Seed Control
- Most models support seed for reproducibility

---

## Technical Implementation

All models are accessed via the FAL.ai API through the text-to-video generator module located at:
```
qcut/apps/web/src/lib/ai-video/generators/text-to-video.ts
```

Model configurations are defined in:
```
qcut/apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts
```

---

## Model Selection Priority Order

Models are displayed in the UI in this order (premium to cost-effective):
1. Kling v2.6 Pro T2V
2. Sora 2 Text-to-Video Pro
3. Veo 3.1 Text-to-Video
4. WAN v2.6 T2V
5. LTX Video 2.0 Fast T2V
6. LTX Video 2.0 Pro T2V
7. Hailuo 2.3 Pro T2V
8. Veo 3.1 Fast Text-to-Video
9. Seedance v1 Pro
10. Sora 2 Text-to-Video
11. Hailuo 2.3 Standard T2V
12. Kling v2.5 Turbo Pro
13. Kling v2.5 Turbo Standard
14. Seedance v1 Lite
15. WAN v2.5 Preview

---

## Related Documentation

- [Text-to-Video Generator](../../../../apps/web/src/lib/ai-video/generators/text-to-video.ts)
- [Text-to-Video Model Config](../../../../apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts)
- [AI Video Workflow](../../ai-video-workflow.md)
