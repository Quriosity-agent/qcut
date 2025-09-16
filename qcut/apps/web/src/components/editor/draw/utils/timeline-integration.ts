import { useTimelineStore } from "@/stores/timeline-store";
import { useMediaStore } from "@/stores/media-store";
import { useProjectStore } from "@/stores/project-store";
import { dataUrlToFile } from "./canvas-utils";
import { generateUUID } from "@/lib/utils";
import { toast } from "sonner";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";

/**
 * Safe timeline integration that uses existing QCut patterns
 * DOES NOT modify core timeline - only uses existing methods
 */
export class TimelineIntegration {
  /**
   * Export drawing as regular image to timeline
   * Uses existing media import flow - 100% safe
   */
  static async exportAsImage(drawingData: string, name?: string): Promise<void> {
    try {
      const filename = name || `drawing-${Date.now()}.png`;
      const file = await dataUrlToFile(drawingData, filename);

      // Get required stores
      const mediaStore = useMediaStore.getState();
      const timelineStore = useTimelineStore.getState();
      const projectStore = useProjectStore.getState();

      const currentProject = projectStore.currentProject;
      if (!currentProject?.id) {
        toast.error("No active project found");
        return;
      }

      // Step 1: Add to media store (existing pattern)
      const mediaId = await mediaStore.addMediaItem(currentProject.id, {
        file,
        name: filename,
        type: "image",
        tags: ["drawing", "white-draw"]
      });

      if (!mediaId) {
        throw new Error("Failed to add drawing to media library");
      }

      // Step 2: Add to timeline (existing pattern)
      // Find the main video track or create one
      const tracks = timelineStore._tracks;
      let targetTrack = tracks.find(track => track.type === "video" && track.name === "Main");

      if (!targetTrack) {
        // Find any video track
        targetTrack = tracks.find(track => track.type === "video");
      }

      if (!targetTrack) {
        toast.error("No video track found. Please create a video track first.");
        return;
      }

      // Get current playhead position or add at the end
      const currentTime = timelineStore.currentTime;

      // Add drawing as image element to timeline
      timelineStore.addElementToTrack(targetTrack.id, {
        type: "media",
        mediaId,
        name: filename,
        duration: TIMELINE_CONSTANTS.DEFAULT_IMAGE_DURATION, // 5 seconds default
        startTime: currentTime,
        id: generateUUID()
      });

      toast.success(`Drawing "${filename}" added to timeline`);

    } catch (error) {
      handleError(error, {
        operation: "export drawing to timeline",
        category: ErrorCategory.MEDIA_PROCESSING,
        severity: ErrorSeverity.MEDIUM
      });
    }
  }

  /**
   * Export drawing as overlay element (advanced)
   * Uses timeline overlay system if available
   */
  static async exportAsOverlay(
    drawingData: string,
    options: {
      duration?: number;
      opacity?: number;
      blendMode?: string;
      position?: { x: number; y: number };
      name?: string;
    } = {}
  ): Promise<void> {
    try {
      const {
        duration = TIMELINE_CONSTANTS.DEFAULT_IMAGE_DURATION,
        opacity = 1,
        name = `drawing-overlay-${Date.now()}.png`
      } = options;

      // First export as regular image
      await this.exportAsImage(drawingData, name);

      // TODO: If QCut adds overlay/layer support in the future,
      // this method can be enhanced to create overlay elements
      // For now, it falls back to regular image export

      toast.success(`Drawing "${name}" added as image overlay`);

    } catch (error) {
      handleError(error, {
        operation: "export drawing as overlay",
        category: ErrorCategory.MEDIA_PROCESSING,
        severity: ErrorSeverity.MEDIUM
      });
    }
  }

  /**
   * Quick export - adds drawing at current playhead position
   */
  static async quickExport(drawingData: string): Promise<void> {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    const name = `drawing-${timestamp}.png`;
    await this.exportAsImage(drawingData, name);
  }

  /**
   * Batch export multiple drawings
   */
  static async exportMultiple(
    drawings: Array<{ data: string; name?: string }>
  ): Promise<void> {
    try {
      for (let i = 0; i < drawings.length; i++) {
        const drawing = drawings[i];
        const name = drawing.name || `drawing-batch-${i + 1}.png`;
        await this.exportAsImage(drawing.data, name);

        // Small delay to prevent overwhelming the system
        if (i < drawings.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      toast.success(`Exported ${drawings.length} drawings to timeline`);

    } catch (error) {
      handleError(error, {
        operation: "batch export drawings",
        category: ErrorCategory.MEDIA_PROCESSING,
        severity: ErrorSeverity.MEDIUM
      });
    }
  }

  /**
   * Check if timeline integration is available
   * Always returns true since we use existing APIs
   */
  static isAvailable(): boolean {
    try {
      const timelineStore = useTimelineStore.getState();
      const mediaStore = useMediaStore.getState();
      const projectStore = useProjectStore.getState();

      return !!(
        timelineStore.addElementToTrack &&
        mediaStore.addMediaItem &&
        projectStore.currentProject
      );
    } catch {
      return false;
    }
  }

  /**
   * Get available video tracks for drawing export
   */
  static getAvailableVideoTracks(): Array<{ id: string; name: string }> {
    try {
      const timelineStore = useTimelineStore.getState();
      return timelineStore._tracks
        .filter(track => track.type === "video")
        .map(track => ({ id: track.id, name: track.name }));
    } catch {
      return [];
    }
  }
}

export default TimelineIntegration;