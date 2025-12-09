/**
 * Avatar Tab UI Component
 *
 * Renders the Avatar tab UI including:
 * - First/Last frame uploads
 * - Reference images grid (6 slots)
 * - Audio input upload
 * - Source video upload
 * - Optional prompt
 * - Kling Avatar v2 specific options
 *
 * @see ai-tsx-refactoring.md - Subtask 3.5
 */

import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileUpload } from "@/components/ui/file-upload";

import { UPLOAD_CONSTANTS } from "../constants/ai-constants";

// ============================================
// Types
// ============================================

export interface AIAvatarTabProps {
  /** Current prompt value */
  prompt: string;
  /** Callback when prompt changes */
  onPromptChange: (value: string) => void;
  /** Maximum character limit for prompt */
  maxChars: number;
  /** Selected AI models */
  selectedModels: string[];
  /** Whether compact mode is active */
  isCompact: boolean;
  /** Callback for errors */
  onError: (error: string | null) => void;

  // Avatar image
  avatarImage: File | null;
  avatarImagePreview: string | null;
  onAvatarImageChange: (file: File | null, preview: string | null) => void;

  // Last frame
  avatarLastFrame: File | null;
  avatarLastFramePreview: string | null;
  onAvatarLastFrameChange: (file: File | null, preview: string | null) => void;

  // Reference images
  referenceImages: (File | null)[];
  referenceImagePreviews: (string | null)[];
  onReferenceImageChange: (
    index: number,
    file: File | null,
    preview: string | null
  ) => void;

  // Audio
  audioFile: File | null;
  onAudioFileChange: (file: File | null) => void;

  // Source video
  sourceVideo: File | null;
  onSourceVideoChange: (file: File | null) => void;

  // Kling Avatar v2
  klingAvatarV2Prompt: string;
  onKlingAvatarV2PromptChange: (value: string) => void;
  audioDuration: number | null;
}

// ============================================
// Component
// ============================================

/**
 * Avatar tab component for AI avatar generation.
 *
 * @example
 * ```tsx
 * <AIAvatarTab
 *   prompt={prompt}
 *   onPromptChange={setPrompt}
 *   maxChars={maxChars}
 *   selectedModels={selectedModels}
 *   isCompact={isCompact}
 *   onError={setError}
 *   avatarImage={avatarImage}
 *   avatarImagePreview={avatarImagePreview}
 *   onAvatarImageChange={(file, preview) => { ... }}
 *   // ... other props
 * />
 * ```
 */
export function AIAvatarTab({
  prompt,
  onPromptChange,
  maxChars,
  selectedModels,
  isCompact,
  onError,
  avatarImage,
  avatarImagePreview,
  onAvatarImageChange,
  avatarLastFrame,
  avatarLastFramePreview,
  onAvatarLastFrameChange,
  referenceImages,
  referenceImagePreviews,
  onReferenceImageChange,
  audioFile,
  onAudioFileChange,
  sourceVideo,
  onSourceVideoChange,
  klingAvatarV2Prompt,
  onKlingAvatarV2PromptChange,
  audioDuration,
}: AIAvatarTabProps) {
  // Model selection helpers
  const klingAvatarV2Selected =
    selectedModels.includes("kling_avatar_v2_standard") ||
    selectedModels.includes("kling_avatar_v2_pro");

  return (
    <div className="space-y-4">
      {/* First Frame / Last Frame - Side by side */}
      <div className="grid grid-cols-2 gap-2">
        <FileUpload
          id="avatar-first-frame-input"
          label="First Frame"
          helperText=""
          fileType="image"
          acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_AVATAR_IMAGE_TYPES}
          maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
          maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
          formatsLabel={UPLOAD_CONSTANTS.AVATAR_IMAGE_FORMATS_LABEL}
          file={avatarImage}
          preview={avatarImagePreview}
          onFileChange={(file, preview) => {
            onAvatarImageChange(file, preview || null);
            if (file) onError(null);
          }}
          onError={onError}
          isCompact={true}
        />
        <FileUpload
          id="avatar-last-frame-input"
          label="Last Frame"
          helperText=""
          fileType="image"
          acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_AVATAR_IMAGE_TYPES}
          maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
          maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
          formatsLabel={UPLOAD_CONSTANTS.AVATAR_IMAGE_FORMATS_LABEL}
          file={avatarLastFrame}
          preview={avatarLastFramePreview}
          onFileChange={(file, preview) => {
            onAvatarLastFrameChange(file, preview || null);
            if (file) onError(null);
          }}
          onError={onError}
          isCompact={true}
        />
      </div>

      {/* Reference Images - 6 slots in 3x2 grid */}
      <div className="space-y-2">
        <Label className="text-xs">Reference Images</Label>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <FileUpload
              key={`reference-${index}`}
              id={`avatar-reference-${index}-input`}
              label={`Ref ${index + 1}`}
              helperText=""
              fileType="image"
              acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_AVATAR_IMAGE_TYPES}
              maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
              maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
              formatsLabel={UPLOAD_CONSTANTS.AVATAR_IMAGE_FORMATS_LABEL}
              file={referenceImages[index]}
              preview={referenceImagePreviews[index]}
              onFileChange={(file, preview) => {
                onReferenceImageChange(index, file, preview || null);
                if (file) onError(null);
              }}
              onError={onError}
              isCompact={true}
            />
          ))}
        </div>
      </div>

      {/* Audio Input */}
      <FileUpload
        id="avatar-audio-input"
        label="Audio Input"
        helperText=""
        fileType="audio"
        acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_AUDIO_TYPES}
        maxSizeBytes={UPLOAD_CONSTANTS.MAX_AUDIO_SIZE_BYTES}
        maxSizeLabel={UPLOAD_CONSTANTS.MAX_AUDIO_SIZE_LABEL}
        formatsLabel={UPLOAD_CONSTANTS.AUDIO_FORMATS_LABEL}
        file={audioFile}
        onFileChange={(file) => {
          onAudioFileChange(file);
          if (file) onError(null);
        }}
        onError={onError}
        isCompact={isCompact}
      />

      {/* Source Video Upload */}
      <FileUpload
        id="avatar-video-input"
        label="Source Video"
        helperText=""
        fileType="video"
        acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES}
        maxSizeBytes={UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_BYTES}
        maxSizeLabel={UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_LABEL}
        formatsLabel={UPLOAD_CONSTANTS.VIDEO_FORMATS_LABEL}
        file={sourceVideo}
        onFileChange={(file) => {
          onSourceVideoChange(file);
          if (file) onError(null);
        }}
        onError={onError}
        isCompact={isCompact}
      />

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
          onChange={(e) => onPromptChange(e.target.value)}
          className="min-h-[40px] text-xs resize-none"
          maxLength={maxChars}
        />
      </div>

      {/* Kling Avatar v2 Options */}
      {klingAvatarV2Selected && (
        <div className="space-y-3 text-left border-t pt-3">
          <Label className="text-sm font-semibold">
            Kling Avatar v2 Options
          </Label>
          <div className="space-y-2">
            <Label
              htmlFor="kling-avatar-v2-prompt"
              className="text-xs text-muted-foreground"
            >
              Animation Prompt (Optional)
            </Label>
            <Textarea
              id="kling-avatar-v2-prompt"
              placeholder="Describe animation style, expressions, or movements..."
              value={klingAvatarV2Prompt}
              onChange={(e) => onKlingAvatarV2PromptChange(e.target.value)}
              className="min-h-[60px] text-xs resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Optional guidance for facial expressions and animation style
            </p>
          </div>
          {audioDuration !== null && (
            <div className="text-xs text-muted-foreground">
              Audio duration: {audioDuration.toFixed(1)}s · Estimated cost: $
              {(
                audioDuration *
                (selectedModels.includes("kling_avatar_v2_pro") ? 0.115 : 0.0562)
              ).toFixed(2)}
            </div>
          )}
          {audioDuration === null && audioFile && (
            <div className="text-xs text-muted-foreground">
              Cost varies by audio length
            </div>
          )}
        </div>
      )}
    </div>
  );
}
