import type { AIActiveTab } from "../types/ai-types";

interface AIValidationMessagesProps {
  activeTab: AIActiveTab;
  selectedModels: string[];
  prompt: string;
  selectedImage: File | null;
  hasVeo31FrameToVideo: boolean;
  firstFrame: File | null;
  lastFrame: File | null;
  avatarImage: File | null;
  syncLipsyncSourceVideo: File | null;
  audioFile: File | null;
}

export function AIValidationMessages({
  activeTab,
  selectedModels,
  prompt,
  selectedImage,
  hasVeo31FrameToVideo,
  firstFrame,
  lastFrame,
  avatarImage,
  syncLipsyncSourceVideo,
  audioFile,
}: AIValidationMessagesProps) {
  return (
    <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-md">
      <div className="text-xs text-orange-600 dark:text-orange-400 space-y-1">
        {activeTab === "text" && !prompt.trim() && (
          <div>Please enter a prompt to generate video</div>
        )}
        {activeTab === "image" && !selectedImage && !hasVeo31FrameToVideo && (
          <div>Please upload an image for video generation</div>
        )}
        {activeTab === "image" && hasVeo31FrameToVideo && !firstFrame && (
          <div>Please upload the first frame (required for frame-to-video)</div>
        )}
        {activeTab === "image" && hasVeo31FrameToVideo && !lastFrame && (
          <div>Please upload the last frame (required for frame-to-video)</div>
        )}
        {activeTab === "avatar" &&
          !avatarImage &&
          !selectedModels.includes("sync_lipsync_react1") &&
          !selectedModels.some(
            (id) =>
              id === "kling_o1_v2v_reference" ||
              id === "kling_o1_v2v_edit" ||
              id === "kling_o1_ref2video"
          ) && <div>Please upload a character image</div>}
        {activeTab === "avatar" &&
          selectedModels.includes("sync_lipsync_react1") &&
          !syncLipsyncSourceVideo && <div>Please upload a source video</div>}
        {activeTab === "avatar" &&
          selectedModels.includes("sync_lipsync_react1") &&
          !audioFile && <div>Please upload an audio file</div>}
      </div>
    </div>
  );
}
