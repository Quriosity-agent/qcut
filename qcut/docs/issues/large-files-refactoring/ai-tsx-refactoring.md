## 1. ai.tsx (4246 lines)

**Path**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

### Main Functions/Sections

1. **Imports & Type Definitions** (Lines 1-150)
   - 40+ import statements
   - Type aliases for model configurations (ReveAspectRatioOption, LTXV2FastDuration, etc.)
   - Duration/resolution option arrays (SEEDANCE_DURATION_OPTIONS, KLING_ASPECT_RATIOS, etc.)

2. **State Management - Model Options** (Lines 157-400)
   - 60+ `useState` hooks for various model options
   - Frame-to-Video state (firstFrame, lastFrame)
   - Video-to-Video state for Kling models
   - Avatar-specific state (avatarImage, audioFile, referenceImages)
   - Upscale tab state (sourceVideoFile, bytedanceTargetResolution, flashvsrSettings)

3. **Text-to-Video Settings** (Lines 271-380)
   - Unified T2V settings (t2vAspectRatio, t2vResolution, t2vDuration)
   - Model-specific settings (LTXV2, Seedance, Kling, Wan25)
   - Settings expansion state

4. **Computed Values & Effects** (Lines 400-500)
   - `combinedCapabilities` - memoized capabilities calculation
   - Settings clamping effects when models change
   - `getActiveSettingsCount()` helper

5. **Event Handlers** (Lines 472-800)
   - `handleUpscaleVideoChange` - file metadata extraction
   - `handleUpscaleVideoUrlBlur` - URL validation
   - Upload handlers for various media types

6. **UI Components - Main Render** (Lines 800-4246)
   - Tab navigation (Text, Image, Avatar, Upscale)
   - Model selection dropdowns
   - Per-model settings panels
   - Generation controls and results display
   - History panel integration

### Recommended Split

#### File 1: `ai-state.ts` (~400 lines)
- Custom hook `useAIViewState()` with all state management
- All model-specific state variables
- State initialization and reset functions

#### File 2: `ai-handlers.ts` (~300 lines)
- All event handlers
- Video/image upload handlers
- Form submission logic
- Validation functions

#### File 3: `ai-text-tab.tsx` (~800 lines)
- Text-to-Video tab UI
- Model selection for T2V
- T2V settings panel

#### File 4: `ai-image-tab.tsx` (~800 lines)
- Image-to-Video tab UI
- Frame upload sections
- I2V model settings

#### File 5: `ai.tsx` (~1900 lines) - Main component
- Tab router structure
- Avatar tab (smaller)
- Upscale tab (smaller)
- Compose all tabs together

---
