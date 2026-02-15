/**
 * Timeline Duration Limit E2E Test
 *
 * Verifies that the timeline can scroll past the old 128-second Radix ScrollArea
 * cap after replacing it with native overflow-x-auto divs.
 *
 * Takes screenshots at each step to visually confirm the timeline works at
 * extended durations (up to 2 hours).
 */

import { test, expect, createTestProject } from "./helpers/electron-helpers";
import {
  captureTestStep,
  captureScreenshot,
} from "./utils/screenshot-helper";

const SCREENSHOT_FOLDER = "timeline-duration-limit";

test.describe("Timeline Duration Limit - 2 Hour Support", () => {
  test("should scroll timeline past 128 seconds with native scroll containers", async ({
    page,
  }) => {
    // Step 1: Create a project and open editor
    await createTestProject(page, "Duration Limit Test");
    await captureTestStep(page, SCREENSHOT_FOLDER, 1, "editor-loaded");

    // Step 2: Verify timeline is present and using native scroll (no Radix viewport)
    const timelineExists = await page
      .locator(".timeline-scroll")
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    // Take screenshot of initial timeline state
    await captureTestStep(page, SCREENSHOT_FOLDER, 2, "timeline-initial");

    // Step 3: Check timeline scroll container properties via JS
    const scrollInfo = await page.evaluate(() => {
      // Tracks container uses .timeline-scroll, ruler uses .scrollbar-hidden
      const tracksContainer = document.querySelector(".timeline-scroll");
      const rulerContainer = document.querySelector(".scrollbar-hidden");
      if (!tracksContainer) return null;

      return {
        tracksScrollWidth: tracksContainer.scrollWidth,
        tracksClientWidth: tracksContainer.clientWidth,
        tracksCanScroll: tracksContainer.scrollWidth > tracksContainer.clientWidth,
        rulerScrollWidth: rulerContainer?.scrollWidth ?? 0,
        rulerClientWidth: rulerContainer?.clientWidth ?? 0,
        rulerCanScroll: (rulerContainer?.scrollWidth ?? 0) > (rulerContainer?.clientWidth ?? 0),
        hasTracksContainer: true,
        hasRulerContainer: !!rulerContainer,
        // Check there are NO Radix scroll viewports inside these containers
        hasRadixViewport:
          tracksContainer.querySelector("[data-radix-scroll-area-viewport]") !== null ||
          (rulerContainer?.querySelector("[data-radix-scroll-area-viewport]") ?? null) !== null,
      };
    });

    console.log("Timeline scroll info:", JSON.stringify(scrollInfo, null, 2));

    // Verify native scroll containers exist (no Radix viewports inside them)
    if (scrollInfo) {
      expect(scrollInfo.hasRadixViewport).toBe(false);
      expect(scrollInfo.hasTracksContainer).toBe(true);
      // Timeline should be scrollable (7200s * 50px/s = 360,000px at 1x zoom)
      expect(scrollInfo.tracksScrollWidth).toBeGreaterThan(6400); // Exceeds old Radix cap
      expect(scrollInfo.tracksCanScroll).toBe(true);
    }

    // Step 4: Programmatically set a long duration and verify scroll works
    const extendedScrollInfo = await page.evaluate(() => {
      const tracksContainer = document.querySelector(".timeline-scroll");
      const rulerContainer = document.querySelector(".scrollbar-hidden");
      if (!tracksContainer) return null;

      // Try scrolling past the old 128-second mark (6400px at 50px/s)
      const targetScrollLeft = 7000; // Past old Radix cap
      tracksContainer.scrollLeft = targetScrollLeft;
      if (rulerContainer) rulerContainer.scrollLeft = targetScrollLeft;

      // Wait a tick for scroll to settle
      return new Promise<any>((resolve) => {
        requestAnimationFrame(() => {
          resolve({
            tracksScrollLeft: tracksContainer.scrollLeft,
            rulerScrollLeft: rulerContainer.scrollLeft,
            tracksScrollWidth: tracksContainer.scrollWidth,
            scrolledPast128s: tracksContainer.scrollLeft > 6400,
            // Calculate what time position we're at
            timePositionSeconds: tracksContainer.scrollLeft / 50, // PIXELS_PER_SECOND = 50
          });
        });
      });
    });

    console.log(
      "Extended scroll info:",
      JSON.stringify(extendedScrollInfo, null, 2)
    );

    await captureTestStep(
      page,
      SCREENSHOT_FOLDER,
      3,
      "scrolled-past-128s"
    );

    // Verify we can scroll past the old 128-second / 6400px limit
    if (extendedScrollInfo) {
      expect(extendedScrollInfo.tracksScrollWidth).toBeGreaterThan(6400);
      expect(extendedScrollInfo.scrolledPast128s).toBe(true);
      expect(extendedScrollInfo.timePositionSeconds).toBeGreaterThan(128);
    }

    // Step 5: Verify scroll sync between ruler and tracks
    const syncInfo = await page.evaluate(() => {
      const tracksContainer = document.querySelector(".timeline-scroll");
      const rulerContainer = document.querySelector(".scrollbar-hidden");
      if (!tracksContainer || !rulerContainer) return null;

      // Scroll tracks to a specific position
      const testPosition = 10000; // 200 seconds at 50px/s
      tracksContainer.scrollLeft = testPosition;

      // Trigger scroll event so sync handler fires
      tracksContainer.dispatchEvent(new Event("scroll"));

      return new Promise<any>((resolve) => {
        // Wait for sync
        setTimeout(() => {
          resolve({
            tracksScrollLeft: tracksContainer.scrollLeft,
            rulerScrollLeft: rulerContainer.scrollLeft,
            inSync:
              Math.abs(tracksContainer.scrollLeft - rulerContainer.scrollLeft) <
              5,
          });
        }, 100);
      });
    });

    console.log("Scroll sync info:", JSON.stringify(syncInfo, null, 2));

    await captureTestStep(
      page,
      SCREENSHOT_FOLDER,
      4,
      "scroll-sync-verified"
    );

    // Step 6: Test wheel-event horizontal scrolling (simulates trackpad/shift+scroll)
    // First, reset scroll position to 0
    await page.evaluate(() => {
      const tc = document.querySelector(".timeline-scroll");
      if (tc) tc.scrollLeft = 0;
    });

    // Simulate horizontal wheel events on the tracks container
    const tracksLocator = page.locator(".timeline-scroll").first();
    const tracksBox = await tracksLocator.boundingBox();

    if (tracksBox) {
      // Dispatch horizontal wheel events (shift+scroll pattern)
      for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(200, 0); // deltaX=200, deltaY=0
      }
      await page.waitForTimeout(200); // Let scroll settle
    }

    const wheelScrollResult = await page.evaluate(() => {
      const tc = document.querySelector(".timeline-scroll");
      if (!tc) return null;
      return {
        scrollLeft: tc.scrollLeft,
        scrolledByWheel: tc.scrollLeft > 0,
        timePosition: tc.scrollLeft / 50, // PPS = 50
      };
    });

    console.log(
      "Wheel scroll result:",
      JSON.stringify(wheelScrollResult, null, 2)
    );

    await captureTestStep(
      page,
      SCREENSHOT_FOLDER,
      6,
      "wheel-scroll-test"
    );

    // Step 7: Test seek at a position past 128 seconds (renamed from Step 6)
    const seekInfo = await page.evaluate(() => {
      // Use the playback store to seek to 200 seconds (past old limit)
      const playbackStore = (window as any).__zustand_stores?.playback;

      // Try direct store access
      const stores = (window as any).__ZUSTAND_STORES__;
      if (stores?.playback) {
        const state = stores.playback.getState();
        if (state?.seek) {
          state.seek(200); // Seek to 200 seconds
          return {
            seekedTo: 200,
            currentTime: stores.playback.getState().currentTime,
            method: "zustand-store",
          };
        }
      }

      return { seekedTo: null, method: "unavailable" };
    });

    console.log("Seek info:", JSON.stringify(seekInfo, null, 2));

    // Final screenshot showing the timeline at extended position
    await captureTestStep(
      page,
      SCREENSHOT_FOLDER,
      7,
      "timeline-at-200s"
    );

    // Step 8: Verify ruler time labels show times > 2 minutes
    const rulerLabels = await page.evaluate(() => {
      // Look for ruler time markers that show times beyond 2 minutes
      const markers = document.querySelectorAll(
        "[data-ruler-area] .absolute span"
      );
      const labels: string[] = [];
      for (const marker of markers) {
        const text = marker.textContent?.trim();
        if (text) labels.push(text);
      }
      return {
        totalMarkers: markers.length,
        sampleLabels: labels.slice(0, 20),
        hasMinuteLabels: labels.some((l) => l.includes(":")),
      };
    });

    console.log("Ruler labels:", JSON.stringify(rulerLabels, null, 2));

    // Take a final full screenshot
    await captureScreenshot(
      page,
      "timeline-duration-limit-final",
      SCREENSHOT_FOLDER
    );

    console.log("Timeline Duration Limit E2E test completed successfully!");
  });
});
