/**
 * Track Operations
 *
 * Operations for managing timeline tracks (add, insert, remove).
 * Uses OperationContext pattern for decoupling from Zustand.
 */

import type { TimelineTrack, TrackType } from "@/types/timeline";
import { checkElementOverlaps, resolveElementOverlaps } from "@/lib/timeline";
import type { OperationContext } from "./types";
import { createTrack, getElementEndTime } from "./utils";

/**
 * Add a new track of the specified type to the timeline
 * @param ctx - Operation context
 * @param type - Type of track to add
 * @returns The ID of the newly created track
 */
export function addTrackOperation(
  ctx: OperationContext,
  type: TrackType
): string {
  ctx.pushHistory();
  const newTrack = createTrack(type);
  ctx.updateTracksAndSave([...ctx.getTracks(), newTrack]);
  return newTrack.id;
}

/**
 * Insert a new track at a specific index position
 * @param ctx - Operation context
 * @param type - Type of track to insert
 * @param index - Position to insert the track at
 * @returns The ID of the newly created track
 */
export function insertTrackAtOperation(
  ctx: OperationContext,
  type: TrackType,
  index: number
): string {
  ctx.pushHistory();
  const newTrack = createTrack(type);
  const newTracks = [...ctx.getTracks()];
  const clampedIndex = Math.min(Math.max(0, index), newTracks.length);
  newTracks.splice(clampedIndex, 0, newTrack);
  ctx.updateTracksAndSave(newTracks);
  return newTrack.id;
}

/**
 * Remove a track from the timeline (simple case without ripple)
 * @param ctx - Operation context
 * @param trackId - ID of the track to remove
 */
export function removeTrackSimpleOperation(
  ctx: OperationContext,
  trackId: string
): void {
  ctx.pushHistory();

  // Clear selection for elements on the removed track to avoid dangling references
  for (const sel of ctx.getSelectedElements()) {
    if (sel.trackId === trackId) {
      ctx.deselectElement(sel.trackId, sel.elementId);
    }
  }

  ctx.updateTracksAndSave(
    ctx.getTracks().filter((track) => track.id !== trackId)
  );
}

/**
 * Remove a track with ripple editing (shifts subsequent elements)
 * @param ctx - Operation context
 * @param trackId - ID of the track to remove
 */
export function removeTrackWithRippleOperation(
  ctx: OperationContext,
  trackId: string
): void {
  const tracks = ctx.getTracks();
  const trackToRemove = tracks.find((t) => t.id === trackId);

  if (!trackToRemove) return;

  ctx.pushHistory();

  // Clear selection for elements on the removed track to avoid dangling references
  for (const sel of ctx.getSelectedElements()) {
    if (sel.trackId === trackId) {
      ctx.deselectElement(sel.trackId, sel.elementId);
    }
  }

  // If track has no elements, just remove it normally
  if (trackToRemove.elements.length === 0) {
    ctx.updateTracksAndSave(tracks.filter((track) => track.id !== trackId));
    return;
  }

  // Find all the time ranges occupied by elements in the track being removed
  const occupiedRanges = trackToRemove.elements.map((element) => ({
    startTime: element.startTime,
    endTime: getElementEndTime(element),
  }));

  // Sort ranges by start time
  occupiedRanges.sort((a, b) => a.startTime - b.startTime);

  // Merge overlapping ranges to get consolidated gaps
  const mergedRanges: Array<{
    startTime: number;
    endTime: number;
    duration: number;
  }> = [];

  for (const range of occupiedRanges) {
    if (mergedRanges.length === 0) {
      mergedRanges.push({
        startTime: range.startTime,
        endTime: range.endTime,
        duration: range.endTime - range.startTime,
      });
    } else {
      const lastRange = mergedRanges[mergedRanges.length - 1];
      if (range.startTime <= lastRange.endTime) {
        // Overlapping or adjacent ranges, merge them
        lastRange.endTime = Math.max(lastRange.endTime, range.endTime);
        lastRange.duration = lastRange.endTime - lastRange.startTime;
      } else {
        // Non-overlapping range, add as new
        mergedRanges.push({
          startTime: range.startTime,
          endTime: range.endTime,
          duration: range.endTime - range.startTime,
        });
      }
    }
  }

  // Remove the track and apply ripple effects to remaining tracks
  const updatedTracks = tracks
    .filter((track) => track.id !== trackId)
    .map((track) => {
      const updatedElements = track.elements.map((element) => {
        let newStartTime = element.startTime;

        // Process gaps from right to left (latest to earliest) to avoid cumulative shifts
        for (let i = mergedRanges.length - 1; i >= 0; i--) {
          const gap = mergedRanges[i];
          // If this element starts after the gap, shift it left by the gap duration
          if (newStartTime >= gap.endTime) {
            newStartTime -= gap.duration;
          }
        }

        return {
          ...element,
          startTime: Math.max(0, newStartTime),
        };
      });

      // Check for overlaps and resolve them if necessary
      const hasOverlaps = checkElementOverlaps(updatedElements);
      if (hasOverlaps) {
        const resolvedElements = resolveElementOverlaps(updatedElements);
        return { ...track, elements: resolvedElements };
      }

      return { ...track, elements: updatedElements };
    });

  ctx.updateTracksAndSave(updatedTracks);
}

/**
 * Find an existing track of the specified type, or create a new one
 * Note: Text tracks always create a new track at index 0
 * @param ctx - Operation context
 * @param trackType - Type of track to find or create
 * @param insertTrackAt - Function to insert a new track at a specific index
 * @param addTrack - Function to add a new track
 * @returns The ID of the found or newly created track
 */
export function findOrCreateTrackOperation(
  ctx: OperationContext,
  trackType: TrackType,
  insertTrackAt: (type: TrackType, index: number) => string,
  addTrack: (type: TrackType) => string
): string {
  // Always create new text track to allow multiple text elements
  // Insert text tracks at the top
  if (trackType === "text") {
    return insertTrackAt(trackType, 0);
  }

  const existingTrack = ctx.getTracks().find((t) => t.type === trackType);
  if (existingTrack) {
    return existingTrack.id;
  }

  return addTrack(trackType);
}
