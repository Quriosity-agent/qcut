// Location: apps/web/src/lib/export-analysis.ts

import type { TimelineTrack, MediaElement } from '@/types/timeline';
import type { MediaItem } from '@/stores/media-store-types';

export interface ExportAnalysis {
  needsImageProcessing: boolean;
  hasImageElements: boolean;
  hasTextElements: boolean;
  hasStickers: boolean;
  hasEffects: boolean;
  hasMultipleVideoSources: boolean;
  hasOverlappingVideos: boolean;
  canUseDirectCopy: boolean;
  optimizationStrategy: 'image-pipeline' | 'direct-copy';
  reason: string;
}

/**
 * Analyzes timeline to determine if image processing is required for export
 * @param tracks - Timeline tracks containing all elements
 * @param mediaItems - All media items in the project
 * @returns Analysis result with optimization recommendations
 */
export function analyzeTimelineForExport(
  tracks: TimelineTrack[],
  mediaItems: MediaItem[]
): ExportAnalysis {
  // Create a map for fast media item lookup
  const mediaItemsMap = new Map(mediaItems.map(item => [item.id, item]));

  let hasImageElements = false;
  let hasTextElements = false;
  let hasStickers = false;
  let hasEffects = false;
  let videoElementCount = 0;
  const videoTimeRanges: Array<{ start: number; end: number }> = [];
  const videoElements: MediaElement[] = [];
  let allVideosHaveLocalPath = true;

  // Iterate through all tracks and elements
  for (const track of tracks) {
    for (const element of track.elements) {
      // Skip hidden elements
      if (element.hidden) continue;

      // Check for text elements
      if (element.type === 'text') {
        hasTextElements = true;
        continue;
      }

      // Check for sticker elements
      if (element.type === 'sticker') {
        hasStickers = true;
        continue;
      }

      // Check for media elements (video/image)
      if (element.type === 'media') {
        const mediaElement = element as MediaElement;
        const mediaItem = mediaItemsMap.get(mediaElement.mediaId);

        if (!mediaItem) continue;

        // Check if media item is an image
        if (mediaItem.type === 'image') {
          hasImageElements = true;
        }

        // Track video elements and their time ranges
        if (mediaItem.type === 'video') {
          videoElementCount++;
          const startTime = element.startTime;
          const endTime = element.startTime +
            (element.duration - element.trimStart - element.trimEnd);
          videoTimeRanges.push({ start: startTime, end: endTime });
          videoElements.push(mediaElement);

          // Check if this video has a localPath (required for direct copy)
          if (!mediaItem.localPath) {
            allVideosHaveLocalPath = false;
          }
        }

        // Check for effects on this element
        if (element.effectIds && element.effectIds.length > 0) {
          hasEffects = true;
        }
      }
    }
  }

  // Check for overlapping video elements (requires compositing)
  const hasOverlappingVideos = checkForOverlappingRanges(videoTimeRanges);
  const hasMultipleVideoSources = videoElementCount > 1;

  // Check for overlay stickers (separate from timeline stickers)
  // Note: This check happens at runtime via useStickersOverlayStore.getState()
  // For analysis, we rely on timeline sticker elements

  // Determine if image processing is needed
  const needsImageProcessing =
    hasImageElements ||
    hasTextElements ||
    hasStickers ||
    hasEffects ||
    hasOverlappingVideos;

  // Can use direct copy/concat if:
  // - Single video source with no processing needed, OR
  // - Multiple video sources without overlaps (sequential concatenation) and no processing
  // - No image elements, text overlays, stickers, or effects
  // - All videos have localPath (filesystem access required for FFmpeg)
  const canUseDirectCopy =
    videoElementCount >= 1 &&
    !hasOverlappingVideos &&
    !hasImageElements &&
    !hasTextElements &&
    !hasStickers &&
    !hasEffects &&
    allVideosHaveLocalPath;

  // Determine optimization strategy
  const optimizationStrategy: 'image-pipeline' | 'direct-copy' =
    canUseDirectCopy ? 'direct-copy' : 'image-pipeline';

  // Generate reason for strategy choice
  let reason = '';
  if (canUseDirectCopy) {
    if (videoElementCount === 1) {
      reason = 'Single video with no overlays, effects, or compositing - using direct copy';
    } else {
      reason = 'Sequential videos without overlaps - using FFmpeg concat demuxer';
    }
  } else {
    const reasons: string[] = [];
    if (hasImageElements) reasons.push('image elements');
    if (hasTextElements) reasons.push('text overlays');
    if (hasStickers) reasons.push('stickers');
    if (hasEffects) reasons.push('effects');
    if (hasOverlappingVideos) reasons.push('overlapping videos');
    if (!allVideosHaveLocalPath) reasons.push('videos without filesystem paths');
    reason = `Image processing required due to: ${reasons.join(', ')}`;
  }

  // Log localPath validation for debugging
  console.log('🔍 [EXPORT ANALYSIS] Video localPath validation:', {
    totalVideos: videoElementCount,
    videosWithLocalPath: videoElements.filter(el => {
      const media = mediaItemsMap.get(el.mediaId);
      return media?.localPath;
    }).length,
    allHaveLocalPath: allVideosHaveLocalPath
  });

  if (!allVideosHaveLocalPath && videoElementCount > 0) {
    console.log('⚠️ [EXPORT ANALYSIS] Some videos lack localPath - direct copy disabled');
    const videosWithoutLocalPath = videoElements
      .filter(el => {
        const media = mediaItemsMap.get(el.mediaId);
        return !media?.localPath;
      })
      .map(el => {
        const media = mediaItemsMap.get(el.mediaId);
        return {
          elementId: el.id,
          mediaId: media?.id,
          hasUrl: !!media?.url,
          urlType: media?.url?.substring(0, 20)
        };
      });
    console.log('📝 [EXPORT ANALYSIS] Videos without localPath:', videosWithoutLocalPath);
  }

  // Log detailed analysis results
  console.log('📊 [EXPORT ANALYSIS] Complete analysis result:', {
    videoElementCount,
    hasOverlappingVideos,
    hasImageElements,
    hasTextElements,
    hasStickers,
    hasEffects,
    allVideosHaveLocalPath,
    canUseDirectCopy,
    optimizationStrategy,
    reason
  });

  // Log video elements with trim information
  if (videoElementCount > 0) {
    const videoTrimInfo = videoElements.map(el => {
      const media = mediaItemsMap.get(el.mediaId);
      return {
        elementId: el.id,
        hasTrim: el.trimStart > 0 || el.trimEnd > 0,
        trimStart: el.trimStart,
        trimEnd: el.trimEnd,
        duration: el.duration,
        effectiveDuration: el.duration - el.trimStart - el.trimEnd,
        hasLocalPath: !!media?.localPath,
        localPath: media?.localPath?.substring(media.localPath.lastIndexOf('\\') + 1) || 'NONE'
      };
    });
    console.log('🎬 [EXPORT ANALYSIS] Video elements with trim info:', videoTrimInfo);
  }

  if (canUseDirectCopy) {
    console.log('✅ [EXPORT ANALYSIS] Using DIRECT COPY optimization - Fast export! 🚀');
  } else {
    console.log('⚠️ [EXPORT ANALYSIS] Using IMAGE PIPELINE - Slow export (frame-by-frame)');
  }

  return {
    needsImageProcessing,
    hasImageElements,
    hasTextElements,
    hasStickers,
    hasEffects,
    hasMultipleVideoSources,
    hasOverlappingVideos,
    canUseDirectCopy,
    optimizationStrategy,
    reason
  };
}

/**
 * Checks if any video time ranges overlap (indicates need for compositing)
 */
function checkForOverlappingRanges(ranges: Array<{ start: number; end: number }>): boolean {
  if (ranges.length < 2) return false;

  // Sort ranges by start time
  const sortedRanges = [...ranges].sort((a, b) => a.start - b.start);

  // Check for overlaps
  for (let i = 0; i < sortedRanges.length - 1; i++) {
    const current = sortedRanges[i];
    const next = sortedRanges[i + 1];

    // If current range ends after next range starts, they overlap
    if (current.end > next.start) {
      return true;
    }
  }

  return false;
}
