/**
 * Test helper for sticker overlay functionality
 * Run in browser console to test timeline integration
 */

export function setupStickerTest() {
  // Make stores available globally for testing
  const setupTestEnvironment = async () => {
    const { useStickersOverlayStore } = await import("@/stores/stickers-overlay-store");
    const { useTimelineStore } = await import("@/stores/timeline-store");
    const { useMediaStore } = await import("@/stores/media-store");
    
    // Clean up orphaned stickers
    const cleanupOrphans = () => {
      const stickerStore = useStickersOverlayStore.getState();
      const mediaStore = useMediaStore.getState();
      
      console.log("🧹 Cleaning up orphaned stickers...");
      const mediaIds = mediaStore.mediaItems.map(item => item.id);
      const cleaned = stickerStore.cleanupInvalidStickers(mediaIds);
      console.log(`✅ Cleanup complete. Cleaned ${cleaned} orphaned stickers`);
      
      // Also clear if no media exists
      if (mediaStore.mediaItems.length === 0 && stickerStore.overlayStickers.size > 0) {
        stickerStore.clearAllStickers();
        console.log("✅ Cleared all stickers (no media items exist)");
      }
    };
    
    // Test adding sticker to timeline
    const testTimelineIntegration = async () => {
      const mediaStore = useMediaStore.getState();
      const stickerStore = useStickersOverlayStore.getState();
      const timelineStore = useTimelineStore.getState();
      
      if (mediaStore.mediaItems.length === 0) {
        console.log("❌ No media items available. Please add some media first.");
        return;
      }
      
      // Use first image media item
      const testMedia = mediaStore.mediaItems.find(item => item.type === "image");
      if (!testMedia) {
        console.log("❌ No image media items available. Please add an image.");
        return;
      }
      
      console.log(`🎯 Testing with media: ${testMedia.name} (${testMedia.id})`);
      
      // Add sticker overlay
      const stickerId = await stickerStore.addOverlaySticker(testMedia.id, {
        position: { x: 50, y: 50 },
        timing: { startTime: 0, endTime: 5 }
      });
      
      console.log(`✅ Added sticker: ${stickerId}`);
      
      // Check timeline
      setTimeout(() => {
        const updatedTimeline = useTimelineStore.getState();
        const stickerTrack = updatedTimeline.tracks.find(t => t.type === "sticker");
        
        if (stickerTrack) {
          console.log("✅ Sticker track found:", stickerTrack);
          const stickerElement = stickerTrack.elements.find((el: any) => el.stickerId === stickerId);
          if (stickerElement) {
            console.log("✅ Sticker element found in timeline:", stickerElement);
          } else {
            console.log("❌ Sticker element NOT found in timeline");
          }
        } else {
          console.log("❌ Sticker track NOT found in timeline");
        }
        
        // Show current state
        console.log("📊 Current state:", {
          stickers: Array.from(stickerStore.overlayStickers.values()),
          tracks: updatedTimeline.tracks.map(t => ({ id: t.id, type: t.type, elements: t.elements.length }))
        });
      }, 1000);
    };
    
    // Export test functions globally
    (window as any).stickerTest = {
      cleanup: cleanupOrphans,
      test: testTimelineIntegration,
      getStores: () => ({
        stickers: useStickersOverlayStore.getState(),
        timeline: useTimelineStore.getState(),
        media: useMediaStore.getState()
      }),
      clearAll: () => {
        useStickersOverlayStore.getState().clearAllStickers();
        console.log("✅ Cleared all stickers");
      }
    };
    
    console.log("🚀 Sticker test helper loaded!");
    console.log("Commands:");
    console.log("  stickerTest.cleanup() - Clean orphaned stickers");
    console.log("  stickerTest.test() - Test timeline integration");
    console.log("  stickerTest.clearAll() - Clear all stickers");
    console.log("  stickerTest.getStores() - Get current store states");
  };
  
  setupTestEnvironment();
}

// Auto-run if in development
if (import.meta.env.DEV) {
  setupStickerTest();
}