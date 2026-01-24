/**
 * Tests for Timeline Type Definitions and Utilities
 *
 * @module types/__tests__/timeline.test
 */

import { describe, it, expect } from "vitest";
import {
  isMediaElement,
  isTextElement,
  isStickerElement,
  isCaptionElement,
  isRemotionElement,
  getRemotionElements,
  getActiveRemotionElements,
  sortTracksByOrder,
  canElementGoOnTrack,
  validateElementTrackCompatibility,
  type TimelineElement,
  type MediaElement,
  type TextElement,
  type StickerElement,
  type CaptionElement,
  type RemotionElement,
  type TimelineTrack,
} from "../timeline";

// ============================================================================
// Test Helpers
// ============================================================================

function createMediaElement(overrides: Partial<MediaElement> = {}): MediaElement {
  return {
    id: "media-1",
    type: "media",
    name: "Test Media",
    duration: 10,
    startTime: 0,
    trimStart: 0,
    trimEnd: 0,
    mediaId: "media-file-1",
    ...overrides,
  };
}

function createTextElement(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: "text-1",
    type: "text",
    name: "Test Text",
    duration: 5,
    startTime: 0,
    trimStart: 0,
    trimEnd: 0,
    content: "Hello World",
    fontSize: 24,
    fontFamily: "Arial",
    color: "#ffffff",
    backgroundColor: "transparent",
    textAlign: "center",
    fontWeight: "normal",
    fontStyle: "normal",
    textDecoration: "none",
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    ...overrides,
  };
}

function createStickerElement(overrides: Partial<StickerElement> = {}): StickerElement {
  return {
    id: "sticker-1",
    type: "sticker",
    name: "Test Sticker",
    duration: 5,
    startTime: 0,
    trimStart: 0,
    trimEnd: 0,
    stickerId: "sticker-asset-1",
    mediaId: "sticker-media-1",
    ...overrides,
  };
}

function createCaptionElement(overrides: Partial<CaptionElement> = {}): CaptionElement {
  return {
    id: "caption-1",
    type: "captions",
    name: "Test Caption",
    duration: 3,
    startTime: 0,
    trimStart: 0,
    trimEnd: 0,
    text: "This is a caption",
    language: "en",
    source: "manual",
    ...overrides,
  };
}

function createRemotionElement(overrides: Partial<RemotionElement> = {}): RemotionElement {
  return {
    id: "remotion-1",
    type: "remotion",
    name: "Test Remotion",
    duration: 5,
    startTime: 0,
    trimStart: 0,
    trimEnd: 0,
    componentId: "test-component",
    props: {},
    renderMode: "live",
    ...overrides,
  };
}

function createTrack(type: TimelineTrack["type"], elements: TimelineElement[] = [], overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: `track-${type}-${Math.random().toString(36).substr(2, 9)}`,
    name: `${type} Track`,
    type,
    elements,
    ...overrides,
  };
}

// ============================================================================
// Type Guard Tests
// ============================================================================

describe("Type Guards", () => {
  describe("isMediaElement", () => {
    it("should return true for media elements", () => {
      const element = createMediaElement();
      expect(isMediaElement(element)).toBe(true);
    });

    it("should return false for non-media elements", () => {
      expect(isMediaElement(createTextElement())).toBe(false);
      expect(isMediaElement(createStickerElement())).toBe(false);
      expect(isMediaElement(createCaptionElement())).toBe(false);
      expect(isMediaElement(createRemotionElement())).toBe(false);
    });
  });

  describe("isTextElement", () => {
    it("should return true for text elements", () => {
      const element = createTextElement();
      expect(isTextElement(element)).toBe(true);
    });

    it("should return false for non-text elements", () => {
      expect(isTextElement(createMediaElement())).toBe(false);
      expect(isTextElement(createStickerElement())).toBe(false);
      expect(isTextElement(createCaptionElement())).toBe(false);
      expect(isTextElement(createRemotionElement())).toBe(false);
    });
  });

  describe("isStickerElement", () => {
    it("should return true for sticker elements", () => {
      const element = createStickerElement();
      expect(isStickerElement(element)).toBe(true);
    });

    it("should return false for non-sticker elements", () => {
      expect(isStickerElement(createMediaElement())).toBe(false);
      expect(isStickerElement(createTextElement())).toBe(false);
      expect(isStickerElement(createCaptionElement())).toBe(false);
      expect(isStickerElement(createRemotionElement())).toBe(false);
    });
  });

  describe("isCaptionElement", () => {
    it("should return true for caption elements", () => {
      const element = createCaptionElement();
      expect(isCaptionElement(element)).toBe(true);
    });

    it("should return false for non-caption elements", () => {
      expect(isCaptionElement(createMediaElement())).toBe(false);
      expect(isCaptionElement(createTextElement())).toBe(false);
      expect(isCaptionElement(createStickerElement())).toBe(false);
      expect(isCaptionElement(createRemotionElement())).toBe(false);
    });
  });

  describe("isRemotionElement", () => {
    it("should return true for remotion elements", () => {
      const element = createRemotionElement();
      expect(isRemotionElement(element)).toBe(true);
    });

    it("should return false for non-remotion elements", () => {
      expect(isRemotionElement(createMediaElement())).toBe(false);
      expect(isRemotionElement(createTextElement())).toBe(false);
      expect(isRemotionElement(createStickerElement())).toBe(false);
      expect(isRemotionElement(createCaptionElement())).toBe(false);
    });
  });
});

// ============================================================================
// Remotion Element Utility Tests
// ============================================================================

describe("Remotion Element Utilities", () => {
  describe("getRemotionElements", () => {
    it("should return empty array when no tracks", () => {
      const result = getRemotionElements([]);
      expect(result).toEqual([]);
    });

    it("should return empty array when no remotion elements", () => {
      const tracks = [
        createTrack("media", [createMediaElement()]),
        createTrack("text", [createTextElement()]),
      ];
      const result = getRemotionElements(tracks);
      expect(result).toEqual([]);
    });

    it("should return all remotion elements from tracks", () => {
      const remotion1 = createRemotionElement({ id: "remotion-1" });
      const remotion2 = createRemotionElement({ id: "remotion-2" });

      const tracks = [
        createTrack("media", [createMediaElement()]),
        createTrack("remotion", [remotion1]),
        createTrack("remotion", [remotion2]),
      ];

      const result = getRemotionElements(tracks);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("remotion-1");
      expect(result[1].id).toBe("remotion-2");
    });

    it("should find remotion elements in mixed tracks", () => {
      const remotion1 = createRemotionElement({ id: "remotion-1" });

      // Create a mixed track (shouldn't normally happen, but testing robustness)
      const mixedTrack: TimelineTrack = {
        id: "mixed-track",
        name: "Mixed Track",
        type: "media",
        elements: [createMediaElement(), remotion1],
      };

      const result = getRemotionElements([mixedTrack]);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("remotion-1");
    });
  });

  describe("getActiveRemotionElements", () => {
    it("should return empty array when no elements active", () => {
      const remotion = createRemotionElement({
        startTime: 10,
        duration: 5,
      });
      const tracks = [createTrack("remotion", [remotion])];

      const result = getActiveRemotionElements(tracks, 0);
      expect(result).toEqual([]);
    });

    it("should return elements active at current time", () => {
      const remotion = createRemotionElement({
        startTime: 2,
        duration: 5,
        trimStart: 0,
        trimEnd: 0,
      });
      const tracks = [createTrack("remotion", [remotion])];

      // At time 3, element should be active (starts at 2, ends at 7)
      const result = getActiveRemotionElements(tracks, 3);
      expect(result).toHaveLength(1);
    });

    it("should not include elements at exact end time", () => {
      const remotion = createRemotionElement({
        startTime: 0,
        duration: 5,
        trimStart: 0,
        trimEnd: 0,
      });
      const tracks = [createTrack("remotion", [remotion])];

      // At time 5, element should not be active (exclusive end)
      const result = getActiveRemotionElements(tracks, 5);
      expect(result).toEqual([]);
    });

    it("should include elements at exact start time", () => {
      const remotion = createRemotionElement({
        startTime: 2,
        duration: 5,
      });
      const tracks = [createTrack("remotion", [remotion])];

      // At time 2, element should be active (inclusive start)
      const result = getActiveRemotionElements(tracks, 2);
      expect(result).toHaveLength(1);
    });

    it("should account for trim values", () => {
      const remotion = createRemotionElement({
        startTime: 0,
        duration: 10,
        trimStart: 2,
        trimEnd: 3,
      });
      const tracks = [createTrack("remotion", [remotion])];

      // Effective duration is 10 - 2 - 3 = 5 seconds
      // Element ends at 0 + 5 = 5 seconds
      const atTime4 = getActiveRemotionElements(tracks, 4);
      expect(atTime4).toHaveLength(1);

      const atTime5 = getActiveRemotionElements(tracks, 5);
      expect(atTime5).toEqual([]);
    });

    it("should return multiple active elements from different tracks", () => {
      const remotion1 = createRemotionElement({
        id: "r1",
        startTime: 0,
        duration: 10,
      });
      const remotion2 = createRemotionElement({
        id: "r2",
        startTime: 2,
        duration: 6,
      });

      const tracks = [
        createTrack("remotion", [remotion1]),
        createTrack("remotion", [remotion2]),
      ];

      // At time 3, both should be active
      const result = getActiveRemotionElements(tracks, 3);
      expect(result).toHaveLength(2);
    });
  });
});

// ============================================================================
// Track Sorting Tests
// ============================================================================

describe("sortTracksByOrder", () => {
  it("should sort tracks by type priority", () => {
    const tracks = [
      createTrack("audio", [], { id: "audio-1" }),
      createTrack("media", [], { id: "media-1" }),
      createTrack("text", [], { id: "text-1" }),
      createTrack("remotion", [], { id: "remotion-1" }),
      createTrack("sticker", [], { id: "sticker-1" }),
      createTrack("captions", [], { id: "captions-1" }),
    ];

    const sorted = sortTracksByOrder(tracks);

    expect(sorted[0].type).toBe("text");
    expect(sorted[1].type).toBe("captions");
    expect(sorted[2].type).toBe("remotion");
    expect(sorted[3].type).toBe("sticker");
    expect(sorted[4].type).toBe("media");
    expect(sorted[5].type).toBe("audio");
  });

  it("should place main track first within same type", () => {
    const tracks = [
      createTrack("media", [], { id: "media-2", isMain: false }),
      createTrack("media", [], { id: "media-1", isMain: true }),
      createTrack("media", [], { id: "media-3", isMain: false }),
    ];

    const sorted = sortTracksByOrder(tracks);

    expect(sorted[0].id).toBe("media-1");
    expect(sorted[0].isMain).toBe(true);
  });

  it("should not mutate original array", () => {
    const tracks = [
      createTrack("audio", [], { id: "audio-1" }),
      createTrack("text", [], { id: "text-1" }),
    ];

    const originalOrder = tracks.map(t => t.id);
    sortTracksByOrder(tracks);

    expect(tracks.map(t => t.id)).toEqual(originalOrder);
  });

  it("should handle empty array", () => {
    const result = sortTracksByOrder([]);
    expect(result).toEqual([]);
  });

  it("should handle single track", () => {
    const tracks = [createTrack("media")];
    const result = sortTracksByOrder(tracks);
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// Track Compatibility Tests
// ============================================================================

describe("canElementGoOnTrack", () => {
  it("should allow text elements only on text tracks", () => {
    expect(canElementGoOnTrack("text", "text")).toBe(true);
    expect(canElementGoOnTrack("text", "media")).toBe(false);
    expect(canElementGoOnTrack("text", "remotion")).toBe(false);
  });

  it("should allow media elements on media and audio tracks", () => {
    expect(canElementGoOnTrack("media", "media")).toBe(true);
    expect(canElementGoOnTrack("media", "audio")).toBe(true);
    expect(canElementGoOnTrack("media", "text")).toBe(false);
    expect(canElementGoOnTrack("media", "remotion")).toBe(false);
  });

  it("should allow sticker elements only on sticker tracks", () => {
    expect(canElementGoOnTrack("sticker", "sticker")).toBe(true);
    expect(canElementGoOnTrack("sticker", "media")).toBe(false);
    expect(canElementGoOnTrack("sticker", "remotion")).toBe(false);
  });

  it("should allow caption elements only on caption tracks", () => {
    expect(canElementGoOnTrack("captions", "captions")).toBe(true);
    expect(canElementGoOnTrack("captions", "text")).toBe(false);
    expect(canElementGoOnTrack("captions", "remotion")).toBe(false);
  });

  it("should allow remotion elements only on remotion tracks", () => {
    expect(canElementGoOnTrack("remotion", "remotion")).toBe(true);
    expect(canElementGoOnTrack("remotion", "media")).toBe(false);
    expect(canElementGoOnTrack("remotion", "text")).toBe(false);
    expect(canElementGoOnTrack("remotion", "sticker")).toBe(false);
  });
});

describe("validateElementTrackCompatibility", () => {
  it("should return valid for compatible element and track", () => {
    const result = validateElementTrackCompatibility(
      { type: "remotion" },
      { type: "remotion" }
    );
    expect(result.isValid).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  });

  it("should return invalid with error message for incompatible pairs", () => {
    const result = validateElementTrackCompatibility(
      { type: "remotion" },
      { type: "media" }
    );
    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toBe("Remotion elements can only be placed on Remotion tracks");
  });

  it("should provide correct error messages for each element type", () => {
    const textResult = validateElementTrackCompatibility(
      { type: "text" },
      { type: "media" }
    );
    expect(textResult.errorMessage).toBe("Text elements can only be placed on text tracks");

    const stickerResult = validateElementTrackCompatibility(
      { type: "sticker" },
      { type: "text" }
    );
    expect(stickerResult.errorMessage).toBe("Sticker elements can only be placed on sticker tracks");

    const captionResult = validateElementTrackCompatibility(
      { type: "captions" },
      { type: "media" }
    );
    expect(captionResult.errorMessage).toBe("Caption elements can only be placed on caption tracks");

    const mediaResult = validateElementTrackCompatibility(
      { type: "media" },
      { type: "text" }
    );
    expect(mediaResult.errorMessage).toBe("Media elements can only be placed on media or audio tracks");
  });
});
