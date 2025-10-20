// Location: apps/web/src/lib/export-analysis.ts

import type { TimelineTrack, MediaElement } from '@/types/timeline';
import type { MediaItem } from '@/stores/media-store-types';

/**
 * Analysis result determining export optimization strategy.
 * Direct copy is 15-48x faster but requires specific conditions.
 */
export interface ExportAnalysis {
  /** Requires frame-by-frame rendering (slow path) */
  needsImageProcessing: boolean;
  /** Requires frame rendering (images/overlapping videos need canvas compositing) */
  needsFrameRendering: boolean;
  /** Requires FFmpeg filter encoding (text/stickers can use filters instead of frames) */
  needsFilterEncoding: boolean;
  /** Contains static images requiring canvas compositing */
  hasImageElements: boolean;
  /** Contains text overlays requiring canvas rendering */
  hasTextElements: boolean;
  /** Contains stickers requiring canvas compositing */
  hasStickers: boolean;
  /** Contains visual effects requiring FFmpeg filters */
  hasEffects: boolean;
  /** Multiple videos that may need concatenation */
  hasMultipleVideoSources: boolean;
  /** Videos overlap in time; requires compositing, not concat */
  hasOverlappingVideos: boolean;
  /** Can use FFmpeg direct copy/concat (fast path) */
  canUseDirectCopy: boolean;
  /** Which export pipeline to use */
  optimizationStrategy:
    | 'image-pipeline'
    | 'direct-copy'
    | 'direct-video-with-filters'
    | 'video-normalization';
  /** Human-readable explanation of strategy choice */
  reason: string;
}

/**
 * Optional export canvas properties supplied by the export engine.
 * Width/height come from export settings; fps is often a fixed project value.
 */
export interface ExportCanvasOptions {
  width?: number;
  height?: number;
  fps?: number;
}

type CanvasSettingSource = 'export-settings' | 'media-fallback' | 'default';

interface ResolvedCanvasSettings {
  width: number;
  height: number;
  fps: number;
  source: CanvasSettingSource;
}

function resolveExportCanvasSettings(params: {
  exportSettings?: ExportCanvasOptions | null;
  fallbackWidth?: number | null;
  fallbackHeight?: number | null;
  fallbackFps?: number | null;
}): ResolvedCanvasSettings {
  const { exportSettings, fallbackWidth, fallbackHeight, fallbackFps } = params;

  const exportWidth = exportSettings?.width;
  const exportHeight = exportSettings?.height;
  const exportFps = exportSettings?.fps;

  const hasExportDimensions =
    typeof exportWidth === 'number' &&
    exportWidth > 0 &&
    typeof exportHeight === 'number' &&
    exportHeight > 0;
  const hasExportFps = typeof exportFps === 'number' && exportFps > 0;

  const resolvedWidth = hasExportDimensions
    ? exportWidth!
    : typeof fallbackWidth === 'number' && fallbackWidth > 0
      ? fallbackWidth
      : 1280;

  const resolvedHeight = hasExportDimensions
    ? exportHeight!
    : typeof fallbackHeight === 'number' && fallbackHeight > 0
      ? fallbackHeight
      : 720;

  const resolvedFps = hasExportFps
    ? exportFps!
    : typeof fallbackFps === 'number' && fallbackFps > 0
      ? fallbackFps
      : 30;

  const source: CanvasSettingSource = hasExportDimensions
    ? 'export-settings'
    : typeof fallbackWidth === 'number' && typeof fallbackHeight === 'number'
      ? 'media-fallback'
      : 'default';

  return {
    width: resolvedWidth,
    height: resolvedHeight,
    fps: resolvedFps,
    source
  };
}

/**
 * Video metadata used to determine when normalization is required.
 */
export interface VideoProperties {
  width: number;
  height: number;
  fps: number;
  codec?: string;
  pixelFormat?: string;
}

/**
 * Extracts the intrinsic video properties for a media element.
 */
function extractVideoProperties(
  element: MediaElement,
  mediaItemsMap: Map<string, MediaItem>
): VideoProperties | null {
  const mediaItem = mediaItemsMap.get(element.mediaId);

  if (!mediaItem || mediaItem.type !== 'video') {
    return null;
  }

  const metadata = mediaItem.metadata as Record<string, any> | undefined;

  const width =
    typeof mediaItem.width === 'number' && mediaItem.width > 0
      ? mediaItem.width
      : typeof metadata?.width === 'number' && metadata.width > 0
        ? metadata.width
        : undefined;
  const height =
    typeof mediaItem.height === 'number' && mediaItem.height > 0
      ? mediaItem.height
      : typeof metadata?.height === 'number' && metadata.height > 0
        ? metadata.height
        : undefined;
  const fps =
    typeof mediaItem.fps === 'number' && mediaItem.fps > 0
      ? mediaItem.fps
      : typeof metadata?.fps === 'number' && metadata.fps > 0
        ? metadata.fps
        : typeof metadata?.video?.fps === 'number' && metadata.video.fps > 0
          ? metadata.video.fps
          : undefined;

  if (!width || !height || !fps) {
    return null;
  }

  const codec =
    typeof metadata?.video?.codec === 'string'
      ? metadata.video.codec
      : typeof metadata?.codec === 'string'
        ? metadata.codec
        : undefined;
  const pixelFormat =
    typeof metadata?.video?.pixelFormat === 'string'
      ? metadata.video.pixelFormat
      : typeof metadata?.pixelFormat === 'string'
        ? metadata.pixelFormat
        : undefined;

  return {
    width,
    height,
    fps,
    codec,
    pixelFormat
  };
}

/**
 * Checks if all videos match the target export properties.
 *
 * WHY this check is critical:
 * - Mode 1 direct copy requires identical video properties
 * - Mismatches cause FFmpeg concat demuxer to fail
 * - Mode 1.5 normalization can fix mismatches (5-7x faster than Mode 3)
 *
 * Edge cases handled:
 * - Missing metadata: Returns false (triggers normalization)
 * - FPS tolerance: Uses 0.1 fps tolerance for floating point comparison
 * - Null properties: Treats as mismatch to ensure safe fallback
 *
 * @param videoElements - Array of video elements from timeline
 * @param mediaItemsMap - Map of media items for fast lookup
 * @param targetWidth - Export target width
 * @param targetHeight - Export target height
 * @param targetFps - Export target fps
 * @returns true if all videos match export settings, false if normalization needed
 */
function checkVideoPropertiesMatch(
  videoElements: MediaElement[],
  mediaItemsMap: Map<string, MediaItem>,
  targetWidth: number,
  targetHeight: number,
  targetFps: number
): boolean {
  console.log('🔍 [MODE 1.5 DETECTION] Checking video properties...');
  console.log(`🔍 [MODE 1.5 DETECTION] Target: ${targetWidth}x${targetHeight} @ ${targetFps}fps`);

  // Edge case: No videos to check
  if (videoElements.length === 0) {
    console.log('⚠️ [MODE 1.5 DETECTION] No video elements to check');
    return true; // No videos = no mismatches
  }

  // Check each video against export settings
  for (let i = 0; i < videoElements.length; i++) {
    const props = extractVideoProperties(videoElements[i], mediaItemsMap);

    // Missing metadata = needs normalization
    if (!props) {
      console.log(`⚠️ [MODE 1.5 DETECTION] Video ${i}: No properties found - triggering normalization`);
      return false;
    }

    console.log(`🔍 [MODE 1.5 DETECTION] Video ${i}: ${props.width}x${props.height} @ ${props.fps}fps`);

    // Resolution must match exactly
    if (props.width !== targetWidth || props.height !== targetHeight) {
      console.log(`⚠️ [MODE 1.5 DETECTION] Video ${i} resolution mismatch - normalization needed`);
      console.log(`   Expected: ${targetWidth}x${targetHeight}, Got: ${props.width}x${props.height}`);
      return false;
    }

    // FPS comparison with tolerance (floating point safety)
    const fpsTolerance = 0.1;
    const fpsDiff = Math.abs(props.fps - targetFps);
    if (fpsDiff > fpsTolerance) {
      console.log(`⚠️ [MODE 1.5 DETECTION] Video ${i} FPS mismatch - normalization needed`);
      console.log(`   Expected: ${targetFps}fps, Got: ${props.fps}fps, Diff: ${fpsDiff.toFixed(2)}fps`);
      return false;
    }
  }

  console.log('✅ [MODE 1.5 DETECTION] All videos match export settings - can use direct copy');
  return true;
}

/**
 * Analyzes timeline to determine optimal export strategy for performance.
 *
 * WHY this analysis matters:
 * - Mode 1 (direct copy) is 15-48x faster than frame rendering
 * - Mode 2 (direct video + filters) is 3-5x faster than frame rendering
 * - Mode 3 (frame rendering) is the slowest but most flexible
 *
 * Performance implications:
 * - Frame rendering: ~5-10s for typical 2s video (slow)
 * - Direct copy: ~0.1-0.5s (extremely fast)
 * - Direct video + filters: ~1-2s (fast)
 *
 * Edge cases handled:
 * - Videos without localPath (blob URLs) cannot use direct modes
 * - Overlapping videos require compositing (Mode 3 only)
 * - Trimmed videos are supported in all modes
 *
 * @param tracks - Timeline tracks containing all elements
 * @param mediaItems - All media items in the project
 * @returns Analysis result with optimization strategy and reasoning
 */
export function analyzeTimelineForExport(
  tracks: TimelineTrack[],
  mediaItems: MediaItem[],
  exportCanvas?: ExportCanvasOptions
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
          const effectiveDuration = element.duration - element.trimStart - element.trimEnd;

          // Validate effective duration is positive
          if (effectiveDuration <= 0) {
            console.warn(`[EXPORT ANALYSIS] Invalid video duration for element ${element.id}: duration=${element.duration}, trimStart=${element.trimStart}, trimEnd=${element.trimEnd}`);
            continue; // Skip this element
          }

          const startTime = element.startTime;
          const endTime = element.startTime + effectiveDuration;
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

  // Separate frame rendering (canvas compositing) from filter encoding (FFmpeg filters)
  const needsFrameRendering =
    hasImageElements ||           // Images require canvas compositing
    hasOverlappingVideos;         // Multiple videos require compositing
    // Note: Effects analysis pending - for now assume all effects need frame rendering

  const needsFilterEncoding =
    hasTextElements ||            // Text uses FFmpeg drawtext
    hasStickers;                  // Stickers use FFmpeg overlay
    // Note: Effects can be added here once FFmpeg-compatible effects are identified

  const needsImageProcessing =
    needsFrameRendering ||
    needsFilterEncoding ||
    hasEffects;

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
  let optimizationStrategy:
    | 'image-pipeline'
    | 'direct-copy'
    | 'direct-video-with-filters'
    | 'video-normalization';

  // Mode decision tree (priority order):
  // 1. Can we use direct copy? (Mode 1 - fastest)
  // 2. Single video with filters? (Mode 2 - fast)
  // 3. Multiple videos that need normalization? (Mode 1.5 - NEW!, medium-fast)
  // 4. Default to frame rendering (Mode 3 - slow but most flexible)

  if (canUseDirectCopy) {
    // Mode 1: Direct copy - fastest path (no re-encoding)
    optimizationStrategy = 'direct-copy';
    console.log('✅ [MODE DETECTION] Selected Mode 1: Direct copy (15-48x speedup)');
  } else if (!needsFrameRendering && needsFilterEncoding && videoElementCount === 1) {
    // Mode 2: Single video with FFmpeg filters (text/stickers)
    optimizationStrategy = 'direct-video-with-filters';
    console.log('⚡ [MODE DETECTION] Selected Mode 2: Direct video with filters (3-5x speedup)');
  } else if (
    videoElementCount > 1 &&
    !hasOverlappingVideos &&
    !hasImageElements &&
    !hasTextElements &&
    !hasStickers &&
    !hasEffects &&
    allVideosHaveLocalPath
  ) {
    // Mode 1.5: Multiple sequential videos - check if normalization needed
    console.log('🔍 [MODE DETECTION] Multiple sequential videos detected - checking properties...');

    const firstVideo = videoElements[0];
    const firstMediaItem = mediaItemsMap.get(firstVideo.mediaId);
    const targetWidth = firstMediaItem?.width || 1280;  // Fallback to 720p
    const targetHeight = firstMediaItem?.height || 720;
    const targetFps = (firstMediaItem as any)?.fps || 30;

    console.log(`🔍 [MODE DETECTION] Using target: ${targetWidth}x${targetHeight} @ ${targetFps}fps`);

    const videosMatch = checkVideoPropertiesMatch(
      videoElements,
      mediaItemsMap,
      targetWidth,
      targetHeight,
      targetFps
    );

    if (videosMatch) {
      // All videos match - can use direct copy without normalization
      optimizationStrategy = 'direct-copy';
      console.log('✅ [MODE DETECTION] Videos match - using Mode 1: Direct copy');
    } else {
      // Videos need normalization before concat
      optimizationStrategy = 'video-normalization';
      console.log('⚡ [MODE DETECTION] Selected Mode 1.5: Video normalization (5-7x speedup)');
    }
  } else {
    // Mode 3: Frame rendering - slowest but most flexible
    optimizationStrategy = 'image-pipeline';
    console.log('🎨 [MODE DETECTION] Selected Mode 3: Frame rendering (baseline speed)');
  }

  // Generate reason for strategy choice
  let reason = '';
  if (optimizationStrategy === 'direct-copy') {
    if (videoElementCount === 1) {
      reason = 'Single video with no overlays, effects, or compositing - using direct copy';
    } else {
      reason = 'Sequential videos without overlaps - using FFmpeg concat demuxer';
    }
  } else if (optimizationStrategy === 'direct-video-with-filters') {
    reason = 'Single video with text/sticker overlays - using FFmpeg filters';
  } else if (optimizationStrategy === 'video-normalization') {
    reason = 'Multiple videos with different properties - using FFmpeg normalization';
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

  // Log optimization strategy with clear mode indicators
  if (optimizationStrategy === 'direct-copy') {
    console.log('✅ [EXPORT ANALYSIS] MODE 1: Using DIRECT COPY optimization - Fast export! 🚀');
  } else if (optimizationStrategy === 'direct-video-with-filters') {
    console.log('⚡ [EXPORT ANALYSIS] MODE 2: Using DIRECT VIDEO WITH FILTERS - Fast export with text/stickers! ⚡');
  } else if (optimizationStrategy === 'video-normalization') {
    console.log('⚡ [EXPORT ANALYSIS] MODE 1.5: Using VIDEO NORMALIZATION - Fast export with padding! ⚡');
  } else {
    console.log('🎨 [EXPORT ANALYSIS] MODE 3: Using IMAGE PIPELINE - Slow export (frame-by-frame)');
  }

  return {
    needsImageProcessing,
    needsFrameRendering,      // NEW: Separate frame rendering flag
    needsFilterEncoding,      // NEW: Separate filter encoding flag
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
 * Detects overlapping videos to determine if compositing is required.
 *
 * Overlaps prevent direct FFmpeg concat; requires frame-by-frame compositing.
 * Sequential videos (no overlap) can use fast concat demuxer.
 *
 * @param ranges - Video time ranges from timeline elements
 * @returns true if any videos overlap (need compositing), false if sequential
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
