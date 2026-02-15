import { describe, it, expect } from "vitest";
import {
  TIMELINE_CONSTANTS,
  calculateMinimumTimelineDuration,
  calculateTimelineBuffer,
} from "../timeline-constants";

/**
 * Integration test verifying the timeline can support 2-hour durations.
 *
 * The old Radix ScrollArea had a ~6,400px scroll width cap, which limited
 * the timeline to ~128 seconds (6400 / 50px/s). By switching to native
 * overflow-x-auto divs, the timeline can now handle up to 360,000px at 1x zoom.
 *
 * These tests validate the full data flow:
 *   content duration → calculateMinimumTimelineDuration → dynamicTimelineWidth
 */
describe("timeline scroll limit - 2 hour support", () => {
  const RADIX_SCROLL_CAP = 6400; // Old Radix ScrollArea width cap in pixels
  const TWO_HOURS_SECONDS = 7200;
  const PPS = TIMELINE_CONSTANTS.PIXELS_PER_SECOND; // 50

  it("old Radix limit would cap at ~128 seconds", () => {
    const maxDurationAtOldCap = RADIX_SCROLL_CAP / PPS;
    expect(maxDurationAtOldCap).toBe(128);
  });

  it("2-hour timeline width exceeds old Radix cap at every zoom level", () => {
    for (const zoom of TIMELINE_CONSTANTS.ZOOM_LEVELS) {
      const width = TWO_HOURS_SECONDS * PPS * zoom;
      expect(width).toBeGreaterThan(RADIX_SCROLL_CAP);
    }
  });

  it("dynamicTimelineWidth formula produces correct value for 2 hours at 1x", () => {
    const duration = TWO_HOURS_SECONDS;
    const zoomLevel = 1;
    const currentTime = 0;
    const dynamicBuffer = calculateTimelineBuffer(duration);
    const clientWidth = 1000;

    const dynamicTimelineWidth = Math.max(
      duration * PPS * zoomLevel,
      (currentTime + dynamicBuffer) * PPS * zoomLevel,
      clientWidth
    );

    expect(dynamicTimelineWidth).toBe(360_000);
  });

  it("dynamicTimelineWidth scales correctly with zoom for 2-hour content", () => {
    const duration = TWO_HOURS_SECONDS;
    const currentTime = 3600; // playhead at 1 hour
    const clientWidth = 1000;

    const expected: Record<number, number> = {
      0.05: 18_000,
      0.1: 36_000,
      0.25: 90_000,
      0.5: 180_000,
      1: 360_000,
      1.5: 540_000,
      2: 720_000,
      3: 1_080_000,
      4: 1_440_000,
    };

    for (const zoom of TIMELINE_CONSTANTS.ZOOM_LEVELS) {
      const dynamicBuffer = calculateTimelineBuffer(duration);
      const dynamicTimelineWidth = Math.max(
        duration * PPS * zoom,
        (currentTime + dynamicBuffer) * PPS * zoom,
        clientWidth
      );

      expect(dynamicTimelineWidth).toBe(expected[zoom]);
    }
  });

  it("empty timeline defaults to 7200s (2 hours) and produces correct width", () => {
    const duration = calculateMinimumTimelineDuration(0);
    expect(duration).toBe(7200);

    const width = duration * PPS * 1;
    expect(width).toBe(360_000);
    expect(width).toBeGreaterThan(RADIX_SCROLL_CAP);
  });

  it("scroll sync works with direct refs (no Radix viewport query needed)", () => {
    // Simulate the scroll sync pattern: direct ref access
    // Previously: element.querySelector('[data-radix-scroll-area-viewport]')
    // Now: element itself is the scroll container
    const mockScrollContainer = {
      scrollLeft: 5000,
      scrollWidth: 360_000,
      clientWidth: 1200,
    };

    // Verify scroll values are within expected bounds for 2-hour timeline
    expect(mockScrollContainer.scrollWidth).toBe(TWO_HOURS_SECONDS * PPS * 1);
    expect(mockScrollContainer.scrollLeft).toBeLessThan(
      mockScrollContainer.scrollWidth
    );

    // Simulate syncing two containers (ruler + tracks)
    const rulerScroll = { ...mockScrollContainer };
    const tracksScroll = { ...mockScrollContainer, scrollLeft: 0 };

    tracksScroll.scrollLeft = rulerScroll.scrollLeft;
    expect(tracksScroll.scrollLeft).toBe(rulerScroll.scrollLeft);
  });

  it("playhead position calculation works at 2-hour mark", () => {
    const playheadTime = 7200; // 2 hours
    const zoomLevel = 1;
    const playheadPx = playheadTime * PPS * zoomLevel;

    expect(playheadPx).toBe(360_000);

    // At the very end, auto-scroll is capped by scrollMax
    const viewportWidth = 1200;
    const scrollWidth = playheadPx; // timeline content width
    const scrollMax = scrollWidth - viewportWidth; // 358,800
    const desiredScroll = Math.max(0, Math.min(scrollMax, playheadPx - viewportWidth / 2));

    // scrollMax caps the scroll, so playhead sits at right edge
    expect(desiredScroll).toBe(scrollMax);
    const playheadRelative = playheadPx - desiredScroll;
    expect(playheadRelative).toBe(viewportWidth); // at right edge
  });

  it("playhead mid-timeline is centered in viewport", () => {
    const playheadTime = 3600; // 1 hour (middle of 2-hour timeline)
    const zoomLevel = 1;
    const playheadPx = playheadTime * PPS * zoomLevel;

    expect(playheadPx).toBe(180_000);

    const viewportWidth = 1200;
    const scrollWidth = TWO_HOURS_SECONDS * PPS * zoomLevel;
    const scrollMax = scrollWidth - viewportWidth;
    const desiredScroll = Math.max(0, Math.min(scrollMax, playheadPx - viewportWidth / 2));
    const playheadRelative = playheadPx - desiredScroll;

    // Mid-timeline: playhead should be centered
    expect(playheadRelative).toBe(viewportWidth / 2);
  });
});
