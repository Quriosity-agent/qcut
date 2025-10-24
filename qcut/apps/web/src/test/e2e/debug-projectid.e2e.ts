/**
 * Debug test to identify why 300+ databases are being created
 * This test will track projectId values throughout the sticker selection flow
 */

import { test, expect, createTestProject } from "./helpers/electron-helpers";

test.describe("Debug ProjectId Bug", () => {
  test("track projectId during sticker selection", async ({ page }) => {
    // Track all console messages
    const consoleLogs: Array<{ type: string; text: string }> = [];
    page.on("console", (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    // Create test project
    await createTestProject(page, "ProjectId Debug Test");

    // Get the project ID from the browser context
    const projectId = await page.evaluate(() => {
      // @ts-ignore - accessing Zustand store directly
      const projectStore = (window as any).__ZUSTAND_STORES__?.projectStore;
      if (projectStore) {
        const state = projectStore.getState();
        console.log("[DEBUG TEST] Project store state:", state);
        return state.activeProject?.id;
      }

      // Alternative: try to get from URL
      const url = window.location.href;
      const match = url.match(/\/editor\/([^/]+)/);
      return match ? match[1] : null;
    });

    console.log(`\n\n========================================`);
    console.log(`[DEBUG TEST] Initial project ID: ${projectId}`);
    console.log(`========================================\n\n`);

    // Open stickers panel
    await page.getByTestId("stickers-panel-tab").click();
    await expect(page.getByTestId("stickers-panel")).toBeVisible();

    // Wait for stickers to load
    const stickerItems = page.getByTestId("sticker-item");
    await stickerItems.first().waitFor({ state: "attached", timeout: 5000 }).catch(() => {});

    const itemCount = await stickerItems.count();
    console.log(`\n[DEBUG TEST] Found ${itemCount} sticker items\n`);

    if (itemCount > 0) {
      // Click on first 5 stickers and check projectId after each click
      const clickCount = Math.min(5, itemCount);

      for (let i = 0; i < clickCount; i++) {
        console.log(`\n[DEBUG TEST] === Clicking sticker ${i + 1} ===`);

        // Click sticker
        await stickerItems.nth(i).click();
        await page.waitForTimeout(500); // Wait for operation to complete

        // Check projectId after click
        const projectIdAfterClick = await page.evaluate(() => {
          // Try multiple ways to get the project ID
          const url = window.location.href;
          const urlMatch = url.match(/\/editor\/([^/]+)/);
          const urlId = urlMatch ? urlMatch[1] : null;

          // Check if we can access stores
          let storeId = null;
          try {
            // @ts-ignore
            if (window.useProjectStore) {
              // @ts-ignore
              const state = window.useProjectStore.getState();
              storeId = state.activeProject?.id;
            }
          } catch (e) {
            console.log("[DEBUG TEST] Could not access store:", e);
          }

          return { urlId, storeId };
        });

        console.log(`[DEBUG TEST] After sticker ${i + 1} click:`, projectIdAfterClick);

        // Check how many databases exist
        const dbCount = await page.evaluate(async () => {
          const databases = await indexedDB.databases();
          const mediaDb = databases.filter(db => db.name?.startsWith("video-editor-media-"));
          console.log(`[DEBUG TEST] Total databases: ${databases.length}, Media databases: ${mediaDb.length}`);

          if (mediaDb.length > 0 && mediaDb.length <= 10) {
            console.log(`[DEBUG TEST] Media database names:`, mediaDb.map(db => db.name));
          } else if (mediaDb.length > 10) {
            console.log(`[DEBUG TEST] First 5 media databases:`, mediaDb.slice(0, 5).map(db => db.name));
            console.log(`[DEBUG TEST] Last 5 media databases:`, mediaDb.slice(-5).map(db => db.name));
          }

          return { total: databases.length, mediaDbCount: mediaDb.length };
        });

        console.log(`[DEBUG TEST] Database count after sticker ${i + 1}: ${dbCount.mediaDbCount} media databases`);
      }
    }

    // Print all collected console logs
    console.log(`\n\n========================================`);
    console.log(`COLLECTED CONSOLE LOGS (${consoleLogs.length} total):`);
    console.log(`========================================\n`);

    const relevantLogs = consoleLogs.filter(log =>
      log.text.includes("ProjectId") ||
      log.text.includes("StickerSelect") ||
      log.text.includes("MediaStore") ||
      log.text.includes("StorageService") ||
      log.text.includes("DEBUG TEST")
    );

    relevantLogs.forEach(log => {
      console.log(`[${log.type.toUpperCase()}] ${log.text}`);
    });

    console.log(`\n========================================`);
    console.log(`END OF DEBUG TEST`);
    console.log(`========================================\n\n`);
  });
});
