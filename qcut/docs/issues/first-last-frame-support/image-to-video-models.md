# Image-to-Video AI Models

This document lists all available image-to-video AI models in the application, including models that support first frame and last frame input.

## Models Overview

### Sora 2 Models

#### Sora 2 Image-to-Video
- **Price**: $0.10/s
- **Resolution**: 720p
- **Description**: Convert images to dynamic videos with Sora 2 (720p)
- **Duration**: 4-12 seconds

#### Sora 2 Image-to-Video Pro
- **Price**: $0.30-0.50
- **Resolution**: 720p / 1080p
- **Description**: High-quality image-to-video with 1080p support
- **Duration**: 4-12 seconds

---

### LTX Video 2.0 Models

#### LTX Video 2.0 I2V
- **Price**: $0.36
- **Resolution**: 1080p (up to 4K)
- **Description**: Image-to-video with audio generation (6-10s, up to 4K)
- **Duration**: 6-10 seconds
- **Features**: Audio generation

#### LTX Video 2.0 Fast I2V
- **Price**: $0.04-0.16
- **Resolution**: 1080p (up to 4K)
- **Description**: Image-to-video with audio generation (6-20s, up to 4K)
- **Duration**: 6-20 seconds
- **Features**: Audio generation, extended duration support

---

### Veo 3.1 Models

#### Veo 3.1 Fast Image-to-Video
- **Price**: $1.20
- **Resolution**: 720p / 1080p
- **Description**: Google's Veo 3.1 Fast - Animate static images with motion (faster, budget-friendly)
- **Duration**: 8 seconds
- **Features**: Fast processing, audio generation

#### Veo 3.1 Fast Frame-to-Video
- **Price**: $1.20
- **Resolution**: 720p / 1080p
- **Description**: Google's Veo 3.1 Fast - Animate between first and last frames (faster, budget-friendly)
- **Duration**: 8 seconds
- **Features**: **First frame + Last frame input support**, audio generation
- **Required Inputs**: First frame image, Last frame image

#### Veo 3.1 Image-to-Video
- **Price**: $3.20
- **Resolution**: 720p / 1080p
- **Description**: Google's Veo 3.1 - Premium quality image animation with motion
- **Duration**: 8 seconds
- **Features**: Premium quality, audio generation

#### Veo 3.1 Frame-to-Video
- **Price**: $3.20
- **Resolution**: 720p / 1080p
- **Description**: Google's Veo 3.1 - Premium quality animation between first and last frames
- **Duration**: 8 seconds
- **Features**: **First frame + Last frame input support**, premium quality, audio generation
- **Required Inputs**: First frame image, Last frame image

---

### Hailuo 2.3 Models

#### Hailuo 2.3 Standard
- **Price**: $0.28-0.56
- **Resolution**: 768p
- **Description**: Budget-friendly image-to-video with 768p quality
- **Duration**: 6-10 seconds

#### Hailuo 2.3 Fast Pro
- **Price**: $0.33
- **Resolution**: 1080p
- **Description**: Balanced 1080p image-to-video with faster generation
- **Duration**: 6-10 seconds

#### Hailuo 2.3 Pro
- **Price**: $0.49
- **Resolution**: 1080p
- **Description**: Premium 1080p image-to-video with highest fidelity
- **Duration**: 6-10 seconds

---

### Vidu Q2 Model

#### Vidu Q2 Turbo I2V
- **Price**: $0.05
- **Resolution**: 720p
- **Description**: High-quality image-to-video with motion control (2-8s)
- **Duration**: 2-8 seconds
- **Features**: Motion control with movement amplitude settings

---

## Models Supporting First Frame + Last Frame

The following models specifically support both first frame and last frame inputs to create smooth transitions:

1. **Veo 3.1 Fast Frame-to-Video** - $1.20, 720p/1080p
2. **Veo 3.1 Frame-to-Video** - $3.20, 720p/1080p

### Implementation Requirements

For first frame + last frame support implementation:
- File upload component for first frame image
- File upload component for last frame image
- Aspect ratio validation (frames must match)
- Maximum file size: 8MB per frame
- Supported formats: PNG, JPEG, WebP, AVIF, HEIF
- Aspect ratio constraints: 16:9 or 9:16

---

## Model Comparison

| Model | Price | Resolution | Duration | First+Last Frame |
|-------|-------|------------|----------|------------------|
| Sora 2 I2V | $0.10/s | 720p | 4-12s | No |
| Sora 2 I2V Pro | $0.30-0.50 | 720p/1080p | 4-12s | No |
| LTX 2.0 I2V | $0.36 | 1080p-4K | 6-10s | No |
| LTX 2.0 Fast I2V | $0.04-0.16 | 1080p-4K | 6-20s | No |
| Veo 3.1 Fast I2V | $1.20 | 720p/1080p | 8s | No |
| Veo 3.1 Fast F2V | $1.20 | 720p/1080p | 8s | **Yes** |
| Veo 3.1 I2V | $3.20 | 720p/1080p | 8s | No |
| Veo 3.1 F2V | $3.20 | 720p/1080p | 8s | **Yes** |
| Hailuo 2.3 Standard | $0.28-0.56 | 768p | 6-10s | No |
| Hailuo 2.3 Fast Pro | $0.33 | 1080p | 6-10s | No |
| Hailuo 2.3 Pro | $0.49 | 1080p | 6-10s | No |
| Vidu Q2 Turbo | $0.05 | 720p | 2-8s | No |

---

## Notes

- F2V = Frame-to-Video (supports first + last frame)
- I2V = Image-to-Video (single image input)
- All prices are subject to change based on provider updates
- Models with audio generation capability are marked in their feature lists
