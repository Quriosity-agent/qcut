import { useMediaStore } from "@/stores/media-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useExportStore } from "@/stores/export-store";
import { useStickersOverlayStore } from "@/stores/stickers-overlay-store";

/**
 * Reset all application stores to their initial state
 * Call this in beforeEach() to ensure test isolation
 */
export async function resetAllStores() {
  // Reset media store
  const mediaStore = useMediaStore.getState();
  if (mediaStore.clearAllMedia) {
    mediaStore.clearAllMedia();
  } else {
    // Fallback if action isn't available
    useMediaStore.setState({ mediaItems: [], isLoading: false });
  }

  // Reset timeline store - use proper initialization from actual store
  const timelineStore = useTimelineStore.getState();
  if (timelineStore.clearTimeline) {
    timelineStore.clearTimeline();
  }

  // Reset project store
  useProjectStore.setState({
    activeProject: null,
    savedProjects: [],
    isLoading: true, // match the store's default
    isInitialized: false,
    invalidProjectIds: new Set<string>(), // ensure no residual invalid IDs
  });

  // Reset playback store
  const playbackStore = usePlaybackStore.getState();
  if (typeof playbackStore.pause === "function") {
    playbackStore.pause();
  }
  usePlaybackStore.setState({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    speed: 1.0,
    volume: 1,
    muted: false,
    previousVolume: 1,
  });

  // Reset export store using canonical methods
  const { resetExport, clearHistory } = useExportStore.getState();
  resetExport();
  clearHistory();

  // Reset stickers overlay store
  const stickersStore = useStickersOverlayStore.getState();
  if (stickersStore.clearAllStickers) {
    stickersStore.clearAllStickers();
  }

  // Small delay to ensure async operations complete - reduced for tests
  await new Promise((resolve) => setTimeout(resolve, 1));
}
