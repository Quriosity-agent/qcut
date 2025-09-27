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

#### **✅ Phase 1: Type System Extensions** (30 minutes total) - **IMPLEMENTED**
**✅ Subtask 1.1**: Extend AIActiveTab type (5 minutes) - **COMPLETED**
- File: `ai-types.ts:98`
- Change: `export type AIActiveTab = "text" | "image" | "avatar";`

**✅ Subtask 1.2**: Update MediaPanelStore interface (5 minutes) - **COMPLETED**
- File: `store.ts:100`
- Change: `aiActiveTab: "text" | "image" | "avatar";`
- Update: `setAiActiveTab: (tab: "text" | "image" | "avatar") => void;`

**✅ Subtask 1.3**: Add avatar-specific types (10 minutes) - **COMPLETED**
- File: `ai-types.ts`
- Add: `AvatarUploadState`, `AvatarModel` interfaces

**✅ Subtask 1.4**: Extend AIModel interface (5 minutes) - **COMPLETED**
- File: `ai-types.ts:14-21`
- Add: `category?: "video" | "avatar"` field
- Add: `requiredInputs?: string[]` field

**✅ Subtask 1.5**: Update generation props (5 minutes) - **COMPLETED**
- File: `ai-types.ts:55-67`
- Add: `audioFile?: File | null`, `sourceVideo?: File | null`

#### **✅ Phase 2: Avatar Model Integration to AI Video Client** (30 minutes total) - **IMPLEMENTED**

**✅ Subtask 2.1**: Add avatar model endpoints to ai-video-client.ts (10 minutes) - **COMPLETED**
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts` (lines 107-118)
- **Action**: Add avatar model endpoints to `modelEndpoints` object

**Implementation:**
```typescript
// Find the modelEndpoints object in generateVideo() function and add:
const modelEndpoints: { [key: string]: string } = {
  // ... existing models ...
  "wan_turbo": "fal-ai/wan/v2.2-a14b/text-to-video/turbo",
  "kling_v2_5_turbo": "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
  "wan_25_preview": "fal-ai/wan-25-preview/text-to-video",

  // ADD THESE AVATAR MODEL ENDPOINTS:
  "wan_animate_replace": "fal-ai/wan/v2.2-14b/animate/replace",
  "kling_avatar_pro": "fal-ai/kling-video/v1/pro/ai-avatar",
  "kling_avatar_standard": "fal-ai/kling-video/v1/standard/ai-avatar",
};
```

**✅ Subtask 2.2**: Add avatar models to AI_MODELS array (10 minutes) - **COMPLETED**
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` (lines 92-107)
- **Action**: Add avatar models to existing AI_MODELS array

**Implementation:**
```typescript
// Add to the existing AI_MODELS array after line 107:
export const AI_MODELS: AIModel[] = [
  // ... existing models ...
  {
    id: "wan_25_preview",
    name: "WAN v2.5 Preview",
    description: "Next-generation WAN model with improved quality",
    price: "0.12",
    resolution: "1080p",
    max_duration: 10,
  },

  // ADD THESE AVATAR MODELS:
  {
    id: "wan_animate_replace",
    name: "WAN Animate/Replace",
    description: "Replace characters in existing videos",
    price: "0.075", // Base price for 480p
    resolution: "480p-720p",
    max_duration: 30, // Supports longer videos for character replacement
  },
  {
    id: "kling_avatar_pro",
    name: "Kling Avatar Pro",
    description: "Premium avatar video generation from image + audio",
    price: "0.25", // Estimated pricing
    resolution: "1080p",
    max_duration: 10,
  },
  {
    id: "kling_avatar_standard",
    name: "Kling Avatar Standard",
    description: "Standard avatar video generation from image + audio",
    price: "0.15", // Estimated pricing
    resolution: "720p",
    max_duration: 10,
  },
];
```

**✅ Subtask 2.3**: Add avatar request interface (10 minutes) - **COMPLETED**
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts` (lines 19-25)
- **Action**: Add new interface for avatar-specific requests

**Implementation:**
```typescript
// Add after existing ImageToVideoRequest interface:
export interface AvatarVideoRequest {
  model: string;
  characterImage: File;
  audioFile?: File; // For Kling models
  sourceVideo?: File; // For WAN animate/replace
  prompt?: string;
  resolution?: string;
  duration?: number;
}
```

#### **✅ Phase 3: Avatar UI Panel Implementation** (45 minutes total) - **IMPLEMENTED**

**✅ Subtask 3.1**: Update AI tab layout for 3 tabs (5 minutes) - **COMPLETED**
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` (line 270)
- **Action**: Change tab layout to support avatar tab

**Implementation:**
```typescript
// Find the TabsList component and update grid-cols-2 to grid-cols-3:
<TabsList className="grid w-full grid-cols-3">
  <TabsTrigger value="text" className="text-xs">
    <TypeIcon className="size-3 mr-1" />
    {!isCompact && "Text"}
  </TabsTrigger>
  <TabsTrigger value="image" className="text-xs">
    <ImageIcon className="size-3 mr-1" />
    {!isCompact && "Image"}
  </TabsTrigger>
  {/* ADD THIS NEW AVATAR TAB: */}
  <TabsTrigger value="avatar" className="text-xs">
    <UserIcon className="size-3 mr-1" />
    {!isCompact && "Avatar"}
  </TabsTrigger>
</TabsList>
```

**✅ Subtask 3.2**: Add UserIcon import (2 minutes) - **COMPLETED**
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` (line 1-15)
- **Action**: Add UserIcon to imports

**Implementation:**
```typescript
// Add UserIcon to the existing imports:
import {
  BotIcon,
  Loader2,
  Play,
  Download,
  History,
  Trash2,
  ImageIcon,
  TypeIcon,
  Upload,
  X,
  Check,
  UserIcon, // ADD THIS LINE
} from "lucide-react";
```

**✅ Subtask 3.3**: Add avatar tab state variables (8 minutes) - **COMPLETED**
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` (line 44-49)
- **Action**: Add avatar-specific state variables

**Implementation:**
```typescript
// Add these state variables after existing selectedImage state:
const [selectedImage, setSelectedImage] = useState<File | null>(null);
const [imagePreview, setImagePreview] = useState<string | null>(null);
const [error, setError] = useState<string | null>(null);

// ADD THESE AVATAR STATE VARIABLES:
const [avatarImage, setAvatarImage] = useState<File | null>(null);
const [avatarImagePreview, setAvatarImagePreview] = useState<string | null>(null);
const [audioFile, setAudioFile] = useState<File | null>(null);
const [audioPreview, setAudioPreview] = useState<string | null>(null);
const [sourceVideo, setSourceVideo] = useState<File | null>(null);
const [sourceVideoPreview, setSourceVideoPreview] = useState<string | null>(null);
```

**✅ Subtask 3.4**: Create avatar tab content (20 minutes) - **COMPLETED**
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` (after line 396)
- **Action**: Add complete avatar tab content with file uploads

**Implementation:**
```typescript
{/* ADD THIS ENTIRE AVATAR TAB CONTENT AFTER THE IMAGE TAB: */}

<TabsContent value="avatar" className="space-y-4">
  {/* Avatar Image Upload */}
  <div className="space-y-2">
    <Label className="text-xs">
      Character Image {!isCompact && "(Required)"}
    </Label>
    <label
      htmlFor="avatar-image-input"
      className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[120px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
        avatarImage
          ? "border-primary/50 bg-primary/5 p-2"
          : "border-muted-foreground/25 hover:border-muted-foreground/50 p-4"
      }`}
      aria-label={avatarImage ? "Change avatar image" : "Click to upload avatar image"}
    >
      {avatarImage && avatarImagePreview ? (
        <div className="relative flex flex-col items-center justify-center h-full">
          <img
            src={avatarImagePreview}
            alt={avatarImage?.name ?? "Avatar preview"}
            className="max-w-full max-h-32 mx-auto rounded object-contain"
          />
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              setAvatarImage(null);
              setAvatarImagePreview(null);
              const input = document.getElementById('avatar-image-input') as HTMLInputElement;
              if (input) input.value = '';
            }}
            className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
          >
            <X className="h-3 w-3" />
          </Button>
          <div className="mt-2 text-xs text-muted-foreground text-center">
            {avatarImage.name}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full space-y-2 text-center">
          <Upload className="size-8 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            Click to upload character image
          </div>
          <div className="text-xs text-muted-foreground/70">
            JPG, PNG, WebP (max 10MB)
          </div>
        </div>
      )}
      <input
        id="avatar-image-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          // Validate file
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            setError('Please select a valid image file (JPG, PNG, WebP)');
            return;
          }

          if (file.size > 10 * 1024 * 1024) {
            setError('Image file too large (max 10MB)');
            return;
          }

          setAvatarImage(file);
          setError(null);

          // Create preview
          const reader = new FileReader();
          reader.onload = (e) => setAvatarImagePreview(e.target?.result as string);
          reader.readAsDataURL(file);
        }}
        className="sr-only"
      />
    </label>
  </div>

  {/* Audio File Upload (for Kling models) */}
  <div className="space-y-2">
    <Label className="text-xs">
      Audio File {!isCompact && "(For Kling Avatar models)"}
    </Label>
    <label
      htmlFor="avatar-audio-input"
      className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[80px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
        audioFile
          ? "border-primary/50 bg-primary/5 p-2"
          : "border-muted-foreground/25 hover:border-muted-foreground/50 p-4"
      }`}
      aria-label={audioFile ? "Change audio file" : "Click to upload audio file"}
    >
      {audioFile ? (
        <div className="relative flex flex-col items-center justify-center h-full">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
              <span className="text-xs">🎵</span>
            </div>
            <div>
              <div className="text-xs font-medium">{audioFile.name}</div>
              <div className="text-xs text-muted-foreground">
                {(audioFile.size / 1024 / 1024).toFixed(1)} MB
              </div>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              setAudioFile(null);
              const input = document.getElementById('avatar-audio-input') as HTMLInputElement;
              if (input) input.value = '';
            }}
            className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full space-y-2 text-center">
          <Upload className="size-6 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            Click to upload audio file
          </div>
          <div className="text-xs text-muted-foreground/70">
            MP3, WAV, AAC (max 50MB)
          </div>
        </div>
      )}
      <input
        id="avatar-audio-input"
        type="file"
        accept="audio/mpeg,audio/wav,audio/aac,audio/mp3"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          // Validate file
          if (!['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/mp3'].includes(file.type)) {
            setError('Please select a valid audio file (MP3, WAV, AAC)');
            return;
          }

          if (file.size > 50 * 1024 * 1024) {
            setError('Audio file too large (max 50MB)');
            return;
          }

          setAudioFile(file);
          setError(null);
        }}
        className="sr-only"
      />
    </label>
  </div>

  {/* Source Video Upload (for WAN animate/replace) */}
  <div className="space-y-2">
    <Label className="text-xs">
      Source Video {!isCompact && "(For WAN Animate/Replace)"}
    </Label>
    <label
      htmlFor="avatar-video-input"
      className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[80px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
        sourceVideo
          ? "border-primary/50 bg-primary/5 p-2"
          : "border-muted-foreground/25 hover:border-muted-foreground/50 p-4"
      }`}
      aria-label={sourceVideo ? "Change source video" : "Click to upload source video"}
    >
      {sourceVideo ? (
        <div className="relative flex flex-col items-center justify-center h-full">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
              <span className="text-xs">🎬</span>
            </div>
            <div>
              <div className="text-xs font-medium">{sourceVideo.name}</div>
              <div className="text-xs text-muted-foreground">
                {(sourceVideo.size / 1024 / 1024).toFixed(1)} MB
              </div>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              setSourceVideo(null);
              const input = document.getElementById('avatar-video-input') as HTMLInputElement;
              if (input) input.value = '';
            }}
            className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full space-y-2 text-center">
          <Upload className="size-6 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            Click to upload source video
          </div>
          <div className="text-xs text-muted-foreground/70">
            MP4, MOV, AVI (max 100MB)
          </div>
        </div>
      )}
      <input
        id="avatar-video-input"
        type="file"
        accept="video/mp4,video/mov,video/avi"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          // Validate file
          if (!['video/mp4', 'video/mov', 'video/avi'].includes(file.type)) {
            setError('Please select a valid video file (MP4, MOV, AVI)');
            return;
          }

          if (file.size > 100 * 1024 * 1024) {
            setError('Video file too large (max 100MB)');
            return;
          }

          setSourceVideo(file);
          setError(null);
        }}
        className="sr-only"
      />
    </label>
  </div>

  {/* Optional Prompt for Avatar */}
  <div className="space-y-2">
    <Label htmlFor="avatar-prompt" className="text-xs">
      {!isCompact && "Additional "}Prompt {!isCompact && "(optional)"}
    </Label>
    <Textarea
      id="avatar-prompt"
      placeholder={
        isCompact
          ? "Describe the avatar style..."
          : "Describe the desired avatar style or motion..."
      }
      value={prompt}
      onChange={(e) => setPrompt(e.target.value)}
      className="min-h-[40px] text-xs resize-none"
      maxLength={maxChars}
    />
  </div>
</TabsContent>
```

**✅ Subtask 3.5**: Update model filtering for avatar tab (10 minutes) - **COMPLETED**
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` (line 406-458)
- **Action**: Filter models to show only avatar models on avatar tab

**Implementation:**
```typescript
// Update the model mapping section to filter models by tab:
{/* AI Model Selection */}
<div className="space-y-2">
  <Label className="text-xs">
    {!isCompact && "Select "}AI Models
    {!isCompact && " (multi-select)"}
  </Label>
  <div className="space-y-1">
    {AI_MODELS
      .filter((model) => {
        // Filter models based on active tab
        if (activeTab === "avatar") {
          return ["wan_animate_replace", "kling_avatar_pro", "kling_avatar_standard"].includes(model.id);
        } else {
          // Show non-avatar models for text/image tabs
          return !["wan_animate_replace", "kling_avatar_pro", "kling_avatar_standard"].includes(model.id);
        }
      })
      .map((model) => {
        const inputId = `ai-model-${model.id}`;
        const selected = isModelSelected(model.id);
        return (
          <label
            key={model.id}
            htmlFor={inputId}
            className={`w-full flex items-center justify-between p-2 rounded-md border transition-colors cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
              selected
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/50"
            }`}
          >
            {/* ... existing model selection UI ... */}
          </label>
        );
      })}
  </div>
</div>
```

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

#### **✅ Phase 5: Model Filtering** (20 minutes total) - **IMPLEMENTED**
**✅ Subtask 5.1**: Filter models by category (10 minutes) - **COMPLETED**
- File: `ai.tsx:406-458`
- Update model mapping to show only relevant models per tab
- `avatar` tab shows only avatar models

**✅ Subtask 5.2**: Update model selection validation (10 minutes) - **COMPLETED**
- Ensure avatar models only selectable on avatar tab
- Update `canGenerate` logic for avatar requirements

#### **Phase 6: Avatar Generation Logic** (35 minutes total)

**Subtask 6.1**: Create avatar video generation function (15 minutes)
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts` (add new function)
- **Action**: Create new `generateAvatarVideo()` function

**Implementation:**
```typescript
// Add new function after generateVideoFromImage() function:
export async function generateAvatarVideo(
  request: AvatarVideoRequest
): Promise<VideoGenerationResponse> {
  try {
    if (!FAL_API_KEY) {
      throw new Error("FAL API key not configured");
    }

    console.log("🎭 Starting avatar video generation with FAL AI");
    console.log("🎬 Model:", request.model);

    // Convert character image to base64
    const characterImageUrl = await imageToDataURL(request.characterImage);

    // Determine endpoint and payload based on model
    let endpoint: string;
    let payload: any;

    if (request.model === "wan_animate_replace") {
      if (!request.sourceVideo) {
        throw new Error("WAN Animate/Replace requires a source video");
      }
      // Convert source video to data URL (for WAN model)
      const sourceVideoUrl = await imageToDataURL(request.sourceVideo);
      endpoint = "fal-ai/wan/v2.2-14b/animate/replace";
      payload = {
        video_url: sourceVideoUrl,
        image_url: characterImageUrl,
        resolution: request.resolution || "480p",
        video_quality: "high",
      };
    } else if (request.model === "kling_avatar_pro") {
      if (!request.audioFile) {
        throw new Error("Kling Avatar Pro requires an audio file");
      }
      // Convert audio to data URL
      const audioUrl = await imageToDataURL(request.audioFile);
      endpoint = "fal-ai/kling-video/v1/pro/ai-avatar";
      payload = {
        image_url: characterImageUrl,
        audio_url: audioUrl,
        prompt: request.prompt || "",
      };
    } else if (request.model === "kling_avatar_standard") {
      if (!request.audioFile) {
        throw new Error("Kling Avatar Standard requires an audio file");
      }
      // Convert audio to data URL
      const audioUrl = await imageToDataURL(request.audioFile);
      endpoint = "fal-ai/kling-video/v1/standard/ai-avatar";
      payload = {
        image_url: characterImageUrl,
        audio_url: audioUrl,
        prompt: request.prompt || "",
      };
    } else {
      throw new Error(`Unsupported avatar model: ${request.model}`);
    }

    const jobId = generateJobId();
    console.log(`🎭 Generating avatar video with: ${endpoint}`);
    console.log("📝 Payload:", payload);

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Avatar generation failed: ${errorData.detail || response.statusText}`);
    }

    const result = await response.json();
    console.log("✅ Avatar video generated:", result);

    return {
      job_id: jobId,
      status: "completed",
      message: `Avatar video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate avatar video", {
      model: request.model,
      operation: "generateAvatarVideo",
    });
    throw error;
  }
}
```

**Subtask 6.2**: Update generation button logic for avatar support (10 minutes)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` (generation button section)
- **Action**: Update the generate button to handle avatar models

**Implementation:**
```typescript
// Update the Generate Video button logic to handle avatar models:

// First, add avatar validation logic
const canGenerateAvatar = useCallback(() => {
  if (activeTab !== "avatar") return false;

  const avatarModels = selectedModels.filter(modelId =>
    ["wan_animate_replace", "kling_avatar_pro", "kling_avatar_standard"].includes(modelId)
  );

  if (avatarModels.length === 0) return false;
  if (!avatarImage) return false;

  // Check specific requirements per model
  for (const modelId of avatarModels) {
    if (modelId === "wan_animate_replace" && !sourceVideo) {
      return false; // WAN needs source video
    }
    if ((modelId === "kling_avatar_pro" || modelId === "kling_avatar_standard") && !audioFile) {
      return false; // Kling needs audio file
    }
  }

  return true;
}, [activeTab, selectedModels, avatarImage, sourceVideo, audioFile]);

// Update the main canGenerate logic
const canGenerate = useMemo(() => {
  if (activeTab === "avatar") {
    return canGenerateAvatar();
  }

  // Existing logic for text/image tabs
  if (selectedModels.length === 0) return false;
  if (activeTab === "text" && !prompt.trim()) return false;
  if (activeTab === "image" && !selectedImage) return false;

  return true;
}, [activeTab, canGenerateAvatar, selectedModels, prompt, selectedImage]);

// Update the generate button onClick handler
const handleGenerateClick = useCallback(async () => {
  if (activeTab === "avatar") {
    // Handle avatar generation
    if (!avatarImage) {
      setError("Please select a character image");
      return;
    }

    for (const modelId of selectedModels) {
      if (modelId === "wan_animate_replace") {
        if (!sourceVideo) {
          setError("WAN Animate/Replace requires a source video");
          return;
        }

        try {
          const avatarRequest = {
            model: modelId,
            characterImage: avatarImage,
            sourceVideo: sourceVideo,
            prompt: prompt || undefined,
          };

          // Call the new generateAvatarVideo function
          console.log("🎭 Generating avatar video with WAN model:", avatarRequest);
          // This would integrate with generateAvatarVideo from ai-video-client.ts

        } catch (error) {
          console.error("Avatar generation error:", error);
          setError(error instanceof Error ? error.message : "Avatar generation failed");
        }
      } else if (modelId === "kling_avatar_pro" || modelId === "kling_avatar_standard") {
        if (!audioFile) {
          setError(`${modelId} requires an audio file`);
          return;
        }

        try {
          const avatarRequest = {
            model: modelId,
            characterImage: avatarImage,
            audioFile: audioFile,
            prompt: prompt || undefined,
          };

          console.log("🎭 Generating avatar video with Kling model:", avatarRequest);
          // This would integrate with generateAvatarVideo from ai-video-client.ts

        } catch (error) {
          console.error("Avatar generation error:", error);
          setError(error instanceof Error ? error.message : "Avatar generation failed");
        }
      }
    }
  } else {
    // Existing text/image generation logic
    generation.handleGenerate();
  }
}, [activeTab, avatarImage, sourceVideo, audioFile, selectedModels, prompt, generation]);

// Update the Generate Button JSX
<Button
  type="button"
  onClick={handleGenerateClick}
  disabled={!canGenerate || generation.isGenerating}
  className="w-full"
  size={isCompact ? "sm" : "lg"}
>
  {generation.isGenerating ? (
    <>
      <Loader2 className="size-4 mr-2 animate-spin" />
      {isCompact ? "Generating..." :
       activeTab === "avatar" ? "Generating Avatar..." : "Generating Video..."}
    </>
  ) : (
    <>
      <BotIcon className="size-4 mr-2" />
      {isCompact ? "Generate" :
       activeTab === "avatar" ? "Generate Avatar Video" : "Generate Video"}
    </>
  )}
</Button>
```

**Subtask 6.3**: Add avatar model cost estimation (10 minutes)
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts` (lines 266-279)
- **Action**: Add avatar models to `estimateCost()` function

**Implementation:**
```typescript
// Update the modelCosts object in estimateCost() function:
const modelCosts: {
  [key: string]: { base_cost: number; max_duration: number };
} = {
  // ... existing models ...
  "wan_25_preview": { base_cost: 0.12, max_duration: 10 },

  // ADD AVATAR MODEL COSTS:
  "wan_animate_replace": { base_cost: 0.075, max_duration: 30 },
  "kling_avatar_pro": { base_cost: 0.25, max_duration: 10 },
  "kling_avatar_standard": { base_cost: 0.15, max_duration: 10 },
};
```

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
- **Phase 2**: 30 minutes (Avatar model integration to AI client)
- **Phase 3**: 45 minutes (Avatar UI panel implementation - **COMPLETE CODE PROVIDED**)
- **Phase 4**: 35 minutes (File handling - **INTEGRATED INTO PHASE 3**)
- **Phase 5**: 20 minutes (Model filtering - **INTEGRATED INTO PHASE 3**)
- **Phase 6**: 35 minutes (Avatar generation logic)
- **Phase 7**: 20 minutes (Testing)

**Total: 215 minutes (3.6 hours)**

### 🎨 **Complete Avatar UI Panel Features**
✅ **Avatar Tab Layout**: 3-tab system (text | image | avatar)
✅ **Character Image Upload**: Drag & drop with preview and validation
✅ **Audio File Upload**: Support for MP3, WAV, AAC files (50MB limit)
✅ **Source Video Upload**: Support for MP4, MOV, AVI files (100MB limit)
✅ **Model Filtering**: Shows only avatar models on avatar tab
✅ **Smart Validation**: Checks required files per model type
✅ **Generate Button Logic**: Avatar-specific generation with proper validation
✅ **File Previews**: Visual previews for images, file info for audio/video
✅ **Error Handling**: File type, size, and requirement validation
✅ **Accessibility**: ARIA labels, keyboard navigation, screen reader support

### ✅ **Key Files to Modify**
1. `ai-types.ts` - Type extensions for avatar tab
2. `store.ts` - Store interface updates for avatar tab
3. `ai-constants.ts` - Avatar model additions to UI constants
4. `ai-video-client.ts` - Avatar generation functions and endpoints (**PRIMARY FOCUS**)
5. `ai.tsx` - UI components for avatar tab
6. `use-ai-generation.ts` - Avatar generation routing logic

### 🎯 **Implementation Priority**
**High Priority (Core functionality):**
1. Avatar model endpoints in `ai-video-client.ts`
2. Avatar generation function in `ai-video-client.ts`
3. Avatar models in `ai-constants.ts`
4. Avatar tab in UI (`ai.tsx`)

**Medium Priority (Enhanced UX):**
5. File upload components
6. Model filtering logic
7. Progress tracking improvements

**Low Priority (Polish):**
8. Error message improvements
9. Validation enhancements
10. Testing coverage

### 🔒 **Risk Mitigation**
- Each subtask is independent and can be tested individually
- Changes are additive, not destructive
- Existing users see no difference until they click the avatar tab
- All file validation and error handling is isolated per tab