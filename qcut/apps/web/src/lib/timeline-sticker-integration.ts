/**
 * Timeline-Sticker Integration Module
 *
 * This module provides a clean, modular interface for integrating
 * overlay stickers with the timeline system. It handles:
 * - Track creation and management
 * - Sticker-to-timeline element conversion
 * - State synchronization between stores
 *
 * Design principles:
 * - Single responsibility: Only handles timeline integration
 * - Defensive programming: Validates all inputs and states
 * - Async-safe: Properly handles dynamic imports and state updates
 * - Maintainable: Clear separation of concerns with detailed logging
 */

import { debugLog, debugError } from "@/lib/debug-config";
import type { OverlaySticker } from "@/types/sticker-overlay";

export interface TimelineIntegrationResult {
  success: boolean;
  trackId?: string;
  elementId?: string;
  error?: string;
}

/**
 * Configuration for timeline sticker integration
 */
export interface TimelineIntegrationConfig {
  enableLogging?: boolean;
  autoCreateTrack?: boolean;
  trackName?: string;
}

const DEFAULT_CONFIG: TimelineIntegrationConfig = {
  enableLogging: true,
  autoCreateTrack: true,
  trackName: "Sticker Track",
};

/**
 * Main integration class for timeline-sticker synchronization
 */
export class TimelineStickerIntegration {
  private config: TimelineIntegrationConfig;

  constructor(config: Partial<TimelineIntegrationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Adds a sticker to the timeline with proper error handling and state management
   */
  async addStickerToTimeline(
    sticker: OverlaySticker
  ): Promise<TimelineIntegrationResult> {
    try {
      // Validate input
      if (!this.validateSticker(sticker)) {
        return {
          success: false,
          error: "Invalid sticker data: missing required fields",
        };
      }

      // Dynamically import timeline store to avoid circular dependencies
      const { useTimelineStore } = await import("@/stores/timeline-store");

      // Get or create sticker track
      const trackResult = await this.ensureStickerTrack(useTimelineStore);
      if (!trackResult.success || !trackResult.trackId) {
        return trackResult;
      }

      // Add sticker element to track
      const elementResult = await this.addStickerElement(
        useTimelineStore,
        trackResult.trackId,
        sticker
      );

      return elementResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      debugError(
        "[TimelineIntegration] Failed to add sticker to timeline:",
        error
      );
      return {
        success: false,
        error: `Timeline integration failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Validates that a sticker has all required fields for timeline integration
   */
  private validateSticker(sticker: OverlaySticker): boolean {
    if (!sticker.id || !sticker.mediaItemId) {
      if (this.config.enableLogging) {
        console.warn(
          "[TimelineIntegration] Invalid sticker: missing id or mediaItemId"
        );
      }
      return false;
    }

    if (
      !sticker.timing ||
      sticker.timing.startTime === undefined ||
      sticker.timing.endTime === undefined
    ) {
      if (this.config.enableLogging) {
        console.warn(
          "[TimelineIntegration] Invalid sticker: missing or invalid timing"
        );
      }
      return false;
    }

    const duration = sticker.timing.endTime - sticker.timing.startTime;
    if (duration <= 0) {
      if (this.config.enableLogging) {
        console.warn(
          `[TimelineIntegration] Invalid sticker: non-positive duration (${duration}s)`
        );
      }
      return false;
    }

    return true;
  }

  /**
   * Ensures a sticker track exists in the timeline
   */
  private async ensureStickerTrack(
    useTimelineStore: any
  ): Promise<TimelineIntegrationResult> {
    try {
      // Get current state
      let store = useTimelineStore.getState();

      // Check for existing sticker track
      let stickerTrack = this.findStickerTrack(store);

      if (stickerTrack) {
        if (this.config.enableLogging) {
          debugLog(
            `[TimelineIntegration] Found existing sticker track: ${stickerTrack.id}`
          );
        }
        return {
          success: true,
          trackId: stickerTrack.id,
        };
      }

      // Create new track if enabled
      if (!this.config.autoCreateTrack) {
        return {
          success: false,
          error: "No sticker track found and auto-creation is disabled",
        };
      }

      if (this.config.enableLogging) {
        console.log("[TimelineIntegration] Creating new sticker track...");
      }

      // Create the track
      const trackId = store.addTrack("sticker");

      if (!trackId) {
        return {
          success: false,
          error: "Failed to create sticker track - addTrack returned null",
        };
      }

      // Wait a tick for state to update (Zustand batching)
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Verify track was created by getting fresh state
      store = useTimelineStore.getState();
      stickerTrack = this.findStickerTrackById(store, trackId);

      if (!stickerTrack) {
        // Try one more time with a longer delay
        await new Promise((resolve) => setTimeout(resolve, 100));
        store = useTimelineStore.getState();
        stickerTrack = this.findStickerTrackById(store, trackId);
      }

      if (stickerTrack) {
        if (this.config.enableLogging) {
          console.log(
            `[TimelineIntegration] Successfully created sticker track: ${trackId}`
          );
        }
        return {
          success: true,
          trackId,
        };
      }
      return {
        success: false,
        error: `Track created but not found in state. ID: ${trackId}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to ensure sticker track: ${errorMessage}`,
      };
    }
  }

  /**
   * Finds a sticker track in the timeline store
   */
  private findStickerTrack(store: any): any {
    // Check sorted tracks first
    let track = store.tracks?.find((t: any) => t.type === "sticker");

    // Fallback to _tracks if not found in sorted
    if (!track && store._tracks) {
      track = store._tracks.find((t: any) => t.type === "sticker");
    }

    return track;
  }

  /**
   * Finds a track by ID in the timeline store
   */
  private findStickerTrackById(store: any, trackId: string): any {
    // Check sorted tracks first
    let track = store.tracks?.find((t: any) => t.id === trackId);

    // Fallback to _tracks if not found in sorted
    if (!track && store._tracks) {
      track = store._tracks.find((t: any) => t.id === trackId);
    }

    return track;
  }

  /**
   * Adds a sticker element to a timeline track
   */
  private async addStickerElement(
    useTimelineStore: any,
    trackId: string,
    sticker: OverlaySticker
  ): Promise<TimelineIntegrationResult> {
    try {
      const store = useTimelineStore.getState();
      const duration = sticker.timing!.endTime! - sticker.timing!.startTime!;

      // Create timeline element from sticker
      const element = {
        type: "sticker" as const,
        stickerId: sticker.id,
        mediaId: sticker.mediaItemId,
        name: `Sticker ${Date.now()}`, // Unique name
        duration,
        startTime: sticker.timing!.startTime,
        trimStart: 0,
        trimEnd: 0,
      };

      if (this.config.enableLogging) {
        console.log(
          `[TimelineIntegration] Adding sticker element to track ${trackId}:`,
          {
            duration: `${duration}s`,
            startTime: element.startTime,
            stickerId: sticker.id,
          }
        );
      }

      // Add element to track
      const success = store.addElementToTrack(trackId, element);

      if (success) {
        if (this.config.enableLogging) {
          console.log(
            "[TimelineIntegration] ✅ Successfully added sticker to timeline track"
          );
        }
        return {
          success: true,
          trackId,
          elementId: sticker.id,
        };
      }
      return {
        success: false,
        error: "addElementToTrack returned false",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to add sticker element: ${errorMessage}`,
      };
    }
  }

  /**
   * Removes a sticker from the timeline
   */
  async removeStickerFromTimeline(
    stickerId: string
  ): Promise<TimelineIntegrationResult> {
    try {
      const { useTimelineStore } = await import("@/stores/timeline-store");
      const store = useTimelineStore.getState();

      // Find the sticker element in any track
      for (const track of store.tracks) {
        const element = track.elements.find(
          (el: any) => el.type === "sticker" && el.stickerId === stickerId
        );

        if (element) {
          store.removeElementFromTrack(track.id, element.id);

          if (this.config.enableLogging) {
            debugLog(
              `[TimelineIntegration] Removed sticker ${stickerId} from timeline`
            );
          }

          return {
            success: true,
            trackId: track.id,
            elementId: element.id,
          };
        }
      }

      return {
        success: false,
        error: `Sticker ${stickerId} not found in timeline`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Failed to remove sticker from timeline: ${errorMessage}`,
      };
    }
  }
}

// Export singleton instance for convenience
export const timelineStickerIntegration = new TimelineStickerIntegration();

// Export function for backward compatibility
export async function addStickerToTimeline(
  sticker: OverlaySticker
): Promise<TimelineIntegrationResult> {
  return timelineStickerIntegration.addStickerToTimeline(sticker);
}
