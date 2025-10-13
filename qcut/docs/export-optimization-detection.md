# Export Optimization Detection - Correct Implementation

## Overview
This document clarifies the correct way to detect if image processing is required for video export in QCut.

## ❌ INCORRECT Approach (from proposal)
```typescript
function needsImageProcessing(timeline: Timeline): boolean {
  // WRONG: Timeline elements don't have type 'image'
  const hasImageElements = timeline.tracks.some(track =>
    track.elements.some(el => el.type === 'image')
  );

  // WRONG: Elements have effectIds, not effects array
  const hasImageEffects = timeline.tracks.some(track =>
    track.elements.some(el =>
      el.effects?.some(effect => EFFECTS_REQUIRING_IMAGES.includes(effect.type))
    )
  );

  // WRONG: Stickers are timeline elements, not a separate array
  const hasStickers = timeline.stickers && timeline.stickers.length > 0;

  return hasImageElements || hasImageEffects || hasStickers;
}
```

## ✅ CORRECT Implementation

### 1. Image Element Detection
Timeline elements with visual media have `type: 'media'`. You must check the associated `MediaItem` to determine if it's an image:

```typescript
// Check for image elements
let hasImageElements = false;

for (const track of tracks) {
  for (const element of track.elements) {
    if (element.hidden) continue;

    // Media elements can be videos OR images
    if (element.type === 'media') {
      const mediaElement = element as MediaElement;
      const mediaItem = mediaItemsMap.get(mediaElement.mediaId);

      if (!mediaItem) continue;

      // Check the MediaItem type, not the element type
      if (mediaItem.type === 'image') {
        hasImageElements = true;
        break;
      }
    }
  }
}
```

**Key Points:**
- Timeline elements: `type: 'media'` (for both videos and images)
- Media items: `type: 'image' | 'video' | 'audio'`
- Must look up MediaItem using `element.mediaId`

### 2. Effects Detection
Timeline elements have `effectIds: string[]`, not an `effects` array:

```typescript
// Check for effects
let hasEffects = false;

for (const track of tracks) {
  for (const element of track.elements) {
    if (element.hidden) continue;

    // Check if element has any effects
    if (element.effectIds && element.effectIds.length > 0) {
      hasEffects = true;
      break;
    }
  }
}
```

**To check specific effect types:**
```typescript
// Optional: Look up effect details from effects store
if (element.effectIds && element.effectIds.length > 0) {
  for (const effectId of element.effectIds) {
    const effect = effectsStore.getEffect(effectId);
    if (effect && EFFECTS_REQUIRING_IMAGES.includes(effect.type)) {
      hasImageEffects = true;
      break;
    }
  }
}
```

**Key Points:**
- Elements have: `effectIds: string[]`
- Not: `effects: Effect[]`
- Use effect IDs to look up details from effects store if needed

### 3. Stickers Detection
Stickers are timeline elements with `type: 'sticker'`, not a separate array:

```typescript
// Check for stickers
let hasStickers = false;

for (const track of tracks) {
  for (const element of track.elements) {
    if (element.hidden) continue;

    // Stickers are timeline elements with type 'sticker'
    if (element.type === 'sticker') {
      hasStickers = true;
      break;
    }
  }
}
```

**Key Points:**
- Stickers are timeline elements: `element.type === 'sticker'`
- Not a separate `timeline.stickers` array
- Located in tracks like other elements

## Complete Working Example

See the actual implementation in `apps/web/src/lib/export-analysis.ts`:

```typescript
export function analyzeTimelineForExport(
  tracks: TimelineTrack[],
  mediaItems: MediaItem[]
): ExportAnalysis {
  const mediaItemsMap = new Map(mediaItems.map(item => [item.id, item]));

  let hasImageElements = false;
  let hasTextElements = false;
  let hasStickers = false;
  let hasEffects = false;
  let videoElementCount = 0;

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

        // Track video elements
        if (mediaItem.type === 'video') {
          videoElementCount++;
        }

        // Check for effects on this element
        if (element.effectIds && element.effectIds.length > 0) {
          hasEffects = true;
        }
      }
    }
  }

  // Determine if image processing is needed
  const needsImageProcessing =
    hasImageElements ||
    hasTextElements ||
    hasStickers ||
    hasEffects ||
    hasOverlappingVideos;

  return {
    needsImageProcessing,
    hasImageElements,
    hasTextElements,
    hasStickers,
    hasEffects,
    // ... other fields
  };
}
```

## Data Structure Reference

### TimelineElement
```typescript
type TimelineElement = {
  id: string;
  type: 'media' | 'text' | 'sticker';  // NOT 'image' or 'video'
  effectIds?: string[];  // Array of effect IDs, NOT effects objects
  hidden?: boolean;
  // ... other fields
}
```

### MediaElement (extends TimelineElement)
```typescript
interface MediaElement extends TimelineElement {
  type: 'media';
  mediaId: string;  // Reference to MediaItem
  // ... other fields
}
```

### MediaItem
```typescript
interface MediaItem {
  id: string;
  type: 'image' | 'video' | 'audio';  // Media type is here
  // ... other fields
}
```

## Common Mistakes

| Mistake | Correct Approach |
|---------|------------------|
| `element.type === 'image'` | `element.type === 'media' && mediaItem.type === 'image'` |
| `element.type === 'video'` | `element.type === 'media' && mediaItem.type === 'video'` |
| `element.effects` | `element.effectIds` |
| `timeline.stickers` | `element.type === 'sticker'` in tracks |

## Testing

See `apps/web/src/lib/__tests__/export-analysis.test.ts` for comprehensive test coverage of this logic.
