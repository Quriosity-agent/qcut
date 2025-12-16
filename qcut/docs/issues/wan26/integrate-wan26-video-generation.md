# WAN v2.6 Video Generation Integration

## Overview

This document outlines the integration plan for WAN v2.6 video generation models into QCut's AI panel.

**Models to integrate:**
- Text-to-Video: `fal-ai/wan/v2.6/text-to-video`
- Image-to-Video: `fal-ai/wan/v2.6/image-to-video`

---

## Text-to-Video Panel

### Endpoint
- **Model ID:** `fal-ai/wan/v2.6/text-to-video`
- **Base URL:** `https://fal.run/wan/v2.6/text-to-video`

### Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Text prompt for video generation. Supports Chinese and English, max 800 characters |
| `audio_url` | string | No | null | Background music URL (WAV/MP3, 3-30s, max 15MB) |
| `aspect_ratio` | enum | No | "16:9" | Options: 16:9, 9:16, 1:1, 4:3, 3:4 |
| `resolution` | enum | No | "1080p" | Options: 720p, 1080p |
| `duration` | enum | No | "5" | Options: 5, 10, 15 seconds |
| `negative_prompt` | string | No | "" | Content to avoid (max 500 chars) |
| `enable_prompt_expansion` | boolean | No | true | LLM-based prompt rewriting |
| `multi_shots` | boolean | No | true | Intelligent scene segmentation |
| `seed` | integer | No | null | Random seed for reproducibility |
| `enable_safety_checker` | boolean | No | true | Content safety filtering |

### Output Format
```json
{
  "video": {
    "url": "string",
    "content_type": "video/mp4",
    "width": "integer",
    "height": "integer",
    "fps": "float",
    "duration": "float",
    "num_frames": "integer"
  },
  "seed": "integer",
  "actual_prompt": "string (if expansion enabled)"
}
```

### Pricing (Text-to-Video)
- **720p:** $0.10 per second
- **1080p:** $0.15 per second

| Duration | 720p Cost | 1080p Cost |
|----------|-----------|------------|
| 5 sec    | $0.50     | $0.75      |
| 10 sec   | $1.00     | $1.50      |
| 15 sec   | $1.50     | $2.25      |

### Code Example
```typescript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/wan/v2.6/text-to-video", {
  input: {
    prompt: "A serene mountain landscape with flowing clouds",
    resolution: "1080p",
    duration: "5",
    aspect_ratio: "16:9",
    enable_prompt_expansion: true,
    multi_shots: true
  },
  logs: true,
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      console.log("Progress:", update.logs);
    }
  }
});

console.log(result.data.video.url);
```

---

## Image-to-Video Panel

### Endpoint
- **Model ID:** `fal-ai/wan/v2.6/image-to-video`
- **Base URL:** `https://fal.run/wan/v2.6/image-to-video`

### Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Text prompt describing desired video motion. Max 800 characters |
| `image_url` | string | Yes | — | URL of the image as first frame. Must be publicly accessible or base64 data URI |
| `resolution` | enum | No | "1080p" | Options: 480p, 720p, 1080p |
| `duration` | enum | No | "5" | Options: 5, 10, 15 seconds |
| `audio_url` | string | No | null | Background music URL (WAV/MP3, 3-30s, max 15MB) |
| `negative_prompt` | string | No | "" | Content to avoid. Max 500 characters |
| `enable_prompt_expansion` | boolean | No | true | Enable LLM-based prompt rewriting |
| `multi_shots` | boolean | No | false | Enable intelligent multi-shot segmentation |
| `seed` | integer | No | null | Random seed for reproducibility |
| `enable_safety_checker` | boolean | No | true | Enable content safety validation |

### Image Requirements
- **Formats:** JPEG, JPG, PNG (no alpha), BMP, WEBP
- **Resolution:** 360–2000 pixels (width/height)
- **Max size:** 25MB

### Output Format
```json
{
  "video": {
    "url": "string",
    "content_type": "video/mp4",
    "file_name": "string",
    "file_size": "integer (bytes)",
    "width": "integer",
    "height": "integer",
    "fps": "float",
    "duration": "float",
    "num_frames": "integer"
  },
  "seed": "integer",
  "actual_prompt": "string (if expansion enabled)"
}
```

### Pricing (Image-to-Video)
- **720p:** $0.10 per second
- **1080p:** $0.15 per second

| Duration | 720p Cost | 1080p Cost |
|----------|-----------|------------|
| 5 sec    | $0.50     | $0.75      |
| 10 sec   | $1.00     | $1.50      |
| 15 sec   | $1.50     | $2.25      |

### Code Example
```typescript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/wan/v2.6/image-to-video", {
  input: {
    prompt: "The woman slowly turns her head and smiles",
    image_url: "https://example.com/image.png",
    resolution: "1080p",
    duration: "5",
    enable_prompt_expansion: true,
    multi_shots: false
  },
  logs: true,
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      console.log("Progress:", update.logs);
    }
  }
});

console.log(result.data.video.url);
```

---

## Key Features

### Common Features (Both Models)
- **Multi-language support:** Chinese and English prompts
- **LLM prompt expansion:** Automatic prompt enhancement for better results
- **Multi-shot segmentation:** Intelligent scene transitions
- **Background audio:** Support for WAV/MP3 audio integration
- **Safety filtering:** Content moderation built-in
- **Seed control:** Reproducible generations

### Text-to-Video Specific
- Aspect ratio options: 16:9, 9:16, 1:1, 4:3, 3:4
- Resolution: 720p, 1080p only (no 480p)
- Multi-shots enabled by default

### Image-to-Video Specific
- Resolution: 480p, 720p, 1080p (480p available)
- Multi-shots disabled by default
- Image first-frame control

---

## QCut Integration Points

### ai-constants.ts
Add model definitions:
```typescript
// Text-to-Video
{
  id: "fal-ai/wan/v2.6/text-to-video",
  name: "WAN 2.6",
  description: "High-quality text-to-video with multi-shot support",
  category: "text-to-video",
  price: 0.75, // 5 sec @ 1080p
  features: ["multi-shot", "prompt-expansion", "audio"]
}

// Image-to-Video
{
  id: "fal-ai/wan/v2.6/image-to-video",
  name: "WAN 2.6 I2V",
  description: "Image-to-video with motion control",
  category: "image-to-video",
  price: 0.75, // 5 sec @ 1080p
  features: ["image-input", "prompt-expansion", "audio"]
}
```

### text2video-models-config.ts
Add capability definitions:
```typescript
"fal-ai/wan/v2.6/text-to-video": {
  aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  resolutions: ["720p", "1080p"],
  durations: [5, 10, 15],
  maxPromptLength: 800,
  supportsNegativePrompt: true,
  supportsAudio: true
}
```

### model-handlers.ts
Add generation handler for WAN 2.6 models.

### ai-cost-calculators.ts
Add cost calculation:
```typescript
function calculateWan26Cost(resolution: string, duration: number): number {
  const perSecond = resolution === "1080p" ? 0.15 : 0.10;
  return perSecond * duration;
}
```

---

## Implementation Checklist

- [ ] Add model constants to `ai-constants.ts`
- [ ] Add capability config to `text2video-models-config.ts`
- [ ] Add I2V capability config
- [ ] Implement generation handler in `model-handlers.ts`
- [ ] Add cost calculator function
- [ ] Update UI to show WAN 2.6 options
- [ ] Add tests for new model
- [ ] Update documentation

---

## References

- [WAN v2.6 Text-to-Video API](https://fal.ai/models/wan/v2.6/text-to-video/api)
- [WAN v2.6 Image-to-Video API](https://fal.ai/models/wan/v2.6/image-to-video/api)

---

*Created: 2025-12-16*
*Status: Planning*
