/**
 * Tests for Remotion Sync Manager
 *
 * @module lib/remotion/__tests__/sync-manager.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  globalToLocalFrame,
  localToGlobalFrame,
  timeToFrame,
  frameToTime,
  isElementActive,
  getActiveElements,
  SyncManager,
  DEFAULT_SYNC_CONFIG,
} from "../sync-manager";
import type { RemotionElement, TimelineTrack } from "@/types/timeline";

// Helper to create a test Remotion element
function createTestElement(
  overrides: Partial<RemotionElement> = {}
): RemotionElement {
  return {
    id: "test-elem-1",
    type: "remotion",
    name: "Test Element",
    duration: 5, // 5 seconds
    startTime: 2, // Starts at 2 seconds
    trimStart: 0,
    trimEnd: 0,
    componentId: "test-component",
    props: {},
    renderMode: "live",
    ...overrides,
  };
}

// Helper to create a test track
function createTestTrack(elements: RemotionElement[] = []): TimelineTrack {
  return {
    id: "test-track-1",
    name: "Test Track",
    type: "remotion",
    elements,
  };
}

describe("Frame Translation", () => {
  const fps = 30;

  describe("globalToLocalFrame", () => {
    it("should convert global frame to local frame", () => {
      const element = createTestElement({
        startTime: 2, // 60 frames at 30fps
        duration: 5, // 150 frames
        trimStart: 0,
        trimEnd: 0,
      });

      // Global frame 90 (3 seconds) -> local frame 30 (1 second into element)
      const localFrame = globalToLocalFrame(90, element, fps);
      expect(localFrame).toBe(30);
    });

    it("should return null for frames before element start", () => {
      const element = createTestElement({
        startTime: 2,
        duration: 5,
      });

      const localFrame = globalToLocalFrame(30, element, fps); // 1 second, before start
      expect(localFrame).toBeNull();
    });

    it("should return null for frames after element end", () => {
      const element = createTestElement({
        startTime: 2,
        duration: 5, // Ends at 7 seconds = 210 frames
      });

      const localFrame = globalToLocalFrame(300, element, fps); // 10 seconds
      expect(localFrame).toBeNull();
    });

    it("should account for trim start", () => {
      const element = createTestElement({
        startTime: 2,
        duration: 5,
        trimStart: 1, // Trim 1 second from start
      });

      // Element now effectively starts at 2s with content from 1s into source
      const localFrame = globalToLocalFrame(60, element, fps);
      // Local frame should be 30 (1 second into source) + offset
      expect(localFrame).not.toBeNull();
    });
  });

  describe("localToGlobalFrame", () => {
    it("should convert local frame to global frame", () => {
      const element = createTestElement({
        startTime: 2, // 60 frames
        trimStart: 0,
      });

      // Local frame 30 (1 second) -> global frame 90 (3 seconds)
      const globalFrame = localToGlobalFrame(30, element, fps);
      expect(globalFrame).toBe(90);
    });

    it("should handle zero local frame", () => {
      const element = createTestElement({
        startTime: 2,
        trimStart: 0,
      });

      const globalFrame = localToGlobalFrame(0, element, fps);
      expect(globalFrame).toBe(60); // 2 seconds
    });
  });

  describe("timeToFrame", () => {
    it("should convert time to frames correctly", () => {
      expect(timeToFrame(0, 30)).toBe(0);
      expect(timeToFrame(1, 30)).toBe(30);
      expect(timeToFrame(2.5, 30)).toBe(75);
    });

    it("should round to nearest frame", () => {
      expect(timeToFrame(1.016, 30)).toBe(30); // 1.016 * 30 = 30.48 -> 30
      expect(timeToFrame(1.017, 30)).toBe(31); // 1.017 * 30 = 30.51 -> 31
    });
  });

  describe("frameToTime", () => {
    it("should convert frames to time correctly", () => {
      expect(frameToTime(0, 30)).toBe(0);
      expect(frameToTime(30, 30)).toBe(1);
      expect(frameToTime(75, 30)).toBe(2.5);
    });
  });
});

describe("Active Element Detection", () => {
  describe("isElementActive", () => {
    it("should return true when time is within element range", () => {
      const element = createTestElement({
        startTime: 2,
        duration: 5,
        trimStart: 0,
        trimEnd: 0,
      });

      expect(isElementActive(element, 2)).toBe(true);
      expect(isElementActive(element, 4)).toBe(true);
      expect(isElementActive(element, 6.9)).toBe(true);
    });

    it("should return false when time is before element", () => {
      const element = createTestElement({
        startTime: 2,
        duration: 5,
      });

      expect(isElementActive(element, 0)).toBe(false);
      expect(isElementActive(element, 1.9)).toBe(false);
    });

    it("should return false when time is after element", () => {
      const element = createTestElement({
        startTime: 2,
        duration: 5,
      });

      expect(isElementActive(element, 7)).toBe(false);
      expect(isElementActive(element, 10)).toBe(false);
    });

    it("should account for trim when determining range", () => {
      const element = createTestElement({
        startTime: 2,
        duration: 5,
        trimStart: 1,
        trimEnd: 1,
      });

      // Effective duration is 3 seconds (5 - 1 - 1)
      // Effective end is 2 + 3 = 5 seconds
      expect(isElementActive(element, 4.9)).toBe(true);
      expect(isElementActive(element, 5)).toBe(false);
    });
  });

  describe("getActiveElements", () => {
    it("should return empty array for empty tracks", () => {
      const tracks: TimelineTrack[] = [];
      const result = getActiveElements(tracks, 2);

      expect(result).toEqual([]);
    });

    it("should return active elements at current time", () => {
      const element = createTestElement({
        startTime: 1,
        duration: 4,
      });
      const track = createTestTrack([element]);

      const result = getActiveElements([track], 2);

      expect(result.length).toBe(1);
      expect(result[0].element.id).toBe(element.id);
    });

    it("should return multiple active elements from different tracks", () => {
      const element1 = createTestElement({
        id: "elem-1",
        startTime: 0,
        duration: 5,
      });
      const element2 = createTestElement({
        id: "elem-2",
        startTime: 1,
        duration: 3,
      });

      const track1 = createTestTrack([element1]);
      const track2 = createTestTrack([element2]);
      track2.id = "track-2";

      const result = getActiveElements([track1, track2], 2);

      expect(result.length).toBe(2);
    });

    it("should exclude hidden elements", () => {
      const element = createTestElement({
        startTime: 1,
        duration: 4,
        hidden: true,
      });
      const track = createTestTrack([element]);

      const result = getActiveElements([track], 2);

      expect(result.length).toBe(0);
    });

    it("should only return Remotion elements", () => {
      const remotionElement = createTestElement({
        startTime: 1,
        duration: 4,
      });

      const track: TimelineTrack = {
        id: "mixed-track",
        name: "Mixed Track",
        type: "media", // Media track with mixed elements
        elements: [
          remotionElement,
          {
            id: "media-elem",
            type: "media",
            name: "Media Element",
            duration: 5,
            startTime: 0,
            trimStart: 0,
            trimEnd: 0,
            mediaId: "media-1",
          },
        ],
      };

      const result = getActiveElements([track], 2);

      expect(result.length).toBe(1);
      expect(result[0].element.type).toBe("remotion");
    });
  });
});

describe("SyncManager", () => {
  let manager: SyncManager;

  beforeEach(() => {
    manager = new SyncManager();
  });

  it("should create with default config", () => {
    expect(manager).toBeDefined();
  });

  it("should create with custom config", () => {
    const customManager = new SyncManager({
      driftTolerance: 5,
      seekDebounceMs: 32,
    });

    expect(customManager).toBeDefined();
  });

  it("should set tracks", () => {
    const tracks = [createTestTrack()];
    manager.setTracks(tracks);
    // No error thrown means success
    expect(true).toBe(true);
  });

  it("should set fps", () => {
    manager.setFps(60);
    // No error thrown means success
    expect(true).toBe(true);
  });

  it("should dispose cleanly", () => {
    manager.dispose();
    // No error thrown means success
    expect(true).toBe(true);
  });
});

describe("DEFAULT_SYNC_CONFIG", () => {
  it("should have reasonable default values", () => {
    expect(DEFAULT_SYNC_CONFIG.driftTolerance).toBeGreaterThan(0);
    expect(DEFAULT_SYNC_CONFIG.seekDebounceMs).toBeGreaterThan(0);
    expect(typeof DEFAULT_SYNC_CONFIG.preloadEnabled).toBe("boolean");
    expect(DEFAULT_SYNC_CONFIG.preloadFrames).toBeGreaterThan(0);
  });
});
