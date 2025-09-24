# Avatar Model Integration Documentation

## Overview
This document outlines the integration of avatar models for QCut's video editing platform. Three avatar models are being integrated to provide users with comprehensive avatar video generation capabilities.

## Avatar Models

### 1. WAN v2.2-14b Animate/Replace
**API Endpoint:** `fal-ai/wan/v2.2-14b/animate/replace`
**Documentation:** https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/replace/api

**Capabilities:**
- Integrates animated characters into reference videos
- Replaces original characters while preserving scene lighting and color tone
- Maintains video quality and environmental consistency

**Required Parameters:**
- `video_url`: Source video URL for character replacement
- `image_url`: Replacement character image URL

**Optional Parameters:**
- `resolution`: 480p (default), 580p, or 720p
- `num_inference_steps`: Generation quality control (default: 20)
- `video_quality`: Low, medium, high, or maximum
- `video_write_mode`: Fast, balanced, or small

**Pricing Structure:**
- 720p: $0.15 per video second
- 580p: $0.1125 per video second
- 480p: $0.075 per video second

**Example Usage:**
```javascript
const result = await fal.subscribe("fal-ai/wan/v2.2-14b/animate/replace", {
  input: {
    video_url: "source_video.mp4",
    image_url: "character_replacement.jpg",
    resolution: "720p",
    video_quality: "high"
  }
});
```

---

### 2. Kling Video v1 Pro AI Avatar
**API Endpoint:** `fal-ai/kling-video/v1/pro/ai-avatar`
**Documentation:** https://fal.ai/models/fal-ai/kling-video/v1/pro/ai-avatar/api

**Capabilities:**
- Creates avatar videos with realistic humans, animals, cartoons, or stylized characters
- Converts input image and audio into synchronized video
- High-quality avatar generation with premium features

**Required Parameters:**
- `image_url`: Avatar image URL
- `audio_url`: Audio file URL for synchronization

**Optional Parameters:**
- `prompt`: Additional context for video generation

**Output:**
- `video`: Generated video file
- `duration`: Video length in seconds

**Example Usage:**
```javascript
const result = await fal.subscribe("fal-ai/kling-video/v1/pro/ai-avatar", {
  input: {
    image_url: "https://example.com/avatar.jpg",
    audio_url: "https://example.com/audio.mp3",
    prompt: "Professional presentation style"
  }
});
```

---

### 3. Kling Video v1 Standard AI Avatar
**API Endpoint:** `fal-ai/kling-video/v1/standard/ai-avatar`
**Documentation:** https://fal.ai/models/fal-ai/kling-video/v1/standard/ai-avatar/api

**Capabilities:**
- Standard avatar video creation
- Supports humans, animals, cartoons, and stylized characters
- Audio-synchronized avatar movement
- Cost-effective alternative to Pro version

**Required Parameters:**
- `image_url`: Avatar image URL
- `audio_url`: Audio file URL for synchronization

**Optional Parameters:**
- `prompt`: Additional video generation guidance

**Output:**
- Generated video file
- Video duration
- Video URL for download/viewing

**Example Usage:**
```javascript
const result = await fal.subscribe("fal-ai/kling-video/v1/standard/ai-avatar", {
  input: {
    image_url: "avatar_image.jpg",
    audio_url: "speech_audio.mp3"
  }
});
```

---

## Implementation Considerations

### Security & Authentication
- All APIs require secure API key management
- Implement server-side proxy for API calls to protect credentials
- Use Electron IPC handlers for secure API key storage

### Integration Architecture
```
Frontend UI → Electron IPC → Avatar Service Handler → FAL.AI APIs
```

### Error Handling
- Implement robust error handling for API failures
- Provide user feedback for processing status
- Handle network timeouts and rate limits

### File Management
- Support for local file uploads to avatar services
- Temporary file cleanup after processing
- Progress tracking for video generation

### Commercial Usage
- All three models support commercial use
- Consider pricing structure for user billing
- Implement usage tracking and quota management

---

## Integration Plan

### ✅ **Safe Integration Strategy**
**Location**: Integrate avatar functionality into existing AI Video panel (`ai.tsx`) to maintain consistency and avoid breaking existing features.

**Current Structure Analysis**:
- AI panel has 2 tabs: `text` | `image` (line 100 in `store.ts`)
- Tab system uses `grid-cols-2` layout (line 270 in `ai.tsx`)
- Models defined in `AI_MODELS` array (line 26 in `ai-constants.ts`)

### 🔧 **Implementation Subtasks** (<10 minutes each)

#### **Phase 1: Type System Extensions** (30 minutes total)
**Subtask 1.1**: Extend AIActiveTab type (5 minutes)
- File: `ai-types.ts:98`
- Change: `export type AIActiveTab = "text" | "image" | "avatar";`

**Subtask 1.2**: Update MediaPanelStore interface (5 minutes)
- File: `store.ts:100`
- Change: `aiActiveTab: "text" | "image" | "avatar";`
- Update: `setAiActiveTab: (tab: "text" | "image" | "avatar") => void;`

**Subtask 1.3**: Add avatar-specific types (10 minutes)
- File: `ai-types.ts`
- Add: `AvatarUploadState`, `AvatarModel` interfaces

**Subtask 1.4**: Extend AIModel interface (5 minutes)
- File: `ai-types.ts:14-21`
- Add: `category?: "video" | "avatar"` field
- Add: `requiredInputs?: string[]` field

**Subtask 1.5**: Update generation props (5 minutes)
- File: `ai-types.ts:55-67`
- Add: `audioFile?: File | null`, `sourceVideo?: File | null`

#### **Phase 2: Constants & Models** (25 minutes total)
**Subtask 2.1**: Add avatar models to AI_MODELS (10 minutes)
- File: `ai-constants.ts:26-83`
- Add 3 avatar models with `category: "avatar"`:
```typescript
{
  id: "wan_animate_replace",
  name: "WAN Animate/Replace",
  description: "Replace characters in existing videos",
  price: "0.075",
  resolution: "480p-720p",
  category: "avatar",
  requiredInputs: ["image", "video"]
},
{
  id: "kling_avatar_pro",
  name: "Kling Avatar Pro",
  description: "Premium avatar video generation",
  price: "0.25",
  resolution: "1080p",
  category: "avatar",
  requiredInputs: ["image", "audio"]
},
{
  id: "kling_avatar_standard",
  name: "Kling Avatar Standard",
  description: "Standard avatar video generation",
  price: "0.15",
  resolution: "720p",
  category: "avatar",
  requiredInputs: ["image", "audio"]
}
```

**Subtask 2.2**: Add avatar upload constants (5 minutes)
- File: `ai-constants.ts:95-99`
- Add: `ALLOWED_AUDIO_TYPES`, `ALLOWED_VIDEO_TYPES`, `MAX_AUDIO_SIZE_BYTES`

**Subtask 2.3**: Add avatar error messages (5 minutes)
- File: `ai-constants.ts:117-126`
- Add: `INVALID_AUDIO_TYPE`, `INVALID_VIDEO_TYPE`, `MISSING_AVATAR_INPUTS`

**Subtask 2.4**: Add avatar model helper functions (5 minutes)
- File: `ai-constants.ts:152-191`
- Add: `getAvatarModels()`, `getVideoModels()` functions

#### **Phase 3: UI Components** (40 minutes total)
**Subtask 3.1**: Update tab layout (5 minutes)
- File: `ai.tsx:270`
- Change: `grid-cols-2` to `grid-cols-3`

**Subtask 3.2**: Add avatar tab trigger (5 minutes)
- File: `ai.tsx:275-279`
- Add third `TabsTrigger` with `UserIcon` and "Avatar" label

**Subtask 3.3**: Create avatar tab content structure (10 minutes)
- File: `ai.tsx:396` (after image TabsContent)
- Add: `<TabsContent value="avatar" className="space-y-4">`

**Subtask 3.4**: Add avatar image upload component (10 minutes)
- Copy and modify existing image upload logic
- Update labels: "Avatar Image", "Character Photo"

**Subtask 3.5**: Add audio file upload component (10 minutes)
- Similar to image upload but for audio files
- Support: MP3, WAV, AAC formats

#### **Phase 4: File Handling Logic** (35 minutes total)
**Subtask 4.1**: Add avatar state variables (5 minutes)
- File: `ai.tsx:44-49`
- Add: `audioFile`, `videoFile`, `audioPreview` state

**Subtask 4.2**: Create audio file handler (10 minutes)
- Similar to `handleImageSelect` function
- Validate audio file types and sizes

**Subtask 4.3**: Create video file handler (10 minutes)
- For WAN model source video input
- Validate video file types and sizes

**Subtask 4.4**: Update file cleanup logic (5 minutes)
- Extend `clearImage` to `clearFiles`
- Handle all file types (image, audio, video)

**Subtask 4.5**: Add file preview components (5 minutes)
- Audio: waveform or file name display
- Video: thumbnail or file name display

#### **Phase 5: Model Filtering** (20 minutes total)
**Subtask 5.1**: Filter models by category (10 minutes)
- File: `ai.tsx:406-458`
- Update model mapping to show only relevant models per tab
- `avatar` tab shows only avatar models

**Subtask 5.2**: Update model selection validation (10 minutes)
- Ensure avatar models only selectable on avatar tab
- Update `canGenerate` logic for avatar requirements

#### **Phase 6: Generation Logic** (30 minutes total)
**Subtask 6.1**: Extend useAIGeneration hook (10 minutes)
- File: `use-ai-generation.ts`
- Add avatar-specific file handling
- Update API calls for avatar models

**Subtask 6.2**: Add avatar API endpoints (10 minutes)
- Electron IPC handlers for FAL avatar APIs
- Handle multi-file uploads (image + audio/video)

**Subtask 6.3**: Update progress tracking (10 minutes)
- Avatar generations may take longer
- Add specific status messages for avatar processing

#### **Phase 7: Testing & Validation** (20 minutes total)
**Subtask 7.1**: Test tab switching (5 minutes)
- Ensure text/image tabs still work
- Verify avatar tab functionality

**Subtask 7.2**: Test file validation (5 minutes)
- Test all file type restrictions
- Verify error messages display correctly

**Subtask 7.3**: Test model filtering (5 minutes)
- Verify correct models show per tab
- Test multi-select behavior

**Subtask 7.4**: Integration test (5 minutes)
- Test complete avatar generation flow
- Verify no existing functionality is broken

### 🎯 **Breaking Change Prevention**

1. **Backward Compatibility**: All existing `text`/`image` functionality remains unchanged
2. **Additive Changes**: Only adding new code, not modifying existing logic
3. **Type Safety**: Extend types rather than replacing them
4. **Default Behavior**: Default tab remains "text", preserving user experience
5. **Error Handling**: New error states don't interfere with existing ones

### 📊 **Total Implementation Time**
- **Phase 1**: 30 minutes (Type extensions)
- **Phase 2**: 25 minutes (Models & constants)
- **Phase 3**: 40 minutes (UI components)
- **Phase 4**: 35 minutes (File handling)
- **Phase 5**: 20 minutes (Model filtering)
- **Phase 6**: 30 minutes (Generation logic)
- **Phase 7**: 20 minutes (Testing)

**Total: 200 minutes (3.3 hours)**

### ✅ **Key Files to Modify**
1. `ai-types.ts` - Type extensions
2. `store.ts` - Store interface updates
3. `ai-constants.ts` - Model and constant additions
4. `ai.tsx` - UI components and logic
5. `use-ai-generation.ts` - Generation logic
6. `electron/main.ts` - API handlers

### 🔒 **Risk Mitigation**
- Each subtask is independent and can be tested individually
- Changes are additive, not destructive
- Existing users see no difference until they click the avatar tab
- All file validation and error handling is isolated per tab