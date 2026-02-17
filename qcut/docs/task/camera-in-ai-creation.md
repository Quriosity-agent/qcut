# Camera in AI Creation

How camera controls work across QCut's AI video generation features.

## Overview

QCut has three distinct camera-related systems in AI creation:

1. **Seedance Camera Lock** — Boolean toggle to fix/free camera motion
2. **Vidu Q2 Movement Amplitude** — 4-level motion intensity control
3. **Cinematic Angles (SHOTS)** — Generate 9 camera perspective variations from a source image
4. **Cinema Equipment Selector** — Camera body/lens/focal/aperture picker (UI-only, not yet wired to generation)

---

## 1. Seedance Camera Fixed

A simple boolean that tells the Seedance model whether the camera should remain static.

### Data Flow

```
UI Checkbox ("Lock camera position")
  → use-ai-image-tab-state.ts :: setSeedanceCameraFixed(boolean)
    → SeedanceSettings.cameraFixed
      → misc-generators.ts :: generateSeedanceVideo()
        → FAL.ai API payload: { camera_fixed: true/false }
```

### Key Files

| Layer | File | What |
|-------|------|------|
| UI | `apps/web/src/components/editor/media-panel/views/ai/components/ai-seedance-settings.tsx:175-184` | Checkbox control |
| State | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-image-tab-state.ts:60` | `cameraFixed` in SeedanceSettings |
| Generator | `apps/web/src/lib/ai-video/generators/misc-generators.ts:183-194` | Reads `camera_fixed`, defaults to `false` |
| Types | `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts:676` | `camera_fixed?: boolean` on SeedanceI2VRequest |

### Supported Models

- Seedance Pro I2V
- Seedance Pro Fast I2V

---

## 2. Vidu Q2 Movement Amplitude

A 4-option enum controlling how much motion (camera + subject) the generated video has.

### Options

| Value | Meaning |
|-------|---------|
| `auto` | Model decides (default) |
| `small` | Minimal motion |
| `medium` | Moderate motion |
| `large` | Aggressive motion |

### Data Flow

```
UI Dropdown ("Movement Amplitude")
  → use-ai-image-tab-state.ts :: setViduQ2MovementAmplitude(value)
    → ViduQ2Settings.movementAmplitude
      → vidu-generators.ts :: generateViduQ2Video()
        → FAL.ai API payload: { movement_amplitude: "auto"|"small"|"medium"|"large" }
```

### Key Files

| Layer | File | What |
|-------|------|------|
| UI | `apps/web/src/components/editor/media-panel/views/ai/components/ai-vidu-q2-settings.tsx:88-110` | Dropdown selector |
| State | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-image-tab-state.ts` | `movementAmplitude` in ViduQ2Settings |
| Generator | `apps/web/src/lib/ai-video/generators/vidu-generators.ts:88-92` | Injects into payload, defaults to `"auto"` |
| Types | `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts:548` | `movement_amplitude?: "auto" \| "small" \| "medium" \| "large"` |

### Supported Models

- Vidu Q2 Turbo I2V

---

## 3. Cinematic Angles (SHOTS)

Generates 9 different camera angle variations from a single source image using Seeddream 4.5.

### The 9 Angles

| ID | Label | Degrees | Prompt Suffix |
|----|-------|---------|---------------|
| `front` | Front | 0° | "front view, direct frontal perspective" |
| `front_left_45` | Front-Left 45° | 45° | "45-degree left angle view" |
| `left_90` | Left 90° | 90° | "left side profile view" |
| `back_left_135` | Back-Left 135° | 135° | "back-left diagonal view" |
| `back_180` | Back 180° | 180° | "rear view, from behind" |
| `back_right_225` | Back-Right 225° | 225° | "back-right diagonal view" |
| `right_270` | Right 270° | 270° | 270° | "right side profile view" |
| `front_right_315` | Front-Right 315° | 315° | "front-right diagonal view" |
| `top_down` | Top-Down | -1 | "overhead aerial top-down view" |

### Generation Flow

```
Source image + optional prompt
  → angles.ts :: generateCinematicAngles()
    → Batch 3 angles at a time (FAL rate limit)
      → fal-ai/bytedance/seedream/v4.5/edit endpoint
        → Progress callback per angle (generating/complete/error)
          → 9 output images with different perspectives
```

### Prompt Construction

```typescript
const fullPrompt = request.prompt
  ? `${request.prompt}, ${angle.prompt_suffix}, consistent style and subject`
  : `${angle.prompt_suffix}, high quality, detailed`;
```

### Key Files

| File | What |
|------|------|
| `apps/web/src/components/editor/media-panel/views/ai/constants/angles-config.ts` | 9 angle definitions (id, label, degrees, prompt_suffix) |
| `apps/web/src/lib/ai-video/generators/angles.ts` | `generateCinematicAngles()` — batch generation logic |

---

## 4. Cinema Equipment Selector

A UI panel for selecting real-world cinema camera gear. Currently standalone — not connected to AI generation prompts.

### Available Equipment

**Camera Bodies** (6 options):
- Red V-Raptor, Sony Venice, IMAX Film Camera, Arri Alexa 35, Arriflex 16SR, Panavision Millennium DXL2

**Lenses** (11 options):
- Spherical: Helios, ARRI Signature, Cooke S4, Canon K-35, Zeiss Ultra Prime, Petzval, Laowa Macro
- Anamorphic: Hawk V-Lite, Panavision C, JDC Xtal Xpress
- Special: Lensbaby

**Focal Lengths**: 8mm, 14mm, 35mm, 50mm

**Apertures**: f/1.4, f/4, f/11

### Key Files

| File | What |
|------|------|
| `apps/web/src/stores/camera-selector-store.ts` | Zustand store with all equipment arrays and selection state |
| `apps/web/src/components/editor/media-panel/views/camera-selector/camera-selector-view.tsx` | Horizontal scroll track UI |

### Store Interface

```typescript
interface CameraSelectorState {
  cameraIndex: number;
  lensIndex: number;
  focalIndex: number;      // default: index 3 (50mm)
  apertureIndex: number;
  setCameraIndex: (i: number) => void;
  setLensIndex: (i: number) => void;
  setFocalIndex: (i: number) => void;
  setApertureIndex: (i: number) => void;
}
```

---

## Model Support Matrix

| Model | Camera Control | Parameter | Type |
|-------|---------------|-----------|------|
| Seedance Pro I2V | Yes | `camera_fixed` | boolean |
| Seedance Pro Fast I2V | Yes | `camera_fixed` | boolean |
| Vidu Q2 Turbo I2V | Yes | `movement_amplitude` | enum |
| Vidu Q3 T2V | No | — | — |
| WAN v2.6 T2V/I2V | No | — | — |
| Kling v2.6/v3 I2V | No | — | — |
| LTX Video 2.0 | No | — | — |

---

## Potential Enhancement

The Cinema Equipment Selector store is fully built but not connected to generation. It could inject camera/lens descriptions into prompts (e.g. "shot on Arri Alexa 35 with Cooke S4 lens at 35mm f/1.4") to influence the visual style of AI-generated video.
