import { useCaptionsStore } from "@/stores/captions-store";

export function resetCaptionsStore(): void {
  const { reset } = useCaptionsStore.getState();
  if (typeof reset === "function") {
    reset();
  } else {
    // Fallback for older store versions
    useCaptionsStore.setState({
      captionTracks: [],
      activeCaptionTrack: null,
      transcriptionJobs: [],
      activeJob: null,
    });
  }
}
