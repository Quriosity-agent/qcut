/**
 * Claude Timeline Bridge
 * Connects Electron main process Claude API with renderer's Zustand stores
 */

import { useTimelineStore } from '@/stores/timeline-store';
import { useProjectStore } from '@/stores/project-store';
import { useMediaStore } from '@/stores/media-store';
import type { TimelineElement, TimelineTrack } from '@/types/timeline';
import type { ClaudeTimeline, ClaudeTrack, ClaudeElement } from '../../../../electron/types/claude-api';

/**
 * Calculate effective duration with safe trim handling
 * Guards against undefined trims and negative durations
 */
function getEffectiveDuration(element: TimelineElement): number {
  const trimStart = element.trimStart ?? 0;
  const trimEnd = element.trimEnd ?? 0;
  const effectiveDuration = element.duration - trimStart - trimEnd;
  return Math.max(0, effectiveDuration);
}

/**
 * Calculate total duration from tracks
 */
function calculateTimelineDuration(tracks: TimelineTrack[]): number {
  let maxEndTime = 0;
  for (const track of tracks) {
    for (const element of track.elements) {
      const effectiveDuration = getEffectiveDuration(element);
      const endTime = element.startTime + effectiveDuration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
  }
  return maxEndTime;
}

/**
 * Find track containing an element
 */
function findTrackByElementId(tracks: TimelineTrack[], elementId: string): TimelineTrack | null {
  return tracks.find(track => track.elements.some(e => e.id === elementId)) || null;
}

/**
 * Setup Claude Timeline Bridge
 * Call this once during app initialization
 */
export function setupClaudeTimelineBridge(): void {
  if (!window.electronAPI?.claude?.timeline) {
    console.warn('[ClaudeTimelineBridge] Claude Timeline API not available');
    return;
  }

  const claudeAPI = window.electronAPI.claude.timeline;
  console.log('[ClaudeTimelineBridge] Setting up bridge...');

  // Respond to timeline export request from main process
  claudeAPI.onRequest(() => {
    console.log('[ClaudeTimelineBridge] Received timeline export request');

    const timelineState = useTimelineStore.getState();
    const projectState = useProjectStore.getState();
    const project = projectState.activeProject;
    const tracks = timelineState.tracks;

    const timeline: ClaudeTimeline = {
      name: project?.name || 'Untitled',
      duration: calculateTimelineDuration(tracks),
      width: project?.canvasSize?.width || 1920,
      height: project?.canvasSize?.height || 1080,
      fps: project?.fps || 30,
      tracks: formatTracksForExport(tracks),
    };

    claudeAPI.sendResponse(timeline);
    console.log('[ClaudeTimelineBridge] Sent timeline response');
  });

  // Handle timeline import from Claude
  claudeAPI.onApply((timeline: ClaudeTimeline) => {
    console.log('[ClaudeTimelineBridge] Received timeline to apply:', timeline.name);
    applyTimelineToStore(timeline);
  });

  /**
   * Handle element addition from Claude
   *
   * @stub This handler is intentionally a stub. Adding elements requires:
   * 1. Mapping ClaudeElement types to internal TimelineElement types
   * 2. Resolving media references (mediaId must exist in media store)
   * 3. Determining target track (create new or use existing)
   * 4. Validating element doesn't overlap with existing elements
   */
  claudeAPI.onAddElement((element: Partial<ClaudeElement>) => {
    console.log('[ClaudeTimelineBridge] Adding element:', element);
    console.warn('[ClaudeTimelineBridge] addElement not implemented - requires type mapping');
  });

  /**
   * Handle element update from Claude
   *
   * @stub This handler is intentionally a stub. Updating elements requires:
   * 1. Timeline store to expose an updateElement method
   * 2. Mapping partial ClaudeElement changes to TimelineElement fields
   * 3. Validating changes don't create invalid state (overlaps, negative times)
   */
  claudeAPI.onUpdateElement((data: { elementId: string; changes: Partial<ClaudeElement> }) => {
    console.log('[ClaudeTimelineBridge] Updating element:', data.elementId);
    console.warn('[ClaudeTimelineBridge] updateElement not implemented - needs store method');
  });

  // Handle element removal
  claudeAPI.onRemoveElement((elementId: string) => {
    console.log('[ClaudeTimelineBridge] Removing element:', elementId);
    const timelineStore = useTimelineStore.getState();
    const tracks = timelineStore.tracks;
    
    // Find the track containing this element
    const track = findTrackByElementId(tracks, elementId);
    if (track) {
      timelineStore.removeElementFromTrack(track.id, elementId);
    } else {
      console.warn('[ClaudeTimelineBridge] Could not find track for element:', elementId);
    }
  });

  console.log('[ClaudeTimelineBridge] Bridge setup complete');
}

/**
 * Format internal tracks for Claude export
 */
function formatTracksForExport(tracks: TimelineTrack[]): ClaudeTrack[] {
  return tracks.map((track, index) => ({
    index: index,
    name: track.name || `Track ${index + 1}`,
    type: track.type,
    elements: track.elements.map((element) => formatElementForExport(element, index)),
  }));
}

/**
 * Format a single element for export
 */
function formatElementForExport(element: TimelineElement, trackIndex: number): ClaudeElement {
  const effectiveDuration = getEffectiveDuration(element);

  const baseElement: ClaudeElement = {
    id: element.id,
    trackIndex,
    startTime: element.startTime,
    endTime: element.startTime + effectiveDuration,
    duration: effectiveDuration,
    type: element.type,
  };

  // Add type-specific fields
  switch (element.type) {
    case 'media':
      return {
        ...baseElement,
        sourceId: element.mediaId,
        sourceName: element.name,
      };
    case 'text':
      return {
        ...baseElement,
        content: element.content,
      };
    case 'captions':
      return {
        ...baseElement,
        content: element.text,
      };
    case 'sticker':
      return {
        ...baseElement,
        sourceId: element.stickerId,
      };
    case 'remotion':
      return {
        ...baseElement,
        sourceId: element.componentId,
      };
    default:
      return baseElement;
  }
}

/**
 * Apply imported Claude timeline to store
 *
 * @stub This function is intentionally a stub. Timeline import is a complex
 * operation that requires user confirmation before overwriting existing work.
 * Full implementation is tracked separately and out of scope for this PR.
 *
 * Future implementation will:
 * 1. Validate media references exist in the media store
 * 2. Map Claude elements back to internal TimelineElement types
 * 3. Handle conflicts with existing elements (prompt user)
 * 4. Update timeline store with imported data
 */
function applyTimelineToStore(timeline: ClaudeTimeline): void {
  // Log import details for debugging - helps verify the bridge is working
  console.log('[ClaudeTimelineBridge] Would apply timeline:', {
    name: timeline.name,
    duration: timeline.duration,
    tracks: timeline.tracks.length,
    totalElements: timeline.tracks.reduce((sum, t) => sum + t.elements.length, 0),
  });

  console.warn('[ClaudeTimelineBridge] Timeline import requires user confirmation - not yet implemented');
}

/**
 * Cleanup bridge listeners
 */
export function cleanupClaudeTimelineBridge(): void {
  if (window.electronAPI?.claude?.timeline?.removeListeners) {
    window.electronAPI.claude.timeline.removeListeners();
  }
  console.log('[ClaudeTimelineBridge] Bridge cleanup complete');
}

/**
 * Setup Claude Project Bridge (for stats requests)
 */
export function setupClaudeProjectBridge(): void {
  if (!window.electronAPI?.claude?.project) {
    return;
  }

  const projectAPI = window.electronAPI.claude.project;

  // Respond to stats request
  projectAPI.onStatsRequest(() => {
    const timelineState = useTimelineStore.getState();
    const projectState = useProjectStore.getState();
    const tracks = timelineState.tracks;

    // Count media by type
    const mediaCount = { video: 0, audio: 0, image: 0 };
    let elementCount = 0;
    const mediaItems = useMediaStore.getState().mediaItems;

    for (const track of tracks) {
      elementCount += track.elements.length;
      for (const element of track.elements) {
        if (element.type === 'media') {
          const mediaItem = mediaItems.find(m => m.id === element.mediaId);
          if (mediaItem && mediaItem.type in mediaCount) {
            mediaCount[mediaItem.type]++;
          } else {
            // Fallback to video if media not found
            mediaCount.video++;
          }
        }
      }
    }

    const stats = {
      totalDuration: calculateTimelineDuration(tracks),
      mediaCount,
      trackCount: tracks.length,
      elementCount,
      lastModified: projectState.activeProject?.updatedAt?.getTime() || Date.now(),
      fileSize: 0, // Would need to calculate
    };

    projectAPI.sendStatsResponse(stats);
  });
}

/**
 * Cleanup project bridge listeners
 */
export function cleanupClaudeProjectBridge(): void {
  if (window.electronAPI?.claude?.project?.removeListeners) {
    window.electronAPI.claude.project.removeListeners();
  }
}
